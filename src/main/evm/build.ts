import type { Account } from '../../shared/accounts'
import { isEvmAddress } from '../../shared/addresses'
import { evmChainOf, type EvmChain } from '../../shared/evm/chains'
import { EvmDecodeError, evmTransferStep, MAX_GAS, MIN_GAS, type EvmTransfer } from '../../shared/evm/transaction'
import type { PlanFailure, PlanIntent, PlanStep } from '../../shared/plan'
import { parseUnits } from '../../shared/token-text'
import type { OneClickToken } from '../routes/one-click'
import { EvmRpcError, type EvmRpc } from './rpc'

/**
 * Fee caps for an EVM transaction, wei per unit of gas. The base fee can rise about 12% a
 * block, so review shows a ceiling at three times today's and the send caps at twice, which
 * leaves room to rise between the two without asking again. What isn't used comes back.
 */
export const REVIEW_BASE_FEE_MARGIN = 3n
export const SEND_BASE_FEE_MARGIN = 2n
/** Room over the gas estimate, since state can move before the transaction lands. */
const GAS_MARGIN_PERCENT = 120n
/** The size of an unsigned transfer, generously, for a rollup's L1 data fee. */
const UNSIGNED_TX_BYTES = 200

/** The caps a transaction is sent with now, and the most its fees could take at them. */
export async function evmSendFees(rpc: EvmRpc, gas: bigint, margin = SEND_BASE_FEE_MARGIN): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; ceiling: bigint }> {
  const [{ baseFee, tip }, l1] = await Promise.all([rpc.fees(), rpc.l1FeeUpperBound(UNSIGNED_TX_BYTES)])
  const maxFeePerGas = baseFee * margin + tip
  return { maxFeePerGas, maxPriorityFeePerGas: tip, ceiling: gas * maxFeePerGas + l1 }
}

/** The most a transfer's fees could take, as review shows it: at three times today's base fee. */
export const evmFeeCeiling = async (rpc: EvmRpc, gas: bigint): Promise<bigint> => (await evmSendFees(rpc, gas, REVIEW_BASE_FEE_MARGIN)).ceiling

/**
 * Whether the address covers the transfer and the most its fees could take: the coin for
 * both when it's the coin that's sent, else the token for the amount and the coin for the
 * fees. Before signing, `maxFee` is what the person saw when they approved, and a higher
 * ceiling now is `fee-rose`. Throws `EvmRpcError`.
 */
export async function evmSendFits(rpc: EvmRpc, transfer: EvmTransfer, fee: bigint, maxFee?: bigint): Promise<'insufficient-funds' | 'fee-rose' | null> {
  if (maxFee !== undefined && fee > maxFee) return 'fee-rose'
  const coin = await rpc.balance(transfer.from)
  if (transfer.token === 'native') return coin < transfer.amount + fee ? 'insufficient-funds' : null
  if (coin < fee) return 'insufficient-funds'
  return (await rpc.tokenBalance(transfer.token, transfer.from)) < transfer.amount ? 'insufficient-funds' : null
}

/** Whether the intent is a send on an EVM chain Ink sends on. */
export const isEvmSend = (intent: PlanIntent): boolean => intent.outcome === 'send' && evmChainOf(intent.chain) !== null

/**
 * The token an asset names on a chain: the chain's own coin, a contract address, or a
 * symbol 1Click lists there (USDC, USDT, WETH…). Its decimals and symbol are read from the
 * chain itself, and a symbol 1Click lists must agree with what the contract says.
 */
export async function evmTokenOf(asset: string, chain: EvmChain, rpc: EvmRpc, listed: readonly OneClickToken[] | null): Promise<{ token: 'native' | string; symbol: string; decimals: number } | { failure: PlanFailure }> {
  const word = asset.trim()
  if (word.toUpperCase() === chain.symbol.toUpperCase()) return { token: 'native', symbol: chain.symbol, decimals: 18 }
  let contract: string | null = null
  let symbol: string | null = null
  if (/^0x[0-9a-fA-F]{40}$/.test(word)) contract = word.toLowerCase()
  else {
    const found = (listed ?? []).filter((token) => token.blockchain === chain.oneClick && token.contract && token.symbol.toLowerCase() === word.toLowerCase())
    if (found.length !== 1) return { failure: found.length > 1 ? 'bad-request' : 'no-route' }
    contract = (found[0]?.contract as string).toLowerCase()
    symbol = found[0]?.symbol ?? null
  }
  if (!/^0x[0-9a-f]{40}$/.test(contract)) return { failure: 'bad-request' }
  try {
    const decimals = await rpc.decimals(contract)
    const listedToken = (listed ?? []).find((token) => token.blockchain === chain.oneClick && token.contract?.toLowerCase() === contract)
    if (listedToken && listedToken.decimals !== decimals) return { failure: 'chain-unavailable' }
    symbol ??= listedToken?.symbol ?? (await rpc.symbol(contract))
    if (!symbol) return { failure: 'bad-request' }
    return { token: contract, symbol, decimals }
  } catch (error) {
    if (error instanceof EvmRpcError) return { failure: error.reason === 'rejected' ? 'no-route' : 'chain-unavailable' }
    throw error
  }
}

export type EvmStepsResult = { ok: true; steps: PlanStep[] } | { ok: false; reason: PlanFailure }

/**
 * The step for sending a coin or token from the wallet's own EVM address. It checks what
 * the chain would refuse later, so a plan that can't go through is never made: the amount
 * is exact at the token's decimals, the recipient is an EVM address, the gas is estimated
 * with room to spare, and the balance covers the amount and the most the fees could take.
 */
export async function buildEvmSend(
  intent: PlanIntent,
  own: readonly Account[],
  { rpcFor, tokens }: { rpcFor: (chain: EvmChain) => EvmRpc; tokens: () => Promise<OneClickToken[] | null> },
): Promise<EvmStepsResult> {
  const chain = evmChainOf(intent.chain)
  const from = own.find((account) => account.chain === 'evm')?.address
  const to = intent.to ?? ''
  if (!chain || !from) return { ok: false, reason: 'chain-unavailable' }
  if (!isEvmAddress(to)) return { ok: false, reason: 'bad-address' }
  const rpc = rpcFor(chain)
  const token = await evmTokenOf(intent.asset, chain, rpc, await tokens().catch(() => null))
  if ('failure' in token) return { ok: false, reason: token.failure }
  const amount = parseUnits(intent.amount, token.decimals)
  if (amount === null || amount === 0n) return { ok: false, reason: 'bad-request' }

  return buildEvmTransfer(rpc, { chainId: chain.chainId, from, to, ...token, amount })
}

/**
 * The step for one transfer from the wallet's own EVM address, once its token and amount
 * are settled: the gas estimated with room to spare, and the balance checked against the
 * amount and the most the fees could take. Shared by sends and by swaps paid on an EVM chain.
 */
export async function buildEvmTransfer(rpc: EvmRpc, transfer: Omit<EvmTransfer, 'gas'>): Promise<EvmStepsResult> {
  const { from, to, token, amount } = transfer
  try {
    const estimate = token === 'native' ? await rpc.estimateGas({ from, to, value: amount }) : await rpc.estimateGas({ from, to: token, data: transferData(to, amount) })
    const padded = (estimate * GAS_MARGIN_PERCENT) / 100n
    const gas = padded < MIN_GAS ? MIN_GAS : padded
    if (gas > MAX_GAS) return { ok: false, reason: 'no-route' }
    const full: EvmTransfer = { ...transfer, gas }
    const { ceiling } = await evmSendFees(rpc, gas)
    const unfit = await evmSendFits(rpc, full, ceiling)
    if (unfit) return { ok: false, reason: 'insufficient-funds' }
    return { ok: true, steps: [evmTransferStep(full)] }
  } catch (error) {
    // A transfer the chain says would revert is, almost always, one the balance can't cover.
    if (error instanceof EvmRpcError) return { ok: false, reason: error.reason === 'rejected' ? 'insufficient-funds' : 'chain-unavailable' }
    if (error instanceof EvmDecodeError) return { ok: false, reason: 'bad-request' }
    throw error
  }
}

/** ERC-20 `transfer(to, amount)`, for estimating its gas. */
export function transferData(to: string, amount: bigint): Uint8Array {
  const hex = `a9059cbb${to.toLowerCase().slice(2).padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`
  return Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)))
}
