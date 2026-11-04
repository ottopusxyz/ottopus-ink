import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMcpBridge, type McpBridge } from '../main/mcp/bridge'

const shimFile = join(import.meta.dirname, 'index.ts')

let parentDir: string
let bridge: McpBridge
const running: ReturnType<typeof spawn>[] = []

beforeEach(async () => {
  parentDir = await mkdtemp(join(tmpdir(), 'ink-s-'))
  bridge = await startMcpBridge({ parentDir, version: '1.2.3' })
})

afterEach(async () => {
  for (const child of running.splice(0)) child.kill('SIGKILL')
  bridge.close()
  await rm(parentDir, { recursive: true, force: true })
})

function shim(env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [shimFile], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  running.push(child)
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => (stderr += chunk))
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve))
  return {
    child,
    exited,
    stderr: () => stderr,
    async ask(message: object) {
      child.stdin.write(`${JSON.stringify(message)}\n`)
      const { value } = await lines.next()
      return JSON.parse(String(value)) as Record<string, unknown>
    },
  }
}

const live = () => shim({ OTTOPUS_INK_SOCKET: bridge.socketPath, OTTOPUS_INK_TOKEN: bridge.addSession().token })

describe('the shim', () => {
  it('speaks MCP to the agent through the app', async () => {
    const { ask } = live()
    expect(await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).toMatchObject({
      result: { serverInfo: { name: 'ottopus-ink', version: '1.2.3' } },
    })
    const tools = (await ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result as { tools: unknown[] }
    expect(tools.tools).toHaveLength(6)
    expect(await ask({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_accounts' } })).toMatchObject({
      id: 3,
      result: { isError: false },
    })
  })

  it('gives up with a message when it has no socket or token', async () => {
    for (const env of [{}, { OTTOPUS_INK_SOCKET: bridge.socketPath }, { OTTOPUS_INK_TOKEN: 'x' }]) {
      const { exited, stderr } = shim(env)
      expect(await exited).toBe(1)
      expect(stderr()).toContain('Ottopus Ink chats only')
    }
  })

  it('never writes its token to stderr or stdout', async () => {
    const { token } = bridge.addSession()
    const { ask, child, exited, stderr } = shim({ OTTOPUS_INK_SOCKET: bridge.socketPath, OTTOPUS_INK_TOKEN: token })
    const reply = await ask({ jsonrpc: '2.0', id: 1, method: 'ping' })
    child.stdin.end()
    await exited
    expect(JSON.stringify(reply) + stderr()).not.toContain(token)
  })

  it('exits with an error when the app is not there', async () => {
    const { exited, stderr } = shim({ OTTOPUS_INK_SOCKET: join(parentDir, 'nothing.sock'), OTTOPUS_INK_TOKEN: 'x' })
    expect(await exited).toBe(1)
    expect(stderr()).toContain("can't reach the app")
  })

  it('exits when the app turns its token away', async () => {
    const { exited } = shim({ OTTOPUS_INK_SOCKET: bridge.socketPath, OTTOPUS_INK_TOKEN: 'f'.repeat(64) })
    expect(await exited).not.toBeNull()
  })

  it('exits when the agent closes its stdin', async () => {
    const { ask, child, exited } = live()
    await ask({ jsonrpc: '2.0', id: 1, method: 'ping' })
    child.stdin.end()
    expect(await exited).toBe(0)
  })

  it('exits when the app goes away', async () => {
    const { ask, exited } = live()
    await ask({ jsonrpc: '2.0', id: 1, method: 'ping' })
    bridge.close()
    expect(await exited).not.toBeNull()
  })
})
