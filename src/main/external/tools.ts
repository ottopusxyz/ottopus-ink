import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { asksForSecrets, fingerprint, letsVariableChooseWhatRuns, looksLikeItMovesFunds, summaryOf, type CatalogEntry, type ServerDef } from './catalog'
import { buildSessionExternal, type SessionExternal } from './session'
import type { ExternalItem, NewExternalServer } from '../../shared/ipc'

/**
 * What's kept on disk: commands and addresses for what was added by hand, the names
 * of variables, and what's switched on. Keys belong in the shell or the agent's own
 * config. Ink refuses the obvious ways of writing one into a server, but can't
 * recognise every one, which is why the file is also 0600.
 */
interface Saved {
  added: { id: string; name: string; server: ServerDef }[]
  /** What was agreed to, by id, as a fingerprint of what would run. */
  enabled: Record<string, string>
  /** Bundled items the person turned off. */
  off: string[]
}

export interface ExternalToolsOptions {
  /** Where the list is kept. Written with mode 0600. */
  file: string
  /** Shipped with the app and checked by us, so on by default. */
  bundled: readonly CatalogEntry[]
  detect: () => Promise<CatalogEntry[]>
  readEnv: (names: string[]) => Promise<Record<string, string>>
}

/** Asks the person in the app's own native dialog, which a page can't answer. */
export type Confirm = (question: { message: string; detail: string; confirm: string }) => Promise<boolean>

export interface ExternalTools {
  list(): Promise<ExternalItem[]>
  add(input: unknown, confirm: Confirm): Promise<ExternalItem[]>
  remove(id: unknown): Promise<ExternalItem[]>
  setEnabled(id: unknown, on: unknown, confirm: Confirm): Promise<ExternalItem[]>
  /** What's enabled, read fresh, so a server changed since it was enabled stays out. */
  forNewChat(): Promise<SessionExternal>
}

const NAME = /^[\w .@-]{1,64}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_ARGS = 50
const MAX_VALUE_CHARS = 2048

function isVisibleText(value: unknown): value is string {
  // eslint-disable-next-line no-control-regex -- control characters are what's being refused.
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_VALUE_CHARS && !/[\u0000-\u001f\u007f]/.test(value)
}

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

const SECRET_NAME = /key|token|secret|password|passwd|credential|auth|signature/i
const SECRET_SHAPE = /^(?:sk-|sk_|pk_|ghp_|gho_|github_pat_|xox[a-z]-|AKIA|eyJ)/

/**
 * Whether a server plainly has a key written into it, which would then sit in the
 * settings file. This catches the common forms, not every one, so it can only keep
 * people from doing it by accident.
 */
function holdsObviousSecret(url: string | null, args: readonly string[]): boolean {
  if (url !== null) {
    const { searchParams } = new URL(url)
    return [...searchParams.keys()].some((name) => SECRET_NAME.test(name)) || [...searchParams.values()].some((value) => SECRET_SHAPE.test(value))
  }
  return args.some((arg, index) => {
    if (SECRET_SHAPE.test(arg)) return true
    const flag = /^--?([\w-]+)(=.*)?$/.exec(arg)
    if (!flag || !SECRET_NAME.test(flag[1] ?? '')) return false
    // "--api-key=value", or "--api-key value" with a value after it.
    return flag[2] !== undefined || (args[index + 1] !== undefined && !args[index + 1]?.startsWith('-'))
  })
}

/** A server from the page, which isn't trusted, or null if it doesn't hold up. */
export function parseNewServer(input: unknown): { name: string; server: ServerDef } | null {
  if (typeof input !== 'object' || input === null) return null
  const { name, command, args, url, envNames } = input as Partial<Record<keyof NewExternalServer, unknown>>
  if (typeof name !== 'string' || !NAME.test(name)) return null
  if (url !== undefined && url !== null && url !== '') {
    if (command || !isVisibleText(url) || !isSafeUrl(url) || holdsObviousSecret(url, [])) return null
    const remote: ServerDef = { transport: 'http', url, headers: {} }
    return letsVariableChooseWhatRuns(remote) ? null : { name, server: remote }
  }
  if (!isVisibleText(command)) return null
  const argList = args ?? []
  const names = envNames ?? []
  if (!Array.isArray(argList) || argList.length > MAX_ARGS || !argList.every(isVisibleText)) return null
  if (!Array.isArray(names) || names.length > MAX_ARGS || !names.every((item) => typeof item === 'string' && ENV_NAME.test(item))) return null
  if (holdsObviousSecret(null, argList)) return null
  const server: ServerDef = { transport: 'stdio', command, args: argList, env: {}, envNames: names }
  return asksForSecrets(server) || letsVariableChooseWhatRuns(server) ? null : { name, server }
}

function load(file: string): Saved {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<Saved>
    return {
      added: Array.isArray(saved.added) ? saved.added : [],
      enabled: typeof saved.enabled === 'object' && saved.enabled !== null ? saved.enabled : {},
      off: Array.isArray(saved.off) ? saved.off : [],
    }
  } catch {
    // Missing or damaged: everything external is off, which is the safe way to be wrong.
    return { added: [], enabled: {}, off: [] }
  }
}

function save(file: string, saved: Saved): void {
  const temporary = `${file}.${randomUUID()}`
  writeFileSync(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 })
  renameSync(temporary, file)
}

function addedEntry({ id, name, server }: Saved['added'][number]): CatalogEntry {
  return {
    id,
    name,
    kind: 'mcp',
    source: 'added',
    origin: null,
    servers: { [name]: server },
    skills: [],
    description: null,
    // Checked again here: the file could have been changed since it was added.
    unavailable: asksForSecrets(server)
      ? "Asks for Ink's token or your agent's sign-in"
      : letsVariableChooseWhatRuns(server)
        ? 'Uses a variable to choose what it runs or connects to, which could change after you agree'
        : null,
  }
}

/** What would run, in full, for the native dialog. Never goes to the page. */
function describeRun(entry: CatalogEntry): string {
  const lines = Object.entries(entry.servers).map(([name, server]) =>
    server.transport === 'stdio'
      ? `${name}: runs ${[server.command, ...server.args].join(' ')}`
      : `${name}: connects to ${server.url}`,
  )
  if (entry.skills.length > 0) lines.push(`Instructions for the agent: ${entry.skills.map((skill) => skill.name).join(', ')}`)
  return lines.join('\n')
}

const RISK =
  "Ink cannot see what this does. If it holds its own keys, your agent could move funds through it with no review or signature in Ink. It can also send what your agent reads, such as your balances, outside Ink. A program on this computer runs as you: it can read your files and, with some effort, what this chat uses to reach Ink. Only turn it on if you trust it as you would any program you install."

const FUNDS_RISK = 'Its name suggests it may send, sign or trade. Only turn this on if you trust it with your funds.\n\n'

export function createExternalTools({ file, bundled, detect, readEnv }: ExternalToolsOptions): ExternalTools {
  let saved = load(file)

  const allEntries = async (): Promise<CatalogEntry[]> => [...bundled, ...(await detect()), ...saved.added.map(addedEntry)]

  const isEnabled = (entry: CatalogEntry): boolean => {
    if (entry.unavailable) return false
    if (entry.source === 'bundled') return !saved.off.includes(entry.id)
    return saved.enabled[entry.id] === fingerprint(entry)
  }

  const toItem = (entry: CatalogEntry): ExternalItem => {
    const agreed = saved.enabled[entry.id]
    return {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      source: entry.source,
      origin: entry.origin,
      summary: summaryOf(entry),
      description: entry.description,
      enabled: isEnabled(entry),
      unavailable: entry.unavailable,
      changed: entry.source !== 'bundled' && agreed !== undefined && agreed !== fingerprint(entry),
      mayMoveFunds: looksLikeItMovesFunds(entry.name),
    }
  }

  const list = async () => (await allEntries()).map(toItem)

  return {
    list,

    async add(input, confirm) {
      const parsed = parseNewServer(input)
      if (!parsed) throw new Error("That server's details don't look right. A key in an address or argument belongs in an environment variable instead.")
      const entry = addedEntry({ id: `added:${randomUUID()}`, ...parsed })
      const agreed = await confirm({
        message: `Add ${parsed.name} to Ink's list?`,
        detail: `${describeRun(entry)}\n\nIt stays off until you turn it on.`,
        confirm: 'Add',
      })
      if (agreed) {
        saved = { ...saved, added: [...saved.added, { id: entry.id, ...parsed }] }
        save(file, saved)
      }
      return list()
    },

    async remove(id) {
      saved = {
        ...saved,
        added: saved.added.filter((item) => item.id !== id),
        enabled: Object.fromEntries(Object.entries(saved.enabled).filter(([key]) => key !== id)),
      }
      save(file, saved)
      return list()
    },

    async setEnabled(id, on, confirm) {
      const entry = (await allEntries()).find((candidate) => candidate.id === id)
      if (!entry) throw new Error('That item is no longer available')
      if (on !== true) {
        const enabled = Object.fromEntries(Object.entries(saved.enabled).filter(([key]) => key !== entry.id))
        saved = { ...saved, enabled, off: entry.source === 'bundled' ? [...new Set([...saved.off, entry.id])] : saved.off }
      } else if (entry.source === 'bundled') {
        saved = { ...saved, off: saved.off.filter((key) => key !== entry.id) }
      } else {
        if (entry.unavailable) throw new Error(entry.unavailable)
        const agreed = await confirm({
          message: `Turn on ${entry.name} for new chats?`,
          detail: `${looksLikeItMovesFunds(entry.name) ? FUNDS_RISK : ''}${RISK}\n\n${describeRun(entry)}`,
          confirm: 'Turn on',
        })
        if (!agreed) return list()
        saved = { ...saved, enabled: { ...saved.enabled, [entry.id]: fingerprint(entry) } }
      }
      save(file, saved)
      return list()
    },

    async forNewChat() {
      return buildSessionExternal((await allEntries()).filter(isEnabled), readEnv)
    },
  }
}
