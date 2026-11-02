import type { WebPreferences } from 'electron'

/**
 * The web preferences every app window uses. The renderer is treated as
 * untrusted display code: no Node, sandboxed, isolated from the preload.
 * DevTools are for development only.
 */
export function secureWebPreferences(preload: string, { devTools }: { devTools: boolean }): WebPreferences {
  return {
    preload,
    devTools,
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
 * Whether a URL is the app's own page. In dev the renderer is served by Vite,
 * so any page on that origin. In production it is one file, the bundled
 * index.html: any other file: URL is not the app, or a file dropped on the
 * window would load with the preload bridge and pass the IPC frame check.
 */
export function isAppUrl(raw: string, appEntry: string): boolean {
  try {
    const url = new URL(raw)
    const entry = new URL(appEntry)
    if (entry.protocol === 'file:') return url.protocol === 'file:' && url.pathname === entry.pathname
    return url.origin === entry.origin
  } catch {
    return false
  }
}
