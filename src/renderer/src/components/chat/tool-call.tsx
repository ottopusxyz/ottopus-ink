import type { ComponentType } from 'react'
import { Badge } from '@/components/ui'
import { Ring } from '@/components/motion/ring'
import { CancelIcon, ChevronDownIcon, EyeIcon, KeyIcon, PieIcon, PlugIcon, ReceiptIcon, ReceiveIcon, RouteIcon, type IconProps } from '@/components/shell/icons'
import { inkTool, toolLabel, type ChatItem, type InkTool } from '@/lib/chats'
import { TOOL_COPY, toolDuration, toolSummary, toolTitle, type ToolState } from '@/lib/tool-copy'

/** Each of Ink's tools' glyph, shared with Home's list of what the agent can reach. */
export const TOOL_GLYPHS: Record<InkTool, ComponentType<IconProps>> = {
  get_accounts: KeyIcon,
  get_deposit_address: ReceiveIcon,
  get_portfolio: PieIcon,
  get_quote: RouteIcon,
  create_plan: ReceiptIcon,
  get_plan: EyeIcon,
  cancel_plan: CancelIcon,
}

/**
 * A tool the agent called, closed to a line by default and hung off the chat's
 * tentacle rail. All of this comes from the agent's own output, not from Ink's
 * server, so it's the agent's account of the call and worded that way. Only a
 * plan card comes from Ink itself.
 *
 * Ink's own tools get plain words and their own glyph. Anything else shows its
 * full name, so a tool from outside Ink stands out.
 */
export function ToolCall({ name, input, result }: Extract<ChatItem, { kind: 'tool' }>) {
  const tool = inkTool(name)
  const label = toolLabel(name)
  const state: ToolState = result === null ? 'running' : result.isError ? 'failed' : 'done'
  const summary = result ? toolSummary(result.text) : null
  const Glyph = tool ? TOOL_GLYPHS[tool] : PlugIcon

  return (
    <details className="ink-tool">
      <summary>
        <span className="ink-tool__glyph" style={{ background: tool ? TOOL_COPY[tool].tint : 'var(--ot-surface-3)' }}>
          <Glyph size={14} />
        </span>
        <span className="ink-tool__text">
          <span className="ink-tool__title">{toolTitle(tool, label, state)}</span>
          <span className="ink-tool__sub">
            <span className="font-mono">{label}</span>
            {summary ? ` · ${summary}` : null}
          </span>
        </span>
        {state === 'running' ? (
          <Badge tone="plan">
            <Ring size={11} />
            Running
          </Badge>
        ) : state === 'failed' ? (
          <Badge tone="block">Failed</Badge>
        ) : (
          <Badge tone="ok">{toolDuration(result?.ms) ? `Done · ${toolDuration(result?.ms)}` : 'Done'}</Badge>
        )}
        <ChevronDownIcon size={12} />
      </summary>
      <span className="ink-eyebrow">Your agent says it sent</span>
      <pre>{input || 'Nothing'}</pre>
      {result ? (
        <>
          <span className="ink-eyebrow">Your agent says it got back</span>
          <pre>{result.text || 'Nothing'}</pre>
        </>
      ) : null}
    </details>
  )
}
