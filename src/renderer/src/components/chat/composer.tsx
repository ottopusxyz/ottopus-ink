import { useId, useState, type ReactNode, type Ref } from 'react'
import type { AttachmentFailure, ChatAttachment } from '../../../../shared/ipc'
import { cn } from '@/lib/cn'
import { ArrowUpIcon, CloseIcon, PlusIcon, ReceiptIcon, StopIcon } from '@/components/shell/icons'
import { Tooltip } from '@/components/ui'
import { ToolsPopover, type ToolsPopoverProps } from './tools-popover'

export { TOOLS_HINT, toolsChip } from './tools-popover'

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  /** Sends what's written and the files attached. Says whether it went, so the files are let go only then. */
  onSubmit: (files: readonly ChatAttachment[]) => boolean
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
/** The most files one message carries; main holds to the same. */
const MAX_FILES = 3

/** Why a file couldn't be attached, in a line. */
const FAILED: Record<AttachmentFailure, string> = {
  'not-supported': 'Ink reads PDFs and text files (.txt, .md, .csv, .json).',
  'too-big': 'That file is over 10 MB.',
  'no-text': 'Ink found no text in it. A scanned invoice has none; try the PDF the sender made.',
  unreadable: 'Ink couldn’t read it. The file may be damaged or locked with a password.',
}

/** Files attached to a message, by name: in the composer, removable, and on a sent message. */
export function FileChips({ names, onRemove }: { names: readonly string[]; onRemove?: (index: number) => void }) {
  return (
    <ul className="ink-file-chips">
      {names.map((name, index) => (
        <li key={`${name}-${index}`} className="ink-file-chip">
          <ReceiptIcon size={13} />
          <span className="truncate">{name}</span>
          {onRemove ? (
            <button type="button" className="ink-file-chip__remove" aria-label={`Remove ${name}`} onClick={() => onRemove(index)}>
              <CloseIcon size={11} />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

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
  const [files, setFiles] = useState<ChatAttachment[]>([])
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const sendable = canSend && !disabled && !onStop && (value.trim().length > 0 || files.length > 0)
  const submit = () => {
    if (!sendable) return
    if (onSubmit(files)) {
      setFiles([])
      setFileNote(null)
    }
  }
  // Main shows the system's file dialog and reads the file; the page gets its name and an id.
  const attach = async () => {
    if (picking || disabled || files.length >= MAX_FILES) return
    setPicking(true)
    try {
      const picked = await window.ink.attachFile()
      if (!picked) return
      if ('failed' in picked) setFileNote(`${picked.name}: ${FAILED[picked.failed]}`)
      else {
        setFiles((all) => [...all, picked])
        setFileNote(picked.cut ? `${picked.name} is long, so your agent gets the start of it.` : null)
      }
    } catch {
      setFileNote('Ink couldn’t open the file dialog.')
    } finally {
      setPicking(false)
    }
  }
  const remove = (index: number) => {
    const file = files[index]
    if (file) void window.ink.dropAttachment(file.id).catch(() => undefined)
    setFiles((all) => all.filter((_, i) => i !== index))
    setFileNote(null)
  }

  return (
    <form
      className={cn('ink-composer', compact && 'ink-composer--compact', prominent && 'ink-composer--prominent')}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
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
            submit()
          }
        }}
      />
      {files.length > 0 ? <FileChips names={files.map((file) => file.name)} onRemove={remove} /> : null}
      {fileNote ? <p className="ink-composer__note m-0">{fileNote}</p> : null}
      <div className="ink-composer__row">
        <Tooltip text={files.length >= MAX_FILES ? `Up to ${MAX_FILES} files a message.` : 'Attach an invoice: a PDF or a text file. Ink reads it here, on your computer.'}>
          <button
            type="button"
            className="ink-round"
            aria-label="Attach a file"
            aria-disabled={disabled || files.length >= MAX_FILES || picking}
            onClick={() => void attach()}
          >
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
    </form>
  )
}

/** The keys a chat's composer takes, shown under it, outside its box, as the design has it. */
export function ComposerHint({ className }: { className?: string }) {
  return (
    <p className={cn('ink-composer__hint m-0', className)}>
      <kbd className="ink-kbd">Enter</kbd> sends · <kbd className="ink-kbd">Shift Enter</kbd> new line
    </p>
  )
}
