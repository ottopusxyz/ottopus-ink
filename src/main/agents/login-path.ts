import { execFile } from 'node:child_process'
import { homedir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * Where agent CLIs are looked for.
 *
 * An app launched from the dock or a desktop file gets a bare PATH, without
 * ~/.local/bin, Homebrew or the npm and bun global folders, so `claude` and
 * friends look missing. The login shell has the PATH the person's terminal
 * has; it goes first, then this process's PATH, then the usual install
 * folders in case the shell could not be read.
 */
export function agentPath(): Promise<string> {
  cached ??= loginShellPath().then((login) => mergePaths(login, process.env.PATH, FALLBACK_DIRS.join(delimiter)))
  return cached
}
let cached: Promise<string> | undefined

const home = homedir()
const FALLBACK_DIRS = [
  join(home, '.local/bin'),
  join(home, '.bun/bin'),
  join(home, '.npm-global/bin'),
  join(home, '.opencode/bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
]

/** Marks PATH in the shell's output, so rc files that print a banner don't matter. */
const MARK = '__INK_PATH__'

/** Prints PATH between the marks. Braces matter: "$PATH__INK_PATH__" would be one variable name. */
export const PATH_COMMAND = `printf '%s' "${MARK}\${PATH}${MARK}"`

/** The PATH between the two marks, or null when the shell didn't print it. */
export function extractPath(output: string): string | null {
  const start = output.indexOf(MARK)
  const end = start === -1 ? -1 : output.indexOf(MARK, start + MARK.length)
  if (end === -1) return null
  return output.slice(start + MARK.length, end) || null
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
 * Runs the person's shell as an interactive login shell and reads its PATH.
 * Resolves null after five seconds, or if the shell fails before printing it.
 */
function loginShellPath(): Promise<string | null> {
  const shell = process.env.SHELL || userInfo().shell || '/bin/sh'
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', PATH_COMMAND],
      // oh-my-zsh would otherwise offer to update itself and wait for an answer.
      { timeout: 5000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      // An rc file that exits non-zero may still have printed PATH first.
      (_error, stdout) => resolve(extractPath(String(stdout))),
    )
  })
}
