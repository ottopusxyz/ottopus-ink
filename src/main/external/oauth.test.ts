import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkServer, completeSignIn, isAllowedEndpoint, planSignIn, renewSignIn, resourceCovers, type SignIn, type SignInPlan } from './oauth'
import { createSignIns, type RemoteServer, type SecretBox } from './sign-ins'

type Route = (req: IncomingMessage, res: ServerResponse, body: string) => boolean | void

interface Fake {
  base: string
  mcp: string
  /** Everything asked of the fake, as "METHOD /path". */
  seen: string[]
  /** Forms sent to the token endpoint. */
  tokenForms: URLSearchParams[]
  registrations: Record<string, unknown>[]
  /** What the MCP endpoint accepts. Change it to revoke one. */
  goodTokens: Set<string>
  override: Map<string, Route>
}

const servers: Server[] = []

async function startFake(): Promise<Fake> {
  const fake: Fake = { base: '', mcp: '', seen: [], tokenForms: [], registrations: [], goodTokens: new Set(), override: new Map() }
  const json = (res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(value))
  }
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', fake.base)
      fake.seen.push(`${req.method} ${url.pathname}`)
      if (fake.override.get(url.pathname)?.(req, res, body)) return
      if (url.pathname === '/mcp') {
        if (fake.goodTokens.has((req.headers.authorization ?? '').replace('Bearer ', ''))) return json(res, 200, { jsonrpc: '2.0', id: 1, result: {} })
        return json(res, 401, {}, { 'WWW-Authenticate': `Bearer resource_metadata="${fake.base}/.well-known/oauth-protected-resource/mcp", scope="read write"` })
      }
      if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return json(res, 200, { resource: fake.mcp, authorization_servers: [fake.base] })
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return json(res, 200, {
          issuer: fake.base,
          authorization_endpoint: `${fake.base}/authorize`,
          token_endpoint: `${fake.base}/token`,
          registration_endpoint: `${fake.base}/register`,
          code_challenge_methods_supported: ['S256'],
        })
      }
      if (url.pathname === '/register') {
        fake.registrations.push(JSON.parse(body) as Record<string, unknown>)
        return json(res, 201, { client_id: 'the-client' })
      }
      if (url.pathname === '/token') {
        const form = new URLSearchParams(body)
        fake.tokenForms.push(form)
        const token = form.get('grant_type') === 'refresh_token' ? 'renewed-token' : 'first-token'
        fake.goodTokens.add(token)
        return json(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600, refresh_token: 'the-refresh' })
      }
      json(res, 404, {})
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  fake.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  fake.mcp = `${fake.base}/mcp`
  return fake
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close()
    server.closeAllConnections()
  }
})

/** A person agreeing in their browser: the authorization server sends them straight back with a code. */
const approving = async (url: string) => {
  const asked = new URL(url)
  const back = new URL(asked.searchParams.get('redirect_uri') ?? '')
  back.searchParams.set('code', 'the-code')
  back.searchParams.set('state', asked.searchParams.get('state') ?? '')
  await fetch(back)
}

const signal = () => new AbortController().signal

describe('which addresses a server may name', () => {
  const remote = 'https://near.test/mcp'
  const local = 'http://127.0.0.1:9000/mcp'

  it('takes https', () => expect(isAllowedEndpoint('https://as.test/a', remote)).toBe(true))
  it('refuses plain http from a remote server, even to this computer', () => {
    expect(isAllowedEndpoint('http://as.test/a', remote)).toBe(false)
    expect(isAllowedEndpoint('http://127.0.0.1:1/a', remote)).toBe(false)
  })
  it('lets a server on this computer use this computer', () => expect(isAllowedEndpoint('http://127.0.0.1:1/a', local)).toBe(true))
  it.each(['https://127.0.0.1:8443/a', 'https://localhost/a', 'https://10.0.0.1/a', 'https://192.168.1.1/a', 'https://169.254.169.254/a', 'https://172.16.0.1/a', 'https://100.64.0.1/a', 'https://[::1]/a', 'https://[fd00::1]/a', 'https://[fe80::1]/a', 'https://0x7f.1/a', 'https://2130706433/a'])(
    'refuses %s from a remote server',
    (value) => expect(isAllowedEndpoint(value, remote)).toBe(false),
  )
  it('lets a server on a private network use that network', () => expect(isAllowedEndpoint('https://10.0.0.2/a', 'https://10.0.0.1/mcp')).toBe(true))
  it('does not take a public name for a private one', () => expect(isAllowedEndpoint('https://10.0.0.1.example.test/a', remote)).toBe(true))
  it('still refuses http elsewhere for a local server', () => expect(isAllowedEndpoint('http://as.test/a', local)).toBe(false))
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@as.test/a', 'not a url', 7, null])('refuses %s', (value) => {
    expect(isAllowedEndpoint(value, remote)).toBe(false)
  })
})

describe('what resource a server may claim', () => {
  it.each([
    ['https://near.test/mcp', true],
    ['https://near.test/', true],
    ['https://near.test', true],
    ['https://other.test/mcp', false],
    ['https://near.test/other', false],
    ['https://near.test/mc', false],
    ['http://near.test/mcp', false],
    [7, false],
  ])('%s for https://near.test/mcp: %s', (resource, expected) => {
    expect(resourceCovers(resource, 'https://near.test/mcp')).toBe(expected)
  })
})

describe('checkServer', () => {
  it('says when a session is turned away', async () => {
    const fake = await startFake()
    expect(await checkServer(fake.mcp, 'http', null)).toBe('needs-sign-in')
  })

  it('says when it would be let in', async () => {
    const fake = await startFake()
    fake.goodTokens.add('abc')
    expect(await checkServer(fake.mcp, 'http', 'abc')).toBe('ok')
  })

  it('takes a server with no sign-in as open', async () => {
    const fake = await startFake()
    fake.override.set('/mcp', (_req, res) => {
      res.writeHead(200).end('{}')
      return true
    })
    expect(await checkServer(fake.mcp, 'http', null)).toBe('ok')
  })

  it('does not mistake a server being down for needing a sign-in', async () => {
    const fake = await startFake()
    const dead = fake.mcp
    for (const server of servers.splice(0)) {
      server.close()
      server.closeAllConnections()
    }
    expect(await checkServer(dead, 'http', null)).toBe('unreachable')
  })

  it('does not follow a redirect with a token', async () => {
    const fake = await startFake()
    fake.override.set('/mcp', (_req, res) => {
      res.writeHead(302, { Location: `${fake.base}/elsewhere` }).end()
      return true
    })
    expect(await checkServer(fake.mcp, 'http', 'secret')).toBe('unreachable')
    expect(fake.seen).not.toContain('POST /elsewhere')
  })
})

describe('planSignIn', () => {
  it('finds the way in from what the server says', async () => {
    const fake = await startFake()
    expect(await planSignIn(fake.mcp, 'http')).toEqual({
      authorizationEndpoint: `${fake.base}/authorize`,
      tokenEndpoint: `${fake.base}/token`,
      registrationEndpoint: `${fake.base}/register`,
      resource: fake.mcp,
      scope: 'read write',
      host: new URL(fake.base).host,
      issuer: fake.base,
      issuerAnswers: false,
    })
  })

  const answering = (fake: Fake, path: string, value: unknown) =>
    fake.override.set(path, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
      return true
    })
  const metadata = (fake: Fake, changes: Record<string, unknown>) => ({
    issuer: fake.base,
    authorization_endpoint: `${fake.base}/authorize`,
    token_endpoint: `${fake.base}/token`,
    registration_endpoint: `${fake.base}/register`,
    code_challenge_methods_supported: ['S256'],
    ...changes,
  })

  it('refuses details made out for another address', async () => {
    const fake = await startFake()
    answering(fake, '/.well-known/oauth-protected-resource/mcp', { resource: 'https://other.test/mcp', authorization_servers: [fake.base] })
    await expect(planSignIn(fake.mcp, 'http')).rejects.toThrow(/different address/)
  })

  it('refuses a sign-in without PKCE', async () => {
    const fake = await startFake()
    answering(fake, '/.well-known/oauth-authorization-server', metadata(fake, { code_challenge_methods_supported: ['plain'] }))
    await expect(planSignIn(fake.mcp, 'http')).rejects.toThrow(/secure enough/)
    answering(fake, '/.well-known/oauth-authorization-server', metadata(fake, { code_challenge_methods_supported: undefined }))
    await expect(planSignIn(fake.mcp, 'http')).rejects.toThrow(/secure enough/)
  })

  it('refuses metadata that claims to be some other issuer', async () => {
    const fake = await startFake()
    answering(fake, '/.well-known/oauth-authorization-server', metadata(fake, { issuer: 'https://other.test' }))
    await expect(planSignIn(fake.mcp, 'http')).rejects.toThrow(/doesn't say how/)
  })

  it('refuses to send a real provider\'s code to the token endpoint of someone else', async () => {
    const fake = await startFake()
    answering(fake, '/.well-known/oauth-authorization-server', metadata(fake, { authorization_endpoint: 'http://localhost:1/authorize' }))
    await expect(planSignIn(fake.mcp, 'http')).rejects.toThrow(/different sites/)
  })

  it('still names this server as the resource when it has no details of its own', async () => {
    const fake = await startFake()
    fake.override.set('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
      res.writeHead(404).end()
      return true
    })
    expect((await planSignIn(fake.mcp, 'http')).resource).toBe(fake.mcp)
  })

  it('refuses a token endpoint at an unsafe address', async () => {
    const fake = await startFake()
    answering(fake, '/.well-known/oauth-authorization-server', metadata(fake, { token_endpoint: 'http://evil.test/token' }))
    await expect(planSignIn(fake.mcp, 'http')).rejects.toThrow(/safe address/)
  })

  it('says so when it would need an app registered by hand', async () => {
    const fake = await startFake()
    answering(fake, '/.well-known/oauth-authorization-server', metadata(fake, { registration_endpoint: undefined }))
    await expect(planSignIn(fake.mcp, 'http')).rejects.toThrow(/by hand/)
  })

  it('takes details too big to read as no details, so they count for nothing', async () => {
    const fake = await startFake()
    fake.override.set('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
      res.writeHead(200).end(`{"resource":"${'x'.repeat(2 * 1024 * 1024)}"}`)
      return true
    })
    expect(await planSignIn(fake.mcp, 'http')).toMatchObject({ resource: fake.mcp, authorizationEndpoint: `${fake.base}/authorize` })
  })
})

describe('completeSignIn', () => {
  it('runs the whole way with PKCE, and asks for the token for this server only', async () => {
    const fake = await startFake()
    const plan = await planSignIn(fake.mcp, 'http')
    let authorizeUrl = new URL('http://unset')
    const signIn = await completeSignIn(plan, {
      signal: signal(),
      openBrowser: async (url) => {
        authorizeUrl = new URL(url)
        await approving(url)
      },
    })

    expect(signIn).toMatchObject({ accessToken: 'first-token', refreshToken: 'the-refresh', clientId: 'the-client', resource: fake.mcp })
    expect(signIn.expiresAt).toBeGreaterThan(Date.now())

    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizeUrl.searchParams.get('resource')).toBe(fake.mcp)
    expect(authorizeUrl.searchParams.get('scope')).toBe('read write')
    expect(authorizeUrl.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)

    const form = fake.tokenForms[0]
    const challenge = createHash('sha256').update(form?.get('code_verifier') ?? '').digest('base64url')
    expect(challenge).toBe(authorizeUrl.searchParams.get('code_challenge'))
    expect(form?.get('code')).toBe('the-code')
    expect(form?.get('resource')).toBe(fake.mcp)
    expect(fake.registrations[0]).toMatchObject({ client_name: 'Ottopus Ink', token_endpoint_auth_method: 'none' })
  })

  it('ignores a callback with the wrong state, and goes on waiting for the real one', async () => {
    const fake = await startFake()
    const plan = await planSignIn(fake.mcp, 'http')
    const signIn = await completeSignIn(plan, {
      signal: signal(),
      openBrowser: async (url) => {
        const asked = new URL(url)
        const back = new URL(asked.searchParams.get('redirect_uri') ?? '')
        back.searchParams.set('code', 'planted-code')
        back.searchParams.set('state', 'not-the-state')
        expect((await fetch(back)).status).toBe(404)
        await approving(url)
      },
    })
    expect(signIn.accessToken).toBe('first-token')
    expect(fake.tokenForms.map((form) => form.get('code'))).toEqual(['the-code'])
  })

  it('survives a callback built to crash it, whose state matches in length but not bytes', async () => {
    const fake = await startFake()
    const plan = await planSignIn(fake.mcp, 'http')
    const signIn = await completeSignIn(plan, {
      signal: signal(),
      openBrowser: async (url) => {
        const back = new URL(new URL(url).searchParams.get('redirect_uri') ?? '')
        back.searchParams.set('code', 'x')
        back.searchParams.set('state', 'é'.repeat(43))
        expect((await fetch(back)).status).toBe(404)
        await approving(url)
      },
    })
    expect(signIn.accessToken).toBe('first-token')
  })

  const returning = (iss: string | null) => async (url: string) => {
    const asked = new URL(url)
    const back = new URL(asked.searchParams.get('redirect_uri') ?? '')
    back.searchParams.set('code', 'the-code')
    back.searchParams.set('state', asked.searchParams.get('state') ?? '')
    if (iss !== null) back.searchParams.set('iss', iss)
    await fetch(back)
  }

  it('refuses a code that says it came from a different issuer', async () => {
    const fake = await startFake()
    const plan = await planSignIn(fake.mcp, 'http')
    await expect(completeSignIn(plan, { signal: signal(), openBrowser: returning('https://honest.test') })).rejects.toThrow(/other than expected/)
    expect(fake.tokenForms).toEqual([])
  })

  it('takes a code that names the right issuer', async () => {
    const fake = await startFake()
    const plan = await planSignIn(fake.mcp, 'http')
    expect((await completeSignIn(plan, { signal: signal(), openBrowser: returning(fake.base) })).accessToken).toBe('first-token')
  })

  it('refuses a code with no issuer from one that promised to name itself', async () => {
    const fake = await startFake()
    const plan = { ...(await planSignIn(fake.mcp, 'http')), issuerAnswers: true }
    await expect(completeSignIn(plan, { signal: signal(), openBrowser: returning(null) })).rejects.toThrow(/other than expected/)
  })

  it('fails when the person refuses at the server', async () => {
    const fake = await startFake()
    const plan = await planSignIn(fake.mcp, 'http')
    const finished = completeSignIn(plan, {
      signal: signal(),
      openBrowser: async (url) => {
        const asked = new URL(url)
        const back = new URL(asked.searchParams.get('redirect_uri') ?? '')
        back.searchParams.set('error', 'access_denied')
        back.searchParams.set('state', asked.searchParams.get('state') ?? '')
        await fetch(back)
      },
    })
    await expect(finished).rejects.toThrow(/didn't finish/)
    expect(fake.tokenForms).toEqual([])
  })

  it('stops waiting when cancelled, and stops listening', async () => {
    const fake = await startFake()
    const plan = await planSignIn(fake.mcp, 'http')
    const controller = new AbortController()
    let redirect = ''
    const finished = completeSignIn(plan, {
      signal: controller.signal,
      openBrowser: async (url) => {
        redirect = new URL(url).searchParams.get('redirect_uri') ?? ''
        setTimeout(() => controller.abort(), 10)
      },
    })
    await expect(finished).rejects.toThrow(/cancelled/)
    await expect(fetch(redirect)).rejects.toThrow()
  })

  it('opens no browser if already cancelled', async () => {
    const fake = await startFake()
    const plan = await planSignIn(fake.mcp, 'http')
    const controller = new AbortController()
    controller.abort()
    let opened = false
    await expect(completeSignIn(plan, { signal: controller.signal, openBrowser: async () => void (opened = true) })).rejects.toThrow()
    expect(opened).toBe(false)
  })

  it('returns no token when cancelled while asking for it', async () => {
    const fake = await startFake()
    const controller = new AbortController()
    fake.override.set('/token', () => {
      controller.abort()
      return true
    })
    const plan = await planSignIn(fake.mcp, 'http')
    await expect(completeSignIn(plan, { signal: controller.signal, openBrowser: approving })).rejects.toThrow()
  })

  it('gives up after a time', async () => {
    const fake = await startFake()
    const plan = await planSignIn(fake.mcp, 'http')
    await expect(completeSignIn(plan, { signal: signal(), timeoutMs: 20, openBrowser: async () => undefined })).rejects.toThrow(/too long/)
  })

  it('refuses a token that would not be safe in a header', async () => {
    const fake = await startFake()
    fake.override.set('/token', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'two\r\nparts', token_type: 'Bearer' }))
      return true
    })
    const plan = await planSignIn(fake.mcp, 'http')
    await expect(completeSignIn(plan, { signal: signal(), openBrowser: approving })).rejects.toThrow(/didn't complete/)
  })

  it('refuses a token that is not a bearer token', async () => {
    const fake = await startFake()
    fake.override.set('/token', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'abc', token_type: 'mac' }))
      return true
    })
    const plan = await planSignIn(fake.mcp, 'http')
    await expect(completeSignIn(plan, { signal: signal(), openBrowser: approving })).rejects.toThrow(/can't pass on/)
  })
})

describe('renewSignIn', () => {
  const signedIn = (fake: Fake): SignIn => ({ accessToken: 'old', refreshToken: 'the-refresh', expiresAt: 0, tokenEndpoint: `${fake.base}/token`, clientId: 'the-client', clientSecret: null, resource: fake.mcp })

  it('swaps the refresh token for a new access token', async () => {
    const fake = await startFake()
    expect(await renewSignIn(signedIn(fake))).toMatchObject({ accessToken: 'renewed-token', refreshToken: 'the-refresh' })
    expect(fake.tokenForms[0]?.get('grant_type')).toBe('refresh_token')
    expect(fake.tokenForms[0]?.get('resource')).toBe(fake.mcp)
  })

  it('keeps the refresh token when none comes back', async () => {
    const fake = await startFake()
    fake.override.set('/token', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'renewed', token_type: 'Bearer' }))
      return true
    })
    expect((await renewSignIn(signedIn(fake))).refreshToken).toBe('the-refresh')
  })
})

describe('createSignIns', () => {
  let dir: string
  let file: string
  /** Reversible but not plain text, to show what's stored went through the box. */
  const box: SecretBox = {
    canKeep: () => true,
    seal: (text) => Buffer.from(text).reverse(),
    open: (data) => Buffer.from(data).reverse().toString(),
  }
  const remoteOf = (fake: Fake): RemoteServer => ({ transport: 'http', url: fake.mcp, headers: {} })
  const make = (useBox: SecretBox = box) => createSignIns({ file, box: useBox, openBrowser: approving })
  const signedIn = async (fake: Fake, signIns = make()) => {
    const server = remoteOf(fake)
    await signIns.signIn(server, (await signIns.plan(server)) satisfies SignInPlan, signal())
    return { signIns, server }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ink-sign-ins-'))
    file = join(dir, 'sign-ins.bin')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('leaves alone a local server, and one with its own headers, without contacting it', async () => {
    const fake = await startFake()
    const signIns = make()
    expect(await signIns.accessFor({ transport: 'stdio', command: '/x', args: [], env: {}, envNames: [] })).toEqual({ kind: 'open' })
    expect(await signIns.accessFor({ transport: 'http', url: fake.mcp, headers: { Authorization: 'Bearer ${KEY}' } })).toEqual({ kind: 'open' })
    expect(fake.seen).toEqual([])
  })

  it('says a server that turns it away needs a sign-in', async () => {
    const fake = await startFake()
    expect(await make().accessFor(remoteOf(fake))).toEqual({ kind: 'needs-sign-in' })
  })

  it('hands over the token once signed in', async () => {
    const fake = await startFake()
    const { signIns, server } = await signedIn(fake)
    expect(signIns.isSignedIn(server)).toBe(true)
    expect(await signIns.accessFor(server)).toEqual({ kind: 'token', token: 'first-token' })
  })

  it('stores it through the box only, readable by no other user, and finds it after a restart', async () => {
    const fake = await startFake()
    const { server } = await signedIn(fake)
    expect(readFileSync(file).toString()).not.toContain('first-token')
    expect(readFileSync(file).toString()).not.toContain('the-refresh')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(await make().accessFor(server)).toEqual({ kind: 'token', token: 'first-token' })
  })

  it('writes nothing where the OS cannot encrypt, and forgets on restart', async () => {
    const fake = await startFake()
    const noKeyring: SecretBox = { ...box, canKeep: () => false }
    const { signIns, server } = await signedIn(fake, make(noKeyring))
    expect(existsSync(file)).toBe(false)
    expect(await signIns.accessFor(server)).toMatchObject({ kind: 'token' })
    expect(make(noKeyring).isSignedIn(server)).toBe(false)
  })

  it('treats a damaged file as signed out', async () => {
    const fake = await startFake()
    writeFileSync(file, 'not what was sealed')
    expect(make().isSignedIn(remoteOf(fake))).toBe(false)
  })

  it('goes by address, so a changed address gets nothing', async () => {
    const fake = await startFake()
    const { signIns } = await signedIn(fake)
    expect(signIns.isSignedIn({ transport: 'http', url: `${fake.base}/other`, headers: {} })).toBe(false)
  })

  it('renews a token the server has stopped taking', async () => {
    const fake = await startFake()
    const { signIns, server } = await signedIn(fake)
    fake.goodTokens.delete('first-token')
    expect(await signIns.accessFor(server)).toEqual({ kind: 'token', token: 'renewed-token' })
    expect(await make().accessFor(server)).toEqual({ kind: 'token', token: 'renewed-token' })
  })

  it('renews one about to run out before using it', async () => {
    const fake = await startFake()
    fake.override.set('/token', (_req, res, body) => {
      const renewing = new URLSearchParams(body).get('grant_type') === 'refresh_token'
      const token = renewing ? 'renewed-token' : 'short-token'
      fake.goodTokens.add(token)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 5, refresh_token: 'r' }))
      return true
    })
    const { signIns, server } = await signedIn(fake)
    expect(await signIns.accessFor(server)).toEqual({ kind: 'token', token: 'renewed-token' })
  })

  it('goes back to needing a sign-in when it cannot be renewed, and forgets the dead one', async () => {
    const fake = await startFake()
    const { signIns, server } = await signedIn(fake)
    fake.goodTokens.clear()
    fake.override.set('/token', (_req, res) => {
      res.writeHead(400).end('{}')
      return true
    })
    expect(await signIns.accessFor(server)).toEqual({ kind: 'needs-sign-in' })
    expect(signIns.isSignedIn(server)).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('goes in with the token when the server cannot be reached, rather than saying sign in', async () => {
    const fake = await startFake()
    const { signIns, server } = await signedIn(fake)
    for (const running of servers.splice(0)) {
      running.close()
      running.closeAllConnections()
    }
    expect(await signIns.accessFor(server)).toEqual({ kind: 'token', token: 'first-token' })
  })

  it('does not let a renewal on its way bring back a sign-in after signing out', async () => {
    const fake = await startFake()
    const { signIns, server } = await signedIn(fake)
    fake.goodTokens.clear()
    let release = () => undefined as void
    const held = new Promise<void>((resolve) => (release = resolve))
    fake.override.set('/token', (_req, res) => {
      void held.then(() => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'renewed-token', token_type: 'Bearer', refresh_token: 'r' })))
      return true
    })
    const asked = signIns.accessFor(server)
    await new Promise((resolve) => setTimeout(resolve, 100))
    signIns.signOut(server)
    release()
    expect(await asked).toEqual({ kind: 'needs-sign-in' })
    expect(signIns.isSignedIn(server)).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('renews once when two chats start together', async () => {
    const fake = await startFake()
    const { signIns, server } = await signedIn(fake)
    fake.goodTokens.delete('first-token')
    const answers = await Promise.all([signIns.accessFor(server), signIns.accessFor(server)])
    expect(answers).toEqual([{ kind: 'token', token: 'renewed-token' }, { kind: 'token', token: 'renewed-token' }])
    expect(fake.tokenForms.filter((form) => form.get('grant_type') === 'refresh_token')).toHaveLength(1)
  })

  it('looks after a server whose only headers carry no sign-in, and sends them along', async () => {
    const fake = await startFake()
    let tenant: string | undefined
    fake.override.set('/mcp', (req, res) => {
      tenant = req.headers['x-tenant'] as string | undefined
      res.writeHead(401).end('{}')
      return true
    })
    const server: RemoteServer = { transport: 'http', url: fake.mcp, headers: { 'X-Tenant': 'demo' } }
    expect(make().handles(server)).toBe(true)
    expect(await make().accessFor(server)).toEqual({ kind: 'needs-sign-in' })
    expect(tenant).toBe('demo')
  })

  it.each(['Authorization', 'X-API-Key', 'x-auth-token'])('leaves alone a server with its own %s header', (name) => {
    expect(createSignIns({ file, box, openBrowser: approving }).handles({ transport: 'http', url: 'https://near.test/mcp', headers: { [name]: 'x' } })).toBe(false)
  })

  it('removes the file on signing out of the last one', async () => {
    const fake = await startFake()
    const { signIns, server } = await signedIn(fake)
    signIns.signOut(server)
    expect(signIns.isSignedIn(server)).toBe(false)
    expect(existsSync(file)).toBe(false)
  })
})
