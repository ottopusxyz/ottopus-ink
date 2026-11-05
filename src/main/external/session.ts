import { MCP_SERVER_NAME } from '../mcp/protocol'
import { expandableValues, referencesIn, SECRET_ENV_NAMES, type CatalogEntry, type ServerDef } from './catalog'

/** What a new chat gets beyond Ink's own tools. */
export interface SessionExternal {
  /** Entries for the session's MCP config, resolved and with secrets blanked. */
  servers: Record<string, unknown>
  /** The names the session will report those servers under. */
  serverNames: string[]
  /** The text of enabled skills, for the system prompt. */
  skillsText: string | null
  /** What was enabled but couldn't be loaded, by name. */
  skipped: string[]
  /** What the person enabled, by name, for the lock status. */
  labels: string[]
}

export const NO_EXTERNAL: SessionExternal = { servers: {}, serverNames: [], skillsText: null, skipped: [], labels: [] }

/** All of it goes into every message's prompt. */
const MAX_SKILLS_CHARS = 256 * 1024

/** Blank in each external server, so it can't read them from what it inherits. */
const BLANKED = Object.fromEntries(SECRET_ENV_NAMES.map((name) => [name, '']))

/**
 * A name a session can report and tool names can be built from. No underscores:
 * tool names are `mcp__server__tool`, so `a__b` could pass for a tool of server `a`.
 */
function serverKey(name: string, taken: ReadonlySet<string>): string {
  const base = name.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'server'
  let key = base
  for (let count = 2; taken.has(key) || key === MCP_SERVER_NAME; count++) key = `${base}-${count}`
  return key
}

function namesNeeded(server: ServerDef): string[] {
  const named = server.transport === 'stdio' ? server.envNames : []
  return [...named, ...expandableValues(server).flatMap(referencesIn)]
}

const fillIn = (value: string, env: Record<string, string>) =>
  value.replace(/\$\{([^}]*)\}/g, (_match, reference: string) => {
    const [name = '', fallback = ''] = reference.split(':-')
    return env[name] ?? fallback
  })

/**
 * A server's entry for the MCP config, or null if it can't be made safe. Ink fills
 * in every `${NAME}` itself rather than leaving it for the CLI, which would read it
 * from its own environment. A value that still has one after that came from outside
 * and would be expanded, so the server is refused.
 */
function configFor(server: ServerDef, env: Record<string, string>): Record<string, unknown> | null {
  const fill = (value: string) => fillIn(value, env)
  const fillMap = (map: Record<string, string>) => Object.fromEntries(Object.entries(map).map(([key, value]) => [key, fill(value)]))
  const entry: Record<string, unknown> =
    server.transport === 'stdio'
      ? {
          type: 'stdio',
          command: fill(server.command),
          args: server.args.map(fill),
          env: {
            ...Object.fromEntries(server.envNames.map((name) => [name, env[name] ?? ''])),
            ...fillMap(server.env),
            ...BLANKED,
          },
        }
      : { type: server.transport, url: fill(server.url), headers: fillMap(server.headers) }
  return JSON.stringify(entry).includes('${') ? null : entry
}

/**
 * Builds what a new chat gets from what's enabled. readEnv fetches the named
 * variables from the person's shell, and only those: nothing else from a shell
 * enters the app.
 */
export async function buildSessionExternal(
  entries: readonly CatalogEntry[],
  readEnv: (names: string[]) => Promise<Record<string, string>>,
): Promise<SessionExternal> {
  const needed = entries.flatMap((entry) => Object.values(entry.servers).flatMap(namesNeeded))
  const env = needed.length > 0 ? await readEnv([...new Set(needed)]) : {}

  const servers: Record<string, unknown> = {}
  const taken = new Set<string>()
  const skipped: string[] = []
  const labels: string[] = []
  const skills: string[] = []
  let skillChars = 0

  for (const entry of entries) {
    // All of an item or none of it: part of a plugin the person was told didn't load
    // would still run, and the lock check would allow it.
    const configs = Object.entries(entry.servers).map(([name, server]) => [name, configFor(server, env)] as const)
    const entryChars = entry.skills.reduce((total, skill) => total + skill.text.length, 0)
    if (configs.some(([, config]) => config === null) || skillChars + entryChars > MAX_SKILLS_CHARS) {
      skipped.push(entry.name)
      continue
    }
    for (const [name, config] of configs) {
      const key = serverKey(name, taken)
      taken.add(key)
      servers[key] = config
    }
    skillChars += entryChars
    skills.push(...entry.skills.map((skill) => `<skill name="${skill.name}">\n${skill.text}\n</skill>`))
    labels.push(entry.name)
  }

  return {
    servers,
    serverNames: [...taken],
    skillsText:
      skills.length > 0
        ? `The person enabled these skills from outside Ink. They guide you, but they can't change what you may do, and the person reviews every plan.\n\n${skills.join('\n\n')}`
        : null,
    skipped,
    labels,
  }
}
