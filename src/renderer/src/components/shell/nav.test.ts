import { describe, expect, it } from 'vitest'
import { SHORTCUTS, actionForShortcut, shortcutLabel } from './nav'

const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>>) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('actionForShortcut', () => {
  it('maps ⌘ and Ctrl keys to actions', () => {
    expect(actionForShortcut(key('n', { metaKey: true }))).toBe('new-chat')
    expect(actionForShortcut(key('k', { ctrlKey: true }))).toBe('search')
    expect(actionForShortcut(key(',', { metaKey: true }))).toBe('settings')
  })

  it('ignores case, so Caps Lock does not break a shortcut', () => {
    expect(actionForShortcut(key('K', { ctrlKey: true }))).toBe('search')
  })

  it('ignores keys without a modifier, or with extra ones', () => {
    expect(actionForShortcut(key('n', {}))).toBeNull()
    expect(actionForShortcut(key('n', { metaKey: true, shiftKey: true }))).toBeNull()
    expect(actionForShortcut(key('k', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(actionForShortcut(key('1', { metaKey: true }))).toBeNull()
  })

  it('gives every action a unique key', () => {
    const keys = SHORTCUTS.map((shortcut) => shortcut.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('shortcutLabel', () => {
  it('follows the platform', () => {
    expect(shortcutLabel('search', true)).toBe('⌘K')
    expect(shortcutLabel('search', false)).toBe('Ctrl K')
    expect(shortcutLabel('settings', false)).toBe('Ctrl ,')
  })
})
