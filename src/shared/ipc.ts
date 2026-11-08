import type { Account, AccountChain } from './accounts'
import type { BackupAnswer, NewPhrase, VaultRequest, VaultResult, VaultStatus, VaultWordCount } from './vault'

/**
 * The IPC contract between the renderer (through the preload bridge) and the
 * main process. Every channel the renderer can reach is listed here; the main
 * process registers handlers for exactly these and nothing else.
 */
export const IPC = {
  appInfo: 'app:info',
  detectAgents: 'agents:detect',
  startChat: 'chat:start',
  sendToChat: 'chat:send',
  stopChatTurn: 'chat:stop-turn',
  closeChat: 'chat:close',
  listExternalTools: 'external:list',
  addExternalServer: 'external:add',
  removeExternalServer: 'external:remove',
  setExternalEnabled: 'external:set-enabled',
  signInExternal: 'external:sign-in',
  cancelExternalSignIn: 'external:cancel-sign-in',
  signOutExternal: 'external:sign-out',
  /** Main to renderer: what happened in a chat. */
  chatEvent: 'chat:event',
  /** Main to renderer: the signer's status, sent on every change. */
  signerStatus: 'signer:status',
  vaultStatus: 'vault:status',
  startVaultCreate: 'vault:start-create',
  finishVaultCreate: 'vault:finish-create',
  cancelVaultCreate: 'vault:cancel-create',
  restoreVault: 'vault:restore',
  unlockVault: 'vault:unlock',
  lockVault: 'vault:lock',
  vaultAccounts: 'vault:accounts',
  copyAddress: 'vault:copy-address',
  /** Main to renderer: the vault's status, sent on every change. */
  vaultStatusChanged: 'vault:status-changed',
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
 * - broken: found on PATH, but `--version` or `--help` failed
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

/** The tools of Ink's MCP server. The server has exactly these, and the page shortens only these names. */
export const INK_TOOLS = ['get_accounts', 'get_portfolio', 'get_quote', 'create_plan', 'get_plan', 'cancel_plan'] as const

/**
 * A plan an agent proposed. Until the wallet exists it's a placeholder that can't
 * be reviewed or signed. The agent wrote every value here, so show them as text.
 */
export interface ChatPlan {
  id: string
  status: 'draft'
  outcome: 'send' | 'swap' | 'stake'
  asset: string
  amount: string
  chain: string | null
  to: string | null
  toAsset: string | null
  toChain: string | null
}

export type ExternalKind = 'mcp' | 'skill' | 'plugin'
export type ExternalSource = 'bundled' | 'detected' | 'added'

/**
 * A skill, MCP server or plugin a chat could use, as the page sees it. Commands,
 * arguments, full URLs and secrets stay in the main process.
 */
export interface ExternalItem {
  id: string
  name: string
  kind: ExternalKind
  source: ExternalSource
  /** Which agent it was found in, if it was found in one. */
  origin: AgentId | null
  /** What it does in a few words, with nothing secret in it. */
  summary: string
  /** Its own description of itself: third-party text. */
  description: string | null
  /** Whether new chats get it. */
  enabled: boolean
  /** Why it can't be turned on, or null if it can. */
  unavailable: string | null
  /** It was turned on, then what it runs changed, so it went back to off. */
  changed: boolean
  /** Its name suggests it can send, sign or trade. Only a hint. */
  mayMoveFunds: boolean
  /** A server of its turned the app away for want of a sign-in, when last asked. Unknown until then. */
  needsSignIn: boolean
  /** Ink holds a sign-in for it. The token itself stays in the main process. */
  signedIn: boolean
}

/** A server someone is adding by hand: a command, or a URL. Keys go in env vars, by name. */
export interface NewExternalServer {
  name: string
  command?: string
  args?: string[]
  url?: string
  envNames?: string[]
}

/** What happens in a chat, whichever agent is driving it. */
export type ChatEvent =
  /**
   * The agent's session as it reports it, at the start of each turn. A list is
   * null when the report couldn't be read. Plugins leaves out the agent's built-in ones.
   * NeedsSignIn names the servers waiting for someone to sign in, which gave it no tools.
   */
  | { type: 'session'; tools: string[] | null; servers: string[] | null; plugins: string[] | null; needsSignIn: string[]; model: string | null }
  /**
   * Whether a report showed only Ink's tools and what the person enabled. If not,
   * found says what else, and the chat is being stopped. External names what they
   * enabled that's working, needsSignIn what they enabled that's waiting for sign-in,
   * and mayMoveFunds any of its tools whose names suggest they send or sign.
   */
  | { type: 'lock'; locked: boolean; found: string[]; external: string[]; needsSignIn: string[]; mayMoveFunds: string[] }
  /** External items that were enabled but couldn't be loaded into this chat. */
  | { type: 'external-skipped'; names: string[] }
  /** The next piece of the reply. */
  | { type: 'text'; text: string }
  /** Input is already text, as an agent can shape its own so it won't cross IPC. */
  | { type: 'tool-call'; id: string; name: string; input: string }
  /** The session is running a subagent, which a locked one can't do. */
  | { type: 'subagent' }
  | { type: 'tool-result'; id: string; text: string; isError: boolean }
  /** From Ink's own server, not the agent's output, so an agent can't forge one by printing it. */
  | { type: 'plan'; plan: ChatPlan }
  | { type: 'turn-end'; outcome: 'done' | 'stopped' | 'failed'; error: string | null }
  /** The agent's process is gone and the chat can't continue. Error is null when Ink closed it. */
  | { type: 'ended'; error: string | null }

/** What the preload exposes on `window.ink`. */
export interface InkBridge {
  appInfo(): Promise<AppInfo>
  /**
   * The agents found on this computer. The first call checks; later calls
   * return that result unless refresh is set, for a "Check again" button.
   */
  detectAgents(options?: { refresh?: boolean }): Promise<AgentStatus[]>
  /** Starts a chat with an agent detection found ready, and returns its id. */
  startChat(agent: AgentId): Promise<string>
  /** Starts a turn. Rejects while one is running. */
  sendToChat(chatId: string, text: string): Promise<void>
  /** Stops the running turn and keeps the conversation. */
  stopChatTurn(chatId: string): Promise<void>
  closeChat(chatId: string): Promise<void>
  /** The skills, MCP servers and plugins new chats could use. Reads only, and starts nothing. */
  listExternalTools(): Promise<ExternalItem[]>
  /** Asks the person in a native dialog, then adds it, switched off. */
  addExternalServer(server: NewExternalServer): Promise<ExternalItem[]>
  removeExternalServer(id: string): Promise<ExternalItem[]>
  /** Turning one on asks the person in a native dialog, so a page can't do it alone. */
  setExternalEnabled(id: string, enabled: boolean): Promise<ExternalItem[]>
  /** Asks in a native dialog, then waits for the person in their browser, for as long as that takes. */
  signInExternal(id: string): Promise<ExternalItem[]>
  /** Gives up on a sign-in that's waiting. */
  cancelExternalSignIn(): Promise<void>
  signOutExternal(id: string): Promise<ExternalItem[]>
  /** Calls listener on everything that happens in any chat; returns an unsubscribe. */
  onChatEvent(listener: (chatId: string, event: ChatEvent) => void): () => void
  /** Calls listener on every signer status change; returns an unsubscribe. */
  onSignerStatus(listener: (status: SignerStatus) => void): () => void
  vaultStatus(): Promise<VaultStatus>
  /** Makes a new recovery phrase to show once. Nothing is saved until finishVaultCreate. */
  startVaultCreate(words: VaultWordCount): Promise<VaultResult<NewPhrase>>
  /** Checks the words asked for, saves the vault under the password, and unlocks it. */
  finishVaultCreate(password: string, answers: BackupAnswer[]): Promise<VaultResult>
  cancelVaultCreate(): Promise<void>
  /** Saves a vault from a phrase the person already has, and unlocks it. */
  restoreVault(words: string, password: string): Promise<VaultResult>
  unlockVault(password: string): Promise<VaultResult>
  lockVault(): Promise<void>
  /** The address on each chain, while unlocked. Fails with 'locked' otherwise. */
  vaultAccounts(): Promise<VaultResult<{ accounts: Account[] }>>
  /** Main copies that chain's address as the signer gave it, not text from the page, and only while Ink's window is in front. */
  copyAddress(chain: AccountChain): Promise<VaultResult>
  /** Calls listener whenever the vault's status changes; returns an unsubscribe. */
  onVaultStatus(listener: (status: VaultStatus) => void): () => void
}

/** Messages between main and the signer utility process. */
export type SignerRequest = { type: 'ping'; id: number } | { type: 'vault'; id: number; request: VaultRequest }
export type SignerResponse = { type: 'pong'; id: number } | { type: 'vault'; id: number; result: VaultResult<object> }
