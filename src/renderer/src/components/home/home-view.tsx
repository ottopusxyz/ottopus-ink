import type { ReactNode, Ref } from 'react'
import { Otto } from '@/components/brand/otto'
import { AgentMark } from '@/components/chat/agent-picker'
import { TOOL_GLYPHS } from '@/components/chat/tool-call'
import { Composer } from '@/components/chat/composer'
import { Sea } from '@/components/motion/sea'
import { Ring } from '@/components/motion/ring'
import { ChatIcon } from '@/components/shell/icons'
import { TokenLogo } from '@/components/ui'
import { planHeadline, type Chat } from '@/lib/chats'
import { TOOL_COPY } from '@/lib/tool-copy'
import { INK_TOOLS, type AgentId, type ChatPlan } from '../../../../shared/ipc'

/** Starting points, filled into the composer rather than sent, each with the marks of what it moves. */
const SUGGESTIONS: readonly { text: string; tokens: readonly string[] }[] = [
  { text: 'Swap 0.1 ETH to USDC on Base', tokens: ['ETH', 'USDC'] },
  { text: 'Bridge USDC from Base to NEAR', tokens: ['USDC', 'NEAR'] },
  { text: 'Stake 10 NEAR', tokens: ['NEAR'] },
  { text: 'What did I spend this week?', tokens: [] },
]

export interface HomeViewProps {
  draft: string
  onDraft: (value: string) => void
  onSubmit: () => void
  live: readonly Chat[]
  onOpenChat: (id: string) => void
  onPortfolio: () => void
  composerRef?: Ref<HTMLTextAreaElement>
  agentPicker: ReactNode
  /** Off until there's a ready agent to send to. */
  canSend: boolean
  /** What new chats get beyond Ottopus tools, by name. */
  external: readonly string[]
  /** A plan waiting on the person's review, if one is, and the chat it came from. */
  waiting: { chatId: string; plan: ChatPlan } | null
  /** The agent new chats go to, once one is ready. */
  readyAgent: { id: AgentId; name: string } | null
}

/**
 * The home screen is a composer. Balances and accounts have their own page;
 * here they are one quiet card under the starting points.
 */
export function HomeView({
  draft,
  onDraft,
  onSubmit,
  live,
  onOpenChat,
  onPortfolio,
  composerRef,
  agentPicker,
  canSend,
  external,
  waiting,
  readyAgent,
}: HomeViewProps) {
  const running = live[0]

  return (
    <main className="ink-panel" id="main">
      <Sea />
      <div className="ink-panel__scroll px-8 pt-16 pb-8">
        <div className="mx-auto flex max-w-[880px] flex-col gap-4">
          <div className="flex flex-wrap items-end gap-5">
            <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-2">
              <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-[var(--ot-text-2)]">
                {readyAgent ? (
                  <span className="ink-ready">
                    <AgentMark id={readyAgent.id} small />
                    {readyAgent.name} is ready
                  </span>
                ) : null}
                Your agent proposes. You review and sign here.
              </p>
              <h1 className="m-0 font-display text-[42px] leading-[1.05] font-bold tracking-[-0.02em]">
                Ask for it.
                <br />
                <span className="ink-highlight">Sign it yourself.</span>
              </h1>
            </div>
            <div className="relative h-[104px] w-[250px] flex-none" aria-hidden>
              <span className="ink-speech">Hi, I’m Otto. Your agent asks me before anything moves.</span>
              <Otto pose="wave" size={100} animated className="absolute right-0 -bottom-2.5" />
            </div>
          </div>

          {waiting ? (
            <button type="button" className="ink-waiting" onClick={() => onOpenChat(waiting.chatId)}>
              <Ring size={20} tone="plan" />
              <TokenLogo symbol={waiting.plan.asset} chain={waiting.plan.chain} size="md" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                <span className="text-[15px] font-bold">{planHeadline(waiting.plan)} is waiting for you</span>
                <span className="text-[13px] text-[var(--ot-text-2)]">Check it in Ink’s review window. Nothing is signed until you approve.</span>
              </span>
              <span className="ink-waiting__go">Open chat</span>
            </button>
          ) : null}

          <Composer
            value={draft}
            onChange={onDraft}
            onSubmit={onSubmit}
            textareaRef={composerRef}
            agentPicker={agentPicker}
            canSend={canSend}
            external={external}
            prominent
            placeholder="Tell your agent what to do: swap, send, bridge or stake."
          />

          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(({ text, tokens }) => (
              <button key={text} type="button" className="ink-suggestion" onClick={() => onDraft(text)}>
                {tokens.length > 0 ? (
                  <span className="ink-logo-stack">
                    {tokens.map((symbol) => (
                      <TokenLogo key={symbol} symbol={symbol} size="sm" />
                    ))}
                  </span>
                ) : (
                  <span className="text-[var(--ot-text-3)]">
                    <ChatIcon />
                  </span>
                )}
                {text}
              </button>
            ))}
          </div>

          <div className="mt-[22px] grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
            {running ? (
              <button
                type="button"
                className="ink-glance cursor-pointer text-left font-[inherit] text-[inherit]"
                onClick={() => onOpenChat(running.id)}
              >
                <span className="ink-eyebrow">In progress</span>
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  <AgentMark id={running.agent} small />
                  {running.title}
                </span>
                <span className="text-[12px] text-[var(--ot-text-2)]">{running.step ?? 'Your agent is working'}</span>
              </button>
            ) : (
              <div className="ink-glance">
                <span className="ink-eyebrow">In progress</span>
                <span className="text-[14px] font-semibold">Nothing running</span>
                <span className="text-[12px] leading-[1.45] text-[var(--ot-text-2)]">
                  Plans you approve are tracked here until every step lands.
                </span>
              </div>
            )}
            <button
              type="button"
              className="ink-glance cursor-pointer text-left font-[inherit] text-[inherit]"
              onClick={onPortfolio}
            >
              <span className="ink-eyebrow">Portfolio</span>
              <span className="text-[14px] font-semibold">Balances aren’t shown yet</span>
              <span className="text-[12px] leading-[1.45] text-[var(--ot-text-2)]">
                Ink can’t read balances yet. Your addresses are on Receive.
              </span>
            </button>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-[var(--ot-text-3)]">
              {external.length === 0 ? 'Your agent gets six Ottopus tools, nothing else:' : 'Your agent gets six Ottopus tools, and what you turned on:'}
            </span>
            {INK_TOOLS.map((tool) => {
              const Glyph = TOOL_GLYPHS[tool]
              return (
                <span key={tool} className="ink-tool-chip">
                  <span className="ink-tool__glyph" style={{ background: TOOL_COPY[tool].tint }} aria-hidden>
                    <Glyph size={11} />
                  </span>
                  <span className="font-mono">{tool}</span>
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </main>
  )
}
