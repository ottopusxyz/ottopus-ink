import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { bigintBytes, bytesBigint, rlpDecode, rlpEncode, RlpError } from './rlp'

const text = (value: string) => new TextEncoder().encode(value)

describe('RLP', () => {
  it('encodes the examples from Ethereum’s own documentation', () => {
    expect(bytesToHex(rlpEncode(text('dog')))).toBe('83646f67')
    expect(bytesToHex(rlpEncode([text('cat'), text('dog')]))).toBe('c88363617483646f67')
    expect(bytesToHex(rlpEncode(new Uint8Array(0)))).toBe('80')
    expect(bytesToHex(rlpEncode([]))).toBe('c0')
    expect(bytesToHex(rlpEncode(bigintBytes(0n)))).toBe('80')
    expect(bytesToHex(rlpEncode(bigintBytes(15n)))).toBe('0f')
    expect(bytesToHex(rlpEncode(bigintBytes(1024n)))).toBe('820400')
    expect(bytesToHex(rlpEncode([[], [[]], [[], [[]]]]))).toBe('c7c0c1c0c3c0c1c0')
    const long = text('Lorem ipsum dolor sit amet, consectetur adipisicing elit')
    expect(bytesToHex(rlpEncode(long)).slice(0, 4)).toBe('b838')
  })

  it('reads back what it writes', () => {
    const value = [bigintBytes(8453n), text('x'.repeat(60)), [bigintBytes(1n), new Uint8Array(0)]]
    expect(rlpDecode(rlpEncode(value))).toEqual(value)
  })

  it('refuses any other way of writing a value', () => {
    // A single small byte wrapped, a short length written long, trailing bytes, and bytes that end early.
    for (const bad of ['8100', 'b800', 'c18000', '83646f', '']) expect(() => rlpDecode(hexToBytes(bad))).toThrow(RlpError)
    expect(() => bytesBigint(hexToBytes('0001'))).toThrow(RlpError)
    expect(bytesBigint(hexToBytes('2105'))).toBe(8453n)
  })
})
