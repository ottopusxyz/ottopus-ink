import type { InkTool } from './chats'

export type ToolState = 'running' | 'done' | 'failed'

interface ToolCopy {
  running: string
  done: string
  failed: string
  /** The glyph tile's fill: one pastel per tool, light in both themes. */
  tint: string
}

/** How each of Ink's tools reads in a chat: what it's doing, what it did, or that it didn't. */
export const TOOL_COPY: Record<InkTool, ToolCopy> = {
  get_accounts: { running: 'Finding your accounts', done: 'Found your accounts', failed: 'Couldn’t read your accounts', tint: '#FFF0DC' },
  get_portfolio: { running: 'Reading your balances', done: 'Read your balances', failed: 'Couldn’t read your balances', tint: '#C9F2DD' },
  get_quote: { running: 'Getting a quote', done: 'Got a quote', failed: 'Couldn’t get a quote', tint: '#CFE0FF' },
  create_plan: { running: 'Drafting a plan', done: 'Drafted a plan', failed: 'Couldn’t draft the plan', tint: '#FFD2C2' },
  get_plan: { running: 'Checking the plan', done: 'Checked the plan', failed: 'Couldn’t check the plan', tint: '#DDE2F0' },
  cancel_plan: { running: 'Withdrawing the plan', done: 'Withdrew the plan', failed: 'Couldn’t withdraw the plan', tint: '#FDD3D4' },
}

/** A tool call's heading: plain words for Ink's tools, the name itself for anything else so it stands out. */
export function toolTitle(tool: InkTool | null, label: string, state: ToolState): string {
  return tool ? TOOL_COPY[tool][state] : label
}

/** How long a call took, as a Done chip shows it, or null when it's too quick or unknown to be worth saying. */
export function toolDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || ms < 100) return null
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60_000)} min`
}

/** The first line of what a tool sent back, collapsed and cut to fit one line under the heading. */
export function toolSummary(text: string | null | undefined, max = 90): string | null {
  const line = (text ?? '')
    .split('\n')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find((part) => part.length > 0)
  if (!line) return null
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}
