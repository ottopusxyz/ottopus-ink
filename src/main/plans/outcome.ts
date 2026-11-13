import type { ChatSwap, InkNote } from '../../shared/ipc'
import { formatNear } from '../../shared/near/units'
import type { PlanCore, PlanStatus } from '../../shared/plan'
import { nearTransferOf } from '../near/build'
import { chainName } from '../routes/route'
import { refundPlace, swapSent } from '../routes/swap-terms'

/** How a plan ended: Ink's note for the chat, and the same facts for the agent to pass on. */
export interface PlanOutcome {
  note: InkNote
  /** What the agent is told, marked as Ink's, so it can tell the person in its own words. */
  forAgent: string
}

const nearblocks = (transactionId: string) => ({ label: 'NEAR transaction', url: `https://nearblocks.io/txns/${encodeURIComponent(transactionId)}` })

const toAgent = (planId: string, facts: string) =>
  `Message from Ink, not from the person: plan ${planId} has finished. ${facts} Tell the person what happened in a sentence or two, with the amounts. Don’t start anything new unless they ask.`

/**
 * How a plan ended, once it has: a send once NEAR ran it or turned it down, a swap once
 * its deposit failed or NEAR Intents finished, refunded or lost track of it. Null while
 * it's still on its way, or for an ending the agent already knows of, such as its own cancel.
 * Every value comes from the plan's fixed core, NEAR's answer and NEAR Intents' report.
 */
export function planOutcome(planId: string, core: PlanCore, status: PlanStatus, transactionId: string | null, swap: ChatSwap | null): PlanOutcome | null {
  const links = transactionId ? [nearblocks(transactionId)] : []
  const terms = core.swap
  if (!terms) {
    const transfer = nearTransferOf(core)
    if (!transfer) return null
    const sent = `${formatNear(transfer.deposit)} NEAR to ${transfer.receiverId}`
    if (status === 'confirmed') {
      return { note: { tone: 'ok', title: 'Sent', lines: [`NEAR ran it: ${sent}.`], links }, forAgent: toAgent(planId, `NEAR confirmed it: ${sent}${transactionId ? `, transaction ${transactionId}` : ''}.`) }
    }
    if (status === 'failed') {
      const why = transactionId ? 'NEAR turned it down or it failed on chain. Any fee already used isn’t returned.' : 'Nothing was sent.'
      return { note: { tone: 'block', title: 'Not sent', lines: [`${sent}: ${why}`], links }, forAgent: toAgent(planId, `It failed: ${sent}. ${why}`) }
    }
    return null
  }

  const amountIn = swapSent(terms) ?? `the ${terms.sendSymbol}`
  const yours = refundPlace(terms)
  const theirs = terms.payFrom === 'intents' ? 'the person’s NEAR Intents balance' : 'the person’s NEAR account'
  const where = terms.getChain === 'intents' ? 'into the NEAR Intents balance' : `to ${terms.recipient} on ${chainName(terms.getChain)}`
  if (status === 'failed') {
    const why = transactionId ? 'NEAR turned the deposit down or it failed on chain, so nothing reached NEAR Intents.' : 'Nothing was sent.'
    return { note: { tone: 'block', title: 'Swap not sent', lines: [`${amountIn} → ${terms.getSymbol}: ${why}`], links }, forAgent: toAgent(planId, `The swap of ${amountIn} to ${terms.getSymbol} failed. ${why}`) }
  }
  if (status !== 'confirmed' || !swap) return null
  const payout = swap.link ? [{ label: 'Payout', url: swap.link }] : []
  switch (swap.stage) {
    case 'done': {
      const got = swap.got ?? terms.getSymbol
      return {
        note: { tone: 'ok', title: 'Swap done', lines: [`${amountIn} → ${got}, paid ${where}.`], links: [...links, ...payout] },
        forAgent: toAgent(planId, `NEAR Intents finished the swap: ${amountIn} became ${got}, paid ${where}.${swap.link ? ` Payout: ${swap.link}` : ''}`),
      }
    }
    case 'refunded': {
      const back = swap.refunded ?? amountIn
      return {
        note: { tone: 'info', title: 'Swap refunded', lines: [`NEAR Intents couldn’t swap ${amountIn} to ${terms.getSymbol} in time, and refunded ${back} to ${yours}.`], links },
        forAgent: toAgent(planId, `NEAR Intents couldn’t swap ${amountIn} to ${terms.getSymbol} and refunded ${back} to ${theirs}.`),
      }
    }
    case 'failed':
      return {
        note: { tone: 'block', title: 'Swap failed', lines: [`NEAR Intents couldn’t finish swapping ${amountIn} to ${terms.getSymbol}. Any refund goes to ${yours}.`], links },
        forAgent: toAgent(planId, `NEAR Intents couldn’t finish swapping ${amountIn} to ${terms.getSymbol}; any refund goes to ${theirs}.`),
      }
    case 'unknown':
      return {
        note: { tone: 'info', title: 'Swap still open', lines: [`Ink stopped checking the swap of ${amountIn} to ${terms.getSymbol}. NEAR Intents still pays it out or refunds it on its own.`], links },
        forAgent: toAgent(planId, `Ink stopped checking the swap of ${amountIn} to ${terms.getSymbol}; NEAR Intents still pays it out or refunds it on its own.`),
      }
    default:
      return null
  }
}
