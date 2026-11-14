import { useEffect, useState } from 'react'
import type { Activity, ActivityPlan, AgentId, ChatPlan, ChatSwap, RecentSwap } from '../../../shared/ipc'
import type { Chat } from './chats'

const NONE: Activity = { plans: [], earlier: [] }

/**
 * What Ink has done lately, read again whenever a plan or a swap moves on, or Ink locks or
 * unlocks. Main gives nothing while Ink is locked. `loaded` is false until the first read.
 */
export function useActivity(): { activity: Activity; loaded: boolean } {
  const [state, setState] = useState<{ activity: Activity; loaded: boolean }>({ activity: NONE, loaded: false })
  useEffect(() => {
    let live = true
    const read = () =>
      void window.ink.activity().then(
        (activity) => {
          if (live) setState({ activity, loaded: true })
        },
        () => {
          if (live) setState((before) => ({ ...before, loaded: true }))
        },
      )
    read()
    const offActivity = window.ink.onActivityChanged(read)
    const offSwaps = window.ink.onSwapsChanged(read)
    const offVault = window.ink.onVaultStatus(read)
    return () => {
      live = false
      offActivity()
      offSwaps()
      offVault()
    }
  }, [])
  return state
}

/** When a plan was made, as Activity shows it: the time today, else the day and time. */
export function whenMade(iso: string, now = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`
}

/** The tabs Activity filters by. */
export type ActivityTab = 'all' | 'needs' | 'sent' | 'drafts'
export const ACTIVITY_TABS: readonly (readonly [ActivityTab, string])[] = [
  ['all', 'All'],
  ['needs', 'Needs you'],
  ['sent', 'Sent'],
  ['drafts', 'Drafts'],
]

/** One dot of a row's track: drafted, reviewed, signed, on chain. */
export interface TrackDot {
  label: 'Drafted' | 'Reviewed' | 'Signed' | 'On chain'
  state: 'done' | 'active' | 'pending' | 'failed'
}

/** One row of Activity: a plan of this run, or a swap Ink still follows from an earlier run. */
export interface ActivityRow {
  id: string
  /** The plan id's first characters, for telling plans apart at a glance. */
  shortId: string
  /** "Send 2 NEAR to alice.near", "Swap 6 USDC → 5.99 USDC on Base". */
  title: string
  /** The token it moves, and the chain it moves on when known, for its logo. */
  token: { symbol: string; chain: string | null }
  status: ChatPlan['status']
  /** The chat that made it, when the page still has it, and its agent. */
  chatId: string | null
  agent: AgentId | null
  /** From an earlier run of Ink, whose plan and chat are gone. */
  earlier: boolean
  /** When it was made, or for an earlier swap when NEAR ran its deposit: for ordering and grouping. */
  at: number
  time: string
  track: TrackDot[]
  /** Where it stands or how it ended, in a line. */
  note: string
  /** Its latest transaction or payout on an explorer. */
  link: { label: string; url: string } | null
  /** Waiting on the person, so the row stands out. */
  needsYou: boolean
  tab: Exclude<ActivityTab, 'all'> | null
}

const LABELS: TrackDot['label'][] = ['Drafted', 'Reviewed', 'Signed', 'On chain']
const SENT: ReadonlySet<ChatPlan['status']> = new Set(['approved', 'signing', 'submitted', 'confirmed', 'failed'])

/** The four dots, `reached` of them done, the next one live or failed. */
function track(reached: number, next: TrackDot['state']): TrackDot[] {
  return LABELS.map((label, i) => ({ label, state: i < reached ? 'done' : i === reached ? next : 'pending' }))
}

/** How far a plan got, as the four dots read it. */
function trackOf({ plan }: ActivityPlan): TrackDot[] {
  const journey = plan.journey
  const sent = Boolean(plan.transactionId) || (journey?.steps.some((step) => step.id.startsWith('tx:') && step.state !== 'pending') ?? false)
  switch (plan.status) {
    case 'draft':
      return track(1, 'pending')
    case 'awaiting_review':
      return track(1, 'active')
    case 'approved':
    case 'signing':
      return track(2, 'active')
    case 'submitted':
      return track(3, journey?.failed ? 'failed' : 'active')
    case 'confirmed':
      return journey?.failed ? track(3, 'failed') : journey && !journey.done ? track(3, 'active') : track(4, 'pending')
    case 'failed':
      return sent ? track(3, 'failed') : track(2, 'failed')
    default:
      // Cancelled, expired or blocked: never signed.
      return track(1, 'failed')
  }
}

const NEVER_SIGNED: Partial<Record<ChatPlan['status'], string>> = {
  cancelled: 'Cancelled. Nothing was signed.',
  expired: 'Nobody approved it in time. Nothing was signed.',
  blocked: 'A safety rule refused it. Nothing was signed.',
}

/** A journey step in a line: "In your Intents balance · 1 of 2 parts landed". */
const stepLine = (step: { label: string; detail: string | null }) => (step.detail ? `${step.label} · ${step.detail}` : step.label)

/** Where a plan stands or how it ended, from main's own words: its journey, Ink's ending note, its expiry. */
function noteOf({ plan, ending, expiresAt }: ActivityPlan, now: Date): string {
  const steps = plan.journey?.steps ?? []
  const failed = steps.find((step) => step.state === 'failed')
  const active = steps.find((step) => step.state === 'active')
  switch (plan.status) {
    case 'draft':
      return 'Ink can’t send this yet, so it stays a draft. Nothing was signed.'
    case 'awaiting_review': {
      const minutes = Math.ceil((Date.parse(expiresAt) - now.getTime()) / 60_000)
      return minutes > 1 ? `Waiting in the review window · ${minutes} minutes left` : 'Waiting in the review window · about to expire'
    }
    case 'approved':
    case 'signing':
      return 'Signing now.'
    case 'cancelled':
    case 'expired':
    case 'blocked':
      return ending ?? NEVER_SIGNED[plan.status] ?? ''
    default:
      if (failed) return ending ?? stepLine(failed)
      if (active) return stepLine(active)
      return ending ?? (steps.at(-1) ? stepLine(steps.at(-1) as (typeof steps)[number]) : '')
  }
}

/** A day heading: "Today", "Yesterday", or the date. */
function dayOf(iso: string, now: Date): string {
  const at = new Date(iso)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (at.toDateString() === now.toDateString()) return 'Today'
  if (at.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return at.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

/** The chat a plan came from: the one whose items hold it. */
function chatOf(chats: readonly Chat[], planId: string): Chat | null {
  return chats.find((chat) => chat.plan?.id === planId || chat.items.some((item) => item.kind === 'plan' && item.id === planId)) ?? null
}

const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** A plan of this run as a row. */
function planRow(entry: ActivityPlan, chats: readonly Chat[], now: Date): ActivityRow {
  const { plan } = entry
  const needsYou = plan.status === 'awaiting_review'
  const chat = chatOf(chats, plan.id)
  const at = Date.parse(entry.createdAt)
  return {
    id: plan.id,
    shortId: plan.id.slice(0, 8),
    title: activityTitle(plan),
    token: { symbol: plan.asset, chain: plan.chain },
    status: plan.status,
    chatId: chat?.id ?? null,
    agent: chat?.agent ?? null,
    earlier: false,
    at,
    time: clock(at),
    track: trackOf(entry),
    note: noteOf(entry, now),
    link: [...(plan.journey?.steps ?? [])].reverse().find((step) => step.link)?.link ?? null,
    needsYou,
    tab: needsYou ? 'needs' : plan.status === 'draft' ? 'drafts' : SENT.has(plan.status) ? 'sent' : null,
  }
}

/** The chain a swap pays out on, from its phrase ("on Base", "on BNB Chain"), as the logos name it; null for the Intents balance. */
function chainOfWhere(where: string): string | null {
  if (!where.startsWith('on ')) return null
  const name = where.slice(3).toLowerCase()
  return name === 'bnb chain' ? 'bsc' : name
}

/** Where a swap NEAR Intents is handling stands, in a line, from its report. */
function swapNote(progress: ChatSwap | null): string {
  switch (progress?.stage) {
    case undefined:
    case 'deposited':
      return 'The deposit landed. NEAR Intents is picking it up.'
    case 'swapping':
      return 'NEAR Intents is swapping it now.'
    case 'done':
      return progress.got ? `Done: ${progress.got} paid out.` : 'Done: paid out.'
    case 'refunded':
      return progress.refunded ? `Refunded: ${progress.refunded} went back where it came from.` : 'Refunded: it went back where it came from.'
    case 'failed':
      return 'NEAR Intents couldn’t finish it. Any refund goes back where it came from.'
    case 'unknown':
      return 'Ink stopped checking. NEAR Intents still finishes or refunds it on its own.'
  }
}

/**
 * The swaps Ink follows from an earlier run as rows: one for each swap, and one for each
 * payment, whose parts (`<plan>#<n>`) are folded together and headed by its payout to a
 * chain. Each was sent already, since Ink follows only deposits a chain ran. Its chat and
 * agent come from the kept chat that holds its plan, when Ink kept one.
 */
function earlierRows(earlier: readonly RecentSwap[], chats: readonly Chat[]): ActivityRow[] {
  const byPlan = new Map<string, RecentSwap[]>()
  for (const swap of earlier) {
    const base = swap.planId.split('#')[0] as string
    byPlan.set(base, [...(byPlan.get(base) ?? []), swap])
  }
  return [...byPlan].map(([base, parts]) => {
    const payment = parts.length > 1 || parts[0]?.planId.includes('#')
    // A payment's payout is the part paid out on a chain; its other parts land in the Intents balance.
    const head = (payment ? parts.find((part) => part.where.startsWith('on ')) : undefined) ?? (parts[0] as RecentSwap)
    const stages = parts.map((part) => part.progress?.stage ?? 'deposited')
    const failed = stages.some((stage) => stage === 'failed' || stage === 'refunded')
    const done = !failed && stages.every((stage) => stage === 'done')
    const sent = head.send.split(' ').at(-1) ?? head.get
    const got = head.progress?.stage === 'done' ? (head.progress.got ?? head.get) : head.get
    const others = parts.length - 1
    const chat = chatOf(chats, base)
    return {
      id: base,
      shortId: base.slice(0, 8),
      title: payment ? `Pay ${got} ${head.where}` : `Swap ${head.send} → ${got} ${head.where}`,
      // A payment pays the token on its chain; a swap's own chain isn't kept, so its token shows alone.
      token: { symbol: payment ? head.get : sent, chain: payment ? chainOfWhere(head.where) : null },
      status: failed ? 'failed' : done ? 'confirmed' : 'submitted',
      chatId: chat?.id ?? null,
      agent: chat?.agent ?? null,
      earlier: true,
      at: Math.min(...parts.map((part) => part.startedAt)),
      time: clock(Math.min(...parts.map((part) => part.startedAt))),
      track: track(3, failed ? 'failed' : done ? 'done' : 'active'),
      note: `${payment && others > 0 ? `${others === 1 ? '1 part' : `${others} parts`} brought in, then the payout · ` : ''}${swapNote(head.progress)}`,
      link: head.progress?.link ? { label: 'payout', url: head.progress.link } : null,
      needsYou: false,
      tab: 'sent',
    }
  })
}

/**
 * Activity's rows, newest first, grouped by day and filtered by tab: each plan of this run
 * with its track, status and note, and the chat and agent that made it when the page still
 * has them; and the swaps Ink follows from an earlier run, among them by when they started.
 */
export function activityGroups(activity: Activity, chats: readonly Chat[], tab: ActivityTab, now = new Date()): { day: string; rows: ActivityRow[] }[] {
  const rows = [...activity.plans.map((entry) => planRow(entry, chats, now)), ...earlierRows(activity.earlier, chats)]
    .filter((row) => tab === 'all' || row.tab === tab)
    .sort((a, b) => b.at - a.at)
  const groups: { day: string; rows: ActivityRow[] }[] = []
  for (const row of rows) {
    const day = dayOf(new Date(row.at).toISOString(), now)
    const group = groups.find((each) => each.day === day)
    if (group) group.rows.push(row)
    else groups.push({ day, rows: [row] })
  }
  return groups
}

/** A long address cut to its ends: "9WzDXw…AWWM". Named accounts stay whole. */
const shortAddress = (address: string) => (address.length > 20 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address)

/** A row's title: "Send 2 NEAR to alice.near", "Swap 25 USDC to NEAR", "Pay 15 USDC on Solana". */
export function activityTitle(plan: ChatPlan): string {
  const lead = `${plan.amount} ${plan.asset}`
  switch (plan.outcome) {
    case 'send':
      return plan.to ? `Send ${lead} to ${shortAddress(plan.to)}` : `Send ${lead}`
    case 'swap':
      return `Swap ${lead} to ${plan.toAsset ?? '?'}${plan.toChain ? ` on ${plan.toChain}` : ''}`
    case 'pay':
      return `Pay ${lead}${plan.to ? ` to ${shortAddress(plan.to)}` : ''}${plan.toChain ? ` on ${plan.toChain}` : ''}`
    case 'stake':
      return `Stake ${lead}`
  }
}
