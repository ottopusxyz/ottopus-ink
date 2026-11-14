import type { AgentId, AgentState } from '../../shared/ipc'
import type { RunResult } from './run'

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
  auth: { args: readonly string[]; parse: (result: RunResult) => boolean | null }
}

export const AGENT_SPECS: readonly AgentSpec[] = [
  {
    id: 'claude-code',
    binary: 'claude',
    requires: [
      '--print',
      '--input-format',
      '--output-format',
      '--verbose',
      '--include-partial-messages',
      '--no-session-persistence',
      '--mcp-config',
      '--strict-mcp-config',
      '--tools',
      '--setting-sources',
      '--allowedTools',
      '--permission-mode',
      '--plugin-dir',
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
    id: 'grok',
    binary: 'grok',
    // `grok agent stdio` runs it headless, speaking ACP; `grok mcp` adds Ink's tools.
    requires: ['agent', 'mcp'],
    auth: { args: ['--version'], parse: parseGrokAuth },
  },
]

/** The first x.y.z in a `--version` line, with any pre-release tag. */
export function parseVersion(text: string): string | null {
  return /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/.exec(text)?.[0] ?? null
}

/**
 * The required flags and commands that `--help` doesn't list. Both must start a
 * help line, so a mention in another item's description doesn't count: flags
 * after any short form ("-c, --config"), commands after any program name, which
 * yargs prints ("  some-cli acp") and others don't ("  app-server").
 */
export function missingFromHelp(help: string, required: readonly string[], binary: string): string[] {
  return required.filter((item) => {
    const word = escapeRegExp(item)
    const lead = item.startsWith('-') ? '(?:-\\w, )?' : `(?:${escapeRegExp(binary)}[ \\t]+)?`
    return !new RegExp(`^[ \\t]+${lead}${word}($|[\\s,=<\\[])`, 'm').test(help)
  })
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `claude auth status --json` has a loggedIn boolean. */
export function parseClaudeAuth({ stdout }: RunResult): boolean | null {
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
export function parseCodexAuth({ code, stdout, stderr }: RunResult): boolean | null {
  const text = `${stdout}\n${stderr}`
  if (/not logged in/i.test(text)) return false
  if (code === 0 && /logged in/i.test(text)) return true
  return null
}

/**
 * Grok's CLI has no command that says whether it's signed in: `grok usage` needs its
 * background service, and `grok login` starts a sign-in. So Ink can't tell, and says so,
 * rather than read Grok's own credentials file.
 */
export function parseGrokAuth(): boolean | null {
  return null
}

/** The state an agent's probes add up to. Order matters: the first problem wins. */
export function agentState(found: {
  path: string | null
  version: string | null
  /** Null when --help itself failed, so what it lacks is unknown. */
  missing: readonly string[] | null
  signedIn: boolean | null
}): AgentState {
  if (!found.path) return 'missing'
  if (!found.version || !found.missing) return 'broken'
  if (found.missing.length > 0) return 'outdated'
  if (found.signedIn === false) return 'signed-out'
  return 'ready'
}
