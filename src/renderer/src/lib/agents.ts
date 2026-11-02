/**
 * The agents Ink drives in the first release, in the order the pickers list
 * them. Detection (issue #4) decides which are installed; until then every
 * one is unchecked.
 */
export const AGENTS = [
  { id: 'claude-code', name: 'Claude Code', mark: 'CC', fill: '#F58A6A', ink: '#16213E' },
  { id: 'codex', name: 'Codex', mark: 'Cx', fill: '#16213E', ink: '#F5F0E6' },
  { id: 'opencode', name: 'OpenCode', mark: 'OC', fill: '#DDE2F0', ink: '#16213E' },
] as const

export type AgentId = (typeof AGENTS)[number]['id']

/** Named in the pickers so nobody goes looking for them yet. */
export const LATER_AGENTS = ['Grok', 'Cursor', 'Cline'] as const
