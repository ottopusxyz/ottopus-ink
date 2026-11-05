import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { AgentId, ExternalKind, ExternalSource } from '../../shared/ipc'

/** How to reach one MCP server. Holds what may be secret, so it never leaves the main process. */
export type ServerDef =
  | {
      transport: 'stdio'
      command: string
      args: string[]
      env: Record<string, string>
      /** Variables to read from the person's shell, by name. */
      envNames: string[]
    }
  | { transport: 'http' | 'sse'; url: string; headers: Record<string, string> }

export interface SkillDef {
  name: string
  text: string
}

export interface CatalogEntry {
  id: string
  name: string
  kind: ExternalKind
  source: ExternalSource
  origin: AgentId | null
  /** What this adds to a session. A plugin can bring both; its hooks are never read. */
  servers: Record<string, ServerDef>
  skills: SkillDef[]
  /** One line on what it does, from its own files. Plain text from a third party. */
  description: string | null
  /** Why it can't be turned on, or null if it can. */
  unavailable: string | null
}

const REFERENCE = /\$\{([^}]*)\}/g

/** The names a value asks the CLI to fill in with `${NAME}` or `${NAME:-default}`. */
export function referencesIn(value: string): string[] {
  return [...value.matchAll(REFERENCE)].map((match) => (match[1] ?? '').split(':-')[0] ?? '')
}

/** Every string in a server's definition that the CLI would expand. */
export function expandableValues(server: ServerDef): string[] {
  return server.transport === 'stdio'
    ? [server.command, ...server.args, ...Object.values(server.env)]
    : [server.url, ...Object.values(server.headers)]
}

/**
 * What must never reach an external server: Ink's token, which would let it call
 * Ink's tools, and the agent's own sign-in. Blank in each server's environment,
 * because a stdio server inherits the whole environment of the CLI that starts it,
 * and refused as a `${NAME}`, because the CLI would fill that in from the same place.
 * The two messaging variables are ones the CLI sets for itself.
 */
export const SECRET_ENV_NAMES = [
  'OTTOPUS_INK_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
] as const

const SECRETS: ReadonlySet<string> = new Set(SECRET_ENV_NAMES)

/** Whether a server asks to be handed Ink's token or the agent's sign-in. */
export function asksForSecrets(server: ServerDef): boolean {
  if (expandableValues(server).flatMap(referencesIn).some((name) => SECRETS.has(name))) return true
  return server.transport === 'stdio' && server.envNames.some((name) => SECRETS.has(name))
}

/**
 * Variables that decide what a program runs or loads. A fingerprint can't watch a
 * value that lives in the shell, so these may not be filled in from there. This list
 * can't be complete, which is why a variable may never choose the command or address.
 */
const CHOOSES_WHAT_RUNS = /^(?:PATH|NODE_OPTIONS|NODE_PATH|LD_[A-Z_]+|DYLD_[A-Z_]+|PYTHON(?:PATH|HOME|STARTUP)|RUBY(?:OPT|LIB)|PERL5(?:OPT|LIB)|BASH_ENV|ENV|JAVA_TOOL_OPTIONS|CLASSPATH)$/

/**
 * Whether a shell variable could change what runs or who gets the data after someone
 * agreed. What's written in the config is in the fingerprint; what a `${NAME}` holds
 * isn't, so a `${NAME}` is only for what a key is for: env values and headers.
 */
export function letsVariableChooseWhatRuns(server: ServerDef): boolean {
  if (server.transport !== 'stdio') return referencesIn(server.url).length > 0
  if ([server.command, ...server.args].flatMap(referencesIn).length > 0) return true
  if (server.envNames.some((name) => CHOOSES_WHAT_RUNS.test(name))) return true
  const { env } = server
  return Object.keys(env).some((name) => CHOOSES_WHAT_RUNS.test(name) && referencesIn(env[name] ?? '').length > 0)
}

/**
 * Identifies what would run. If this changes after someone turned an item on, it
 * goes back to off: they agreed to the old command, not the new one. Env and header
 * values are in it because they can decide what runs (NODE_OPTIONS can load another
 * program), so a rotated key means agreeing again. Only this hash is stored, and
 * anyone who could read it could read the value from the agent's own config.
 */
export function fingerprint({ servers, skills }: Pick<CatalogEntry, 'servers' | 'skills'>): string {
  const sorted = (map: Record<string, string>) => Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  const shape = Object.entries(servers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, server]) =>
      server.transport === 'stdio'
        ? [name, server.command, server.args, sorted(server.env), [...server.envNames].sort()]
        : [name, server.transport, server.url, sorted(server.headers)],
    )
  const texts = skills.map(({ name, text }) => [name, text]).sort(([a], [b]) => (a ?? '').localeCompare(b ?? ''))
  return createHash('sha256').update(JSON.stringify([shape, texts])).digest('hex')
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'a web address'
  }
}

/** Names what runs without showing anything secret, since arguments and URLs can hold keys. */
export function summaryOf({ kind, servers, skills }: CatalogEntry): string {
  if (kind === 'skill') return 'Instructions for the agent'
  const defs = Object.values(servers)
  const [only] = defs
  if (kind === 'mcp' && only) {
    return only.transport === 'stdio' ? `Runs ${basename(only.command)} on this computer` : `Connects to ${hostOf(only.url)}`
  }
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  return [defs.length ? plural(defs.length, 'server') : null, skills.length ? plural(skills.length, 'skill') : null]
    .filter(Boolean)
    .join(', ')
}

const FUNDS_WORDS = /(?:^|[^a-z])(?:send|sign|transfer|swap|pay|payment|withdraw|bridge|trade|buy|sell|wallet|broadcast|stake)/i

/** Only a hint: a name can't show what a tool does, and nothing here can see inside it. */
export function looksLikeItMovesFunds(name: string): boolean {
  return FUNDS_WORDS.test(name)
}
