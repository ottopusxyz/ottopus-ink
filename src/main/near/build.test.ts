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
  receipt: { send: 108_059_500_000n, exec: 108_059_500_000n },
  transfer: { send: 115_123_062_500n, exec: 115_123_062_500n },
  createAccount: { send: 500_000_000_000n, exec: 7_200_000_000_000n },
  addFullAccessKey: { send: 101_765_125_000n, exec: 101_765_125_000n },
}
/**
 * Worked out by hand from FEES, at twice the 10^8 gas price for send fees and
 * the 10^9 receipt price for exec fees:
 * - named: send 0.223182562500 Tgas, exec 0.223182562500 Tgas;
 * - Ethereum implicit: send 0.723182562500 Tgas, exec 7.423182562500 Tgas (creating the account);
 * - NEAR implicit: send 0.824947687500 Tgas, exec 7.524947687500 Tgas (creating it and its key).
 * About 0.00027, 0.0076 and 0.0077 NEAR.
 */
const FEE = 267_819_075_000_000_000_000n
const ETH_IMPLICIT_FEE = 7_567_819_075_000_000_000_000n
const IMPLICIT_FEE = 7_689_937_225_000_000_000_000n
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
    const { rpc, asked } = fakeRpc({ [FROM]: funded(5n * NEAR) })
    const to = 'b'.repeat(64)
    expect((await buildNearSend({ ...SEND, to }, OWN, rpc)).ok).toBe(true)
    expect(asked).not.toContain(to)
    expect((await buildNearSend({ ...SEND, to: `0x${'c'.repeat(40)}` }, OWN, rpc)).ok).toBe(true)
  })

  it('counts what a transfer to an implicit account pays up front, whether or not the account exists', async () => {
    const amount = 1_500_000_000_000_000_000_000_000n
    const near = 'b'.repeat(64)
    const eth = `0x${'c'.repeat(40)}`
    for (const [to, fee] of [[near, IMPLICIT_FEE], [eth, ETH_IMPLICIT_FEE]] as const) {
      for (const accounts of [{}, { [to]: funded(NEAR) }]) {
        expect((await buildNearSend({ ...SEND, to }, OWN, fakeRpc({ [FROM]: funded(amount + fee), ...accounts }).rpc)).ok).toBe(true)
        expect(await buildNearSend({ ...SEND, to }, OWN, fakeRpc({ [FROM]: funded(amount + fee - 1n), ...accounts }).rpc)).toEqual({ ok: false, reason: 'insufficient-funds' })
      }
    }
    // What Codex found the first fix let through: 1 NEAR from 1.001 NEAR to an implicit account that already exists.
    const sender = { [FROM]: funded(1_001_000_000_000_000_000_000_000n, 182n), [near]: funded(NEAR) }
    expect(await buildNearSend({ ...SEND, amount: '1', to: near }, OWN, fakeRpc(sender).rpc)).toEqual({ ok: false, reason: 'insufficient-funds' })
    // And what the old 2 Tgas ceiling let through: 1.0002 NEAR to send 1 NEAR.
    expect(await buildNearSend({ ...SEND, amount: '1', to: near }, OWN, fakeRpc({ [FROM]: funded(1_000_200_000_000_000_000_000_000n) }).rpc)).toEqual({ ok: false, reason: 'insufficient-funds' })
  })

  it('burns send fees at the gas price and buys exec fees at no less than the receipt price, with room for the price to double', () => {
    expect(transferFeeCeiling(FEES, GAS_PRICE, 'named')).toBe(FEE)
    expect(transferFeeCeiling(FEES, GAS_PRICE, 'eth-implicit')).toBe(ETH_IMPLICIT_FEE)
    expect(transferFeeCeiling(FEES, GAS_PRICE, 'implicit')).toBe(IMPLICIT_FEE)
    // Once twice the gas price passes the receipt price, everything is bought at twice the gas price.
    const named = FEES.receipt.send + FEES.receipt.exec + FEES.transfer.send + FEES.transfer.exec
    expect(transferFeeCeiling(FEES, FEES.minGasPurchasePrice, 'named')).toBe(named * 2n * FEES.minGasPurchasePrice)
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
