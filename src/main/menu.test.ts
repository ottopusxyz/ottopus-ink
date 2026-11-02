import { describe, expect, it } from 'vitest'
import { appMenuTemplate } from './menu'

describe('appMenuTemplate', () => {
  it('has no View menu, reload or DevTools on any platform', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const roles = appMenuTemplate(platform).map((item) => item.role)
      expect(roles).not.toContain('viewMenu')
      expect(roles).not.toContain('reload')
      expect(roles).not.toContain('forceReload')
      expect(roles).not.toContain('toggleDevTools')
      expect(roles).toContain('editMenu')
    }
  })

  it('adds the app menu only on macOS', () => {
    expect(appMenuTemplate('darwin')[0]?.role).toBe('appMenu')
    expect(appMenuTemplate('linux').map((item) => item.role)).not.toContain('appMenu')
  })
})
