import { useId, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/cn'
import { ArrowUpIcon, ChevronDownIcon, PlugIcon, PlusIcon, StopIcon } from '@/components/shell/icons'
import { Tooltip } from '@/components/ui'

export const SKILLS_HINT = "Skills aren't available yet. Ink's own skills are on the way."
export const TOOLS_HINT = 'Ink starts chats with only its own tools: reading balances and proposing plans. No shell, file or web access.'

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
}

/**
 * Where a person tells their agent what to do. Enter sends and Shift+Enter
 * breaks the line. While a turn runs, writing still works and only sending waits.
 *
 * The Skills picker is drawn but off until the skills bundle (issue #11).
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
}: ComposerProps) {
  const id = useId()
  const sendable = canSend && !disabled && !onStop && value.trim().length > 0

  return (
    <form
      className={cn('ink-composer', compact && 'ink-composer--compact')}
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
        {compact ? null : (
          <>
            <span className="ml-1">{agentPicker}</span>
            <Tooltip text={SKILLS_HINT}>
              <button type="button" className="ink-picker" aria-disabled>
                Skills
                <ChevronDownIcon size={12} />
              </button>
            </Tooltip>
          </>
        )}
        <span className="flex-1" />
        {compact ? (
          <span className="mr-2 text-[12px] text-[var(--ot-text-3)]">Enter sends · Shift+Enter for a new line</span>
        ) : (
          <Tooltip text={TOOLS_HINT}>
            <span className="ink-connector" tabIndex={0}>
              <PlugIcon size={13} />
              Ottopus tools only
            </span>
          </Tooltip>
        )}
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
    </form>
  )
}
