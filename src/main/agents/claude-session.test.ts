import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../../shared/ipc'
import { startClaudeSession, type ChatSession, type ClaudeSessionOptions } from './claude-session'

let root: string
const open: ChatSession[] = []

/**
 * A stand-in for the CLI. Its body runs with `say` (print one event), `onLine`
 * (handle one line of stdin) and `note` (save a value for the test to read).
 */
async function standIn(name: string, body: string): Promise<string> {
  const file = join(root, name)
  await writeFile(
    file,
    `#!${process.execPath}
const { createInterface } = require('node:readline')
const { writeFileSync, readFileSync, statSync } = require('node:fs')
const say = (event) => process.stdout.write(JSON.stringify(event) + '\\n')
const note = (value) => writeFileSync(${JSON.stringify(`${file}.note`)}, JSON.stringify(value))
const onLine = (handle) => createInterface({ input: process.stdin }).on('line', (line) => handle(JSON.parse(line)))
const delta = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })
const done = { type: 'result', is_error: false, result: 'ok' }
${body}
`,
  )
  await chmod(file, 0o755)
  return file
}

const notes = async (file: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(`${file}.note`, 'utf8')) as Record<string, unknown>

function start(binary: string, options: Partial<ClaudeSessionOptions> = {}) {
  const events: ChatEvent[] = []
  const session = startClaudeSession({
    binary,
    env: { PATH: '/usr/bin:/bin', ...options.env },
    mcpServers: {},
    closeGraceMs: 100,
    stopTurnGraceMs: 100,
    onEvent: (event) => events.push(event),
    ...options,
  })
  open.push(session)
  return { session, events }
}

const ended = (events: ChatEvent[]) =>
  vi.waitFor(() => {
    const end = events.find((event) => event.type === 'ended')
    if (!end) throw new Error('not ended')
    return end
  })

const turnEnds = (events: ChatEvent[], count: number) =>
  vi.waitFor(() => {
    const ends = events.filter((event) => event.type === 'turn-end')
    if (ends.length < count) throw new Error('turn still running')
    return ends
  })

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** For a test that isn't about the deadline: a busy machine can take longer than the short one to start a stand-in. */
const PATIENT_MS = 30_000

const answers = `onLine((m) => { if (m.type === 'user') { say(delta('you said: ')); say(delta(m.message.content)); say(done) } })`

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ink-session-'))
})

afterEach(() => {
  for (const session of open.splice(0)) session.kill()
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('startClaudeSession launch', () => {
  it('runs in a private folder with a private MCP config, and leaves neither behind', async () => {
    const file = await standIn(
      'launch',
      `const args = process.argv.slice(2)
       const config = args[args.indexOf('--mcp-config') + 1]
       note({ args, cwd: process.cwd(), config, mode: statSync(config).mode & 0o777, dirMode: statSync(process.cwd()).mode & 0o777,
              servers: JSON.parse(readFileSync(config, 'utf8')) })
       ${answers}`,
    )
    const { session, events } = start(file, { mcpServers: { 'ottopus-ink': { command: '/shim' } } })
    await vi.waitFor(() => expect(existsSync(`${file}.note`)).toBe(true))
    const seen = await notes(file)

    expect(seen.mode).toBe(0o600)
    expect(seen.dirMode).toBe(0o700)
    expect(seen.servers).toEqual({ mcpServers: { 'ottopus-ink': { command: '/shim' } } })
    expect(seen.args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence']))
    expect(existsSync(String(seen.cwd))).toBe(true)

    session.close()
    await ended(events)
    expect(existsSync(String(seen.cwd))).toBe(false)
  })

  it('gives the process the filtered environment, not the one it was given', async () => {
    const file = await standIn('env', `note(process.env); ${answers}`)
    start(file, {
      env: { HOME: '/h', PATH: '/usr/bin:/bin', CLAUDE_CODE_PLUGIN_DIRS: '/other', GITHUB_TOKEN: 'test-value' },
      sessionEnv: { OTTOPUS_INK_TOKEN: 'for-this-session' },
    })
    await vi.waitFor(() => expect(existsSync(`${file}.note`)).toBe(true))
    const seen = await notes(file)
    expect(seen.HOME).toBe('/h')
    expect(seen.OTTOPUS_INK_TOKEN).toBe('for-this-session')
    expect(seen).not.toHaveProperty('CLAUDE_CODE_PLUGIN_DIRS')
    expect(seen).not.toHaveProperty('GITHUB_TOKEN')
  })

  it('reports a binary that is gone', async () => {
    const { events } = start(join(root, 'nothing-here'))
    expect(await ended(events)).toEqual({ type: 'ended', error: expect.stringContaining("Couldn't start Claude Code") })
  })
})

describe('startClaudeSession turns', () => {
  it('streams a reply, in order, and takes another message after it', async () => {
    const { session, events } = start(await standIn('turns', answers))
    session.send('one')
    await turnEnds(events, 1)
    session.send('two')
    await turnEnds(events, 2)
    expect(events).toEqual([
      { type: 'text', text: 'you said: ' },
      { type: 'text', text: 'one' },
      { type: 'turn-end', outcome: 'done', error: null },
      { type: 'text', text: 'you said: ' },
      { type: 'text', text: 'two' },
      { type: 'turn-end', outcome: 'done', error: null },
    ])
  })

  it('reads a line split across chunks, even in the middle of a character', async () => {
    const file = await standIn(
      'split',
      `onLine(() => {
         const bytes = Buffer.from(JSON.stringify(delta('naïve ✓')) + '\\n' + JSON.stringify(done) + '\\n')
         process.stdout.write(bytes.subarray(0, bytes.indexOf(0xc3) + 1))
         setTimeout(() => process.stdout.write(bytes.subarray(bytes.indexOf(0xc3) + 1)), 30)
       })`,
    )
    const { session, events } = start(file)
    session.send('go')
    await turnEnds(events, 1)
    expect(events[0]).toEqual({ type: 'text', text: 'naïve ✓' })
  })

  it('refuses a second message while a turn is running', async () => {
    const { session } = start(await standIn('busy', `onLine(() => undefined)`))
    session.send('one')
    expect(() => session.send('two')).toThrow(/still answering/)
  })

  it('sends the message as one stream-json line', async () => {
    const file = await standIn('input', `onLine((m) => { note(m); say(done) })`)
    const { session, events } = start(file)
    session.send('line one\nline "two"')
    await turnEnds(events, 1)
    expect(await notes(file)).toEqual({ type: 'user', message: { role: 'user', content: 'line one\nline "two"' } })
  })
})

describe('startClaudeSession stopping a turn', () => {
  it('reports a stopped turn and keeps the chat going', async () => {
    const file = await standIn(
      'interrupt',
      `onLine((m) => {
         if (m.type === 'control_request' && m.request.subtype === 'interrupt') {
           say({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } })
           say({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '' })
         } else if (m.message.content === 'hang') {
           say(delta('thinking'))
         } else {
           say(delta('back')); say(done)
         }
       })`,
    )
    const { session, events } = start(file, { stopTurnGraceMs: PATIENT_MS })
    session.send('hang')
    await vi.waitFor(() => expect(events).toContainEqual({ type: 'text', text: 'thinking' }))
    session.stopTurn()
    await turnEnds(events, 1)
    expect(events.at(-1)).toEqual({ type: 'turn-end', outcome: 'stopped', error: null })

    session.send('next')
    await turnEnds(events, 2)
    expect(events.slice(-2)).toEqual([
      { type: 'text', text: 'back' },
      { type: 'turn-end', outcome: 'done', error: null },
    ])
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'ended' }))
  })

  it('keeps a real failure as a failure once the stop has been dealt with', async () => {
    const file = await standIn(
      'fails',
      `onLine((m) => {
         if (m.type === 'control_request') say({ type: 'result', is_error: true, result: '' })
         else if (m.message.content === 'hang') undefined
         else say({ type: 'result', is_error: true, result: 'API Error' })
       })`,
    )
    const { session, events } = start(file, { stopTurnGraceMs: PATIENT_MS })
    session.send('hang')
    session.stopTurn()
    await turnEnds(events, 1)
    session.send('next')
    await turnEnds(events, 2)
    expect(events.at(-1)).toEqual({ type: 'turn-end', outcome: 'failed', error: 'API Error' })
  })

  it('does nothing between turns', async () => {
    const file = await standIn('idle', `onLine((m) => { note(m); say(done) })`)
    const { session, events } = start(file)
    session.stopTurn()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(existsSync(`${file}.note`)).toBe(false)
    expect(events).toEqual([])
  })

  it('ends the chat when the agent ignores the stop and every polite signal', async () => {
    const file = await standIn(
      'stubborn',
      `process.on('SIGTERM', () => undefined)
       note({ pid: process.pid })
       onLine(() => undefined)`,
    )
    const { session, events } = start(file)
    await vi.waitFor(() => expect(existsSync(`${file}.note`)).toBe(true))
    const { pid } = await notes(file)
    session.send('hang')
    session.stopTurn()
    expect(await ended(events)).toEqual({ type: 'ended', error: expect.stringContaining('did not stop') })
    await vi.waitFor(() => expect(isAlive(Number(pid))).toBe(false))
  })
})

describe('startClaudeSession ending', () => {
  it('reports an exit nobody asked for, with the last thing it said on stderr', async () => {
    const file = await standIn('dies', `onLine(() => { console.error('noise'); console.error('out of cheese'); process.exit(3) })`)
    const { session, events } = start(file)
    session.send('go')
    expect(await ended(events)).toEqual({ type: 'ended', error: 'Claude Code exited with code 3: out of cheese' })
    expect(() => session.send('again')).toThrow(/ended/)
  })

  it('closes quietly, once the process has seen its input end', async () => {
    const { session, events } = start(await standIn('closes', `onLine(() => undefined)`))
    session.close()
    expect(await ended(events)).toEqual({ type: 'ended', error: null })
    expect(events.filter((event) => event.type === 'ended')).toHaveLength(1)
    expect(() => session.send('again')).toThrow(/ended/)
  })

  it('takes the agent and whatever it started with it', async () => {
    const child = `require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' })`
    const file = await standIn(
      'tree',
      `process.on('SIGTERM', () => undefined)
       const kid = ${child}
       note({ pid: process.pid, kid: kid.pid })
       onLine(() => undefined)`,
    )
    const { session, events } = start(file)
    await vi.waitFor(() => expect(existsSync(`${file}.note`)).toBe(true))
    const seen = await notes(file)
    session.close()
    await ended(events)
    await vi.waitFor(() => {
      expect(isAlive(Number(seen.pid))).toBe(false)
      expect(isAlive(Number(seen.kid))).toBe(false)
    })
  })

  it('ends at once on kill, for when the app quits', async () => {
    const file = await standIn('killed', `process.on('SIGTERM', () => undefined); note({ pid: process.pid, cwd: process.cwd() }); onLine(() => undefined)`)
    const { session, events } = start(file)
    await vi.waitFor(() => expect(existsSync(`${file}.note`)).toBe(true))
    const seen = await notes(file)
    session.kill()
    expect(events).toEqual([{ type: 'ended', error: null }])
    expect(existsSync(String(seen.cwd))).toBe(false)
    await vi.waitFor(() => expect(isAlive(Number(seen.pid))).toBe(false))
  })

  it('ends a chat whose agent never finishes a line', async () => {
    const file = await standIn('flood', `onLine(() => process.stdout.write('x'.repeat(17 * 1024 * 1024)))`)
    const { session, events } = start(file)
    session.send('go')
    expect(await ended(events)).toEqual({ type: 'ended', error: 'Claude Code sent more than Ink can read.' })
  })

  it('still reads a line that is long but finished', async () => {
    const file = await standIn('long', `onLine(() => { say(delta('y'.repeat(2 * 1024 * 1024))); say(done) })`)
    const { session, events } = start(file)
    session.send('go')
    await turnEnds(events, 1)
    // Read and not treated as a stuck agent, though only the start of it goes on to the page.
    expect(events[0]).toEqual({ type: 'text', text: `${'y'.repeat(200_000)}…` })
    expect(events.at(-1)).toEqual({ type: 'turn-end', outcome: 'done', error: null })
  })
})
