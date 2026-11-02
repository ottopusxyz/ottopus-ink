/**
 * The IPC contract between the renderer (through the preload bridge) and the
 * main process. Every channel the renderer can reach is listed here; the main
 * process registers handlers for exactly these and nothing else.
 */
export const IPC = {
  appInfo: 'app:info',
  detectAgents: 'agents:detect',
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

/** The agents Ink drives in the first release, in the order pickers list them. */
export const AGENT_IDS = ['claude-code', 'codex', 'opencode'] as const
export type AgentId = (typeof AGENT_IDS)[number]

/**
 * What detection found for one agent:
 * - ready: installed, new enough, and signed in (or its sign-in can't be read)
 * - signed-out: installed and new enough, but not signed in
 * - outdated: installed, but its --help lacks a flag or command Ink needs
 * - broken: found on PATH, but `--version` failed
 * - missing: not on PATH
 */
export type AgentState = 'ready' | 'signed-out' | 'outdated' | 'broken' | 'missing'

export interface AgentStatus {
  id: AgentId
  state: AgentState
  /** Where the binary was found, for the settings list. */
  path: string | null
  version: string | null
  /** Flags or commands Ink needs that this version's --help doesn't list. */
  missing: string[]
  /** Null when the CLI gives no clear answer. */
  signedIn: boolean | null
}

/** What the preload exposes on `window.ink`. */
export interface InkBridge {
  appInfo(): Promise<AppInfo>
  /**
   * The agents found on this computer. The first call checks; later calls
   * return that result unless refresh is set, for a "Check again" button.
   */
  detectAgents(options?: { refresh?: boolean }): Promise<AgentStatus[]>
  /** Calls listener on every signer status change; returns an unsubscribe. */
  onSignerStatus(listener: (status: SignerStatus) => void): () => void
}

/** Messages between main and the signer utility process. */
export type SignerRequest = { type: 'ping'; id: number }
export type SignerResponse = { type: 'pong'; id: number }
