import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentId } from '../../shared/ipc'
import { MCP_SERVER_NAME } from '../mcp/protocol'
import { asksForSecrets, expandableValues, letsVariableChooseWhatRuns, referencesIn, type CatalogEntry, type ServerDef, type SkillDef } from './catalog'

type Fields = Record<string, unknown>

/** Where each agent keeps things, and how to ask Codex for its servers. */
export interface DetectOptions {
  claudeDir: string
  /** ~/.claude.json, or the same file in CLAUDE_CONFIG_DIR. */
  claudeJson: string
  codexDir: string
  /** The output of `codex mcp list --json`, or null if Codex isn't there. */
  codexServers: () => Promise<unknown>
}

/** Past any real skill, and it all goes into the agent's prompt. */
const MAX_SKILL_CHARS = 64 * 1024

const NEEDS_SHELL = 'Needs a shell, which an Ink chat does not have'
const ASKS_FOR_SECRETS = "Asks for Ink's token or your agent's sign-in"
const NEEDS_SETUP = 'Needs setup Ink cannot fill in'
const VARIABLE_CHOOSES = 'Uses a variable to choose what it runs or connects to, which could change after you agree'
const NOTHING_TO_LOAD = 'Has nothing Ink can load: only hooks, commands or skills that need a shell'

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringsIn(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function stringMap(value: unknown): Record<string, string> {
  if (!isFields(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function folders(dir: string): Promise<string[]> {
  try {
    // Skills are often symlinks into another folder, so follow them to see.
    const names = (await readdir(dir)).filter((name) => !name.startsWith('.'))
    const kept = await Promise.all(
      names.map(async (name) => ((await stat(join(dir, name)).catch(() => null))?.isDirectory() ? name : null)),
    )
    return kept.filter((name) => name !== null).sort()
  } catch {
    return []
  }
}

/** Claude Code's shape, which plugins' `.mcp.json` files share. */
function serverFromClaude(raw: unknown): ServerDef | null {
  if (!isFields(raw)) return null
  if (typeof raw.url === 'string') {
    return { transport: raw.type === 'sse' ? 'sse' : 'http', url: raw.url, headers: stringMap(raw.headers) }
  }
  if (typeof raw.command !== 'string') return null
  return { transport: 'stdio', command: raw.command, args: stringsIn(raw.args), env: stringMap(raw.env), envNames: [] }
}

/** Codex's shape: the same things, under `transport`. */
function serverFromCodex(raw: unknown): ServerDef | null {
  if (!isFields(raw)) return null
  if (typeof raw.url === 'string') {
    const bearer: Record<string, string> = typeof raw.bearer_token_env_var === 'string' ? { Authorization: `Bearer \${${raw.bearer_token_env_var}}` } : {}
    return { transport: 'http', url: raw.url, headers: { ...stringMap(raw.http_headers), ...bearer } }
  }
  if (typeof raw.command !== 'string') return null
  return { transport: 'stdio', command: raw.command, args: stringsIn(raw.args), env: stringMap(raw.env), envNames: stringsIn(raw.env_vars) }
}

function problemWith(server: ServerDef): string | null {
  if (asksForSecrets(server)) return ASKS_FOR_SECRETS
  // Filled in by Claude Code from a plugin's settings, which Ink doesn't have.
  if (expandableValues(server).flatMap(referencesIn).some((name) => name.includes('.'))) return NEEDS_SETUP
  return letsVariableChooseWhatRuns(server) ? VARIABLE_CHOOSES : null
}

function mcpEntry(origin: AgentId, name: string, server: ServerDef): CatalogEntry {
  return {
    id: `detected:${origin}:mcp:${name}`,
    name,
    kind: 'mcp',
    source: 'detected',
    origin,
    servers: { [name]: server },
    skills: [],
    description: null,
    unavailable: problemWith(server),
  }
}

function descriptionOf(text: string): string | null {
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1]
  const line = front ? /^description:\s*(.+)$/m.exec(front)?.[1] : undefined
  return line ? line.trim().replace(/^["']|["']$/g, '').slice(0, 200) : null
}

/** A locked session can't run commands, so a skill that relies on them wouldn't work. */
async function needsShell(dir: string, text: string): Promise<boolean> {
  if (/^allowed-tools:.*\bBash\b/m.test(text) || /```(?:bash|sh|shell|zsh)\b/.test(text)) return true
  return (await stat(join(dir, 'scripts')).catch(() => null))?.isDirectory() === true
}

/** A skill in a folder, or null if there isn't one or it's too big to load. */
async function readSkill(dir: string, name: string): Promise<{ skill: SkillDef; description: string | null; shell: boolean } | null> {
  const text = await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => null)
  if (text === null || text.length > MAX_SKILL_CHARS) return null
  return { skill: { name, text }, description: descriptionOf(text), shell: await needsShell(dir, text) }
}

async function skillEntries(origin: AgentId, root: string): Promise<CatalogEntry[]> {
  const entries = await Promise.all(
    (await folders(root)).map(async (name): Promise<CatalogEntry | null> => {
      const found = await readSkill(join(root, name), name)
      if (!found) return null
      return {
        id: `detected:${origin}:skill:${name}`,
        name,
        kind: 'skill',
        source: 'detected',
        origin,
        servers: {},
        skills: [found.skill],
        description: found.description,
        unavailable: found.shell ? NEEDS_SHELL : null,
      }
    }),
  )
  return entries.filter((entry) => entry !== null)
}

/** Puts a plugin's own folder into its server definitions, as Claude Code would. */
function withPluginRoot(server: ServerDef, root: string): ServerDef {
  const fill = (value: string) => value.replaceAll('${CLAUDE_PLUGIN_ROOT}', root)
  const fillMap = (map: Record<string, string>) => Object.fromEntries(Object.entries(map).map(([key, value]) => [key, fill(value)]))
  return server.transport === 'stdio'
    ? { ...server, command: fill(server.command), args: server.args.map(fill), env: fillMap(server.env) }
    : { ...server, url: fill(server.url), headers: fillMap(server.headers) }
}

/**
 * A plugin, unpacked: its MCP servers and the skills that can work, and nothing
 * else. Its hooks can run code whatever a session's tool list says, so they are
 * never loaded, and neither is the plugin as a plugin.
 */
async function pluginEntry(id: string, root: string): Promise<CatalogEntry> {
  const manifest = await readJson(join(root, '.claude-plugin', 'plugin.json'))
  const mcpFile = await readJson(join(root, '.mcp.json'))
  const declared = {
    ...(isFields(manifest) && isFields(manifest.mcpServers) ? manifest.mcpServers : {}),
    ...(isFields(mcpFile) ? (isFields(mcpFile.mcpServers) ? mcpFile.mcpServers : mcpFile) : {}),
  }
  const servers: Record<string, ServerDef> = {}
  for (const [name, raw] of Object.entries(declared)) {
    const server = serverFromClaude(raw)
    if (server) servers[name] = withPluginRoot(server, root)
  }

  const skillsDir = join(root, 'skills')
  const found = await Promise.all((await folders(skillsDir)).map((name) => readSkill(join(skillsDir, name), name)))
  const skills = found.flatMap((skill) => (skill && !skill.shell ? [skill.skill] : []))

  const problem = Object.values(servers).map(problemWith).find((reason) => reason !== null) ?? null
  const hasAnything = Object.keys(servers).length > 0 || skills.length > 0
  return {
    id: `detected:claude-code:plugin:${id}`,
    name: id.split('@')[0] ?? id,
    kind: 'plugin',
    source: 'detected',
    origin: 'claude-code',
    servers,
    skills,
    description: isFields(manifest) && typeof manifest.description === 'string' ? manifest.description.slice(0, 200) : null,
    unavailable: problem ?? (hasAnything ? null : NOTHING_TO_LOAD),
  }
}

async function claudePlugins(claudeDir: string): Promise<CatalogEntry[]> {
  const installed = await readJson(join(claudeDir, 'plugins', 'installed_plugins.json'))
  if (!isFields(installed) || !isFields(installed.plugins)) return []
  const entries = await Promise.all(
    Object.entries(installed.plugins).map(([id, installs]) => {
      const [first] = Array.isArray(installs) ? (installs as unknown[]) : []
      return isFields(first) && typeof first.installPath === 'string' ? pluginEntry(id, first.installPath) : null
    }),
  )
  return entries.filter((entry) => entry !== null)
}

function isOurs(name: string): boolean {
  // Someone who added Ink to their own agent shouldn't see Ink offered back to them.
  return name === MCP_SERVER_NAME
}

async function claudeServers(claudeJson: string): Promise<CatalogEntry[]> {
  const config = await readJson(claudeJson)
  if (!isFields(config) || !isFields(config.mcpServers)) return []
  return Object.entries(config.mcpServers).flatMap(([name, raw]) => {
    const server = serverFromClaude(raw)
    return server && !isOurs(name) ? [mcpEntry('claude-code', name, server)] : []
  })
}

async function codexServers(list: DetectOptions['codexServers']): Promise<CatalogEntry[]> {
  const found = await list().catch(() => null)
  if (!Array.isArray(found)) return []
  return found.flatMap((raw: unknown) => {
    if (!isFields(raw) || typeof raw.name !== 'string' || isOurs(raw.name)) return []
    const server = serverFromCodex(raw.transport)
    return server ? [mcpEntry('codex', raw.name, server)] : []
  })
}

/**
 * What the person's agents already have. Only reads: it changes none of their
 * config and starts none of their servers, so it deliberately doesn't call
 * `claude mcp list`, which health-checks servers by running them.
 */
export async function detectEntries(options: DetectOptions): Promise<CatalogEntry[]> {
  const groups = await Promise.all([
    claudeServers(options.claudeJson),
    codexServers(options.codexServers),
    claudePlugins(options.claudeDir),
    skillEntries('claude-code', join(options.claudeDir, 'skills')),
    skillEntries('codex', join(options.codexDir, 'skills')),
  ])
  return groups.flat()
}
