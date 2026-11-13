import { describe, expect, it } from 'vitest'
import type { ReviewState } from '../../../shared/review'
import { ACCOUNT_KIND, approveLabel, canApprove, failureText, groupAddress, outcomeOf, sendSteps, shortHash, timeLeft } from './review-copy'

const STATE: ReviewState = {
  plan: {
    id: 'p',
    hash: 'a'.repeat(64),
    network: 'NEAR mainnet',
    kind: 'send',
    swap: null,
    from: 'b'.repeat(64),
    publicKey: 'ed25519:x',
    to: 'alice.near',
    toKind: 'named',
    chain: 'NEAR',
    feeAsset: 'NEAR',
    toWhy: 'typed',
    amount: '1',
    amountYocto: '1000000000000000000000000',
    asset: 'NEAR',
    maxFee: '0.0003',
    maxFeeYocto: '300000000000000000000',
    maxTotal: '1.0003',
    actions: [{ kind: 'Transfer', amount: '1', method: null, summary: 'Send 1 NEAR to alice.near' }],
    expiresAt: '2026-11-09T12:30:00.000Z',
  },
  status: 'awaiting_review',
  armed: true,
  unlocked: true,
  sending: false,
  failure: null,
  transactionId: null,
  waiting: 0,
}

describe('showing an address', () => {
  it('splits a NEAR implicit account into groups of 8, keeping every character', () => {
    const id = '0123456789abcdef'.repeat(4)
    expect(groupAddress(id)).toEqual(['01234567', '89abcdef', '01234567', '89abcdef', '01234567', '89abcdef', '01234567', '89abcdef'])
    expect(groupAddress(id).join('')).toBe(id)
  })

  it('groups a checksummed EVM address too, keeping its case', () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    expect(groupAddress(address)).toEqual(['0x', 'd8dA6BF2', '6964aF9D', '7eEd9e03', 'E53415D3', '7aA96045'])
  })

  it('keeps the 0x apart for an Ethereum implicit account', () => {
    const id = `0x${'1234567890'.repeat(4)}`
    expect(groupAddress(id)).toEqual(['0x', '12345678', '90123456', '78901234', '56789012', '34567890'])
  })

  it('leaves a named account whole', () => {
    expect(groupAddress('alice.near')).toEqual(['alice.near'])
    expect(groupAddress('deadbeef.near')).toEqual(['deadbeef.near'])
  })
})

describe('the plan hash and time left', () => {
  it('shows the hash’s first and last 8 characters', () => {
    expect(shortHash(`12345678${'0'.repeat(48)}abcdefgh`)).toBe('12345678…abcdefgh')
  })

  it('counts down in minutes and seconds, then stops', () => {
    const end = Date.parse(STATE.plan.expiresAt)
    expect(timeLeft(STATE.plan.expiresAt, end - 125_000)).toBe('2:05')
    expect(timeLeft(STATE.plan.expiresAt, end - 1_000)).toBe('0:01')
    expect(timeLeft(STATE.plan.expiresAt, end)).toBeNull()
    expect(timeLeft('not a date', end)).toBeNull()
  })
})

describe('when Approve works', () => {
  it('works once armed and unlocked, for a plan still waiting on the person', () => {
    expect(canApprove(STATE)).toBe(true)
    expect(canApprove({ ...STATE, status: 'approved' })).toBe(true)
  })

  it('waits for the arm delay, an unlock and any send in progress', () => {
    expect(canApprove({ ...STATE, armed: false })).toBe(false)
    expect(canApprove({ ...STATE, unlocked: false })).toBe(false)
    expect(canApprove({ ...STATE, sending: true })).toBe(false)
  })

  it('never works for a plan past review', () => {
    for (const status of ['draft', 'signing', 'submitted', 'confirmed', 'failed', 'cancelled', 'expired', 'blocked'] as const) {
      expect(canApprove({ ...STATE, status })).toBe(false)
    }
  })

  it('says Try again for a plan approved before whose send stopped short', () => {
    expect(approveLabel(STATE)).toBe('Approve and send')
    expect(approveLabel({ ...STATE, status: 'approved' })).toBe('Try again')
  })
})

describe('what became of the plan', () => {
  it('says nothing while the plan waits on the person', () => {
    expect(outcomeOf(STATE)).toBeNull()
    expect(outcomeOf({ ...STATE, status: 'approved', failure: 'chain-unavailable' })).toBeNull()
  })

  it('says it’s sending while it is', () => {
    expect(outcomeOf({ ...STATE, status: 'approved', sending: true })?.title).toBe('Signing and sending…')
  })

  it('tells a send NEAR turned down apart from one never sent', () => {
    expect(outcomeOf({ ...STATE, status: 'failed', transactionId: 'tx' })?.title).toBe('NEAR didn’t run it')
    expect(outcomeOf({ ...STATE, status: 'failed', failure: 'refused' })).toEqual({ tone: 'block', title: 'Not sent', text: failureText('refused') })
  })

  it('says nothing was signed when the plan was cancelled or expired', () => {
    expect(outcomeOf({ ...STATE, status: 'cancelled' })?.text).toMatch(/Nothing was signed/)
    expect(outcomeOf({ ...STATE, status: 'expired' })?.text).toMatch(/Nothing was signed/)
  })

  it('warns against sending again while a send is unanswered', () => {
    expect(outcomeOf({ ...STATE, status: 'submitted' })).toMatchObject({ tone: 'caution', text: expect.stringMatching(/before sending it again/) })
  })
})

describe('while it sends', () => {
  it('signs first, then waits for NEAR', () => {
    expect(sendSteps({ ...STATE, sending: true }).map((step) => step.status)).toEqual(['active', 'pending', 'pending'])
    const signed = sendSteps({ ...STATE, sending: true, transactionId: 'tx' })
    expect(signed.map((step) => step.status)).toEqual(['done', 'active', 'pending'])
    expect(signed[0]?.label).toBe('Signed in the signer')
  })

  it('names every kind of recipient account', () => {
    expect(ACCOUNT_KIND.named).toMatch(/named/)
    expect(Object.keys(ACCOUNT_KIND)).toHaveLength(5)
    expect(ACCOUNT_KIND.evm).toBe('An EVM address')
  })
})
