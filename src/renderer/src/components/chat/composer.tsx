import { useId, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/cn'
import { ArrowUpIcon, PlusIcon, StopIcon } from '@/components/shell/icons'
import { Tooltip } from '@/components/ui'
import { ToolsPopover, type ToolsPopoverProps } from './tools-popover'

export { TOOLS_HINT, toolsChip } from './tools-popover'

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  compact?: boolean
  textareaRef?: Ref<HTMLTextAreaElement>
  /** The agent picker, shown in the full composer's toolbar. */
  agentPicker?: ReactNode
  /** Off when there's no agent to send to, or a chat isn't ready for a message. */
  canSend?: boolean
  /** Whether a chat has ended, so nothing more can be written. */
  disabled?: boolean
  /** Set while a turn runs: the send button becomes this stop button. */
  onStop?: (() => void) | undefined
  /** Whether the running turn has already been asked to stop. */
  stopping?: boolean
  /** What new chats get beyond Ottopus tools, by name. */
  external?: readonly string[]
  /** The home composer: the screen's focus, with the sticker edge. */
  prominent?: boolean
  /** What the tools popover says beyond the list: a chat's lock, and where to change things. */
  tools?: Pick<ToolsPopoverProps, 'status' | 'extra' | 'onSettings' | 'scope'>
}

/**
 * Where a person tells their agent what to do. Enter sends and Shift+Enter
 * breaks the line. While a turn runs, writing still works and only sending waits.
 * Home and chats share one row: agent, tools, send.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  compact = false,
  textareaRef,
  agentPicker,
  canSend = true,
  disabled = false,
  onStop,
  stopping = false,
  external = [],
  prominent = false,
  tools = { scope: 'new' },
}: ComposerProps) {
  const id = useId()
  const sendable = canSend && !disabled && !onStop && value.trim().length > 0

  return (
    <form
      className={cn('ink-composer', compact && 'ink-composer--compact', prominent && 'ink-composer--prominent')}
      onSubmit={(event) => {
        event.preventDefault()
        if (sendable) onSubmit()
      }}
    >
      <label htmlFor={id} className="sr-only">
        Message your agent
      </label>
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (sendable) onSubmit()
          }
        }}
      />
      <div className="ink-composer__row">
        <Tooltip text="Adding files or context isn't available yet.">
          <button type="button" className="ink-round" aria-label="Add files or context" aria-disabled>
            <PlusIcon />
          </button>
        </Tooltip>
        {agentPicker ? <span className="ml-1">{agentPicker}</span> : null}
        <span className="flex-1" />
        <ToolsPopover external={external} {...tools} />
        {onStop ? (
          <button type="button" className="ink-send" aria-label="Stop" disabled={stopping} onClick={onStop}>
            <StopIcon />
          </button>
        ) : (
          <button type="submit" className="ink-send" aria-label="Send" disabled={!sendable}>
            <ArrowUpIcon />
          </button>
        )}
      </div>
      {compact ? (
        <span className="ink-composer__hint">
          <kbd className="ink-kbd">Enter</kbd> sends · <kbd className="ink-kbd">Shift Enter</kbd> new line
        </span>
      ) : null}
    </form>
  )
}
