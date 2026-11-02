/**
 * The IPC contract between the renderer (through the preload bridge) and the
 * main process. Every channel the renderer can reach is listed here; the main
 * process registers handlers for exactly these and nothing else.
 */
export const IPC = {
  appInfo: 'app:info',
  /** Main to renderer: the signer's status, sent on every change. */
  signerStatus: 'signer:status',
} as const

export type SignerStatus = 'starting' | 'ready' | 'stopped'

export interface AppInfo {
  name: string
  version: string
  /** process.platform of the main process: darwin, linux, win32. */
  platform: string
  signer: SignerStatus
}

/** What the preload exposes on `window.ink`. */
export interface InkBridge {
  appInfo(): Promise<AppInfo>
  /** Calls listener on every signer status change; returns an unsubscribe. */
  onSignerStatus(listener: (status: SignerStatus) => void): () => void
}

/** Messages between main and the signer utility process. */
export type SignerRequest = { type: 'ping'; id: number }
export type SignerResponse = { type: 'pong'; id: number }
