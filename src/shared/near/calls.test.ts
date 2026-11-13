import { describe, expect, it } from 'vitest'
import type { PlanStep } from '../plan'
import {
  actionsOfCalls,
  callsDeposit,
  callsGas,
  callsOfStep,
  callsOfTransaction,
  describeCall,
  nearCallStep,
  sameCalls,
  WRAP_STORAGE_DEPOSIT,
  type NearCall,
} from './calls'
import { decodeTransaction, encodeTransaction, NearDecodeError, nearPublicKey, type NearTransaction } from './transaction'

const SIGNER = 'a'.repeat(64)
const KEY = nearPublicKey(new Uint8Array(32).fill(7))
const DEPOSIT_ADDRESS = 'b'.repeat(64)
const NEAR = (amount: bigint) => amount * 10n ** 24n

/** What 1Click's deposit from NEAR needs: register its address, wrap, and send it the wNEAR. */
const SWAP_DEPOSIT: NearCall[] = [
  { method: 'storage_deposit', accountId: DEPOSIT_ADDRESS },
  { method: 'near_deposit', amount: NEAR(5n) },
  { method: 'ft_transfer', receiverId: DEPOSIT_ADDRESS, amount: NEAR(5n) },
]

const step = (receiverId: string, calls: NearCall[]) => nearCallStep({ signerId: SIGNER, publicKey: KEY, receiverId, calls })
const transactionOf = (receiverId: string, calls: NearCall[]): NearTransaction => ({
  signerId: SIGNER,
  publicKey: new Uint8Array(32).fill(7),
  nonce: 5n,
  receiverId,
  blockHash: new Uint8Array(32),
  actions: actionsOfCalls(calls),
})

describe('the calls Ink signs', () => {
  it('builds each call’s arguments, gas and deposit itself', () => {
    const decoder = new TextDecoder()
    expect(actionsOfCalls(SWAP_DEPOSIT).map((action) => (action.kind === 'FunctionCall' ? { method: action.methodName, args: decoder.decode(action.args), gas: action.gas, deposit: action.deposit } : null))).toEqual([
      { method: 'storage_deposit', args: `{"account_id":"${DEPOSIT_ADDRESS}","registration_only":true}`, gas: 10n ** 13n, deposit: WRAP_STORAGE_DEPOSIT },
      { method: 'near_deposit', args: '{}', gas: 10n ** 13n, deposit: NEAR(5n) },
      { method: 'ft_transfer', args: `{"receiver_id":"${DEPOSIT_ADDRESS}","amount":"5000000000000000000000000"}`, gas: 3n * 10n ** 13n, deposit: 1n },
    ])
    expect(callsDeposit(SWAP_DEPOSIT)).toBe(WRAP_STORAGE_DEPOSIT + NEAR(5n) + 1n)
    expect(callsGas(SWAP_DEPOSIT)).toBe(5n * 10n ** 13n)
  })

  it('writes Intents and staking calls as their contracts read them', () => {
    const decoder = new TextDecoder()
    const args = (calls: NearCall[]) => actionsOfCalls(calls).map((action) => (action.kind === 'FunctionCall' ? decoder.decode(action.args) : ''))
    expect(args([{ method: 'mt_transfer', receiverId: DEPOSIT_ADDRESS, tokenId: 'nep141:wrap.near', amount: 7n }])).toEqual([`{"receiver_id":"${DEPOSIT_ADDRESS}","token_id":"nep141:wrap.near","amount":"7"}`])
    expect(args([{ method: 'ft_withdraw', token: 'wrap.near', receiverId: SIGNER, amount: 7n }])).toEqual([`{"token":"wrap.near","receiver_id":"${SIGNER}","amount":"7"}`])
    expect(args([{ method: 'deposit_and_stake', amount: NEAR(1n) }])).toEqual(['{}'])
  })

  it('keeps a step as strings, and reads it back to the same calls', () => {
    const made = step('wrap.near', SWAP_DEPOSIT)
    expect(Object.values(made.fields).every((value) => typeof value === 'string')).toBe(true)
    const read = callsOfStep(made)
    expect(read).toMatchObject({ signerId: SIGNER, receiverId: 'wrap.near', calls: SWAP_DEPOSIT })
    expect(sameCalls(read.calls, SWAP_DEPOSIT)).toBe(true)
  })

  it('reads a transaction’s calls back from its bytes alone', () => {
    const bytes = encodeTransaction(transactionOf('wrap.near', SWAP_DEPOSIT))
    expect(callsOfTransaction(decodeTransaction(bytes))).toEqual(SWAP_DEPOSIT)
    const intents: NearCall[] = [{ method: 'mt_transfer', receiverId: DEPOSIT_ADDRESS, tokenId: 'nep245:v2_1.omni.hot.tg:56_usdc', amount: 10n }]
    expect(callsOfTransaction(decodeTransaction(encodeTransaction(transactionOf('intents.near', intents))))).toEqual(intents)
    const stake: NearCall[] = [{ method: 'deposit_and_stake', amount: NEAR(3n) }]
    expect(callsOfTransaction(decodeTransaction(encodeTransaction(transactionOf('astro-stakers.poolv1.near', stake))))).toEqual(stake)
  })

  it('says what each call does in plain words', () => {
    expect(SWAP_DEPOSIT.map((call) => describeCall(call, 'wrap.near'))).toEqual([
      `Register ${DEPOSIT_ADDRESS} with wNEAR, paying 0.00125 NEAR for its storage`,
      'Wrap 5 NEAR into wNEAR',
      `Send 5 wNEAR to ${DEPOSIT_ADDRESS}`,
    ])
    expect(describeCall({ method: 'deposit_and_stake', amount: NEAR(2n) }, 'astro-stakers.poolv1.near')).toBe('Stake 2 NEAR with astro-stakers.poolv1.near')
    expect(describeCall({ method: 'near_withdraw', amount: NEAR(1n) / 2n }, 'wrap.near')).toBe('Unwrap 0.5 wNEAR back into NEAR')
    expect(describeCall({ method: 'mt_transfer', receiverId: 'x.near', tokenId: 'nep141:wrap.near', amount: 9n }, 'intents.near')).toBe(
      'Move 9 (in its smallest unit) of nep141:wrap.near from your NEAR Intents balance to x.near',
    )
  })
})

describe('refusing calls off the list', () => {
  const refuseStep = (made: PlanStep) => expect(() => callsOfStep(made)).toThrow(NearDecodeError)
  const raw = (receiverId: string, calls: unknown, extra: Record<string, string> = {}): PlanStep => ({
    chain: 'near',
    action: 'call',
    fields: { signerId: SIGNER, publicKey: KEY, receiverId, calls: typeof calls === 'string' ? calls : JSON.stringify(calls), ...extra },
  })

  it('refuses a method to the wrong contract, and a pool that isn’t one', () => {
    expect(() => step('intents.near', SWAP_DEPOSIT)).toThrow(NearDecodeError)
    expect(() => step('mallory.near', [{ method: 'ft_transfer', receiverId: 'x.near', amount: 1n }])).toThrow(NearDecodeError)
    expect(() => step('wrap.near', [{ method: 'mt_transfer', receiverId: 'x.near', tokenId: 'nep141:wrap.near', amount: 1n }])).toThrow(NearDecodeError)
    for (const pool of ['mallory.near', 'poolv1.near', 'evil.poolv1.near.mallory.near', 'x.poolv2.near']) expect(() => step(pool, [{ method: 'deposit_and_stake', amount: 1n }])).toThrow(NearDecodeError)
  })

  it('refuses a method not on the list, or any field it doesn’t take', () => {
    refuseStep(raw('wrap.near', [{ method: 'ft_transfer_call', receiverId: 'x.near', amount: '1' }]))
    refuseStep(raw('wrap.near', [{ method: 'storage_withdraw' }]))
    refuseStep(raw('wrap.near', [{ method: 'ft_transfer', receiverId: 'x.near', amount: '1', memo: 'hi' }]))
    refuseStep(raw('wrap.near', [{ method: 'ft_transfer', receiverId: 'x.near' }]))
    refuseStep(raw('wrap.near', [{ method: 'ft_transfer', receiverId: 'x.near', amount: '1' }], { gas: '1' }))
  })

  it('refuses amounts that aren’t whole and above zero, ids that aren’t ids, and lists of the wrong length', () => {
    for (const amount of ['0', '-1', '1.5', '01', '1e3', String(1n << 128n), 5]) refuseStep(raw('wrap.near', [{ method: 'near_deposit', amount }]))
    refuseStep(raw('wrap.near', [{ method: 'ft_transfer', receiverId: 'Mallory.near', amount: '1' }]))
    refuseStep(raw('intents.near', [{ method: 'mt_transfer', receiverId: 'x.near', tokenId: 'nep171:nft.near:1', amount: '1' }]))
    refuseStep(raw('wrap.near', []))
    refuseStep(raw('wrap.near', Array.from({ length: 5 }, () => ({ method: 'near_deposit', amount: '1' }))))
    refuseStep(raw('wrap.near', 'not json'))
    refuseStep(raw('wrap.near', { method: 'near_deposit', amount: '1' }))
  })

  it('refuses calls that need more gas than one transaction attaches', () => {
    expect(() => step('intents.near', Array.from({ length: 4 }, () => ({ method: 'ft_withdraw' as const, token: 'wrap.near', receiverId: 'x.near', amount: 1n })))).toThrow(NearDecodeError)
  })

  it('refuses a step written any way but Ink’s own, so two that read the same can’t hash differently', () => {
    const made = step('wrap.near', SWAP_DEPOSIT)
    refuseStep({ ...made, fields: { ...made.fields, calls: made.fields.calls!.replace('[', '[ ') } })
    const reordered = JSON.stringify([{ amount: '5', method: 'near_deposit' }])
    refuseStep(raw('wrap.near', reordered))
  })

  it('refuses another step kind', () => {
    const made = step('wrap.near', SWAP_DEPOSIT)
    refuseStep({ ...made, action: 'transfer' })
    refuseStep({ ...made, chain: 'evm' })
  })

  it('reads back only arguments, gas and deposits exactly as Ink writes them', () => {
    const tamper = (change: (action: Extract<NearTransaction['actions'][number], { kind: 'FunctionCall' }>) => void, receiverId = 'wrap.near', calls = SWAP_DEPOSIT) => {
      const transaction = transactionOf(receiverId, calls)
      change(transaction.actions[2] as Extract<NearTransaction['actions'][number], { kind: 'FunctionCall' }>)
      expect(() => callsOfTransaction(transaction)).toThrow(NearDecodeError)
    }
    const encode = (text: string) => new TextEncoder().encode(text)
    tamper((action) => (action.deposit = 2n))
    tamper((action) => (action.gas = 299n * 10n ** 12n))
    tamper((action) => (action.args = encode(`{"amount":"5000000000000000000000000","receiver_id":"${DEPOSIT_ADDRESS}"}`)))
    tamper((action) => (action.args = encode(`{"receiver_id":"${DEPOSIT_ADDRESS}","amount":"5000000000000000000000000","memo":"x"}`)))
    tamper((action) => (action.args = encode(`{"receiver_id":"${DEPOSIT_ADDRESS}", "amount":"5000000000000000000000000"}`)))
    tamper((action) => (action.methodName = 'ft_transfer_call'))
    tamper((action) => (action.args = new Uint8Array([0xff])))
    // A transfer is never read as a call.
    const withTransfer = transactionOf('wrap.near', SWAP_DEPOSIT.slice(0, 1))
    withTransfer.actions = [{ kind: 'Transfer', deposit: 1n }]
    expect(() => callsOfTransaction(withTransfer)).toThrow(NearDecodeError)
    // Calls to a contract they aren't for.
    expect(() => callsOfTransaction(transactionOf('mallory.near', SWAP_DEPOSIT))).toThrow(NearDecodeError)
  })
})
