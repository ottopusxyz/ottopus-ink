import { Badge } from '@/components/ui'
import { ChevronDownIcon, PlugIcon } from '@/components/shell/icons'
import { toolLabel, type ChatItem } from '@/lib/chats'

/**
 * A tool the agent called, closed to a line by default. Opening it shows exactly
 * what was sent and what came back, so a person can check an agent's claim.
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
      <span className="ink-eyebrow">Sent</span>
      <pre>{input || 'Nothing'}</pre>
      {result ? (
        <>
          <span className="ink-eyebrow">Came back</span>
          <pre>{result.text || 'Nothing'}</pre>
        </>
      ) : null}
    </details>
  )
}
