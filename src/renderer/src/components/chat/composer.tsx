import { useId, type Ref } from 'react'
import { cn } from '@/lib/cn'
import { ArrowUpIcon, ChevronDownIcon, PlugIcon, PlusIcon } from '@/components/shell/icons'

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  compact?: boolean
  textareaRef?: Ref<HTMLTextAreaElement>
}

/**
 * Where a person tells their agent what to do. Enter sends and Shift+Enter
 * breaks the line.
 *
 * The agent, model and skills pickers are drawn but not wired: they fill in
 * once agent detection (issue #4) knows what is installed, so for now they
 * say so rather than show an agent that may not be there.
 */
export function Composer({ value, onChange, onSubmit, placeholder, compact = false, textareaRef }: ComposerProps) {
  const id = useId()
  const empty = value.trim().length === 0

  return (
    <form
      className={cn('ink-composer', compact && 'ink-composer--compact')}
      onSubmit={(event) => {
        event.preventDefault()
        if (!empty) onSubmit()
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
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (!empty) onSubmit()
          }
        }}
      />
      <div className="ink-composer__row">
        <button type="button" className="ink-round" aria-label="Add files or context" disabled>
          <PlusIcon />
        </button>
        {compact ? null : (
          <>
            <button
              type="button"
              className="ink-picker ml-1"
              disabled
              title="Ink lists the agents it finds on this computer once detection is in"
            >
              Choose an agent
              <ChevronDownIcon size={12} />
            </button>
            <button type="button" className="ink-picker" disabled>
              Skills
              <ChevronDownIcon size={12} />
            </button>
          </>
        )}
        <span className="flex-1" />
        {compact ? (
          <span className="mr-2 text-[12px] text-[var(--ot-text-3)]">Enter sends · Shift+Enter for a new line</span>
        ) : (
          <span className="ink-connector" title="In Ink chats the agent sees only Ottopus Ink's tools">
            <PlugIcon size={13} />
            Ottopus tools only
          </span>
        )}
        <button type="submit" className="ink-send" aria-label="Send" disabled={empty}>
          <ArrowUpIcon />
        </button>
      </div>
    </form>
  )
}
