import type { AgentId, AgentStatus } from '../../../shared/ipc'

export interface AgentInfo {
  id: AgentId
  name: string
  /** Two letters for the coloured mark, with its fill and text colour. */
  mark: string
  fill: string
  ink: string
  install: string
  signIn: string
  update: string
}

/**
 * How each agent is shown, and the terminal commands its hints offer, in the
 * order the pickers list them. Detection (main process) decides which are
 * installed.
 */
export const AGENTS: readonly AgentInfo[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    mark: 'CC',
    fill: '#F58A6A',
    ink: '#16213E',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    signIn: 'claude auth login',
    update: 'claude update',
  },
  {
    id: 'codex',
    name: 'Codex',
    mark: 'Cx',
    fill: '#16213E',
    ink: '#F5F0E6',
    install: 'npm install -g @openai/codex',
    signIn: 'codex login',
    update: 'npm install -g @openai/codex@latest',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    mark: 'OC',
    fill: '#DDE2F0',
    ink: '#16213E',
    install: 'curl -fsSL https://opencode.ai/install | bash',
    signIn: 'opencode auth login',
    update: 'opencode upgrade',
  },
]

export function agentInfo(id: AgentId): AgentInfo {
  const info = AGENTS.find((agent) => agent.id === id)
  if (!info) throw new Error(`unknown agent ${id}`)
  return info
}

/** Named in the pickers so nobody goes looking for them yet. */
export const LATER_AGENTS = ['Grok', 'Cursor', 'Cline'] as const

export interface AgentCopy {
  /** A short state: "Ready", "Not installed". */
  label: string
  /** What to know or do next, in a sentence. */
  hint: string
  /** A terminal command that fixes it, shown so it can be copied. */
  command?: string
}

/** What the pickers and settings say about one detected agent. */
export function describeAgent(status: AgentStatus): AgentCopy {
  const info = agentInfo(status.id)
  switch (status.state) {
    case 'ready':
      return {
        label: 'Ready',
        hint:
          status.signedIn === null
            ? `Version ${status.version}. Ink couldn't read its sign-in, so check it in a terminal if a chat fails.`
            : `Version ${status.version}, signed in.`,
      }
    case 'signed-out':
      return { label: 'Not signed in', hint: 'Sign in once in a terminal, then check again.', command: info.signIn }
    case 'outdated':
      return {
        label: 'Needs an update',
        hint: `Version ${status.version} lacks ${status.missing.join(', ')}. Update it, then check again.`,
        command: info.update,
      }
    case 'broken':
      return { label: "Doesn't start", hint: `${status.path} didn't answer --version. Try running it in a terminal.` }
    case 'missing':
      return { label: 'Not installed', hint: 'Install it in a terminal, then check again.', command: info.install }
  }
}

/**
 * The agent new chats use: the one picked, while it is ready, otherwise the
 * first ready one in list order. Null when none is ready.
 */
export function chooseAgent(agents: readonly AgentStatus[], picked: AgentId | null): AgentId | null {
  const ready = agents.filter((agent) => agent.state === 'ready')
  return ready.find((agent) => agent.id === picked)?.id ?? ready[0]?.id ?? null
}
