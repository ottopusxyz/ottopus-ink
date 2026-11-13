import { nearAccountKind } from '../../shared/near/account-id'
import { CALL_RULES, callsDeposit, callsOfStep, describeCall, INTENTS_NEAR, WRAP_NEAR } from '../../shared/near/calls'
import { NearDecodeError, nearPublicKey } from '../../shared/near/transaction'
import { formatNear } from '../../shared/near/units'
import type { PlanSwap } from '../../shared/plan'
import type { ReviewPlan } from '../../shared/review'
import { formatUnits } from '../../shared/token-text'
import { nearTransferOf } from '../near/build'
import type { PlanView } from '../plans/store'
import { chainName } from '../routes/route'
import { swapSent } from '../routes/swap-terms'
import { inkChainOf } from '../intents/explorers'
import { legsOfStep } from '../routes/pay-plan'
import { evmChainById, type EvmChain } from '../../shared/evm/chains'
import { EvmDecodeError, evmTransferOfStep } from '../../shared/evm/transaction'

const NEARBLOCKS = { name: 'nearblocks.io', tx: 'https://nearblocks.io/txns/' }

/** An EVM chain's explorer, named by its host as the link shows it. */
const explorerOf = (chain: EvmChain) => ({ name: new URL(chain.explorer.tx).hostname.replace(/^www\./, ''), tx: chain.explorer.tx })

/**
 * What the review window shows for a plan, worked out from its fixed steps: the
 * same fields the signer reads back and signs. Nothing comes from the intent or
 * summary, which began as the agent's words. Null for a plan Ink can't send, so
 * it's never shown for approval.
 *
 * `maxFee` is the most the fees could take, in yoctoNEAR, or null if the chain
 * couldn't be asked. It's only shown: the sender checks the balance against it
 * again just before signing.
 */
export function describeForReview(plan: PlanView, network: string, maxFee: bigint | null, stepFees?: readonly (bigint | null)[]): ReviewPlan | null {
  if (plan.core.swaps) return describePayment(plan, stepFees ?? [])
  if (plan.core.steps[0]?.chain === 'evm') return plan.core.swap ? describeEvmSwap(plan, maxFee) : describeEvmSend(plan, maxFee)
  if (plan.core.swap) return describeSwap(plan, network, maxFee)
  const transfer = nearTransferOf(plan.core)
  const toKind = transfer ? nearAccountKind(transfer.receiverId) : null
  const recipient = plan.core.recipient
  // A plan whose recipient isn't the one its step pays isn't one main made, so it isn't shown.
  if (!transfer || !toKind || !recipient || recipient.address !== transfer.receiverId) return null
  const amount = formatNear(transfer.deposit)
  return {
    id: plan.id,
    kind: 'send',
    swap: null,
    hash: plan.hash,
    network,
    chain: 'NEAR',
    feeAsset: 'NEAR',
    chainMark: 'near',
    explorer: NEARBLOCKS,
    from: transfer.signerId,
    publicKey: nearPublicKey(transfer.publicKey),
    to: transfer.receiverId,
    toKind,
    toWhy: recipient.why,
    amount,
    amountYocto: transfer.deposit.toString(),
    asset: 'NEAR',
    maxFee: maxFee === null ? null : formatNear(maxFee),
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    maxTotal: maxFee === null ? null : formatNear(transfer.deposit + maxFee),
    actions: [{ kind: 'Transfer', amount, method: null, summary: `Send ${amount} NEAR to ${transfer.receiverId}` }],
    expiresAt: plan.core.expiresAt,
  }
}

/** A token amount from its smallest unit and decimals, or null if either isn't one. */
function tokenAmount(raw: string, decimals: string, symbol: string): string | null {
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !/^[0-9]{1,2}$/.test(decimals)) return null
  return `${formatUnits(BigInt(raw), Number(decimals))} ${symbol}`
}

/**
 * A swap's review, from its one step of calls and the terms 1Click fixed. It's shown only
 * when the two agree: paid from the wallet, the step wraps exactly the NEAR swapped and
 * sends it all to the deposit address; paid from the Intents balance, it moves exactly
 * the token swapped, and nothing else, to the deposit address. Either way 1Click pays the
 * plan's own recipient (the person's, or one they typed) and refunds the person's own
 * account.
 */
function describeSwap(plan: PlanView, network: string, maxFee: bigint | null): ReviewPlan | null {
  const swap = plan.core.swap as PlanSwap
  const [step, ...rest] = plan.core.steps
  const recipient = plan.core.recipient
  if (!step || rest.length > 0 || !recipient || recipient.address !== swap.recipient) return null
  let read: ReturnType<typeof callsOfStep>
  try {
    read = callsOfStep(step)
  } catch (error) {
    if (error instanceof NearDecodeError) return null
    throw error
  }
  const amountIn = /^[1-9][0-9]*$/.test(swap.amountIn) ? BigInt(swap.amountIn) : null
  const sent = swapSent(swap)
  if (amountIn === null || !sent || swap.refundTo !== read.signerId) return null
  if (swap.payFrom === 'intents') {
    const [move, ...others] = read.calls
    if (read.receiverId !== INTENTS_NEAR || others.length > 0 || move?.method !== 'mt_transfer' || move.receiverId !== swap.depositAddress || move.tokenId !== swap.originAsset || move.amount !== amountIn) return null
  } else {
    const wraps = read.calls.filter((call) => call.method === 'near_deposit')
    const sends = read.calls.filter((call) => call.method === 'ft_transfer')
    const pays = (call: (typeof read.calls)[number]) => call.method === 'ft_transfer' && call.receiverId === swap.depositAddress && call.amount === amountIn
    if (read.receiverId !== WRAP_NEAR || swap.sendSymbol !== 'NEAR' || wraps.length !== 1 || wraps[0]?.amount !== amountIn || sends.length !== 1 || !pays(sends[0]!)) return null
  }

  const get = tokenAmount(swap.amountOut, swap.getDecimals, swap.getSymbol)
  const least = tokenAmount(swap.minAmountOut, swap.getDecimals, swap.getSymbol)
  const seconds = Number(swap.seconds)
  const feeBps = Number(swap.feeBps)
  if (!get || !least || !Number.isFinite(seconds) || !Number.isInteger(feeBps)) return null
  const deposit = callsDeposit(read.calls)
  const fromIntents = swap.payFrom === 'intents'
  // What leaves, as the amount line reads it: NEAR from the wallet, or the token from the Intents balance.
  const amount = fromIntents ? sent.slice(0, sent.lastIndexOf(' ')) : formatNear(amountIn)
  const toKind = swap.getChain === 'intents' ? nearAccountKind(swap.recipient) : 'other-chain'
  if (!toKind) return null
  return {
    id: plan.id,
    kind: 'swap',
    swap: {
      send: sent,
      from: fromIntents ? 'intents' : 'wallet',
      get,
      least,
      getChain: swap.getChain === 'intents' ? 'your NEAR Intents balance' : chainName(swap.getChain),
      refundTo: swap.refundTo,
      depositAddress: swap.depositAddress,
      deadline: swap.deadline,
      fee: `${(feeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
      seconds,
    },
    hash: plan.hash,
    network,
    chain: 'NEAR',
    feeAsset: 'NEAR',
    chainMark: 'near',
    explorer: NEARBLOCKS,
    from: read.signerId,
    publicKey: nearPublicKey(read.publicKey),
    to: swap.recipient,
    toKind,
    toWhy: recipient.why,
    amount,
    amountYocto: amountIn.toString(),
    asset: fromIntents ? swap.sendSymbol : 'NEAR',
    maxFee: maxFee === null ? null : formatNear(maxFee),
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    // The NEAR that can leave the account: for a swap from the Intents balance, the yoctoNEAR the move attaches and the fee.
    maxTotal: maxFee === null ? null : formatNear(deposit + maxFee),
    actions: read.calls.map((call) => ({
      kind: 'FunctionCall',
      amount: formatNear(CALL_RULES[call.method].deposit(call)),
      method: call.method,
      // The move's token and amount checked against the swap's own above, so they can be written as a person reads them.
      summary: call.method === 'mt_transfer' ? `Move ${sent} from your NEAR Intents balance to NEAR Intents’ deposit address ${call.receiverId}` : describeCall(call, read.receiverId),
    })),
    expiresAt: plan.core.expiresAt,
  }
}

/**
 * An EVM send's review, from its one step: the coin or token, the exact amount at the
 * token's own decimals, who gets it, and the most the fees could take in the chain's coin.
 * The recipient must be the one the plan pays (the person's, or one they typed).
 */
function describeEvmSend(plan: PlanView, maxFee: bigint | null): ReviewPlan | null {
  const [step, ...rest] = plan.core.steps
  const recipient = plan.core.recipient
  if (!step || rest.length > 0 || plan.core.swap || !recipient) return null
  let transfer: ReturnType<typeof evmTransferOfStep>
  try {
    transfer = evmTransferOfStep(step)
  } catch (error) {
    if (error instanceof EvmDecodeError) return null
    throw error
  }
  const chain = evmChainById(transfer.chainId)
  if (!chain || recipient.address.toLowerCase() !== transfer.to.toLowerCase()) return null
  const native = transfer.token === 'native'
  const amount = formatUnits(transfer.amount, transfer.decimals)
  const fee = maxFee === null ? null : formatUnits(maxFee, 18)
  return {
    id: plan.id,
    kind: 'send',
    swap: null,
    hash: plan.hash,
    network: `${chain.name} mainnet`,
    chain: chain.name,
    feeAsset: chain.symbol,
    chainMark: chain.id,
    explorer: explorerOf(chain),
    from: transfer.from,
    publicKey: `secp256k1 · ${transfer.from}`,
    to: transfer.to,
    toKind: 'evm',
    toWhy: recipient.why,
    amount,
    amountYocto: transfer.amount.toString(),
    asset: transfer.symbol,
    maxFee: fee,
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    // What can leave in the chain's coin: the coin sent and the fees, or just the fees for a token.
    maxTotal: maxFee === null ? null : formatUnits((native ? transfer.amount : 0n) + maxFee, 18),
    actions: [
      native
        ? { kind: 'Transfer', amount, method: null, summary: `Send ${amount} ${chain.symbol} to ${transfer.to} on ${chain.name}` }
        : { kind: 'FunctionCall', amount: '0', method: 'transfer', summary: `Send ${amount} ${transfer.symbol} to ${transfer.to} on ${chain.name}, through the token’s contract ${transfer.token}` },
    ],
    expiresAt: plan.core.expiresAt,
  }
}

/**
 * A swap the wallet pays on an EVM chain, from its one transfer and the terms 1Click fixed.
 * Shown only when the two agree: the transfer sends exactly the swap's coin or token and
 * amount, on its chain, to its deposit address, from the address a refund goes back to; and
 * 1Click pays the plan's own recipient.
 */
function describeEvmSwap(plan: PlanView, maxFee: bigint | null): ReviewPlan | null {
  const swap = plan.core.swap as PlanSwap
  const [step, ...rest] = plan.core.steps
  const recipient = plan.core.recipient
  if (!step || rest.length > 0 || !recipient || recipient.address !== swap.recipient || swap.payFrom !== 'evm') return null
  let transfer: ReturnType<typeof evmTransferOfStep>
  try {
    transfer = evmTransferOfStep(step)
  } catch (error) {
    if (error instanceof EvmDecodeError) return null
    throw error
  }
  const chain = evmChainById(transfer.chainId)
  const sent = swapSent(swap)
  const agrees =
    chain !== null &&
    sent !== null &&
    String(transfer.chainId) === swap.sendChainId &&
    transfer.token === swap.sendToken &&
    transfer.to.toLowerCase() === swap.depositAddress.toLowerCase() &&
    transfer.amount.toString() === swap.amountIn &&
    transfer.from.toLowerCase() === swap.refundTo.toLowerCase() &&
    String(transfer.decimals) === swap.sendDecimals
  if (!agrees || !chain || !sent) return null
  const get = tokenAmount(swap.amountOut, swap.getDecimals, swap.getSymbol)
  const least = tokenAmount(swap.minAmountOut, swap.getDecimals, swap.getSymbol)
  const seconds = Number(swap.seconds)
  const feeBps = Number(swap.feeBps)
  if (!get || !least || !Number.isFinite(seconds) || !Number.isInteger(feeBps)) return null
  const toKind = swap.getChain === 'intents' ? nearAccountKind(swap.recipient) : 'other-chain'
  if (!toKind) return null
  const native = transfer.token === 'native'
  const amount = formatUnits(transfer.amount, transfer.decimals)
  return {
    id: plan.id,
    kind: 'swap',
    swap: {
      send: sent,
      from: 'evm',
      get,
      least,
      getChain: swap.getChain === 'intents' ? 'your NEAR Intents balance' : chainName(swap.getChain),
      refundTo: swap.refundTo,
      depositAddress: swap.depositAddress,
      deadline: swap.deadline,
      fee: `${(feeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
      seconds,
    },
    hash: plan.hash,
    network: `${chain.name} mainnet`,
    chain: chain.name,
    feeAsset: chain.symbol,
    chainMark: chain.id,
    explorer: explorerOf(chain),
    from: transfer.from,
    publicKey: `secp256k1 · ${transfer.from}`,
    to: swap.recipient,
    toKind,
    toWhy: recipient.why,
    amount,
    amountYocto: transfer.amount.toString(),
    asset: transfer.symbol,
    maxFee: maxFee === null ? null : formatUnits(maxFee, 18),
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    maxTotal: maxFee === null ? null : formatUnits((native ? transfer.amount : 0n) + maxFee, 18),
    actions: [
      native
        ? { kind: 'Transfer', amount, method: null, summary: `Send ${amount} ${chain.symbol} to NEAR Intents’ deposit address ${transfer.to} on ${chain.name}` }
        : { kind: 'FunctionCall', amount: '0', method: 'transfer', summary: `Send ${amount} ${transfer.symbol} to NEAR Intents’ deposit address ${transfer.to} on ${chain.name}, through the token’s contract ${transfer.token}` },
    ],
    expiresAt: plan.core.expiresAt,
  }
}

/**
 * A payment's review, from its steps and each leg's terms. Shown only when they agree
 * exactly: each Intents leg's mt_transfer in the one NEAR step, and each EVM leg's transfer
 * in its own step, moves exactly that leg's token and amount to its deposit address, every
 * step pays a leg and every leg is paid once; every leg pays exactly its amount, of the
 * same token on the same chain, to the plan's own recipient.
 */
function describePayment(plan: PlanView, stepFees: readonly (bigint | null)[]): ReviewPlan | null {
  const legs = plan.core.swaps ?? []
  const recipient = plan.core.recipient
  const [first] = legs
  if (!first || !recipient || plan.core.steps.length === 0 || plan.core.swap) return null
  const sameTarget = legs.every((leg) => leg.recipient === recipient.address && leg.destinationAsset === first.destinationAsset && leg.getChain === first.getChain && leg.getDecimals === first.getDecimals && leg.amountOut === leg.minAmountOut && /^[1-9][0-9]*$/.test(leg.amountOut))
  if (!sameTarget) return null

  const paid = new Set<number>()
  // Each step must pay exactly the legs its place says, since that's how each leg is followed once it's sent.
  let stepIndex = 0
  let stepPays: number[] = []
  const payOnce = (index: number) => (index < 0 || paid.has(index) ? false : (paid.add(index), stepPays.push(index), true))
  const inPlace = () => {
    const expected = legsOfStep(plan.core, stepIndex++)
    const ok = expected.length === stepPays.length && expected.every((leg, i) => leg === stepPays[i])
    stepPays = []
    return ok
  }
  const actions: ReviewPlan['actions'] = []
  const chains: { name: string; mark: string; symbol: string; explorer: { name: string; tx: string } }[] = []
  for (const step of plan.core.steps) {
    try {
      if (step.chain === 'evm') {
        const transfer = evmTransferOfStep(step)
        const chain = evmChainById(transfer.chainId)
        if (!chain) return null
        const index = legs.findIndex((leg, i) => !paid.has(i) && leg.payFrom === 'evm' && leg.sendChainId === String(transfer.chainId) && leg.sendToken === transfer.token && leg.depositAddress.toLowerCase() === transfer.to.toLowerCase() && leg.amountIn === transfer.amount.toString() && leg.refundTo.toLowerCase() === transfer.from.toLowerCase() && leg.sendDecimals === String(transfer.decimals))
        if (!payOnce(index)) return null
        const amount = formatUnits(transfer.amount, transfer.decimals)
        actions.push({ kind: 'FunctionCall', amount: '0', method: 'transfer', summary: `Send ${amount} ${transfer.symbol} to NEAR Intents’ deposit address ${transfer.to} on ${chain.name}, through the token’s contract ${transfer.token}` })
        chains.push({ name: chain.name, mark: chain.id, symbol: chain.symbol, explorer: explorerOf(chain) })
        if (!inPlace()) return null
      } else {
        const read = callsOfStep(step)
        if (read.receiverId !== INTENTS_NEAR) return null
        for (const call of read.calls) {
          if (call.method !== 'mt_transfer') return null
          const index = legs.findIndex((leg, i) => !paid.has(i) && leg.payFrom === 'intents' && leg.depositAddress === call.receiverId && leg.originAsset === call.tokenId && leg.amountIn === call.amount.toString() && leg.refundTo === read.signerId)
          if (!payOnce(index)) return null
          const sent = swapSent(legs[index] as PlanSwap)
          actions.push({ kind: 'FunctionCall', amount: formatNear(CALL_RULES[call.method].deposit(call)), method: call.method, summary: `Move ${sent} from your NEAR Intents balance to NEAR Intents’ deposit address ${call.receiverId}` })
        }
        chains.push({ name: 'NEAR', mark: 'near', symbol: 'NEAR', explorer: NEARBLOCKS })
        if (!inPlace()) return null
      }
    } catch (error) {
      if (error instanceof EvmDecodeError || error instanceof NearDecodeError) return null
      throw error
    }
  }
  if (paid.size !== legs.length) return null

  const reviewLegs = legs.map((leg) => {
    const chain = leg.payFrom === 'evm' ? evmChainById(Number(leg.sendChainId)) : null
    return {
      send: swapSent(leg) ?? leg.sendSymbol,
      from: leg.payFrom === 'evm' ? ('evm' as const) : ('intents' as const),
      fromPlace: chain ? chain.name : 'your NEAR Intents balance',
      get: tokenAmount(leg.amountOut, leg.getDecimals, leg.getSymbol) ?? leg.getSymbol,
      depositAddress: leg.depositAddress,
      refundTo: leg.refundTo,
      fee: `${(Number(leg.feeBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
      seconds: Number(leg.seconds),
    }
  })
  const total = legs.reduce((sum, leg) => sum + BigInt(leg.amountOut), 0n)
  const last = chains.at(-1) as (typeof chains)[number]
  return {
    id: plan.id,
    kind: 'pay',
    swap: null,
    legs: reviewLegs,
    payChain: { mark: inkChainOf(first.getChain) ?? first.getChain, name: chainName(first.getChain) },
    stepFees: chains.map((chain, i) => {
      const fee = stepFees[i] ?? null
      return { chain: chain.name, feeAsset: chain.symbol, maxFee: fee === null ? null : formatUnits(fee, chain.symbol === 'NEAR' ? 24 : 18), maxFeeYocto: fee === null ? null : fee.toString() }
    }),
    hash: plan.hash,
    network: [...new Set(chains.map((chain) => `${chain.name} mainnet`))].join(' + '),
    chain: [...new Set(chains.map((chain) => chain.name))].join(' and '),
    feeAsset: last.symbol,
    chainMark: last.mark,
    explorer: last.explorer,
    from: legs.map((leg) => leg.refundTo).filter((address, i, all) => all.indexOf(address) === i).join(', '),
    publicKey: chains.map((chain) => (chain.symbol === 'NEAR' ? 'ed25519' : 'secp256k1')).filter((key, i, all) => all.indexOf(key) === i).join(' + '),
    to: recipient.address,
    toKind: first.getChain === 'intents' ? 'implicit' : 'other-chain',
    toWhy: recipient.why,
    amount: formatUnits(total, Number(first.getDecimals)),
    amountYocto: total.toString(),
    asset: first.getSymbol,
    maxFee: null,
    maxFeeYocto: stepFees.every((fee) => fee !== null) && stepFees.length === chains.length ? '0' : null,
    maxTotal: null,
    actions,
    expiresAt: plan.core.expiresAt,
  }
}
