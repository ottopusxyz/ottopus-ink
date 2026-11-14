import { describe, expect, it } from 'vitest'
import type { Activity, ActivityPlan, ChatPlan, PlanJourney } from '../../../shared/ipc'
import { activityGroups, activityTitle, whenMade } from './activity'
import type { Chat } from './chats'

const NOW = new Date(2026, 10, 14, 15, 0)
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString()
const SEND: ChatPlan = { id: 'aaaaaaaa-1111', status: 'awaiting_review', outcome: 'send', asset: 'NEAR', amount: '2', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }
const entry = (plan: Partial<ChatPlan>, extra: Partial<ActivityPlan> = {}): ActivityPlan => ({ plan: { ...SEND, ...plan }, createdAt: at(14, 10), expiresAt: new Date(NOW.getTime() + 28 * 60_000).toISOString(), ending: null, ...extra })
const activity = (...plans: ActivityPlan[]): Activity => ({ plans, earlier: [] })
const row = (plan: ActivityPlan, chats: Chat[] = []) => activityGroups(activity(plan), chats, 'all', NOW)[0]?.rows[0]
const states = (plan: ActivityPlan) => row(plan)?.track.map((dot) => dot.state)

const journey = (steps: [string, PlanJourney['steps'][number]['state'], string | null, string | null][], done = false, failed = false): PlanJourney => ({
  steps: steps.map(([id, state, detail, url]) => ({ id, label: id === 'payout' ? 'Paid on Solana' : id === 'tx:0' ? 'On NEAR' : id, icon: { kind: 'review' }, state, detail, link: url ? { label: 'explorer', url } : null })),
  done,
  failed,
})

describe('Activity’s rows', () => {
  it('groups by day, newest first, and filters by tab', () => {
    const plans = activity(entry({ id: 'p1' }), entry({ id: 'p2', status: 'confirmed' }, { createdAt: at(13, 9) }), entry({ id: 'p3', status: 'draft' }, { createdAt: at(10, 9) }), entry({ id: 'p4', status: 'cancelled' }))
    expect(activityGroups(plans, [], 'all', NOW).map((group) => [group.day, group.rows.map((each) => each.id)])).toEqual([
      ['Today', ['p1', 'p4']],
      ['Yesterday', ['p2']],
      [expect.stringMatching(/10/), ['p3']],
    ])
    expect(activityGroups(plans, [], 'needs', NOW).flatMap((group) => group.rows.map((each) => each.id))).toEqual(['p1'])
    expect(activityGroups(plans, [], 'sent', NOW).flatMap((group) => group.rows.map((each) => each.id))).toEqual(['p2'])
    expect(activityGroups(plans, [], 'drafts', NOW).flatMap((group) => group.rows.map((each) => each.id))).toEqual(['p3'])
  })

  it('draws how far each plan got: drafted, reviewed, signed, on chain', () => {
    expect(states(entry({ status: 'draft' }))).toEqual(['done', 'pending', 'pending', 'pending'])
    expect(states(entry({}))).toEqual(['done', 'active', 'pending', 'pending'])
    expect(states(entry({ status: 'signing' }))).toEqual(['done', 'done', 'active', 'pending'])
    expect(states(entry({ status: 'submitted' }))).toEqual(['done', 'done', 'done', 'active'])
    expect(states(entry({ status: 'confirmed', journey: journey([['payout', 'active', null, null]]) }))).toEqual(['done', 'done', 'done', 'active'])
    expect(states(entry({ status: 'confirmed', journey: journey([['payout', 'done', '15 USDC', null]], true) }))).toEqual(['done', 'done', 'done', 'done'])
    expect(states(entry({ status: 'failed' }))).toEqual(['done', 'done', 'failed', 'pending'])
    expect(states(entry({ status: 'failed', transactionId: 'Tx1' }))).toEqual(['done', 'done', 'done', 'failed'])
    expect(states(entry({ status: 'cancelled' }))).toEqual(['done', 'failed', 'pending', 'pending'])
  })

  it('says where each stands, from main’s own words, with its latest explorer link', () => {
    expect(row(entry({}))?.note).toBe('Waiting in the review window · 28 minutes left')
    expect(row(entry({ status: 'draft' }))?.note).toMatch(/stays a draft/)
    expect(row(entry({ status: 'expired' }))?.note).toBe('Nobody approved it in time. Nothing was signed.')
    const landing = row(entry({ status: 'confirmed', journey: journey([['tx:0', 'done', 'Confirmed', 'https://nearblocks.io/txns/x'], ['payout', 'active', 'Paying out now', null]]) }))
    expect(landing).toMatchObject({ note: 'Paid on Solana · Paying out now', link: { url: 'https://nearblocks.io/txns/x' } })
    expect(row(entry({ status: 'confirmed', journey: journey([['payout', 'done', '15 USDC', 'https://solscan.io/tx/y']], true) }, { ending: '15 USDC reached alice on Solana.' }))?.note).toBe('15 USDC reached alice on Solana.')
    expect(row(entry({ status: 'failed', journey: journey([['tx:0', 'failed', 'NEAR didn’t run it', null]], false, true) }))?.note).toBe('On NEAR · NEAR didn’t run it')
  })

  it('names the chat and agent that made it, when the page still has that chat', () => {
    const chat = { id: 'chat-1', agent: 'claude-code', plan: null, items: [{ kind: 'plan', id: SEND.id, plan: SEND }] } as unknown as Chat
    expect(row(entry({}), [chat])).toMatchObject({ chatId: 'chat-1', agent: 'claude-code', shortId: 'aaaaaaaa', needsYou: true })
    expect(row(entry({}))).toMatchObject({ chatId: null, agent: null })
  })

  it('titles each plan by what it does', () => {
    expect(activityTitle(SEND)).toBe('Send 2 NEAR to alice.near')
    expect(activityTitle({ ...SEND, outcome: 'swap', asset: 'USDC', amount: '25', to: null, toAsset: 'NEAR', toChain: null })).toBe('Swap 25 USDC to NEAR')
    expect(activityTitle({ ...SEND, outcome: 'pay', asset: 'USDC', amount: '15', to: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', toChain: 'solana' })).toBe('Pay 15 USDC to 9WzDXw…AWWM on solana')
  })
})

describe('when a plan was made', () => {
  it('is the time for today, and the day and time before', () => {
    expect(whenMade(new Date(2026, 10, 14, 9, 5).toISOString(), NOW)).not.toMatch(/Nov|14/)
    expect(whenMade(new Date(2026, 10, 12, 9, 5).toISOString(), NOW)).toMatch(/12/)
    expect(whenMade('not a date', NOW)).toBe('')
  })
})
