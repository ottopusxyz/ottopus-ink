import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import { transferOfStep } from '../../shared/near/transaction'
import type { PlanIntent } from '../../shared/plan'
import { STORAGE_YOCTO_PER_BYTE } from './balance'
import { buildNearSend, isNearSend, transferFeeCeiling } from './build'
import { NearRpcError, type NearAccountView, type NearProtocolFees, type NearRpc } from './rpc'

const NEAR = 10n ** 24n
const GAS_PRICE = 100_000_000n
/** Mainnet's fees under protocol 88, as its protocol config gave them on 9 Nov 2026 (see rpc.test.ts). */
const FEES: NearProtocolFees = {
  minGasPurchasePrice: 1_000_000_000n,
  accountCreationCharge: 7_000_000_000_000_000_000_000n,
  receipt: { send: 108_059_500_000n, exec: 108_059_500_000n },
  transfer: { send: 115_123_062_500n, exec: 115_123_062_500n },
  createAccount: { send: 500_000_000_000n, exec: 7_200_000_000_000n },
  addFullAccessKey: { send: 101_765_125_000n, exec: 101_765_125_000n },
}
/**
 * Worked out by hand: 0.446365125 Tgas to an existing account, and 8.349895375 Tgas
 * when the transfer creates one, at twice the 10^9 receipt price, plus 0.007 NEAR
 * to create an account. About 0.0009 NEAR and 0.0237 NEAR.
 */
const FEE = 892_730_250_000_000_000_000n
const NEW_ACCOUNT_FEE = 23_699_790_750_000_000_000_000n
/** Public key and implicit id from the BIP-32 test seed (src/signer/accounts.test.ts). */
const FROM = '06b66cee83c72cf7462ac756b159664732607df5bf254e589426b7e4b4f9d60d'
const OWN: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: FROM }]
const SEND: PlanIntent = { outcome: 'send', asset: 'NEAR', amount: '1.5', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }

function fakeRpc(accounts: Record<string, NearAccountView>, { down = false } = {}) {
  const asked: string[] = []
  const rpc = {
    viewAccount: async (id: string) => {
      asked.push(id)
      if (down) throw new NearRpcError('unavailable', 'down')
      return accounts[id] ?? null
    },
    gasPrice: async () => GAS_PRICE,
    protocolFees: async () => FEES,
  } as unknown as NearRpc
  return { rpc, asked }
}

const funded = (amount: bigint, storageUsage = 0n): NearAccountView => ({ amount, locked: 0n, storageUsage })
const ALICE = { 'alice.near': funded(NEAR) }

describe('building a NEAR send', () => {
  it('handles only native NEAR sent on NEAR', () => {
    expect(isNearSend(SEND)).toBe(true)
    expect(isNearSend({ ...SEND, chain: 'NEAR', asset: 'near' })).toBe(true)
    expect(isNearSend({ ...SEND, asset: 'USDC' })).toBe(false)
    expect(isNearSend({ ...SEND, chain: 'base' })).toBe(false)
    expect(isNearSend({ ...SEND, chain: null })).toBe(false)
    expect(isNearSend({ ...SEND, outcome: 'stake' })).toBe(false)
  })

  it('makes one transfer step from the person’s implicit account, with the exact deposit', async () => {
    const { rpc } = fakeRpc({ [FROM]: funded(5n * NEAR), ...ALICE })
    const built = await buildNearSend(SEND, OWN, rpc)
    if (!built.ok) throw new Error(built.reason)
    expect(built.steps).toEqual([
      {
        chain: 'near',
        action: 'transfer',
        fields: { signerId: FROM, publicKey: 'ed25519:TCnVAvGfFG1gCaiPDLFq4wMUzPctRXzMXrKjYQ8QTrc', receiverId: 'alice.near', deposit: '1500000000000000000000000' },
      },
    ])
    // The step reads back as the transfer it describes.
    const transfer = transferOfStep(built.steps[0]!, { nonce: 1n, blockHash: new Uint8Array(32) })
    expect(transfer.deposit).toBe(1_500_000_000_000_000_000_000_000n)
  })

  it('sends to an implicit account that doesn’t exist yet, since the transfer creates it', async () => {
    const { rpc } = fakeRpc({ [FROM]: funded(5n * NEAR) })
    expect((await buildNearSend({ ...SEND, to: 'b'.repeat(64) }, OWN, rpc)).ok).toBe(true)
    expect((await buildNearSend({ ...SEND, to: `0x${'c'.repeat(40)}` }, OWN, rpc)).ok).toBe(true)
  })

  it('counts what creating a new implicit account costs, and only when it doesn’t exist yet', async () => {
    const to = 'b'.repeat(64)
    const exact = 1_500_000_000_000_000_000_000_000n + NEW_ACCOUNT_FEE
    expect((await buildNearSend({ ...SEND, to }, OWN, fakeRpc({ [FROM]: funded(exact) }).rpc)).ok).toBe(true)
    expect(await buildNearSend({ ...SEND, to }, OWN, fakeRpc({ [FROM]: funded(exact - 1n) }).rpc)).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await buildNearSend({ ...SEND, to: `0x${'c'.repeat(40)}` }, OWN, fakeRpc({ [FROM]: funded(exact - 1n) }).rpc)).toEqual({ ok: false, reason: 'insufficient-funds' })
    // Once it exists, sending to it costs what any transfer does.
    expect((await buildNearSend({ ...SEND, to }, OWN, fakeRpc({ [FROM]: funded(exact - 1n), [to]: funded(1n) }).rpc)).ok).toBe(true)
    // What Codex found the old 2 Tgas ceiling let through: 1.0002 NEAR to send 1 NEAR to a new account.
    expect(await buildNearSend({ ...SEND, amount: '1', to }, OWN, fakeRpc({ [FROM]: funded(1_000_200_000_000_000_000_000_000n) }).rpc)).toEqual({ ok: false, reason: 'insufficient-funds' })
  })

  it('prices gas at the higher of the gas price and the price receipts are bought at', () => {
    expect(transferFeeCeiling(FEES, GAS_PRICE, false)).toBe(FEE)
    expect(transferFeeCeiling(FEES, FEES.minGasPurchasePrice, false)).toBe(FEE)
    expect(transferFeeCeiling(FEES, 3n * FEES.minGasPurchasePrice, false)).toBe(3n * FEE)
    expect(transferFeeCeiling(FEES, GAS_PRICE, true)).toBe(NEW_ACCOUNT_FEE)
  })

  it('refuses a named account that doesn’t exist, which no transfer can create', async () => {
    const { rpc } = fakeRpc({ [FROM]: funded(5n * NEAR) })
    expect(await buildNearSend({ ...SEND, to: 'nobody.near' }, OWN, rpc)).toEqual({ ok: false, reason: 'recipient-unknown' })
  })

  it('refuses when the balance can’t cover the amount and the most the gas could cost', async () => {
    const exact = 1_500_000_000_000_000_000_000_000n + FEE
    expect((await buildNearSend(SEND, OWN, fakeRpc({ [FROM]: funded(exact), ...ALICE }).rpc)).ok).toBe(true)
    expect(await buildNearSend(SEND, OWN, fakeRpc({ [FROM]: funded(exact - 1n), ...ALICE }).rpc)).toEqual({ ok: false, reason: 'insufficient-funds' })
  })

  it('counts what storage holds back as not there to send', async () => {
    const exact = 1_500_000_000_000_000_000_000_000n + FEE + 2_000n * STORAGE_YOCTO_PER_BYTE
    expect((await buildNearSend(SEND, OWN, fakeRpc({ [FROM]: funded(exact, 2_000n), ...ALICE }).rpc)).ok).toBe(true)
    expect((await buildNearSend(SEND, OWN, fakeRpc({ [FROM]: funded(exact - 1n, 2_000n), ...ALICE }).rpc)).ok).toBe(false)
  })

  it('refuses from an account nothing was sent to yet, which has no NEAR', async () => {
    expect(await buildNearSend(SEND, OWN, fakeRpc(ALICE).rpc)).toEqual({ ok: false, reason: 'insufficient-funds' })
  })

  it('refuses an amount NEAR can’t send exactly, or a recipient that isn’t a NEAR account id', async () => {
    const { rpc, asked } = fakeRpc({ [FROM]: funded(5n * NEAR), ...ALICE })
    for (const change of [{ amount: '0.0000000000000000000000001' }, { amount: '0' }, { to: 'Alice.near' }, { to: '0x1111111111111111111111111111111111111111'.toUpperCase() }]) {
      expect(await buildNearSend({ ...SEND, ...change }, OWN, rpc)).toEqual({ ok: false, reason: 'bad-request' })
    }
    expect(asked).toEqual([])
  })

  it('says the chain is unavailable when NEAR can’t be reached, or there’s no NEAR account', async () => {
    expect(await buildNearSend(SEND, OWN, fakeRpc({}, { down: true }).rpc)).toEqual({ ok: false, reason: 'chain-unavailable' })
    expect(await buildNearSend(SEND, [], fakeRpc(ALICE).rpc)).toEqual({ ok: false, reason: 'chain-unavailable' })
  })
})
