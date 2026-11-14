import { nearAccountKind } from '../../shared/near/account-id'
import { CALL_RULES, callsDeposit, callsOfStep, describeCall, INTENTS_NEAR, WRAP_NEAR, type NearCall } from '../../shared/near/calls'
import { NearDecodeError, nearPublicKey } from '../../shared/near/transaction'
import { formatNear } from '../../shared/near/units'
import type { PlanSwap } from '../../shared/plan'
import type { ReviewAction, ReviewPlan, ReviewToken, ReviewTransaction } from '../../shared/review'
import { formatUnits } from '../../shared/token-text'
import { nearTransferOf } from '../near/build'
import type { PlanView } from '../plans/store'
import { chainName } from '../routes/route'
import { swapSent } from '../routes/swap-terms'
import { inkChainOf } from '../intents/explorers'
import { legsOfStep } from '../routes/pay-plan'
import { evmChainById, type EvmChain } from '../../shared/evm/chains'
import { EvmDecodeError, evmTransferOfStep } from '../../shared/evm/transaction'
import { SolanaDecodeError, solanaTransferOfStep, type SolanaTransfer } from '../../shared/solana/transaction'

const NEARBLOCKS = { name: 'nearblocks.io', tx: 'https://nearblocks.io/txns/' }
const SOLSCAN = { name: 'solscan.io', tx: 'https://solscan.io/tx/' }

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
  if (plan.core.steps[0]?.chain === 'solana') return describeSolana(plan, maxFee)
  if (plan.core.swap) return describeSwap(plan, network, maxFee)
  const transfer = nearTransferOf(plan.core)
  const toKind = transfer ? nearAccountKind(transfer.receiverId) : null
  const recipient = plan.core.recipient
  // A plan whose recipient isn't the one its step pays isn't one main made, so it isn't shown.
  if (!transfer || !toKind || !recipient || recipient.address !== transfer.receiverId) return null
  const amount = formatNear(transfer.deposit)
  const action: ReviewAction = { kind: 'Transfer', amount, attachAsset: 'NEAR', method: null, summary: `Send ${amount} NEAR to ${transfer.receiverId}`, move: { amount, token: NEAR_COIN, to: transfer.receiverId, role: 'recipient' } }
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
    ...(recipient.file ? { toFile: recipient.file } : {}),
    amount,
    amountYocto: transfer.deposit.toString(),
    asset: 'NEAR',
    maxFee: maxFee === null ? null : formatNear(maxFee),
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    maxTotal: maxFee === null ? null : formatNear(transfer.deposit + maxFee),
    actions: [action],
    flow: { out: [{ token: NEAR_COIN, amount }], via: 'direct', in: { token: NEAR_COIN, amount, exact: true, to: transfer.receiverId } },
    transactions: [nearTransaction([action], maxFee === null ? null : formatNear(maxFee))],
    expiresAt: plan.core.expiresAt,
  }
}

/** A token amount from its smallest unit and decimals, or null if either isn't one. */
function tokenAmount(raw: string, decimals: string, symbol: string): string | null {
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !/^[0-9]{1,2}$/.test(decimals)) return null
  return `${formatUnits(BigInt(raw), Number(decimals))} ${symbol}`
}

/** A token amount in whole tokens, without its symbol, or null if either part isn't one. */
function units(raw: string, decimals: string): string | null {
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !/^[0-9]{1,2}$/.test(decimals)) return null
  return formatUnits(BigInt(raw), Number(decimals))
}

/** The number in "5 NEAR". */
const amountOf = (text: string) => text.slice(0, text.lastIndexOf(' '))

const token = (symbol: string, chain: string, place: string, id: string | null): ReviewToken => ({ symbol, chain, place, id, icon: null })
const NEAR_COIN = token('NEAR', 'near', 'NEAR', null)
const WNEAR = token('wNEAR', 'near', 'NEAR', WRAP_NEAR)
/** A token in the person's NEAR Intents balance, by 1Click's id for it. */
const intentsToken = (symbol: string, asset: string) => token(symbol, 'near', 'NEAR Intents', asset)

/** What a swap pays out, where it pays it: on a chain, or into the NEAR Intents balance. */
function swapGetToken(swap: PlanSwap): ReviewToken {
  if (swap.getChain === 'intents') return intentsToken(swap.getSymbol, swap.destinationAsset)
  return token(swap.getSymbol, inkChainOf(swap.getChain) ?? swap.getChain, chainName(swap.getChain), swap.destinationAsset)
}

/** What a swap sends, where from: NEAR from the wallet, a token from the Intents balance, or a coin or token on its chain. */
function swapSendToken(swap: PlanSwap): ReviewToken {
  if (swap.payFrom === 'intents') return intentsToken(swap.sendSymbol, swap.originAsset)
  if (swap.payFrom === 'evm') {
    const chain = evmChainById(Number(swap.sendChainId))
    return token(swap.sendSymbol, chain?.id ?? 'ethereum', chain?.name ?? 'EVM', swap.sendToken && swap.sendToken !== 'native' ? swap.sendToken : null)
  }
  if (swap.payFrom === 'solana') return token(swap.sendSymbol, 'solana', 'Solana', swap.sendToken && swap.sendToken !== 'native' ? swap.sendToken : null)
  return NEAR_COIN
}

/** One NEAR call as an action: what it attaches, and what it moves to whom. */
function nearCallAction(call: NearCall, receiverId: string, moved: { amount: string; token: ReviewToken } | null, summary = describeCall(call, receiverId)): ReviewAction {
  const to = call.method === 'mt_transfer' || call.method === 'ft_transfer' ? call.receiverId : null
  return {
    kind: 'FunctionCall',
    amount: formatNear(CALL_RULES[call.method].deposit(call)),
    attachAsset: 'NEAR',
    method: call.method,
    summary,
    move: moved && to ? { ...moved, to, role: 'deposit' } : null,
  }
}

const nearTransaction = (actions: ReviewAction[], maxFee: string | null, when: ReviewTransaction['when'] = 'now'): ReviewTransaction => ({
  chain: { mark: 'near', name: 'NEAR' },
  key: 'ed25519',
  when,
  maxFee,
  feeAsset: 'NEAR',
  actions,
})

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
  const sendToken = swapSendToken(swap)
  // The moves' tokens and amounts were checked against the swap's own above, so they can be written as a person reads them.
  const actions = read.calls.map((call) =>
    call.method === 'mt_transfer'
      ? nearCallAction(call, read.receiverId, { amount, token: sendToken }, `Move ${sent} from your NEAR Intents balance to NEAR Intents’ deposit address ${call.receiverId}`)
      : nearCallAction(call, read.receiverId, call.method === 'ft_transfer' ? { amount: formatNear(call.amount), token: WNEAR } : null),
  )
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
    ...(recipient.file ? { toFile: recipient.file } : {}),
    amount,
    amountYocto: amountIn.toString(),
    asset: fromIntents ? swap.sendSymbol : 'NEAR',
    maxFee: maxFee === null ? null : formatNear(maxFee),
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    // The NEAR that can leave the account: for a swap from the Intents balance, the yoctoNEAR the move attaches and the fee.
    maxTotal: maxFee === null ? null : formatNear(deposit + maxFee),
    actions,
    flow: { out: [{ token: sendToken, amount }], via: 'intents', in: { token: swapGetToken(swap), amount: amountOf(get), exact: false, least: amountOf(least), to: swap.recipient } },
    transactions: [nearTransaction(actions, maxFee === null ? null : formatNear(maxFee))],
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
  const sent = evmToken(transfer, chain)
  const action = evmAction(transfer, chain, sent, 'recipient')
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
    ...(recipient.file ? { toFile: recipient.file } : {}),
    amount,
    amountYocto: transfer.amount.toString(),
    asset: transfer.symbol,
    maxFee: fee,
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    // What can leave in the chain's coin: the coin sent and the fees, or just the fees for a token.
    maxTotal: maxFee === null ? null : formatUnits((native ? transfer.amount : 0n) + maxFee, 18),
    actions: [action],
    flow: { out: [{ token: sent, amount }], via: 'direct', in: { token: sent, amount, exact: true, to: transfer.to } },
    transactions: [evmTransaction(chain, [action], fee)],
    expiresAt: plan.core.expiresAt,
  }
}

/** An EVM transfer's one action: the coin itself, or a token through its contract. */
function evmAction(transfer: ReturnType<typeof evmTransferOfStep>, chain: EvmChain, sent: ReviewToken, role: 'recipient' | 'deposit'): ReviewAction {
  const amount = formatUnits(transfer.amount, transfer.decimals)
  const where = role === 'deposit' ? 'NEAR Intents’ deposit address ' : ''
  const move = { amount, token: sent, to: transfer.to, role }
  return transfer.token === 'native'
    ? { kind: 'Transfer', amount, attachAsset: chain.symbol, method: null, summary: `Send ${amount} ${chain.symbol} to ${where}${transfer.to} on ${chain.name}`, move }
    : { kind: 'FunctionCall', amount: '0', attachAsset: chain.symbol, method: 'transfer', summary: `Send ${amount} ${transfer.symbol} to ${where}${transfer.to} on ${chain.name}, through the token’s contract ${transfer.token}`, move }
}

const evmToken = (transfer: ReturnType<typeof evmTransferOfStep>, chain: EvmChain) => token(transfer.symbol, chain.id, chain.name, transfer.token === 'native' ? null : transfer.token)

const evmTransaction = (chain: EvmChain, actions: ReviewAction[], maxFee: string | null): ReviewTransaction => ({
  chain: { mark: chain.id, name: chain.name },
  key: 'secp256k1',
  when: 'now',
  maxFee,
  feeAsset: chain.symbol,
  actions,
})

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
  const sentToken = evmToken(transfer, chain)
  const action = evmAction(transfer, chain, sentToken, 'deposit')
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
    ...(recipient.file ? { toFile: recipient.file } : {}),
    amount,
    amountYocto: transfer.amount.toString(),
    asset: transfer.symbol,
    maxFee: maxFee === null ? null : formatUnits(maxFee, 18),
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    maxTotal: maxFee === null ? null : formatUnits((native ? transfer.amount : 0n) + maxFee, 18),
    actions: [action],
    flow: { out: [{ token: sentToken, amount }], via: 'intents', in: { token: swapGetToken(swap), amount: amountOf(get), exact: false, least: amountOf(least), to: swap.recipient } },
    transactions: [evmTransaction(chain, [action], maxFee === null ? null : formatUnits(maxFee, 18))],
    expiresAt: plan.core.expiresAt,
  }
}

/** A Solana transfer's one action, as review reads it. `where` names a deposit address, or nothing for a plain send. */
function solanaAction(transfer: SolanaTransfer, where = ''): ReviewPlan['actions'][number] {
  const amount = formatUnits(transfer.amount, transfer.decimals)
  const move = { amount, token: solanaToken(transfer), to: transfer.to, role: where ? ('deposit' as const) : ('recipient' as const) }
  return transfer.token === 'native'
    ? { kind: 'Transfer', amount, attachAsset: 'SOL', method: null, summary: `Send ${amount} SOL to ${where}${transfer.to} on Solana`, move }
    : {
        kind: 'FunctionCall',
        amount: '0',
        attachAsset: 'SOL',
        move,
        method: 'TransferChecked',
        summary: `Send ${amount} ${transfer.symbol} (mint ${transfer.token}) to ${where}${transfer.to} on Solana, from your token account to theirs, which is opened first, at your cost, if it isn’t yet`,
      }
}

const solanaToken = (transfer: SolanaTransfer) => token(transfer.symbol, 'solana', 'Solana', transfer.token === 'native' ? null : transfer.token)

const solanaTransaction = (actions: ReviewAction[], maxFee: string | null): ReviewTransaction => ({
  chain: { mark: 'solana', name: 'Solana' },
  key: 'ed25519',
  when: 'now',
  maxFee,
  feeAsset: 'SOL',
  actions,
})

/**
 * A plan whose one step sends on Solana: a send to the plan's recipient, or a swap the
 * wallet pays there. A swap is shown only when the transfer and the terms 1Click fixed
 * agree: exactly the swap's SOL or token and amount, to its deposit address, from the
 * address a refund goes back to; and 1Click pays the plan's own recipient.
 */
function describeSolana(plan: PlanView, maxFee: bigint | null): ReviewPlan | null {
  const [step, ...rest] = plan.core.steps
  const recipient = plan.core.recipient
  if (!step || rest.length > 0 || !recipient) return null
  let transfer: SolanaTransfer
  try {
    transfer = solanaTransferOfStep(step)
  } catch (error) {
    if (error instanceof SolanaDecodeError) return null
    throw error
  }
  const swap = plan.core.swap
  let reviewSwap: ReviewPlan['swap'] = null
  let toKind: ReviewPlan['toKind'] = 'solana'
  let arrives: ReviewPlan['flow']['in'] = { token: solanaToken(transfer), amount: formatUnits(transfer.amount, transfer.decimals), exact: true, to: transfer.to }
  if (swap) {
    const sent = swapSent(swap)
    const agrees =
      swap.payFrom === 'solana' &&
      recipient.address === swap.recipient &&
      sent !== null &&
      transfer.token === swap.sendToken &&
      transfer.to === swap.depositAddress &&
      transfer.amount.toString() === swap.amountIn &&
      transfer.from === swap.refundTo &&
      String(transfer.decimals) === swap.sendDecimals
    const get = tokenAmount(swap.amountOut, swap.getDecimals, swap.getSymbol)
    const least = tokenAmount(swap.minAmountOut, swap.getDecimals, swap.getSymbol)
    const seconds = Number(swap.seconds)
    const feeBps = Number(swap.feeBps)
    const kind = swap.getChain === 'intents' ? nearAccountKind(swap.recipient) : 'other-chain'
    if (!agrees || !sent || !get || !least || !Number.isFinite(seconds) || !Number.isInteger(feeBps) || !kind) return null
    toKind = kind
    arrives = { token: swapGetToken(swap), amount: amountOf(get), exact: false, least: amountOf(least), to: swap.recipient }
    reviewSwap = {
      send: sent,
      from: 'solana',
      get,
      least,
      getChain: swap.getChain === 'intents' ? 'your NEAR Intents balance' : chainName(swap.getChain),
      refundTo: swap.refundTo,
      depositAddress: swap.depositAddress,
      deadline: swap.deadline,
      fee: `${(feeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
      seconds,
    }
  } else if (recipient.address !== transfer.to) return null
  const native = transfer.token === 'native'
  const action = solanaAction(transfer, swap ? 'NEAR Intents’ deposit address ' : '')
  return {
    id: plan.id,
    kind: swap ? 'swap' : 'send',
    swap: reviewSwap,
    hash: plan.hash,
    network: 'Solana mainnet',
    chain: 'Solana',
    feeAsset: 'SOL',
    chainMark: 'solana',
    explorer: SOLSCAN,
    from: transfer.from,
    publicKey: `ed25519 · ${transfer.from}`,
    to: swap ? swap.recipient : transfer.to,
    toKind,
    toWhy: recipient.why,
    ...(recipient.file ? { toFile: recipient.file } : {}),
    amount: formatUnits(transfer.amount, transfer.decimals),
    amountYocto: transfer.amount.toString(),
    asset: transfer.symbol,
    maxFee: maxFee === null ? null : formatUnits(maxFee, 9),
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    // What can leave in SOL: the SOL sent and the fees, or just the fees for a token.
    maxTotal: maxFee === null ? null : formatUnits((native ? transfer.amount : 0n) + maxFee, 9),
    actions: [action],
    flow: { out: [{ token: solanaToken(transfer), amount: formatUnits(transfer.amount, transfer.decimals) }], via: swap ? 'intents' : 'direct', in: arrives },
    transactions: [solanaTransaction([action], maxFee === null ? null : formatUnits(maxFee, 9))],
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
  const payout = legs.at(-1)
  if (!payout || !recipient || plan.core.steps.length === 0 || plan.core.swap) return null
  const exact = (swap: PlanSwap) => swap.amountOut === swap.minAmountOut && /^[1-9][0-9]*$/.test(swap.amountOut) && /^[1-9][0-9]*$/.test(swap.amountIn)
  // The payout: last, out of the Intents balance to the recipient, the same token it moves, exactly.
  const payoutOk = payout.role === 'payout' && payout.payFrom === 'intents' && payout.recipient === recipient.address && payout.originAsset === payout.destinationAsset && exact(payout) && /^(0|[1-9][0-9]*)$/.test(payout.fromBalance ?? '0')
  // Each leg: exactly its part into the person's own Intents balance, as the token the payout moves.
  const before = legs.slice(0, -1)
  const legsOk = before.every((leg) => leg.role !== 'payout' && leg.getChain === 'intents' && leg.recipient === payout.refundTo && leg.destinationAsset === payout.originAsset && exact(leg))
  // Together with what the balance held already, the legs bring in exactly what the payout moves.
  const brought = before.reduce((sum, leg) => sum + BigInt(leg.amountOut), 0n) + BigInt(payout.fromBalance ?? '0')
  if (!payoutOk || !legsOk || brought !== BigInt(payout.amountIn)) return null

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
  /** Each step's own actions, as one transaction. */
  const stepActions: ReviewAction[][] = []
  for (const step of plan.core.steps) {
    try {
      if (step.chain === 'evm') {
        const transfer = evmTransferOfStep(step)
        const chain = evmChainById(transfer.chainId)
        if (!chain) return null
        const index = legs.findIndex((leg, i) => !paid.has(i) && leg.payFrom === 'evm' && leg.sendChainId === String(transfer.chainId) && leg.sendToken === transfer.token && leg.depositAddress.toLowerCase() === transfer.to.toLowerCase() && leg.amountIn === transfer.amount.toString() && leg.refundTo.toLowerCase() === transfer.from.toLowerCase() && leg.sendDecimals === String(transfer.decimals))
        if (!payOnce(index)) return null
        const action = evmAction(transfer, chain, evmToken(transfer, chain), 'deposit')
        actions.push(action)
        stepActions.push([action])
        chains.push({ name: chain.name, mark: chain.id, symbol: chain.symbol, explorer: explorerOf(chain) })
        if (!inPlace()) return null
      } else if (step.chain === 'solana') {
        const transfer = solanaTransferOfStep(step)
        const index = legs.findIndex((leg, i) => !paid.has(i) && leg.payFrom === 'solana' && leg.sendToken === transfer.token && leg.depositAddress === transfer.to && leg.amountIn === transfer.amount.toString() && leg.refundTo === transfer.from && leg.sendDecimals === String(transfer.decimals))
        if (!payOnce(index)) return null
        const action = solanaAction(transfer, 'NEAR Intents’ deposit address ')
        actions.push(action)
        stepActions.push([action])
        chains.push({ name: 'Solana', mark: 'solana', symbol: 'SOL', explorer: SOLSCAN })
        if (!inPlace()) return null
      } else {
        const read = callsOfStep(step)
        if (read.receiverId !== INTENTS_NEAR) return null
        const moves: ReviewAction[] = []
        for (const call of read.calls) {
          if (call.method !== 'mt_transfer') return null
          const index = legs.findIndex((leg, i) => !paid.has(i) && leg.payFrom === 'intents' && leg.depositAddress === call.receiverId && leg.originAsset === call.tokenId && leg.amountIn === call.amount.toString() && leg.refundTo === read.signerId)
          if (!payOnce(index)) return null
          const leg = legs[index] as PlanSwap
          const sent = swapSent(leg) ?? leg.sendSymbol
          const action = nearCallAction(call, read.receiverId, { amount: amountOf(sent), token: intentsToken(leg.sendSymbol, leg.originAsset) }, `Move ${sent} from your NEAR Intents balance to NEAR Intents’ deposit address ${call.receiverId}`)
          actions.push(action)
          moves.push(action)
        }
        stepActions.push(moves)
        chains.push({ name: 'NEAR', mark: 'near', symbol: 'NEAR', explorer: NEARBLOCKS })
        if (!inPlace()) return null
      }
    } catch (error) {
      if (error instanceof EvmDecodeError || error instanceof NearDecodeError || error instanceof SolanaDecodeError) return null
      throw error
    }
  }
  if (paid.size !== legs.length) return null

  const reviewLegs = before.map((leg) => {
    const chain = leg.payFrom === 'evm' ? evmChainById(Number(leg.sendChainId)) : null
    return {
      send: swapSent(leg) ?? leg.sendSymbol,
      from: leg.payFrom === 'evm' ? ('evm' as const) : leg.payFrom === 'solana' ? ('solana' as const) : ('intents' as const),
      fromPlace: chain ? chain.name : leg.payFrom === 'solana' ? 'Solana' : 'your NEAR Intents balance',
      get: tokenAmount(leg.amountOut, leg.getDecimals, leg.getSymbol) ?? leg.getSymbol,
      depositAddress: leg.depositAddress,
      refundTo: leg.refundTo,
      fee: `${(Number(leg.feeBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
      seconds: Number(leg.seconds),
    }
  })
  const total = BigInt(payout.amountOut)
  const last = chains.at(-1) as (typeof chains)[number]
  const fromBalance = BigInt(payout.fromBalance ?? '0')
  const feeText = (fee: bigint | null, symbol: string) => (fee === null ? null : formatUnits(fee, symbol === 'NEAR' ? 24 : symbol === 'SOL' ? 9 : 18))
  const transactions: ReviewTransaction[] = chains.map((chain, i) => ({
    chain: { mark: chain.mark, name: chain.name },
    key: chain.symbol === 'NEAR' || chain.symbol === 'SOL' ? 'ed25519' : 'secp256k1',
    // The last step is the payout's, which Ink sends only once every part has landed.
    when: i === chains.length - 1 ? 'later' : 'now',
    maxFee: feeText(stepFees[i] ?? null, chain.symbol),
    feeAsset: chain.symbol,
    actions: stepActions[i] ?? [],
  }))
  const payoutToken = intentsToken(payout.sendSymbol, payout.originAsset)
  const sources: ReviewPlan['flow']['out'] = [
    ...(fromBalance > 0n ? [{ token: payoutToken, amount: units(fromBalance.toString(), payout.getDecimals) ?? '0', brings: units(fromBalance.toString(), payout.getDecimals) ?? '0' }] : []),
    ...before.map((leg) => ({ token: swapSendToken(leg), amount: amountOf(swapSent(leg) ?? ` ${leg.sendSymbol}`), brings: units(leg.amountOut, leg.getDecimals) ?? '0' })),
  ]
  return {
    id: plan.id,
    kind: 'pay',
    swap: null,
    legs: reviewLegs,
    payout: {
      get: tokenAmount(payout.amountOut, payout.getDecimals, payout.getSymbol) ?? payout.getSymbol,
      fromBalance: fromBalance > 0n ? tokenAmount(fromBalance.toString(), payout.getDecimals, payout.getSymbol) : null,
      fee: `${(Number(payout.feeBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
      seconds: Number(payout.seconds),
    },
    payChain: { mark: inkChainOf(payout.getChain) ?? payout.getChain, name: chainName(payout.getChain) },
    stepFees: chains.map((chain, i) => {
      const fee = stepFees[i] ?? null
      return { chain: chain.name, feeAsset: chain.symbol, maxFee: feeText(fee, chain.symbol), maxFeeYocto: fee === null ? null : fee.toString() }
    }),
    hash: plan.hash,
    network: [...new Set(chains.map((chain) => `${chain.name} mainnet`))].join(' + '),
    chain: [...new Set(chains.map((chain) => chain.name))].join(' and '),
    feeAsset: last.symbol,
    chainMark: last.mark,
    explorer: last.explorer,
    from: legs.map((leg) => leg.refundTo).filter((address, i, all) => all.indexOf(address) === i).join(', '),
    publicKey: chains.map((chain) => (chain.symbol === 'NEAR' || chain.symbol === 'SOL' ? 'ed25519' : 'secp256k1')).filter((key, i, all) => all.indexOf(key) === i).join(' + '),
    to: recipient.address,
    toKind: 'other-chain',
    toWhy: recipient.why,
    ...(recipient.file ? { toFile: recipient.file } : {}),
    amount: formatUnits(total, Number(payout.getDecimals)),
    amountYocto: total.toString(),
    asset: payout.getSymbol,
    maxFee: null,
    maxFeeYocto: stepFees.every((fee) => fee !== null) && stepFees.length === chains.length ? '0' : null,
    maxTotal: null,
    actions,
    flow: { out: sources, via: 'intents', in: { token: swapGetToken(payout), amount: formatUnits(total, Number(payout.getDecimals)), exact: true, to: recipient.address } },
    transactions,
    expiresAt: plan.core.expiresAt,
  }
}
