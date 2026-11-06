import { useId, type ReactNode, type Ref } from 'react'
import { externalCount } from '@/lib/chats'
import { cn } from '@/lib/cn'
import { ArrowUpIcon, ChevronDownIcon, PlugIcon, PlusIcon, StopIcon } from '@/components/shell/icons'
import { Tooltip } from '@/components/ui'

export const SKILLS_HINT = "Turn skills on in Settings, under Tools and skills. Ink's own are on the way."
export const TOOLS_HINT = 'Ink starts chats with only its own tools: reading balances and proposing plans. No shell, file or web access.'

/** What a chat can use, for the chip beside the composer and the chat's toolbar. */
export function toolsChip(external: readonly string[]): { text: string; hint: string; open: boolean } {
  if (external.length === 0) return { text: 'Ottopus tools only', hint: TOOLS_HINT, open: false }
  return {
    text: `Ottopus + ${externalCount(external.length)}`,
    hint: `Also on, by your choice: ${external.join(', ')}. These can act outside Ink's review. Change them in Settings.`,
    open: true,
  }
}

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
  external = [],
}: ComposerProps) {
  const id = useId()
  const chip = toolsChip(external)
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
          <Tooltip text={chip.hint}>
            <span className={cn('ink-connector', chip.open && 'ink-connector--open')} tabIndex={0}>
              <PlugIcon size={13} />
              {chip.text}
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
