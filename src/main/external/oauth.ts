import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Signing in to a remote MCP server the way the MCP spec describes: find its
 * authorization server, register, then OAuth with PKCE and a redirect back to this
 * computer. Written out here rather than taken from the MCP SDK, which would bring
 * Express and a dozen other packages into a wallet's main process.
 *
 * Everything a server says is untrusted. It can't send a token anywhere but the
 * authorization server it names for itself, and that can't be a plain-text address.
 */

export type Fetch = typeof fetch

/** What's kept after signing in. Secret: never goes to the page. */
export interface SignIn {
  accessToken: string
  refreshToken: string | null
  /** Milliseconds, or null if the server didn't say. */
  expiresAt: number | null
  tokenEndpoint: string
  clientId: string
  clientSecret: string | null
  /** Null if the server doesn't name itself as a resource. */
  resource: string | null
}

/** How to sign in to a server, once it has been looked up. */
export interface SignInPlan {
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  resource: string | null
  scope: string | null
  /** Where the browser will open, to show in the dialog. */
  host: string
  /** Who should be answering, to check what the browser brings back. */
  issuer: string
  /** The issuer promises to say who it is on the way back, so its silence means something's wrong. */
  issuerAnswers: boolean
}

export type ServerState = 'ok' | 'needs-sign-in' | 'unreachable'

const REQUEST_MS = 10_000
/** A new chat waits for this, so a slow server can't hold it up for long. */
const CHECK_MS = 4_000
const MAX_RESPONSE_BYTES = 1024 * 1024
const CALLBACK_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Ottopus Ink</title><body style="font-family:sans-serif;margin:3em"><h1>You can close this tab</h1><p>Go back to Ottopus Ink.</p></body>'

const isLoopback = (url: URL) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)

/**
 * Whether a URL is written as an address on this computer or a private network. A
 * public name that resolves to one can't be caught here. URL has already turned other
 * spellings of an IPv4 address into dotted form.
 */
function isPrivateAddress({ hostname }: URL): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.includes(':')) return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:')
  const [first, second] = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.split('.').map(Number) : []
  if (first === undefined || second === undefined) return false
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

/**
 * Whether an address a server named may be used: https, and not written as an address
 * on a private network unless the server is on one too, so a remote server can't point
 * Ink at something inside. Plain http only on this computer, for a server here too.
 */
export function isAllowedEndpoint(raw: unknown, serverUrl: string): raw is string {
  if (typeof raw !== 'string') return false
  try {
    const url = new URL(raw)
    const server = new URL(serverUrl)
    if (url.username || url.password) return false
    if (url.protocol === 'http:') return isLoopback(url) && isLoopback(server)
    return url.protocol === 'https:' && (!isPrivateAddress(url) || isPrivateAddress(server))
  } catch {
    return false
  }
}

/** The same site, allowing for one on a subdomain of the other, as some providers split theirs. */
function sameSite(a: string, b: string): boolean {
  const [first, second] = [new URL(a).hostname, new URL(b).hostname]
  return first === second || first.endsWith(`.${second}`) || second.endsWith(`.${first}`)
}

/** Whether a resource a server claims to be covers its own address. Otherwise a token could be got for one server and used by another. */
export function resourceCovers(resource: unknown, serverUrl: string): resource is string {
  if (typeof resource !== 'string') return false
  try {
    const claimed = new URL(resource)
    const server = new URL(serverUrl)
    if (claimed.origin !== server.origin) return false
    const path = claimed.pathname.replace(/\/$/, '')
    return server.pathname === path || server.pathname.startsWith(`${path}/`) || path === ''
  } catch {
    return false
  }
}

/** A response's text, up to a limit: a server chooses how much it sends. */
async function limitedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_RESPONSE_BYTES) {
      void reader.cancel()
      throw new Error('The server sent too much')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Redirects are refused throughout, so a code or token can't be carried somewhere else. */
const request = (fetchFn: Fetch, url: string, init: RequestInit = {}) => fetchFn(url, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(REQUEST_MS) })

/** Times out, and also stops when the sign-in is cancelled. */
const untilCancelled = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(REQUEST_MS)])

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)

async function readJson(fetchFn: Fetch, url: string): Promise<Fields | null> {
  try {
    const response = await request(fetchFn, url, { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const parsed: unknown = JSON.parse(await limitedText(response))
    return isFields(parsed) ? parsed : null
  } catch {
    return null
  }
}

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Ottopus Ink', version: '0' } },
})

function challengeFrom(url: string, transport: 'http' | 'sse', fetchFn: Fetch, token: string | null, headers: Record<string, string>, timeoutMs = REQUEST_MS): Promise<Response> {
  const auth: Record<string, string> = { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const signal = AbortSignal.timeout(timeoutMs)
  return transport === 'http'
    ? request(fetchFn, url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...auth }, body: INITIALIZE, signal })
    : request(fetchFn, url, { headers: { Accept: 'text/event-stream', ...auth }, signal })
}

/**
 * Whether a server turns away a session with this token, or with none. Asked only
 * when someone has turned the server on, because it contacts that server.
 */
export async function checkServer(url: string, transport: 'http' | 'sse', token: string | null, fetchFn: Fetch = fetch, headers: Record<string, string> = {}): Promise<ServerState> {
  try {
    const response = await challengeFrom(url, transport, fetchFn, token, headers, CHECK_MS)
    void response.body?.cancel()
    return response.status === 401 ? 'needs-sign-in' : 'ok'
  } catch {
    return 'unreachable'
  }
}

const metadataUrls = (base: string, name: string): string[] => {
  const url = new URL(base)
  const path = url.pathname.replace(/\/$/, '')
  return [`${url.origin}/.well-known/${name}${path}`, ...(path ? [`${url.origin}/.well-known/${name}`] : [])]
}

function issuerUrls(issuer: string): string[] {
  const url = new URL(issuer)
  const path = url.pathname.replace(/\/$/, '')
  return path
    ? [`${url.origin}/.well-known/oauth-authorization-server${path}`, `${url.origin}/.well-known/openid-configuration${path}`, `${url.origin}${path}/.well-known/openid-configuration`]
    : [`${url.origin}/.well-known/oauth-authorization-server`, `${url.origin}/.well-known/openid-configuration`]
}

const sameIssuer = (a: unknown, b: string) => typeof a === 'string' && a.replace(/\/$/, '') === b.replace(/\/$/, '')

/** Finds out how to sign in to a server, or says plainly why it can't be done from here. */
export async function planSignIn(serverUrl: string, transport: 'http' | 'sse', fetchFn: Fetch = fetch, headers: Record<string, string> = {}): Promise<SignInPlan> {
  let challenge: string
  try {
    const response = await challengeFrom(serverUrl, transport, fetchFn, null, headers)
    void response.body?.cancel()
    challenge = response.headers.get('www-authenticate') ?? ''
  } catch {
    throw new Error("Ink couldn't reach that server.")
  }

  const named = /resource_metadata="([^"]+)"/.exec(challenge)?.[1]
  const candidates = [...(isAllowedEndpoint(named, serverUrl) ? [named] : []), ...metadataUrls(serverUrl, 'oauth-protected-resource')]
  let protectedResource: Fields | null = null
  for (const candidate of candidates) {
    protectedResource = await readJson(fetchFn, candidate)
    if (protectedResource) break
  }

  if (protectedResource && !resourceCovers(protectedResource.resource, serverUrl)) {
    throw new Error("That server's sign-in details are for a different address, so Ink won't use them.")
  }
  // Always names a resource, as the MCP spec asks: a token should be good only for this server.
  const server = new URL(serverUrl)
  const resource = protectedResource ? (protectedResource.resource as string) : `${server.origin}${server.pathname}`
  const servers = protectedResource?.authorization_servers
  const issuer: unknown = Array.isArray(servers) ? servers[0] : server.origin
  if (!isAllowedEndpoint(issuer, serverUrl)) throw new Error("That server's sign-in page isn't at a safe address.")

  let metadata: Fields | null = null
  for (const candidate of issuerUrls(issuer)) {
    const found = await readJson(fetchFn, candidate)
    if (found && sameIssuer(found.issuer, issuer)) {
      metadata = found
      break
    }
  }
  if (!metadata) throw new Error("That server doesn't say how to sign in, so Ink can't do it from here.")

  const { authorization_endpoint: authorize, token_endpoint: token, registration_endpoint: register, code_challenge_methods_supported: methods } = metadata
  if (!isAllowedEndpoint(authorize, serverUrl) || !isAllowedEndpoint(token, serverUrl)) throw new Error("That server's sign-in page isn't at a safe address.")
  // Without PKCE, another program on this computer could take the code on its way back.
  if (!Array.isArray(methods) || !methods.includes('S256')) throw new Error("That server's sign-in isn't secure enough for Ink to use.")
  if (!isAllowedEndpoint(register, serverUrl)) throw new Error('That server needs an app registered with it by hand, which Ink can\'t do yet.')
  // Otherwise a server could send the person to a real provider's sign-in page, then have
  // the code it issues, and the verifier that unlocks it, posted to the server's own address.
  if (!sameSite(authorize, token) || !sameSite(authorize, register)) throw new Error("That server's sign-in details point at different sites, so Ink won't use them.")

  const scope = /scope="([^"]+)"/.exec(challenge)?.[1] ?? (Array.isArray(protectedResource?.scopes_supported) ? protectedResource.scopes_supported.filter((item) => typeof item === 'string').join(' ') : '')
  return {
    authorizationEndpoint: authorize,
    tokenEndpoint: token,
    registrationEndpoint: register,
    resource,
    scope: scope || null,
    host: new URL(authorize).host,
    issuer,
    issuerAnswers: metadata.authorization_response_iss_parameter_supported === true,
  }
}

/** A token as it will go in a header, or null if it can't safely. */
const visibleToken = (value: unknown): value is string => typeof value === 'string' && /^[!-~]+$/.test(value) && !value.includes('${')

async function askForToken(fetchFn: Fetch, endpoint: string, form: Record<string, string | null>, previous: Pick<SignIn, 'clientId' | 'clientSecret' | 'refreshToken' | 'resource'>, signal?: AbortSignal): Promise<SignIn> {
  const body = new URLSearchParams(Object.entries(form).filter((entry): entry is [string, string] => entry[1] !== null))
  const response = await request(fetchFn, endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, ...(signal ? { signal: untilCancelled(signal) } : {}) })
  const parsed: unknown = response.ok ? JSON.parse(await limitedText(response)) : null
  if (!isFields(parsed) || !visibleToken(parsed.access_token)) throw new Error("That server didn't complete the sign-in.")
  if (typeof parsed.token_type === 'string' && parsed.token_type.toLowerCase() !== 'bearer') throw new Error('That server uses a kind of sign-in Ink can\'t pass on.')
  return {
    accessToken: parsed.access_token,
    refreshToken: visibleToken(parsed.refresh_token) ? parsed.refresh_token : previous.refreshToken,
    expiresAt: typeof parsed.expires_in === 'number' ? Date.now() + parsed.expires_in * 1000 : null,
    tokenEndpoint: endpoint,
    clientId: previous.clientId,
    clientSecret: previous.clientSecret,
    resource: previous.resource,
  }
}

/** A new access token for a sign-in that has run out. Throws if it can't be renewed. */
export function renewSignIn(signIn: SignIn, fetchFn: Fetch = fetch): Promise<SignIn> {
  if (!signIn.refreshToken) throw new Error('Nothing to renew with')
  return askForToken(
    fetchFn,
    signIn.tokenEndpoint,
    { grant_type: 'refresh_token', refresh_token: signIn.refreshToken, client_id: signIn.clientId, client_secret: signIn.clientSecret, resource: signIn.resource },
    signIn,
  )
}

const urlSafe = (bytes: Buffer) => bytes.toString('base64url')

/** By bytes, as timingSafeEqual throws on different lengths and text can match in length but not bytes. */
function sameText(a: string, b: string): boolean {
  const [first, second] = [Buffer.from(a), Buffer.from(b)]
  return first.length === second.length && timingSafeEqual(first, second)
}

/**
 * Waits on this computer for the browser to come back with the code. Only the state
 * made for this sign-in counts, so another page or program can't feed in its own.
 */
function callbackListener(state: string, expected: Pick<SignInPlan, 'issuer' | 'issuerAnswers'>, signal: AbortSignal, timeoutMs: number): Promise<{ redirectUri: string; code: Promise<string>; close: () => void }> {
  return new Promise((resolveListener, rejectListener) => {
    let settle: { resolve: (code: string) => void; reject: (error: Error) => void }
    const code = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject }
    })
    // A rejection before anyone awaits it shouldn't count as unhandled.
    code.catch(() => undefined)

    const server = createServer((req, res) => {
      const page = (status: number, text: string) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'no-store', Connection: 'close' })
        res.end(text)
      }
      // Anything can reach this port, and an error here would be outside everything that catches.
      const url = URL.parse(req.url ?? '/', 'http://127.0.0.1')
      if (!url || req.method !== 'GET' || url.pathname !== '/callback' || !sameText(url.searchParams.get('state') ?? '', state)) return page(404, 'Not found')
      page(200, CALLBACK_PAGE)
      const received = url.searchParams.get('code')
      const iss = url.searchParams.get('iss')
      if (iss === null ? expected.issuerAnswers : !sameIssuer(iss, expected.issuer)) settle.reject(new Error('The sign-in came back from somewhere other than expected, so Ink ignored it.'))
      else if (received) settle.resolve(received)
      else settle.reject(new Error("The sign-in didn't finish."))
    })

    const timer = setTimeout(() => settle.reject(new Error('The sign-in took too long.')), timeoutMs)
    const onAbort = () => settle.reject(new Error('cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
    const close = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      server.close()
      server.closeAllConnections()
    }
    server.on('error', rejectListener)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolveListener({ redirectUri: `http://127.0.0.1:${port}/callback`, code, close })
    })
  })
}

export interface CompleteOptions {
  openBrowser: (url: string) => Promise<void>
  signal: AbortSignal
  timeoutMs?: number
  fetchFn?: Fetch
}

/** Registers, sends the person to their browser, and swaps the code it brings back for a token. */
export async function completeSignIn(plan: SignInPlan, { openBrowser, signal, timeoutMs = 5 * 60_000, fetchFn = fetch }: CompleteOptions): Promise<SignIn> {
  signal.throwIfAborted()
  const state = urlSafe(randomBytes(32))
  const verifier = urlSafe(randomBytes(32))
  const listener = await callbackListener(state, plan, signal, timeoutMs)
  try {
    const registered = await request(fetchFn, plan.registrationEndpoint, {
      signal: untilCancelled(signal),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'Ottopus Ink',
        redirect_uris: [listener.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...(plan.scope ? { scope: plan.scope } : {}),
      }),
    })
    const client: unknown = registered.ok ? JSON.parse(await limitedText(registered)) : null
    if (!isFields(client) || typeof client.client_id !== 'string' || !client.client_id) throw new Error("That server wouldn't register Ink.")
    const clientId = client.client_id
    const clientSecret = typeof client.client_secret === 'string' ? client.client_secret : null

    const url = new URL(plan.authorizationEndpoint)
    const params: Record<string, string | null> = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: listener.redirectUri,
      state,
      code_challenge: urlSafe(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      scope: plan.scope,
      resource: plan.resource,
    }
    for (const [name, value] of Object.entries(params)) if (value !== null) url.searchParams.set(name, value)
    signal.throwIfAborted()
    await openBrowser(url.href)

    const code = await listener.code
    const signIn = await askForToken(
      fetchFn,
      plan.tokenEndpoint,
      { grant_type: 'authorization_code', code, redirect_uri: listener.redirectUri, code_verifier: verifier, client_id: clientId, client_secret: clientSecret, resource: plan.resource },
      { clientId, clientSecret, refreshToken: null, resource: plan.resource },
      signal,
    )
    signal.throwIfAborted()
    return signIn
  } finally {
    listener.close()
  }
}
