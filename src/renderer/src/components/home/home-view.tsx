import type { ReactNode, Ref } from 'react'
import { Otto } from '@/components/brand/otto'
import { AgentMark } from '@/components/chat/agent-picker'
import { TOOL_GLYPHS } from '@/components/chat/tool-call'
import { Composer } from '@/components/chat/composer'
import { Sea } from '@/components/motion/sea'
import { Ring } from '@/components/motion/ring'
import { Badge, ChainLogo, TokenLogo } from '@/components/ui'
import { planHeadline, type Chat } from '@/lib/chats'
import { Bone } from '@/components/portfolio/portfolio-skeleton'
import { formatMoney } from '@/lib/format'
import { isTokenSymbol } from '@/lib/logos'
import { portfolioView, spread } from '@/lib/portfolio'
import { usePortfolio } from '@/lib/use-portfolio'
import type { ChainId } from '@/lib/logos'
import { TOOL_COPY } from '@/lib/tool-copy'
import { INK_TOOLS, type AgentId, type ChatPlan } from '../../../../shared/ipc'

/** Starting points, filled into the composer rather than sent, each with the marks of what it moves. */
const SUGGESTIONS: readonly { text: string; tokens?: readonly string[]; chains?: readonly ChainId[] }[] = [
  { text: 'Send 2 NEAR to alice.near', tokens: ['NEAR'] },
  { text: 'Swap 25 USDC to NEAR', tokens: ['USDC', 'NEAR'] },
  { text: 'Stake 10 NEAR', tokens: ['NEAR'] },
  { text: 'What’s my wallet worth?', chains: ['ethereum', 'solana', 'bitcoin'] },
]

/** Home's Portfolio card: the total and the biggest few holdings, or why there's no total. */
function PortfolioGlance({ onOpen }: { onOpen: () => void }) {
  const { result } = usePortfolio()
  const view = result?.ok ? portfolioView(result) : null
  const money = view?.total != null ? formatMoney(view.total) : null
  // Plain marks of the biggest holdings Ink has a mark for: a stack of badges and letters at this size is noise.
  const marks = [...new Set((view?.rows ?? []).map((row) => row.symbol.toUpperCase()).filter(isTokenSymbol))].slice(0, 3)
  return (
    <button type="button" className="ink-glance cursor-pointer text-left font-[inherit] text-[inherit]" onClick={onOpen}>
      <span className="flex items-center gap-2">
        <span className="ink-eyebrow flex-1">Portfolio</span>
        {marks.length > 0 ? (
          <span className="ink-logo-stack" aria-hidden>
            {marks.map((symbol) => (
              <TokenLogo key={symbol} symbol={symbol} size="sm" />
            ))}
          </span>
        ) : null}
      </span>
      {result === null ? (
        <span className="flex flex-col gap-2" role="status" aria-busy>
          <span className="sr-only">Reading your balances</span>
          <Bone className="h-[26px] w-[150px]" />
          <Bone className="h-3 w-[190px]" />
        </span>
      ) : !view ? (
        <>
          <span className="text-[14px] font-semibold">Balances couldn’t be read</span>
          <span className="text-[12px] leading-[1.45] text-[var(--ot-text-2)]">Open Portfolio to try again.</span>
        </>
      ) : (
        <>
          <span className="font-mono text-[22px] font-bold tracking-[-0.02em]">
            {money ? (
              <>
                {money.whole}
                <span className="text-[var(--ot-text-3)]">.{money.fraction}</span>
              </>
            ) : (
              '$—'
            )}
          </span>
          <span className="text-[12px] leading-[1.45] text-[var(--ot-text-2)]">
            {money
              ? `${view.rows.length === 1 ? '1 asset' : `${view.rows.length} assets`}, ${spread(view.rows).toLowerCase()}.${result?.ok && result.zerion === 'off' ? ' Add a Zerion key in Settings for other chains.' : ''}`
              : 'Prices couldn’t be read, so there’s no total.'}
          </span>
        </>
      )}
    </button>
  )
}

export interface HomeViewProps {
  draft: string
  onDraft: (value: string) => void
  onSubmit: () => void
  live: readonly Chat[]
  onOpenChat: (id: string) => void
  onPortfolio: () => void
  /** Opens Settings on the wallet and backup section. */
  onBackup: () => void
  /** Opens Settings on tools and skills. */
  onToolsSettings: () => void
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
  onBackup,
  onToolsSettings,
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
                ) : (
                  'Your agent proposes. You review and sign here.'
                )}
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
                <span className="text-[13px] text-[var(--ot-text-2)]">Open in the review window · nothing is signed until you approve</span>
              </span>
              <span className="ink-waiting__go">See the plan</span>
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
            tools={{ scope: 'new', onSettings: onToolsSettings }}
            prominent
            placeholder="Tell your agent what to do: swap, send, bridge or stake."
          />

          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(({ text, tokens = [], chains = [] }) => (
              <button key={text} type="button" className="ink-suggestion" onClick={() => onDraft(text)}>
                <span className="ink-logo-stack">
                  {tokens.map((symbol) => (
                    <TokenLogo key={symbol} symbol={symbol} size="md" />
                  ))}
                  {chains.map((chain) => (
                    <ChainLogo key={chain} chain={chain} size="md" />
                  ))}
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
            ) : null}
            <PortfolioGlance onOpen={onPortfolio} />
            <button
              type="button"
              className="ink-glance ink-glance--warn cursor-pointer text-left font-[inherit] text-[inherit]"
              onClick={onBackup}
            >
              <span className="flex items-center gap-2">
                <span className="ink-eyebrow flex-1 text-[var(--ot-warn-text)]">Before you hold more</span>
                <Badge tone="warn">Paper only</Badge>
              </span>
              <span className="text-[15px] font-extrabold">Keep your recovery phrase safe</span>
              <span className="text-[12px] leading-[1.45] text-[var(--ot-text)]">
                The words you wrote down are the only way back if this computer is lost. Keep them on paper, somewhere safe.
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
