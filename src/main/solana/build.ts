import type { Account } from '../../shared/accounts'
import { isSolanaAddress } from '../../shared/addresses'
import type { PlanFailure, PlanIntent, PlanStep } from '../../shared/plan'
import { ACCOUNT_RENT, associatedTokenAccount, mintDecimals, SolanaDecodeError, solanaFee, solanaTransferStep, TOKEN_PROGRAM, tokenAccountAmount, type SolanaTransfer } from '../../shared/solana/transaction'
import { parseUnits } from '../../shared/token-text'
import type { OneClickToken } from '../routes/one-click'
import { SolanaRpcError, type SolanaRpc } from './rpc'

/** 1Click's name for Solana. */
export const SOLANA_ONE_CLICK = 'sol'

/** Whether the intent is a send on Solana. */
export const isSolanaSend = (intent: PlanIntent): boolean => intent.outcome === 'send' && ['solana', 'sol'].includes((intent.chain ?? '').trim().toLowerCase())

/** The most the transfer's fees could take now, in lamports: with the recipient's token account's rent while it has none. Throws `SolanaRpcError`. */
export async function solanaFeeNow(rpc: SolanaRpc, transfer: SolanaTransfer): Promise<bigint> {
  if (transfer.token === 'native') return solanaFee(transfer, false)
  return solanaFee(transfer, (await rpc.account(associatedTokenAccount(transfer.to, transfer.token))) === null)
}

/**
 * Whether the address covers the transfer and its fees: SOL for both when SOL is sent,
 * else the token for the amount and SOL for the fees. What's left in SOL must be nothing
 * or enough to keep the account open, or the chain refuses it. Before signing, `maxFee` is
 * what the person saw when they approved, and a higher fee now is `fee-rose`. Throws `SolanaRpcError`.
 */
export async function solanaSendFits(rpc: SolanaRpc, transfer: SolanaTransfer, fee: bigint, maxFee?: bigint): Promise<'insufficient-funds' | 'fee-rose' | null> {
  if (maxFee !== undefined && fee > maxFee) return 'fee-rose'
  const lamports = await rpc.balance(transfer.from)
  const spent = fee + (transfer.token === 'native' ? transfer.amount : 0n)
  const left = lamports - spent
  if (left < 0n || (left > 0n && left < ACCOUNT_RENT)) return 'insufficient-funds'
  if (transfer.token === 'native') return null
  const source = await rpc.account(associatedTokenAccount(transfer.from, transfer.token))
  const held = source && source.owner === TOKEN_PROGRAM ? tokenAccountAmount(source.data) : null
  return held === null || held < transfer.amount ? 'insufficient-funds' : null
}

/**
 * The token an asset names on Solana: SOL, a mint address, or a symbol 1Click lists there
 * (USDC, USDT…). Its decimals are read from the mint itself, which must belong to the
 * original SPL Token program, and a symbol 1Click lists must agree with them.
 */
export async function solanaTokenOf(asset: string, rpc: SolanaRpc, listed: readonly OneClickToken[] | null): Promise<{ token: 'native' | string; symbol: string; decimals: number } | { failure: PlanFailure }> {
  const word = asset.trim()
  if (word.toUpperCase() === 'SOL') return { token: 'native', symbol: 'SOL', decimals: 9 }
  const onSolana = (listed ?? []).filter((token) => token.blockchain === SOLANA_ONE_CLICK && token.contract)
  let mint: string | null = null
  if (isSolanaAddress(word)) mint = word
  else {
    const found = onSolana.filter((token) => token.symbol.toLowerCase() === word.toLowerCase())
    if (found.length !== 1) return { failure: found.length > 1 ? 'bad-request' : 'no-route' }
    mint = found[0]?.contract ?? null
  }
  if (!mint || !isSolanaAddress(mint)) return { failure: 'bad-request' }
  const listedToken = onSolana.find((token) => token.contract === mint)
  // Review shows a symbol, so only a token 1Click names can be sent by its mint.
  if (!listedToken) return { failure: 'no-route' }
  try {
    const account = await rpc.account(mint)
    const decimals = account && account.owner === TOKEN_PROGRAM ? mintDecimals(account.data) : null
    // A Token-2022 mint, or not a mint at all: Ink doesn't send those.
    if (decimals === null) return { failure: 'no-route' }
    if (listedToken.decimals !== decimals) return { failure: 'chain-unavailable' }
    return { token: mint, symbol: listedToken.symbol, decimals }
  } catch (error) {
    if (error instanceof SolanaRpcError) return { failure: 'chain-unavailable' }
    throw error
  }
}

export type SolanaStepsResult = { ok: true; steps: PlanStep[] } | { ok: false; reason: PlanFailure }

/**
 * The step for one transfer from the wallet's own Solana address, once its token and
 * amount are settled. It checks what the chain would refuse later: the recipient is a
 * wallet, not a token account; SOL sent to a new account is enough to open it; and the
 * balance covers the amount and the fees. Shared by sends and by swaps paid on Solana.
 */
export async function buildSolanaTransfer(rpc: SolanaRpc, transfer: SolanaTransfer): Promise<SolanaStepsResult> {
  try {
    const recipient = await rpc.account(transfer.to)
    // A token account as the recipient would get a token account of its own, which nobody could spend from.
    if (recipient && recipient.owner === TOKEN_PROGRAM) return { ok: false, reason: 'bad-address' }
    if (transfer.token === 'native' && !recipient && transfer.amount < ACCOUNT_RENT) return { ok: false, reason: 'bad-request' }
    const fee = await solanaFeeNow(rpc, transfer)
    if (await solanaSendFits(rpc, transfer, fee)) return { ok: false, reason: 'insufficient-funds' }
    return { ok: true, steps: [solanaTransferStep(transfer)] }
  } catch (error) {
    if (error instanceof SolanaRpcError) return { ok: false, reason: 'chain-unavailable' }
    if (error instanceof SolanaDecodeError) return { ok: false, reason: 'bad-request' }
    throw error
  }
}

/** The step for sending SOL or a token from the wallet's own Solana address. */
export async function buildSolanaSend(intent: PlanIntent, own: readonly Account[], { rpc, tokens }: { rpc: SolanaRpc; tokens: () => Promise<OneClickToken[] | null> }): Promise<SolanaStepsResult> {
  const from = own.find((account) => account.chain === 'solana')?.address
  const to = intent.to ?? ''
  if (!from) return { ok: false, reason: 'chain-unavailable' }
  if (!isSolanaAddress(to) || to === from) return { ok: false, reason: 'bad-address' }
  const token = await solanaTokenOf(intent.asset, rpc, await tokens().catch(() => null))
  if ('failure' in token) return { ok: false, reason: token.failure }
  const amount = parseUnits(intent.amount, token.decimals)
  if (amount === null || amount === 0n) return { ok: false, reason: 'bad-request' }
  return buildSolanaTransfer(rpc, { from, to, ...token, amount })
}
