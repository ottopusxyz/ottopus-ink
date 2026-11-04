import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatEvent } from '../../shared/ipc'
import { claudeEventReader } from './claude-events'
import { claudeArgs, claudeEnv } from './claude-launch'
import { DRAIN_AFTER_EXIT_MS, signalGroup } from './run'

/** A live chat with an agent. The methods throw once it has ended. */
export interface ChatSession {
  /** Starts a turn. Throws while one is running. */
  send(text: string): void
  /** Stops the running turn and keeps the conversation. Does nothing between turns. */
  stopTurn(): void
  /** Ends the chat, giving the process a moment to exit by itself. */
  close(): void
  /** Ends the chat at once, for when the app is quitting. */
  kill(): void
}

export interface ClaudeSessionOptions {
  binary: string
  env: NodeJS.ProcessEnv
  /** The `mcpServers` of the session's MCP config. Nothing else is available to it. */
  mcpServers: Record<string, unknown>
  pluginDir?: string | null
  onEvent: (event: ChatEvent) => void
  /** How long a turn gets to stop before the whole session is ended. */
  stopTurnGraceMs?: number
  /** How long after asking the process to exit to send SIGTERM, then SIGKILL. */
  closeGraceMs?: number
}

/** Far past any real event. An agent that never ends a line is ended instead of held in memory. */
const MAX_LINE_CHARS = 16 * 1024 * 1024

/** Enough of stderr to say why the process died. */
const MAX_STDERR_CHARS = 4 * 1024

/**
 * Runs `claude --print` as a long-lived process, one user message per turn. Its
 * working directory and MCP config live in a private temp folder that goes away
 * with the session, so it picks up no project and leaves none of Ink's files.
 */
export function startClaudeSession(options: ClaudeSessionOptions): ChatSession {
  const { binary, env, mcpServers, pluginDir = null, onEvent, stopTurnGraceMs = 5000, closeGraceMs = 500 } = options

  const dir = mkdtempSync(join(tmpdir(), 'ink-chat-'))
  const mcpConfig = join(dir, 'mcp.json')
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers }), { mode: 0o600 })

  const child = spawn(binary, claudeArgs({ mcpConfig, pluginDir }), {
    cwd: dir,
    env: claudeEnv(env),
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  })

  const read = claudeEventReader()
  let ended = false
  let closing = false
  let closeReason: string | null = null
  let turnRunning = false
  let stopping = false
  let stopTimer: NodeJS.Timeout | undefined
  let stderr = ''
  let buffer = ''
  const closeTimers: NodeJS.Timeout[] = []

  const finish = (error: string | null) => {
    if (ended) return
    ended = true
    clearTimeout(stopTimer)
    for (const timer of closeTimers) clearTimeout(timer)
    // Takes the MCP server and anything else the agent started with it.
    signalGroup(child, 'SIGKILL')
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
    child.unref()
    rmSync(dir, { recursive: true, force: true })
    onEvent({ type: 'ended', error: closing ? closeReason : error })
  }

  /** Once closing, how the process goes no longer matters: the reason given here is reported. */
  const close = (reason: string | null = null) => {
    if (ended || closing) return
    closing = true
    closeReason = reason
    child.stdin.end()
    closeTimers.push(
      setTimeout(() => signalGroup(child, 'SIGTERM'), closeGraceMs),
      setTimeout(() => finish(null), closeGraceMs * 2),
    )
  }

  const emit = (event: ChatEvent) => {
    if (event.type !== 'turn-end') {
      onEvent(event)
      return
    }
    turnRunning = false
    clearTimeout(stopTimer)
    // An interrupted turn reports itself as an error, with nothing useful to say.
    const stopped = stopping && event.outcome === 'failed'
    stopping = false
    onEvent(stopped ? { type: 'turn-end', outcome: 'stopped', error: null } : event)
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (ended) return
      read(line).forEach(emit)
    }
    if (buffer.length > MAX_LINE_CHARS) finish('Claude Code sent more than Ink can read.')
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS)
  })

  // Writing to a process that just died; the exit below reports it.
  child.stdin.on('error', () => undefined)

  child.once('error', (error) => finish(`Couldn't start Claude Code: ${error.message}`))
  child.once('exit', (code, signal) => {
    const reason = stderr.trim().split('\n').at(-1)
    const how = signal ? `was stopped by ${signal}` : `exited with code ${String(code)}`
    // Output already written can still be arriving; don't wait on it for long.
    setTimeout(() => finish(`Claude Code ${how}${reason ? `: ${reason}` : '.'}`), DRAIN_AFTER_EXIT_MS)
  })

  const assertLive = () => {
    if (ended || closing) throw new Error('This chat has ended')
  }

  return {
    send(text) {
      assertLive()
      if (turnRunning) throw new Error('The agent is still answering')
      turnRunning = true
      child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
    },
    stopTurn() {
      assertLive()
      if (!turnRunning || stopping) return
      stopping = true
      child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'stop', request: { subtype: 'interrupt' } })}\n`)
      stopTimer = setTimeout(() => close('Claude Code did not stop when asked, so the chat was ended.'), stopTurnGraceMs)
    },
    close: () => close(),
    kill: () => finish(null),
  }
}
