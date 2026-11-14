import { useEffect, useState } from 'react'
import type { Activity, ActivityPlan, AgentId, ChatPlan } from '../../../shared/ipc'
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

/** One plan as an Activity row draws it. */
export interface ActivityRow {
  id: string
  /** The plan id's first characters, for telling plans apart at a glance. */
  shortId: string
  plan: ChatPlan
  /** The chat that made it, when the page still has it, and its agent. */
  chatId: string | null
  agent: AgentId | null
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
function track(reached: number, next: 'active' | 'failed' | 'pending'): TrackDot[] {
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

/**
 * Activity's rows, newest first, grouped by day and filtered by tab: each plan's track,
 * status and note, and the chat and agent that made it when the page still has them.
 */
export function activityGroups(activity: Activity, chats: readonly Chat[], tab: ActivityTab, now = new Date()): { day: string; rows: ActivityRow[] }[] {
  const groups: { day: string; rows: ActivityRow[] }[] = []
  for (const entry of activity.plans) {
    const { plan } = entry
    const needsYou = plan.status === 'awaiting_review'
    const rowTab: ActivityRow['tab'] = needsYou ? 'needs' : plan.status === 'draft' ? 'drafts' : SENT.has(plan.status) ? 'sent' : null
    if (tab !== 'all' && rowTab !== tab) continue
    const chat = chatOf(chats, plan.id)
    const link = [...(plan.journey?.steps ?? [])].reverse().find((step) => step.link)?.link ?? null
    const row: ActivityRow = {
      id: plan.id,
      shortId: plan.id.slice(0, 8),
      plan,
      chatId: chat?.id ?? null,
      agent: chat?.agent ?? null,
      time: new Date(entry.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      track: trackOf(entry),
      note: noteOf(entry, now),
      link,
      needsYou,
      tab: rowTab,
    }
    const day = dayOf(entry.createdAt, now)
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
