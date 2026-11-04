import { homedir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import { run } from './run'

/**
 * What an agent CLI is run with, on top of this process's environment.
 *
 * An app launched from the dock or a desktop file gets a bare environment: no
 * ~/.local/bin, Homebrew or the npm and bun global folders on PATH, so `claude`
 * and friends look missing, and no CODEX_HOME or CLAUDE_CONFIG_DIR, so a CLI
 * that is signed in with a custom config folder looks signed out. The login
 * shell has what the person's terminal has.
 */
export interface AgentEnv extends Record<string, string> {
  PATH: string
}

/**
 * Read from the login shell: PATH, and the folders each agent keeps its config
 * and sign-in in. Only these. Everything else in a shell's environment, API
 * keys and tokens included, stays out of the app.
 */
export const SHELL_ENV_NAMES = [
  'PATH',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'OPENCODE_CONFIG_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
] as const

/**
 * Keeps the last read, so the shell runs once rather than on every call. A read
 * that didn't complete isn't kept, and refresh reads again, so a shell that
 * timed out at launch or a folder added to PATH since doesn't need a restart.
 */
export function keepLastRead<T>(read: () => Promise<{ value: T; complete: boolean }>) {
  let kept: Promise<T> | undefined
  return ({ refresh = false }: { refresh?: boolean } = {}): Promise<T> => {
    if (!kept || refresh) {
      const reading: Promise<T> = read().then(({ value, complete }) => {
        if (!complete && kept === reading) kept = undefined
        return value
      })
      kept = reading
    }
    return kept
  }
}

export const agentEnv = keepLastRead(readAgentEnv)

const home = homedir()
/** Added to PATH in case the shell could not be read. */
const FALLBACK_DIRS = [
  join(home, '.local/bin'),
  join(home, '.bun/bin'),
  join(home, '.npm-global/bin'),
  join(home, '.opencode/bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
]

async function readAgentEnv(): Promise<{ value: AgentEnv; complete: boolean }> {
  const login = await readLoginShell()
  return {
    value: {
      ...login,
      // The login shell's folders first, then this process's, then the usual ones.
      PATH: mergePaths(login?.PATH, process.env.PATH, FALLBACK_DIRS.join(delimiter)),
    },
    complete: login !== null,
  }
}

/** Separates the values in the shell's output, so a banner from an rc file doesn't matter. */
const MARK = '__INK_ENV__'

/**
 * Prints each variable after a mark, and one last mark. printenv rather than
 * "$NAME", because variable syntax differs between shells and fish rejects
 * "${NAME}". An unset variable prints nothing.
 */
export const SHELL_ENV_COMMAND = [
  ...SHELL_ENV_NAMES.flatMap((name) => [`printf '%s' ${MARK}`, `printenv ${name}`]),
  `printf '%s' ${MARK}`,
].join('; ')

/** The values set in the shell's output, or null unless it got as far as the last mark. */
export function parseShellEnv(output: string): Partial<Record<(typeof SHELL_ENV_NAMES)[number], string>> | null {
  const parts = output.split(MARK)
  // Whatever came before the first mark, then one part per name, then the rest.
  if (parts.length < SHELL_ENV_NAMES.length + 2) return null
  const env: Partial<Record<(typeof SHELL_ENV_NAMES)[number], string>> = {}
  SHELL_ENV_NAMES.forEach((name, index) => {
    const value = parts[index + 1]?.trim()
    if (value) env[name] = value
  })
  return env
}

/** PATH lists joined in order, each folder once, empty entries dropped. */
export function mergePaths(...lists: (string | null | undefined)[]): string {
  const dirs = new Set<string>()
  for (const list of lists) {
    for (const dir of (list ?? '').split(delimiter)) if (dir) dirs.add(dir)
  }
  return [...dirs].join(delimiter)
}

/**
 * Runs the person's shell as an interactive login shell and reads the variables.
 * Null if it blocks past the deadline, or fails before printing them; an rc file
 * that exits non-zero may still have printed them first.
 */
async function readLoginShell(): Promise<ReturnType<typeof parseShellEnv>> {
  const shell = process.env.SHELL || userInfo().shell || '/bin/sh'
  const { stdout } = await run(shell, ['-ilc', SHELL_ENV_COMMAND], {
    // oh-my-zsh would otherwise offer to update itself and wait for an answer.
    env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' },
    timeoutMs: 5000,
  })
  return parseShellEnv(stdout)
}
