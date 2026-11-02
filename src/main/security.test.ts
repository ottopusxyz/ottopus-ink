import { describe, expect, it } from 'vitest'
import { isAppUrl, isSafeExternalUrl, secureWebPreferences } from './security'

describe('secureWebPreferences', () => {
  it('isolates and sandboxes the renderer', () => {
    const prefs = secureWebPreferences('/app/preload.cjs', { devTools: false })
    expect(prefs).toMatchObject({
      devTools: false,
      preload: '/app/preload.cjs',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    })
  })
})

describe('isSafeExternalUrl', () => {
  it('allows only https', () => {
    expect(isSafeExternalUrl('https://nearblocks.io/txns/abc')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(false)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('ms-settings:privacy')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })
})

describe('isAppUrl', () => {
  it('matches only the dev server origin in dev', () => {
    const dev = 'http://localhost:5173'
    expect(isAppUrl('http://localhost:5173/#/chat', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppUrl('https://evil.example/', dev)).toBe(false)
  })

  it('matches only the bundled index.html in production', () => {
    const entry = 'file:///opt/ink/resources/app/out/renderer/index.html'
    expect(isAppUrl(entry, entry)).toBe(true)
    expect(isAppUrl(`${entry}#/chat`, entry)).toBe(true)
    expect(isAppUrl('file:///home/me/Downloads/dropped.html', entry)).toBe(false)
    expect(isAppUrl('file:///opt/ink/resources/app/out/renderer/other.html', entry)).toBe(false)
    expect(isAppUrl('https://evil.example/', entry)).toBe(false)
  })
})
