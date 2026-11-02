import type { MenuItemConstructorOptions } from 'electron'

/**
 * The menu of the built app. It keeps what a desktop app needs: quit and close,
 * and the edit roles that make copy and paste work on macOS. It leaves out the
 * View menu, whose Reload wipes everything held in memory and whose DevTools
 * would let anyone at the keyboard script window.ink.
 */
export function appMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
}
