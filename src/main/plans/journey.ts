import { evmChainById } from '../../shared/evm/chains'
import type { ChatSwap, JourneyStep, PlanJourney } from '../../shared/ipc'
import type { PlanCore, PlanStatus, PlanSwap } from '../../shared/plan'
import { inkChainOf } from '../intents/explorers'
import { chainName } from '../routes/route'
import { legsOfStep } from '../routes/pay-plan'
import { swapSent } from '../routes/swap-terms'

/** A step's transaction, as the sender reported it. */
export interface StepTx {
  state: 'sent' | 'confirmed' | 'failed'
  id: string
}

/** What a plan's journey is worked out from: all of it main's own record. */
export interface JourneyInput {
  core: PlanCore
  status: PlanStatus
  /** Each step's transaction, by the step's place. */
  txs: ReadonlyMap<number, StepTx>
  /** Each swap's progress, by its place in `swaps`, or the one swap's at 0. Null before Ink heard of it. */
  swaps: readonly (ChatSwap | null)[]
  /** Whether a payment's payout is signed and waiting for its legs. */
  held: boolean
}

const STOPPED: ReadonlySet<PlanStatus> = new Set(['cancelled', 'expired', 'blocked'])

/** Where a step's transaction runs: NEAR, or an EVM chain by its name and explorer. */
function chainOfStep(core: PlanCore, index: number): { name: string; mark: string; tx: (id: string) => string } {
  const step = core.steps[index]
  if (step?.chain === 'evm') {
    const chain = evmChainById(Number(step.fields.chainId))
    if (chain) return { name: chain.name, mark: chain.id, tx: (id) => `${chain.explorer.tx}${id}` }
  }
  if (step?.chain === 'solana') return { name: 'Solana', mark: 'solana', tx: (id) => `https://solscan.io/tx/${encodeURIComponent(id)}` }
  return { name: 'NEAR', mark: 'near', tx: (id) => `https://nearblocks.io/txns/${encodeURIComponent(id)}` }
}

/** A payout's step as the journey shows it, from its swap's progress. */
function paidOut(swap: PlanSwap, progress: ChatSwap | null, from: JourneyStep['state']): JourneyStep {
  const where = swap.getChain === 'intents' ? 'In your Intents balance' : `Paid on ${chainName(swap.getChain)}`
  const icon = { kind: 'token' as const, symbol: swap.getSymbol, chain: inkChainOf(swap.getChain) }
  const link = progress?.link ? { label: 'payout', url: progress.link } : null
  const base = { id: 'payout', label: where, icon, link }
  if (!progress || from === 'pending') return { ...base, state: from, detail: from === 'active' ? 'NEAR Intents is paying it out' : null }
  switch (progress.stage) {
    case 'deposited':
      return { ...base, state: 'active', detail: 'NEAR Intents picked it up' }
    case 'swapping':
      return { ...base, state: 'active', detail: 'Paying out now' }
    case 'done':
      return { ...base, state: 'done', detail: progress.got }
    case 'refunded':
      return { ...base, state: 'failed', detail: progress.refunded ? `Refunded ${progress.refunded}` : 'Refunded' }
    case 'failed':
      return { ...base, state: 'failed', detail: 'NEAR Intents couldn’t finish it' }
    case 'unknown':
      return { ...base, state: 'active', detail: 'Ink stopped checking; NEAR Intents finishes it on its own' }
  }
}

/**
 * A plan's journey, every step from review to its money landing:
 * - review and signing, from the plan's status;
 * - each of its transactions, on its own chain, from what the sender reported;
 * - for a swap, NEAR Intents paying it out;
 * - for a payment, its legs landing in the Intents balance, then its one payout, which
 *   waits, signed, until they have.
 * A step that failed fails the journey, and steps after it stay where they were.
 */
export function journeyOf({ core, status, txs, swaps, held }: JourneyInput): PlanJourney {
  const steps: JourneyStep[] = []
  const reached = (['approved', 'signing', 'submitted', 'confirmed', 'failed'] as PlanStatus[]).includes(status)
  const anySent = txs.size > 0
  steps.push({
    id: 'review',
    label: 'Review',
    icon: { kind: 'review' },
    state: STOPPED.has(status) ? 'failed' : status === 'awaiting_review' ? 'active' : reached ? 'done' : 'pending',
    detail: STOPPED.has(status) ? { cancelled: 'Cancelled', expired: 'Expired', blocked: 'Blocked' }[status as 'cancelled' | 'expired' | 'blocked'] : status === 'awaiting_review' ? 'Waiting for you' : reached ? 'Approved' : null,
    link: null,
  })
  const signFailed = status === 'failed' && !anySent
  steps.push({
    id: 'sign',
    label: 'Sign',
    icon: { kind: 'sign' },
    state: signFailed ? 'failed' : anySent ? 'done' : status === 'approved' || status === 'signing' ? 'active' : 'pending',
    detail: signFailed ? 'Not sent' : anySent ? 'Signed' : status === 'approved' || status === 'signing' ? 'Signing' : null,
    link: null,
  })

  const payment = core.swaps
  const payoutIndex = payment ? payment.findIndex((swap) => swap.role === 'payout') : -1
  const payoutStep = payoutIndex >= 0 ? core.steps.length - 1 : -1
  /** A payment's legs landing in the Intents balance, together, before its payout can go. */
  const legsStep = (): JourneyStep | null => {
    if (!payment) return null
    const legs = payment.flatMap((swap, index) => (swap.role === 'payout' ? [] : [{ swap, progress: swaps[index] ?? null }]))
    if (legs.length === 0) return null
    const landed = legs.filter((leg) => leg.progress?.stage === 'done').length
    const failed = legs.some((leg) => leg.progress && (leg.progress.stage === 'failed' || leg.progress.stage === 'refunded'))
    const started = core.steps.some((_, index) => index !== payoutStep && txs.get(index)?.state === 'confirmed')
    return {
      id: 'legs',
      label: 'In your Intents balance',
      icon: { kind: 'swap' },
      state: failed ? 'failed' : landed === legs.length ? 'done' : started ? 'active' : 'pending',
      detail: failed ? 'A part wasn’t swapped; what arrived stays there' : started || landed > 0 ? `${landed} of ${legs.length} parts landed` : null,
      link: null,
    }
  }

  core.steps.forEach((_, index) => {
    const chain = chainOfStep(core, index)
    const tx = txs.get(index)
    const paying = payment ? legsOfStep(core, index).map((leg) => payment[leg]).filter((swap): swap is PlanSwap => swap !== undefined) : []
    const isPayout = index === payoutStep
    const what = isPayout ? 'Payout' : paying.length > 0 ? paying.map((swap) => swapSent(swap) ?? swap.sendSymbol).join(' + ') : null
    const label = isPayout ? `Payout on ${chain.name}` : what ? `${what} on ${chain.name}` : `On ${chain.name}`
    const link = tx ? { label: chain.name === 'NEAR' ? 'nearblocks' : 'explorer', url: chain.tx(tx.id) } : null
    const base = { id: `tx:${index}`, label, icon: { kind: 'chain' as const, chain: chain.mark }, link }
    // The legs land before the payout can go, so their step comes first.
    if (isPayout) {
      const landing = legsStep()
      if (landing) steps.push(landing)
    }
    if (tx?.state === 'confirmed') steps.push({ ...base, state: 'done', detail: 'Confirmed' })
    else if (tx?.state === 'failed') steps.push({ ...base, state: 'failed', detail: `${chain.name} didn’t run it` })
    else if (tx) steps.push({ ...base, state: 'active', detail: `Waiting for ${chain.name}` })
    else if (isPayout && held) steps.push({ ...base, state: 'pending', detail: 'Signed; sent once the parts land' })
    else steps.push({ ...base, state: 'pending', detail: null })
  })

  // A swap: NEAR Intents pays it out once its one transaction ran.
  if (core.swap) steps.push(paidOut(core.swap, swaps[0] ?? null, txs.get(0)?.state === 'confirmed' ? 'active' : 'pending'))

  if (payment) {
    const payout = payment[payoutIndex]
    if (payout) steps.push(paidOut(payout, swaps[payoutIndex] ?? null, txs.get(payoutStep)?.state === 'confirmed' ? 'active' : 'pending'))
  }

  const failed = steps.some((step) => step.state === 'failed') || STOPPED.has(status)
  return { steps, done: steps.at(-1)?.state === 'done', failed }
}
