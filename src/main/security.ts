import type { WebPreferences } from 'electron'

/**
 * The web preferences every app window uses. The renderer is treated as
 * untrusted display code: no Node, sandboxed, isolated from the preload.
 */
export function secureWebPreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
  }
}

/**
 * Links the renderer may hand to the OS browser. Only https; never file:,
 * javascript: or custom schemes that could launch another app.
 */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Whether a navigation stays inside the app. In dev the renderer is served by
 * Vite, in production from a file: URL inside the app bundle.
 */
export function isAppUrl(raw: string, devServerUrl: string | undefined): boolean {
  try {
    const url = new URL(raw)
    if (devServerUrl) return url.origin === new URL(devServerUrl).origin
    return url.protocol === 'file:'
  } catch {
    return false
  }
}
