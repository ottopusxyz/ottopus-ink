import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import { transferOfStep } from '../../shared/near/transaction'
import type { PlanIntent } from '../../shared/plan'
import { STORAGE_YOCTO_PER_BYTE } from './balance'
import { buildNearSend, isNearSend, TRANSFER_GAS_CEILING } from './build'
import { NearRpcError, type NearAccountView, type NearRpc } from './rpc'

const NEAR = 10n ** 24n
const GAS_PRICE = 100_000_000n
const FEE = GAS_PRICE * TRANSFER_GAS_CEILING
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
