import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { PlanCore } from '../../shared/plan'
import { canonicalize, PlanIntegrityError } from './canonical'
import { PLAN_DOMAIN, planHash } from './hash'

describe('canonicalize', () => {
  it('escapes strings as RFC 8785 does (its own example, section 3.2.2)', () => {
    // "€$\u000F\u000aA'B"\\\\"\/" in the RFC's input.
    const input = { string: '€$\u000f\nA\'B"\\\\"/', literals: [null, true, false] }
    expect(canonicalize(input)).toBe('{"literals":[null,true,false],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}')
  })

  it('sorts keys by UTF-16 code units (RFC 8785 section 3.2.3)', () => {
    const input = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      'דּ': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      'ö': 'Latin Small Letter O With Diaeresis',
    }
    const order = Object.values(JSON.parse(canonicalize(input)) as Record<string, string>)
    // JSON.parse would reorder integer-like keys, so read the order from the text instead.
    expect([...canonicalize(input).matchAll(/":"([^"]+)"/g)].map((match) => match[1])).toEqual([
      'Carriage Return',
      'One',
      'Control',
      'Latin Small Letter O With Diaeresis',
      'Euro Sign',
      'Emoji: Grinning Face',
      'Hebrew Letter Dalet With Dagesh',
    ])
    expect(order).toHaveLength(7)
  })

  it('is the same whatever order the fields were built in, at every level', () => {
    const a = canonicalize({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } })
    const b = canonicalize({ a: { c: 'x', d: [1, { y: 2, z: 1 }] }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}')
  })

  it('keeps array order: steps in another order are another plan', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]))
  })

  it('accepts a whole surrogate pair, such as an emoji', () => {
    expect(canonicalize('🐙')).toBe('"🐙"')
  })

  it('drops undefined properties but keeps null', () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}')
  })

  it('writes -0 as 0', () => {
    expect(canonicalize(-0)).toBe('0')
  })

  it.each([
    ['a float, so "0.1" and 0.1 can never be two plans', 0.1],
    ['an unsafe integer', 2 ** 53],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a bigint', 10n],
    ['undefined on its own', undefined],
    ['undefined in an array', [undefined]],
    // Holes are skipped by map, so these once printed [] and [,].
    ['an array that is only a hole', Array(1)],
    ['an array of holes', Array(2)],
    ['an array with a hole in the middle', [1, , 2]], // eslint-disable-line no-sparse-arrays
    ['a hole nested in an object', { steps: Array(1) }],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
    ['a Date, whose JSON form is its own choice', new Date(0)],
    ['a Map', new Map()],
    ['a string with a lone surrogate', '\ud800'],
    ['a key with a lone surrogate', { '\udc00': 1 }],
    ['a high surrogate at the end', 'ok\ud83d'],
    ['a low surrogate before its high half', '\ude00\ud83d'],
  ])('refuses %s', (_name, value) => {
    expect(() => canonicalize(value)).toThrow(PlanIntegrityError)
  })
})

/**
 * A fixed plan and its hash. The canonical text and the hash were worked out on
 * 8 Nov 2026 with the RFC author's JCS implementation (canonicalize 2.0.0 on npm)
 * and Python's hashlib, independently of this code.
 */
const VECTOR: PlanCore = {
  hashVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  createdBy: 'agent',
  createdAt: '2026-11-08T00:00:00.000Z',
  expiresAt: '2026-11-08T00:30:00.000Z',
  intent: { outcome: 'send', asset: 'NEAR', amount: '1.5', chain: 'near', to: 'alice.near', toAsset: null, toChain: null },
  recipient: { address: 'alice.near', why: 'typed' },
  summary: 'Send 1.5 NEAR to alice.near',
  steps: [{ chain: 'near', action: 'transfer', fields: { receiverId: 'alice.near', deposit: '1500000000000000000000000' } }],
}
const VECTOR_CANONICAL =
  '{"createdAt":"2026-11-08T00:00:00.000Z","createdBy":"agent","expiresAt":"2026-11-08T00:30:00.000Z","hashVersion":1,' +
  '"id":"00000000-0000-4000-8000-000000000001","intent":{"amount":"1.5","asset":"NEAR","chain":"near","outcome":"send",' +
  '"to":"alice.near","toAsset":null,"toChain":null},"recipient":{"address":"alice.near","why":"typed"},"steps":[{"action":' +
  '"transfer","chain":"near","fields":{"deposit":"1500000000000000000000000","receiverId":"alice.near"}}],' +
  '"summary":"Send 1.5 NEAR to alice.near"}'
const VECTOR_HASH = 'd5e6ea15abe565b96eaa037e3395955d3f47cb37c198ee4efa80ccf7744c8ca5'

describe('planHash', () => {
  it('refuses a plan whose steps have a hole', () => {
    expect(() => planHash({ ...VECTOR, steps: Array(1) })).toThrow(PlanIntegrityError)
  })

  it('matches the independently computed vector', () => {
    expect(canonicalize(VECTOR)).toBe(VECTOR_CANONICAL)
    expect(planHash(VECTOR)).toBe(VECTOR_HASH)
  })

  it('hashes the domain, a NUL byte and the canonical text, in that order', () => {
    const expected = createHash('sha256').update(Buffer.concat([Buffer.from(PLAN_DOMAIN), Buffer.from([0]), Buffer.from(VECTOR_CANONICAL)])).digest('hex')
    expect(planHash(VECTOR)).toBe(expected)
    expect(PLAN_DOMAIN).toBe('ottopus-ink/plan/v1')
  })

  it('changes when any hashed field changes', () => {
    const changes: ((core: PlanCore) => void)[] = [
      (core) => (core.id = '00000000-0000-4000-8000-000000000002'),
      (core) => (core.createdBy = 'ui'),
      (core) => (core.expiresAt = '2026-11-08T00:31:00.000Z'),
      (core) => (core.intent.amount = '1.50'),
      (core) => (core.intent.to = 'alice.nea'),
      (core) => (core.recipient = { address: 'alice.near', why: 'own' }),
      (core) => (core.summary = 'Send 1.5 NEAR to alice.near.'),
      (core) => (core.steps[0]!.fields.deposit = '1500000000000000000000001'),
      (core) => core.steps.push({ chain: 'near', action: 'transfer', fields: {} }),
    ]
    for (const change of changes) {
      const copy = structuredClone(VECTOR)
      change(copy)
      expect(planHash(copy)).not.toBe(VECTOR_HASH)
    }
  })

  it('is the same whatever order the plan’s fields were built in', () => {
    const reordered = Object.fromEntries(Object.entries(structuredClone(VECTOR)).reverse()) as unknown as PlanCore
    expect(planHash(reordered)).toBe(VECTOR_HASH)
  })

  it('is 64 lowercase hex characters', () => {
    expect(planHash(VECTOR)).toMatch(/^[0-9a-f]{64}$/)
  })
})
