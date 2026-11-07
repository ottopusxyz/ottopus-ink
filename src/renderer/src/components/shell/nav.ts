/** The pages the sidebar's lower group opens. Chats are listed above them. */
export const PAGES = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'activity', label: 'Activity' },
] as const

export type PageId = (typeof PAGES)[number]['id']

/** Where the main panel is: the home composer, one chat, or a page. */
export type View = { kind: 'home' } | { kind: 'chat'; chatId: string } | { kind: 'page'; page: PageId }

export const SHORTCUTS = [
  { action: 'new-chat', key: 'n', label: 'New chat' },
  { action: 'search', key: 'k', label: 'Search chats' },
  { action: 'settings', key: ',', label: 'Settings' },
  { action: 'lock', key: 'l', label: 'Lock' },
] as const

export type ShortcutAction = (typeof SHORTCUTS)[number]['action']

/**
 * The action a keyboard shortcut runs: ⌘ or Ctrl plus one key, the desktop
 * convention. Returns null for anything else so the key reaches the page.
 */
export function actionForShortcut(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): ShortcutAction | null {
  const modifier = event.metaKey || event.ctrlKey
  if (!modifier || event.altKey || event.shiftKey) return null
  const key = event.key.toLowerCase()
  return SHORTCUTS.find((shortcut) => shortcut.key === key)?.action ?? null
}

/** How a shortcut reads on this platform: "⌘K" on a Mac, "Ctrl K" elsewhere. */
export function shortcutLabel(action: ShortcutAction, mac: boolean): string {
  const key = SHORTCUTS.find((shortcut) => shortcut.action === action)?.key ?? ''
  return mac ? `⌘${key.toUpperCase()}` : `Ctrl ${key.toUpperCase()}`
}
