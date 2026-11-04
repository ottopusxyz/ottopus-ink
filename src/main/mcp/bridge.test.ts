import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMcpBridge, type McpBridge } from './bridge'

let parentDir: string
let bridge: McpBridge
const clients: Socket[] = []

beforeEach(async () => {
  parentDir = await mkdtemp(join(tmpdir(), 'ink-b-'))
  bridge = await startMcpBridge({ parentDir, version: '1.2.3', helloTimeoutMs: 100 })
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy()
  bridge.close()
  await rm(parentDir, { recursive: true, force: true })
})

/** A connection, with every line it received and whether it has closed. */
function client() {
  const socket = connect(bridge.socketPath)
  clients.push(socket)
  socket.on('error', () => undefined)
  const state = { socket, lines: [] as Record<string, unknown>[], closed: false }
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    state.lines.push(...lines.map((line) => JSON.parse(line) as Record<string, unknown>))
  })
  socket.once('close', () => (state.closed = true))
  return state
}

const hello = (token: string) => `${JSON.stringify({ token })}\n`
const ping = (id: number) => `${JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' })}\n`
const closed = (state: { closed: boolean }) => vi.waitFor(() => expect(state.closed).toBe(true))
const answered = (state: { lines: unknown[] }, count = 1) => vi.waitFor(() => expect(state.lines.length).toBe(count))

describe('startMcpBridge socket', () => {
  it('is private: 0600 in a 0700 folder of its own', () => {
    expect(statSync(bridge.socketPath).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(bridge.socketPath)).mode & 0o777).toBe(0o700)
    expect(dirname(dirname(bridge.socketPath))).toBe(parentDir)
  })

  it('makes the parent folder when it does not exist yet', async () => {
    const other = await startMcpBridge({ parentDir: join(parentDir, 'not', 'yet'), version: '1' })
    expect(existsSync(other.socketPath)).toBe(true)
    other.close()
  })

  it('leaves nothing behind when closed, and drops who is connected', async () => {
    const { token } = bridge.addSession()
    const state = client()
    state.socket.write(hello(token) + ping(1))
    await answered(state)
    const folder = dirname(bridge.socketPath)
    bridge.close()
    await closed(state)
    expect(existsSync(folder)).toBe(false)
  })
})

describe('startMcpBridge tokens', () => {
  it('answers requests after a good hello, even split across chunks', async () => {
    const { token } = bridge.addSession()
    const state = client()
    state.socket.write(hello(token))
    const line = ping(1)
    state.socket.write(line.slice(0, 5))
    await new Promise((resolve) => setTimeout(resolve, 20))
    state.socket.write(line.slice(5) + ping(2))
    await answered(state, 2)
    expect(state.lines).toEqual([
      { jsonrpc: '2.0', id: 1, result: {} },
      { jsonrpc: '2.0', id: 2, result: {} },
    ])
  })

  it.each([
    ['a wrong token', hello('f'.repeat(64))],
    ['an empty token', hello('')],
    ['not JSON', 'hello\n'],
    ['JSON without a token', '{}\n'],
    ['a token of the wrong type', '{"token":7}\n'],
    ['a request instead of a hello', ping(1)],
  ])('drops a connection that opens with %s, answering nothing', async (_name, first) => {
    bridge.addSession()
    const state = client()
    state.socket.write(first + ping(2))
    await closed(state)
    expect(state.lines).toEqual([])
  })

  it('drops a connection that says nothing', async () => {
    const state = client()
    await closed(state)
    expect(state.lines).toEqual([])
  })

  it('gives each session its own long random token', () => {
    const [a, b] = [bridge.addSession().token, bridge.addSession().token]
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('stops honouring a token once its session is removed, and drops its connection', async () => {
    const session = bridge.addSession()
    const first = client()
    first.socket.write(hello(session.token) + ping(1))
    await answered(first)
    session.remove()
    await closed(first)

    const second = client()
    second.socket.write(hello(session.token) + ping(2))
    await closed(second)
    expect(second.lines).toEqual([])
  })

  it('removing one session leaves another alone', async () => {
    const [one, other] = [bridge.addSession(), bridge.addSession()]
    const state = client()
    state.socket.write(hello(other.token) + ping(1))
    await answered(state)
    one.remove()
    state.socket.write(ping(2))
    await answered(state, 2)
    expect(state.closed).toBe(false)
  })

  it('lets a restarted shim take over its session from the old connection', async () => {
    const { token } = bridge.addSession()
    const old = client()
    old.socket.write(hello(token) + ping(1))
    await answered(old)
    const fresh = client()
    fresh.socket.write(hello(token) + ping(2))
    await answered(fresh)
    await closed(old)
    expect(fresh.closed).toBe(false)
  })
})

describe('startMcpBridge on hostile input', () => {
  const live = async () => {
    const state = client()
    state.socket.write(hello(bridge.addSession().token))
    state.socket.write(ping(0))
    await answered(state)
    state.lines.length = 0
    return state
  }

  it('answers a line of bad JSON with an error and carries on', async () => {
    const state = await live()
    state.socket.write(`not json\n${ping(1)}`)
    await answered(state, 2)
    expect(state.lines[0]).toMatchObject({ id: null, error: { code: -32700 } })
    expect(state.lines[1]).toMatchObject({ id: 1, result: {} })
  })

  it('skips blank lines', async () => {
    const state = await live()
    state.socket.write(`\n\n${ping(1)}`)
    await answered(state)
    expect(state.lines[0]).toMatchObject({ id: 1 })
  })

  it('drops a connection that never ends a line, signed in or not', async () => {
    const state = await live()
    state.socket.write('x'.repeat(1024 * 1024 + 1))
    await closed(state)

    const stranger = client()
    stranger.socket.write('x'.repeat(1024 * 1024 + 1))
    await closed(stranger)
  })

  it('still answers a request that is long but finished', async () => {
    const state = await live()
    state.socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'y'.repeat(512 * 1024) } })}\n`)
    await answered(state)
    expect(state.lines[0]).toMatchObject({ id: 1, result: {} })
  })

  it('drops a reader that asks without ever taking the answers', async () => {
    const socket = connect(bridge.socketPath)
    clients.push(socket)
    socket.on('error', () => undefined)
    const state = { closed: false }
    socket.once('close', () => (state.closed = true))
    socket.pause()
    socket.write(hello(bridge.addSession().token))
    const list = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const flood = setInterval(() => {
      if (!state.closed) socket.write(`${list}\n`.repeat(2000))
    }, 1)
    try {
      await vi.waitFor(() => expect(state.closed).toBe(true), { timeout: 15_000 })
    } finally {
      clearInterval(flood)
    }
  }, 20_000)
})
