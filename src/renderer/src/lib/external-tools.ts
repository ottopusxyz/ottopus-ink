import type { ExternalItem, ExternalKind, ExternalSource, NewExternalServer } from '../../../shared/ipc'

export const KIND_LABELS: Record<ExternalKind, string> = { mcp: 'MCP server', skill: 'Skill', plugin: 'Plugin' }

const SOURCE_TITLES: Record<ExternalSource, string> = {
  bundled: 'Shipped with Ink',
  detected: 'Found in your agents',
  added: 'Added by you',
}

/** What to do about tools waiting for sign-in. */
export function signInHint(names: readonly string[]): string {
  const who = names.join(', ')
  return `${who} ${names.length === 1 ? 'needs' : 'need'} sign-in, so chats don't get ${names.length === 1 ? 'its' : 'their'} tools. Sign in under Settings, Tools and skills, then start a new chat.`
}

export interface ExternalGroup {
  source: ExternalSource
  title: string
  items: ExternalItem[]
}

/** What's on first, then what could be, then what can't, each by name. */
function compare(a: ExternalItem, b: ExternalItem): number {
  const rank = (item: ExternalItem) => (item.enabled ? 0 : item.unavailable ? 2 : 1)
  return rank(a) - rank(b) || a.name.localeCompare(b.name)
}

/** Items in the settings list's order. A source with nothing in it isn't shown. */
export function groupExternal(items: readonly ExternalItem[]): ExternalGroup[] {
  return (Object.keys(SOURCE_TITLES) as ExternalSource[]).flatMap((source) => {
    const inSource = items.filter((item) => item.source === source).sort(compare)
    return inSource.length > 0 ? [{ source, title: SOURCE_TITLES[source], items: inSource }] : []
  })
}

/** Items holding every word of the query, in any order and case. */
export function filterExternal(items: readonly ExternalItem[], query: string): ExternalItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((item) => {
    const text = `${item.name} ${KIND_LABELS[item.kind]} ${item.description ?? ''}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

export interface ServerForm {
  name: string
  /** A command to run, or an address starting with http:// or https://. */
  target: string
  args: string
  envNames: string
}

const words = (text: string) => text.split(/[\s,]+/).filter(Boolean)

/** The form as a request for main, which checks it again and asks the person. */
export function serverFromForm({ name, target, args, envNames }: ServerForm): NewExternalServer {
  const trimmed = target.trim()
  if (/^https?:\/\//i.test(trimmed)) return { name: name.trim(), url: trimmed }
  return { name: name.trim(), command: trimmed, args: args.split(/\s+/).filter(Boolean), envNames: words(envNames) }
}
