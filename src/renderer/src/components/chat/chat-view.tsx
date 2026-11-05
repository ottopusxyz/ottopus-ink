import { memo, useEffect, useRef, type ReactNode } from 'react'
import { Otto } from '@/components/brand/otto'
import { Callout, ErrorState, Tooltip } from '@/components/ui'
import { PANE_LIFE, Sea } from '@/components/motion/sea'
import { ChevronDownIcon, ListIcon, PlugIcon } from '@/components/shell/icons'
import { agentInfo } from '@/lib/agents'
import type { Chat, ChatItem } from '@/lib/chats'
import { cn } from '@/lib/cn'
import { AgentThinking } from '@/vendor/boardui/agent-thinking'
import { ComposerLoader } from '@/vendor/boardui/composer-loader'
import { AgentMark } from './agent-picker'
import { Composer, SKILLS_HINT, TOOLS_HINT } from './composer'
import { PlanCard } from './plan-card'
import { ToolCall } from './tool-call'

export interface ChatViewProps {
  chat: Chat
  draft: string
  onDraft: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  onEnd: () => void
}

/** How near the bottom counts as following along. Further up, someone is reading. */
const FOLLOW_PX = 80

const WORKING: Partial<Record<Chat['phase'], string>> = {
  starting: 'Starting your agent…',
  answering: 'Working…',
  stopping: 'Stopping…',
}

/** The water's blue into Otto's coral: brand colours, because the state colours mean something. */
const COMPOSER_LIGHT: [string, string, string, string] = ['var(--ot-plan-border)', 'var(--ot-plan)', 'var(--ot-coral)', 'var(--ot-plan)']

/**
 * One chat: the conversation on the left and the live plan on the right, over
 * water, so a transaction in flight reads as something happening rather than
 * as a row in a wallet.
 *
 * Everything an agent sends is drawn as plain text. Its replies aren't rendered
 * as Markdown, so it has no way to put links or images in front of the person.
 */
export function ChatView({ chat, draft, onDraft, onSubmit, onStop, onEnd }: ChatViewProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const following = useRef(true)
  const agent = agentInfo(chat.agent)
  const working = WORKING[chat.phase]
  const running = chat.phase === 'answering' || chat.phase === 'stopping'

  // Opening a chat starts at its end, ready for a reply.
  useEffect(() => {
    following.current = true
    composer.current?.focus()
  }, [chat.id])

  useEffect(() => {
    const element = scroller.current
    if (element && following.current) element.scrollTop = element.scrollHeight
  }, [chat.id, chat.items, working])

  return (
    <>
      <main className="ink-panel flex flex-col" id="main" aria-label={chat.title}>
        <div className="ink-chat-toolbar">
          <span className="ink-picker cursor-default">
            <AgentMark id={chat.agent} small />
            {agent.name}
          </span>
          <span className="flex-1" />
          <Tooltip text={SKILLS_HINT}>
            <button type="button" className="ink-picker" aria-disabled>
              Skills
              <ChevronDownIcon size={12} />
            </button>
          </Tooltip>
          <Tooltip text={TOOLS_HINT}>
            <span className="ink-connector" tabIndex={0}>
              <PlugIcon size={13} />
              ottopus-ink
            </span>
          </Tooltip>
          <button type="button" className="ink-picker" disabled={chat.phase === 'ended' || !chat.sessionId} onClick={onEnd}>
            End chat
          </button>
        </div>

        <div
          ref={scroller}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-[22px] py-[18px]"
          onScroll={(event) => {
            const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
            following.current = scrollHeight - scrollTop - clientHeight < FOLLOW_PX
          }}
        >
          {chat.trimmed ? (
            <p className="m-0 text-center text-[12px] text-[var(--ot-text-3)]">Earlier messages are no longer shown.</p>
          ) : null}
          {chat.items.map((item) => (
            <ConversationItem key={item.id} item={item} />
          ))}
          {working ? <AgentThinking className="ink-thinking" variant="infinity" label={working} showTimer={false} /> : null}
        </div>

        <ComposerLoader
          className={cn('ink-composer-light', !working && 'ink-composer-light--off')}
          active={working !== undefined}
          colors={COMPOSER_LIGHT}
          radius={18}
          surface={false}
        >
          <Composer
            compact
            textareaRef={composer}
            value={draft}
            onChange={onDraft}
            onSubmit={onSubmit}
            onStop={running ? onStop : undefined}
            stopping={chat.phase === 'stopping'}
            canSend={chat.phase === 'ready'}
            disabled={chat.phase === 'ended'}
            placeholder={chat.phase === 'ended' ? 'This chat has ended. Start a new one to keep going.' : 'Reply to your agent'}
          />
        </ComposerLoader>
      </main>

      <aside className="ink-plan-pane" aria-label="Live plan">
        <Sea creatures={PANE_LIFE} shafts={false} />
        <div className="relative flex h-full flex-col gap-3 p-[18px]">
          <span className="ink-eyebrow">Live plan</span>
          {chat.plan ? (
            <PlanCard plan={chat.plan} />
          ) : (
            <div className="flex flex-col items-start gap-2 rounded-[12px] border border-[var(--ot-border)] bg-[color-mix(in_srgb,var(--ot-card)_86%,transparent)] p-3.5">
              <span className="text-[var(--ot-plan)]">
                <ListIcon />
              </span>
              <span className="text-[14px] font-semibold">No plan yet</span>
              <span className="text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">
                When your agent proposes one, each step shows here and opens for review in its own window.
              </span>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

/** Memoised because a long chat redraws on every batch, and only its newest row has changed. */
const ConversationItem = memo(function ConversationItem({ item }: { item: ChatItem }): ReactNode {
  switch (item.kind) {
    case 'user':
      return <div className="ink-bubble">{item.text}</div>
    case 'agent':
      return <p className="selectable m-0 max-w-[94%] text-[14px] leading-[1.6] whitespace-pre-wrap">{item.text}</p>
    case 'notice':
      // Errors hold still, so Otto isn't animated in either of these.
      if (item.ends) {
        return <ErrorState title={item.title} description={item.text ?? undefined} illustration={<Otto pose="ink" size={150} />} />
      }
      return (
        <Callout
          severity={item.severity}
          title={item.title}
          icon={item.severity === 'block' ? <Otto pose="ink" size={44} /> : undefined}
          compact
        >
          {item.text}
        </Callout>
      )
    case 'tool':
      return <ToolCall {...item} />
    case 'plan':
      return <PlanCard plan={item.plan} />
  }
})
