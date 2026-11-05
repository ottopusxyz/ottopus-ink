import type { ReactNode, Ref } from 'react'
import { Otto } from '@/components/brand/otto'
import { AgentMark } from '@/components/chat/agent-picker'
import { Composer } from '@/components/chat/composer'
import { Sea } from '@/components/motion/sea'
import { ArrowRightIcon, ChatIcon, StakeIcon, SwapIcon } from '@/components/shell/icons'
import type { Chat } from '@/lib/chats'

/** Starting points, filled into the composer rather than sent. */
const SUGGESTIONS = [
  { text: 'Swap 0.1 ETH to USDC on Base', Icon: SwapIcon },
  { text: 'Bridge USDC from Base to NEAR', Icon: ArrowRightIcon },
  { text: 'Stake 10 NEAR', Icon: StakeIcon },
  { text: 'What did I spend this week?', Icon: ChatIcon },
] as const

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
}: HomeViewProps) {
  const running = live[0]

  return (
    <main className="ink-panel" id="main">
      <Sea />
      <div className="ink-panel__scroll px-8 pt-16 pb-8">
        <div className="mx-auto flex max-w-[780px] flex-col gap-[18px]">
          <p className="m-0 text-[13px] text-[var(--ot-text-2)]">Your agent proposes. You review and sign here.</p>
          <h1 className="m-0 font-display text-[52px] leading-[1.02] font-bold tracking-[-0.02em]">
            Ask for it.
            <br />
            Sign it yourself.
          </h1>

          <Composer
            value={draft}
            onChange={onDraft}
            onSubmit={onSubmit}
            textareaRef={composerRef}
            agentPicker={agentPicker}
            canSend={canSend}
            placeholder="Tell your agent what to do: swap, send, bridge or stake."
          />

          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(({ text, Icon }) => (
              <button key={text} type="button" className="ink-suggestion" onClick={() => onDraft(text)}>
                <span className="text-[var(--ot-text-3)]">
                  <Icon />
                </span>
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
              <span className="text-[14px] font-semibold">No wallet yet</span>
              <span className="text-[12px] leading-[1.45] text-[var(--ot-text-2)]">
                Balances on every chain show here once your wallet is set up.
              </span>
            </button>
          </div>
        </div>
      </div>
      <Otto pose="base" size={84} animated label="Otto" className="pointer-events-none absolute right-5 bottom-3" />
    </main>
  )
}
