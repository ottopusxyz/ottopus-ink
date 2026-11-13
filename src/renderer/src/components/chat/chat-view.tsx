import { memo, useEffect, useId, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { Otto } from '@/components/brand/otto'
import { Callout, ErrorState, TokenLogo, Tooltip } from '@/components/ui'
import { Sea } from '@/components/motion/sea'
import { SignInIcon } from '@/components/settings/sign-in-icon'
import { MoreIcon, PlugIcon } from '@/components/shell/icons'
import { agentInfo } from '@/lib/agents'
import { chatTurns, lockStatus, trimmedPlan, type Chat, type ChatItem } from '@/lib/chats'
import { cn } from '@/lib/cn'
import { AgentThinking } from '@/vendor/boardui/agent-thinking'
import { AgentMark } from './agent-picker'
import { Composer, toolsChip } from './composer'
import { InkNoteCard } from './ink-note'
import { Markdown } from './markdown'
import { PlanCard } from './plan-card'
import { ToolCall } from './tool-call'

export interface ChatViewProps {
  chat: Chat
  draft: string
  onDraft: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  onEnd: () => void
  /** Opens Settings on tools and skills. */
  onToolsSettings: () => void
}

/** How near the bottom counts as following along. Further up, someone is reading. */
const FOLLOW_PX = 80

const WORKING: Partial<Record<Chat['phase'], string>> = {
  starting: 'Starting your agent…',
  answering: 'Working…',
  stopping: 'Stopping…',
}

/**
 * One chat, over water: your messages on the right, and each answer of the
 * agent's under its avatar on the left, with its tool calls on the tentacle rail
 * and its plan as a ticket. While the agent works, a coral and blue band runs
 * round the composer's edge.
 *
 * An agent's replies get the formatting `Markdown` allows, and the rest of what
 * it sends is drawn as plain text, so it has no way to load an image or disguise
 * where a link goes.
 */
export function ChatView({ chat, draft, onDraft, onSubmit, onStop, onEnd, onToolsSettings }: ChatViewProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const following = useRef(true)
  const agent = agentInfo(chat.agent)
  const chip = toolsChip(chat.external)
  const working = WORKING[chat.phase]
  const running = chat.phase === 'answering' || chat.phase === 'stopping'
  const toolCount = chat.items.filter((item) => item.kind === 'tool').length
  const turns = useMemo(() => chatTurns(chat.items), [chat.items])
  const lastTurn = turns.at(-1)
  const kept = trimmedPlan(chat)
  const thinking = working ? <AgentThinking className="ink-thinking" variant="infinity" label={working} shimmer={false} /> : null

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
    <main className="ink-panel flex flex-col" id="main" aria-label={chat.title}>
      <Sea shafts={false} className="opacity-75" />
      <div className="ink-chat-toolbar relative">
        {chat.plan ? <TokenLogo symbol={chat.plan.asset} chain={chat.plan.chain} size="md" /> : <AgentMark id={chat.agent} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-[14.5px] font-extrabold">{chat.title}</h1>
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--ot-text-3)]">
            <AgentMark id={chat.agent} small />
            {agent.name} · {toolCount === 1 ? '1 tool call' : `${toolCount} tool calls`}
          </span>
        </div>
        <Tooltip text={chip.hint}>
          <span className={cn('ink-connector', chip.open && 'ink-connector--open')} tabIndex={0}>
            <PlugIcon size={13} />
            {chip.text}
          </span>
        </Tooltip>
        <ChatMenu canEnd={chat.phase !== 'ended' && Boolean(chat.sessionId)} onEnd={onEnd} />
      </div>

      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto px-6 py-5"
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
          following.current = scrollHeight - scrollTop - clientHeight < FOLLOW_PX
        }}
      >
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
          {chat.trimmed ? (
            <p className="m-0 text-center text-[12px] text-[var(--ot-text-3)]">Earlier messages are no longer shown.</p>
          ) : null}
          {/* The plan's own message was trimmed, but where it stands still matters. */}
          {kept ? <PlanCard plan={kept} /> : null}
          {turns.map((turn) =>
            turn.kind === 'you' ? (
              <ConversationItem key={turn.item.id} item={turn.item} />
            ) : (
              <div key={turn.id} className="ink-turn">
                <AgentMark id={chat.agent} />
                <div className="ink-turn__body">
                  {turn.items.map((item) => (
                    <ConversationItem key={item.id} item={item} />
                  ))}
                  {turn === lastTurn ? thinking : null}
                </div>
              </div>
            ),
          )}
          {thinking && lastTurn?.kind !== 'agent' ? (
            <div className="ink-turn">
              <AgentMark id={chat.agent} />
              <div className="ink-turn__body">{thinking}</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative px-6 pt-2 pb-4">
        <div className={cn('ink-rim mx-auto max-w-[760px]', working && 'ink-rim--on')}>
          <Composer
            compact
            textareaRef={composer}
            agentPicker={
              <span className="ink-picker cursor-default">
                <AgentMark id={chat.agent} small />
                {agent.name}
              </span>
            }
            external={chat.external}
            tools={{
              scope: 'chat',
              status: lockStatus(chat),
              extra: chat.phase !== 'ended' && chat.lock === 'locked' ? <SignInIcon names={chat.needsSignIn} /> : null,
              onSettings: onToolsSettings,
            }}
            value={draft}
            onChange={onDraft}
            onSubmit={onSubmit}
            onStop={running ? onStop : undefined}
            stopping={chat.phase === 'stopping'}
            canSend={chat.phase === 'ready'}
            disabled={chat.phase === 'ended'}
            placeholder={chat.phase === 'ended' ? 'This chat has ended. Start a new one to keep going.' : 'Reply to your agent'}
          />
        </div>
      </div>
    </main>
  )
}

/** The chat's options behind "…". Ending it is the one there is. */
function ChatMenu({ canEnd, onEnd }: { canEnd: boolean; onEnd: () => void }) {
  const id = useId()
  const popoverId = `ink-chat-menu-${id}`
  const anchor = `--ink-chat-menu-${id.replace(/[^\w-]/g, '')}`
  const menu = useRef<HTMLDivElement>(null)
  return (
    <>
      <button type="button" className="ink-round" aria-label="Chat options" popoverTarget={popoverId} style={{ anchorName: anchor } as CSSProperties}>
        <MoreIcon />
      </button>
      <div ref={menu} id={popoverId} popover="auto" role="menu" className="ink-popover ink-chat-menu" style={{ positionAnchor: anchor } as CSSProperties}>
        <button
          type="button"
          role="menuitem"
          className="ink-agent-option"
          disabled={!canEnd}
          onClick={() => {
            menu.current?.hidePopover()
            onEnd()
          }}
        >
          <span className="min-w-0 flex-1">
            <b className="text-[13.5px] font-semibold">End chat</b>
            <span className="block text-[12px] text-[var(--ot-text-3)]">Stops its agent. Nothing more can be written here after.</span>
          </span>
        </button>
      </div>
    </>
  )
}

/** Memoised because a long chat redraws on every batch, and only its newest row has changed. */
const ConversationItem = memo(function ConversationItem({ item }: { item: ChatItem }): ReactNode {
  switch (item.kind) {
    case 'user':
      return <div className="ink-bubble">{item.text}</div>
    case 'agent':
      return <Markdown text={item.text} />
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
    case 'ink-note':
      return <InkNoteCard note={item.note} />
  }
})
