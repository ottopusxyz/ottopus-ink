import { useEffect, useRef, type ReactNode } from 'react'
import { Callout } from '@/components/ui'
import { PANE_LIFE, Sea } from '@/components/motion/sea'
import { ChevronDownIcon, ListIcon, PlugIcon } from '@/components/shell/icons'
import type { Chat } from '@/lib/chats'
import { Composer } from './composer'

export interface ChatViewProps {
  chat: Chat
  draft: string
  onDraft: (value: string) => void
  onSubmit: () => void
  agentPicker: ReactNode
}

/**
 * One chat: the conversation on the left and the live plan on the right, over
 * water, so a transaction in flight reads as something happening rather than
 * as a row in a wallet.
 *
 * Nothing answers yet. The agent drivers (issues #5 to #7) and the chat
 * stream (#10) fill the conversation in; this lays out where they land.
 */
export function ChatView({ chat, draft, onDraft, onSubmit, agentPicker }: ChatViewProps) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [chat.messages.length])

  return (
    <>
      <main className="ink-panel flex flex-col" id="main" aria-label={chat.title}>
        <div className="ink-chat-toolbar">
          {agentPicker}
          <span className="flex-1" />
          <button type="button" className="ink-picker" disabled>
            Skills
            <ChevronDownIcon size={12} />
          </button>
          <span className="ink-connector">
            <PlugIcon size={13} />
            ottopus-ink
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-[22px] py-[18px]">
          {chat.messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="ink-bubble">
                {message.text}
              </div>
            ) : (
              <p key={message.id} className="selectable m-0 max-w-[94%] text-[14px] leading-[1.6]">
                {message.text}
              </p>
            ),
          )}
          <Callout severity="info" title="No agent is connected yet">
            Ink can find your agents but can't drive them yet; that comes with the chat drivers. Nothing was sent.
          </Callout>
          <div ref={end} />
        </div>

        <Composer compact value={draft} onChange={onDraft} onSubmit={onSubmit} placeholder="Reply to your agent" />
      </main>

      <aside className="ink-plan-pane" aria-label="Live plan">
        <Sea creatures={PANE_LIFE} shafts={false} />
        <div className="relative flex h-full flex-col gap-3 p-[18px]">
          <span className="ink-eyebrow">Live plan</span>
          <div className="flex flex-col items-start gap-2 rounded-[12px] border border-[var(--ot-border)] bg-[color-mix(in_srgb,var(--ot-card)_86%,transparent)] p-3.5">
            <span className="text-[var(--ot-plan)]">
              <ListIcon />
            </span>
            <span className="text-[14px] font-semibold">No plan yet</span>
            <span className="text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">
              When your agent proposes one, each step shows here and opens for review in its own window.
            </span>
          </div>
        </div>
      </aside>
    </>
  )
}
