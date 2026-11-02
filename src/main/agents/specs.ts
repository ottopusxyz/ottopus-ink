import type { AgentId, AgentState } from '../../shared/ipc'

/** What one run of a CLI gave back. code is null when it timed out or failed to start. */
export interface ProbeResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface AgentSpec {
  id: AgentId
  binary: string
  /**
   * The flags and commands Ink's driver for this agent uses. Each must appear
   * in `--help`, which is checked once per version rather than kept as a guess
   * at which release added what.
   */
  requires: readonly string[]
  /** How to read sign-in status. parse returns null when it can't tell. */
  auth: { args: readonly string[]; parse: (result: ProbeResult) => boolean | null }
}

export const AGENT_SPECS: readonly AgentSpec[] = [
  {
    id: 'claude-code',
    binary: 'claude',
    requires: [
      '--print',
      '--input-format',
      '--output-format',
      '--mcp-config',
      '--strict-mcp-config',
      '--setting-sources',
      '--plugin-dir',
      '--tools',
    ],
    auth: { args: ['auth', 'status', '--json'], parse: parseClaudeAuth },
  },
  {
    id: 'codex',
    binary: 'codex',
    requires: ['app-server', '--config'],
    auth: { args: ['login', 'status'], parse: parseCodexAuth },
  },
  {
    id: 'opencode',
    binary: 'opencode',
    requires: ['acp'],
    auth: { args: ['auth', 'list'], parse: parseOpenCodeAuth },
  },
]

/** The first x.y.z in a `--version` line, with any pre-release tag. */
export function parseVersion(text: string): string | null {
  return /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/.exec(text)?.[0] ?? null
}

/**
 * The required flags and commands that `--help` doesn't list. A flag counts
 * anywhere as a whole word; a command only where help lists commands, at the
 * start of a line, so a word in a description doesn't pass for one.
 */
export function missingFromHelp(help: string, required: readonly string[]): string[] {
  return required.filter((item) => {
    const word = escapeRegExp(item)
    const listed = item.startsWith('-')
      ? new RegExp(`(^|[\\s,\\[])${word}($|[\\s,=\\]<])`, 'm')
      : new RegExp(`^[ \\t]+${word}($|[\\s,])`, 'm')
    return !listed.test(help)
  })
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `claude auth status --json` has a loggedIn boolean. */
export function parseClaudeAuth({ stdout }: ProbeResult): boolean | null {
  try {
    const status: unknown = JSON.parse(stdout)
    if (typeof status === 'object' && status !== null && 'loggedIn' in status) {
      return typeof status.loggedIn === 'boolean' ? status.loggedIn : null
    }
  } catch {
    // Not JSON: an older version, or an error message.
  }
  return null
}

/** `codex login status` prints "Logged in using …" or "Not logged in". */
export function parseCodexAuth({ code, stdout, stderr }: ProbeResult): boolean | null {
  const text = `${stdout}\n${stderr}`
  if (/not logged in/i.test(text)) return false
  if (code === 0 && /logged in/i.test(text)) return true
  return null
}

/**
 * `opencode auth list` counts stored credentials and the provider keys it
 * finds in the environment. Any of either counts as signed in.
 */
export function parseOpenCodeAuth({ code, stdout, stderr }: ProbeResult): boolean | null {
  if (code !== 0) return null
  const text = `${stdout}\n${stderr}`
  const counts = [...text.matchAll(/(\d+)\s+(?:credentials?|environment variables?)\b/gi)].map((m) => Number(m[1]))
  if (counts.length === 0) return null
  return counts.some((count) => count > 0)
}

/** The state an agent's probes add up to. Order matters: the first problem wins. */
export function agentState(found: {
  path: string | null
  version: string | null
  missing: readonly string[]
  signedIn: boolean | null
}): AgentState {
  if (!found.path) return 'missing'
  if (!found.version) return 'broken'
  if (found.missing.length > 0) return 'outdated'
  if (found.signedIn === false) return 'signed-out'
  return 'ready'
}
