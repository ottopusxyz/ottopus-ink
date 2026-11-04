import { spawn, type ChildProcess } from 'node:child_process'

/** What one run of a command gave back. code is null when it timed out or failed to start. */
export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface RunOptions {
  env: NodeJS.ProcessEnv
  timeoutMs: number
  /** How long after the polite SIGTERM to send SIGKILL and stop waiting. */
  killGraceMs?: number
}

/** More than any help text; anything past it is dropped rather than held in memory. */
const MAX_OUTPUT_CHARS = 1024 * 1024

/** A background child can hold the pipes open after the command exits; don't wait on it for long. */
export const DRAIN_AFTER_EXIT_MS = 250

const running = new Set<ChildProcess>()

/**
 * Runs a command without a shell and always settles.
 *
 * execFile's timeout isn't enough for this: it sends SIGTERM once and waits for
 * the process to close, and an interactive shell ignores SIGTERM, so a blocking
 * line in an rc file would never call back. Here stdin is closed, the command
 * leads its own process group so its children die with it, SIGKILL follows the
 * SIGTERM, and the promise settles at that point whether or not it closed.
 */
export function run(file: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  const { env, timeoutMs, killGraceMs = 500 } = options
  return new Promise((resolve) => {
    const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    running.add(child)

    let code: number | null = null
    let stdout = ''
    let stderr = ''
    const timers: NodeJS.Timeout[] = []

    const settle = () => {
      for (const timer of timers) clearTimeout(timer)
      running.delete(child)
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.unref()
      resolve({ code, stdout, stderr })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString()
    })

    // Spawn failed, such as a file that can't be executed. code stays null.
    child.once('error', settle)
    child.once('close', settle)
    child.once('exit', (exitCode) => {
      code = exitCode
      // The exit is in, so the deadline's kill and its null code no longer apply.
      for (const timer of timers) clearTimeout(timer)
      timers.length = 0
      timers.push(setTimeout(settle, DRAIN_AFTER_EXIT_MS))
    })

    timers.push(
      setTimeout(() => signalGroup(child, 'SIGTERM'), timeoutMs),
      setTimeout(() => {
        signalGroup(child, 'SIGKILL')
        settle()
      }, timeoutMs + killGraceMs),
    )
  })
}

/** Kills whatever is still running, for when the app quits mid-check. */
export function stopRuns(): void {
  for (const child of running) signalGroup(child, 'SIGKILL')
}

/** Signals the command's whole process group, which it leads because it was spawned detached. */
export function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    // Already gone.
  }
}
