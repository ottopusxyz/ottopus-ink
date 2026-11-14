import { useState } from 'react'
import { Otto } from '@/components/brand/otto'
import { Sea } from '@/components/motion/sea'
import { AgentMark } from '@/components/chat/agent-picker'
import { ExternalIcon } from '@/components/shell/icons'
import { Card, TokenLogo } from '@/components/ui'
import { Segmented } from '@/components/ui/segmented'
import { StatusChip } from '@/components/ui/status-chip'
import { ACTIVITY_TABS, activityGroups, useActivity, type ActivityRow, type ActivityTab, type TrackDot } from '@/lib/activity'
import { agentInfo } from '@/lib/agents'
import type { Chat } from '@/lib/chats'
import { cn } from '@/lib/cn'

const DOT: Record<TrackDot['state'], string> = {
  done: 'bg-[var(--ot-ok)]',
  failed: 'bg-[var(--ot-block)]',
  active: 'bg-[var(--ot-plan)]',
  pending: 'bg-[var(--ot-card)]',
}

/** Drafted, reviewed, signed, on chain: four dots, joined where the plan got that far. */
function Track({ dots }: { dots: readonly TrackDot[] }) {
  const reached = dots.filter((dot) => dot.state !== 'pending').length
  return (
    <ol aria-label="Progress" className="m-0 flex flex-none list-none items-start p-0">
      {dots.map((dot, i) => (
        <li key={dot.label} className="relative flex w-[62px] flex-col items-center gap-1" aria-label={`${dot.label}: ${dot.state}`}>
          {i < dots.length - 1 ? <span className={cn('absolute top-[6px] left-1/2 h-[2px] w-[62px]', i < reached - 1 ? 'bg-[var(--ot-ok)]' : 'bg-[var(--ot-border-strong)] opacity-40')} aria-hidden /> : null}
          <span className={cn('relative size-[14px] rounded-full border-2 border-[var(--ot-text-2)]', DOT[dot.state])} aria-hidden />
          <span className="text-[10.5px] font-semibold text-[var(--ot-text-3)]">{dot.label}</span>
        </li>
      ))}
    </ol>
  )
}

/** One plan: what it does, who asked and when, how far it got, and where it stands. Opens its chat when the page still has it. */
function Row({ row, onOpenChat }: { row: ActivityRow; onOpenChat: (chatId: string) => void }) {
  const open = row.chatId ? () => onOpenChat(row.chatId as string) : undefined
  return (
    <Card
      raised
      className={cn('flex flex-wrap items-center gap-x-[14px] gap-y-3 px-[14px] py-3', row.needsYou && 'border-2 border-[var(--ot-text)]', open && 'cursor-pointer hover:border-[var(--ot-border-strong)]')}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      aria-label={open ? `${row.title}: open its chat` : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (open && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          open()
        }
      }}
    >
      <span className="flex-none">
        <TokenLogo symbol={row.token.symbol} chain={row.token.chain} size="lg" />
      </span>
      <span className="min-w-0 flex-[1_1_220px]">
        <b className="block text-[14.5px] [overflow-wrap:anywhere]">{row.title}</b>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--ot-text-3)]">
          {row.agent ? (
            <>
              <AgentMark id={row.agent} small />
              {agentInfo(row.agent).name} ·
            </>
          ) : row.earlier ? (
            'Before Ink last started ·'
          ) : null}{' '}
          {row.time} · <span className="font-mono">{row.shortId}</span>
        </span>
      </span>
      <Track dots={row.track} />
      <StatusChip status={row.status} className="min-w-[100px] flex-none justify-center" />
      <span className="-mt-1 flex-[1_1_100%] pl-[54px] text-[12.5px] text-[var(--ot-text-2)] [overflow-wrap:anywhere]" role="status">
        {row.note}
        {row.link ? (
          <>
            {' · '}
            <a className="inline-flex items-center gap-1 underline" href={row.link.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
              view on {new URL(row.link.url).hostname.replace(/^www\./, '')}
              <ExternalIcon size={10} />
            </a>
          </>
        ) : null}
      </span>
    </Card>
  )
}

/**
 * Every plan your agent drafted this run, newest first and grouped by day, with how far
 * each got and where it stands, filtered by what needs you, what was sent and what stayed
 * a draft, among them the swaps Ink still follows from before it last started. Every
 * value comes from main.
 */
export function ActivityView({ chats, onOpenChat }: { chats: readonly Chat[]; onOpenChat: (chatId: string) => void }) {
  const { activity, loaded } = useActivity()
  const [tab, setTab] = useState<ActivityTab>('all')
  const groups = activityGroups(activity, chats, tab)
  const empty = groups.length === 0
  return (
    <main className="ink-panel" id="main">
      <Sea shafts={false} />
      <div className="ink-panel__scroll px-7 pt-[26px] pb-7">
        <div className="mx-auto flex max-w-[880px] flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[260px] flex-1">
              <h1 className="m-0 font-display text-[30px] font-bold tracking-[-0.02em]">Activity</h1>
              <p className="m-0 mt-1 text-[14px] text-[var(--ot-text-2)]">Every plan your agent drafted, and what became of it, step by step until it lands.</p>
            </div>
            <Segmented compact label="Show" value={tab} onChange={(next) => setTab(next as ActivityTab)} options={ACTIVITY_TABS} />
          </div>

          {groups.map((group) => (
            <section key={group.day} className="flex flex-col gap-2" aria-label={group.day}>
              <h2 className="ink-eyebrow m-0 mt-1.5">{group.day}</h2>
              {group.rows.map((row) => (
                <Row key={row.id} row={row} onOpenChat={onOpenChat} />
              ))}
            </section>
          ))}

          {loaded && empty ? (
            <Card raised className="flex flex-col items-center gap-2.5 p-[30px] text-center">
              <Otto pose="base" size={90} animated label="Otto" />
              <b>Nothing here</b>
              <span className="text-[13px] text-[var(--ot-text-3)]">{tab === 'all' ? 'Ask your agent for something and its plan shows up here.' : 'Nothing under this tab yet.'}</span>
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  )
}
