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
  /** Main to renderer: what happened in a chat. */
  chatEvent: 'chat:event',
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

/** What happens in a chat, whichever agent is driving it. */
export type ChatEvent =
  /**
   * The agent's session as it reports it, at the start of each turn. A list is
   * null when the report couldn't be read. Plugins leaves out the agent's built-in ones.
   */
  | { type: 'session'; tools: string[] | null; servers: string[] | null; plugins: string[] | null; model: string | null }
  /** Whether a report showed only Ink's tools. If not, found says what else, and the chat is being stopped. */
  | { type: 'lock'; locked: boolean; found: string[] }
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
  /** Calls listener on everything that happens in any chat; returns an unsubscribe. */
  onChatEvent(listener: (chatId: string, event: ChatEvent) => void): () => void
  /** Calls listener on every signer status change; returns an unsubscribe. */
  onSignerStatus(listener: (status: SignerStatus) => void): () => void
}

/** Messages between main and the signer utility process. */
export type SignerRequest = { type: 'ping'; id: number }
export type SignerResponse = { type: 'pong'; id: number }
