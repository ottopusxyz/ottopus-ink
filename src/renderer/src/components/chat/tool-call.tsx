import { Badge } from '@/components/ui'
import { ChevronDownIcon, PlugIcon } from '@/components/shell/icons'
import { toolLabel, type ChatItem } from '@/lib/chats'

/**
 * A tool the agent called, closed to a line by default. All of this comes from the
 * agent's own output, not from Ink's server, so it's the agent's account of the call
 * and worded that way. Only a plan card comes from Ink itself.
 */
export function ToolCall({ name, input, result }: Extract<ChatItem, { kind: 'tool' }>) {
  return (
    <details className="ink-tool">
      <summary>
        <PlugIcon size={13} />
        <span className="min-w-0 truncate font-mono">{toolLabel(name)}</span>
        {result === null ? (
          <Badge tone="plan">Running</Badge>
        ) : result.isError ? (
          <Badge tone="block">Failed</Badge>
        ) : (
          <Badge tone="neutral">Done</Badge>
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
