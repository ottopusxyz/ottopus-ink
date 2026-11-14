/**
 * Ethereum's Recursive Length Prefix encoding, for the few values a transaction holds:
 * byte strings and lists of them. Decoding is strict: one way to write each value, so
 * bytes that read the same always hash the same.
 */
export type Rlp = Uint8Array | Rlp[]

export class RlpError extends Error {}

function lengthBytes(length: number): Uint8Array {
  const bytes: number[] = []
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256)
  return Uint8Array.from(bytes)
}

function withPrefix(short: number, long: number, body: Uint8Array): Uint8Array {
  if (body.length <= 55) return Uint8Array.from([short + body.length, ...body])
  const size = lengthBytes(body.length)
  return Uint8Array.from([long + size.length, ...size, ...body])
}

export function rlpEncode(value: Rlp): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length === 1 && (value[0] as number) < 0x80) return value
    return withPrefix(0x80, 0xb7, value)
  }
  const parts = value.map(rlpEncode)
  const body = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    body.set(part, at)
    at += part.length
  }
  return withPrefix(0xc0, 0xf7, body)
}

/** One value and where it ends, read strictly. */
function decodeAt(bytes: Uint8Array, at: number): { value: Rlp; end: number } {
  const first = bytes[at]
  if (first === undefined) throw new RlpError('the bytes end early')
  if (first < 0x80) return { value: bytes.subarray(at, at + 1), end: at + 1 }
  const isList = first >= 0xc0
  const base = isList ? 0xc0 : 0x80
  let start: number
  let length: number
  if (first - base <= 55) {
    start = at + 1
    length = first - base
  } else {
    const size = first - base - 55
    const sizeBytes = bytes.subarray(at + 1, at + 1 + size)
    if (sizeBytes.length !== size || sizeBytes[0] === 0) throw new RlpError('a length is not written the short way')
    length = sizeBytes.reduce((sum, byte) => sum * 256 + byte, 0)
    if (length <= 55) throw new RlpError('a length is not written the short way')
    start = at + 1 + size
  }
  const end = start + length
  if (end > bytes.length) throw new RlpError('the bytes end early')
  if (!isList) {
    const value = bytes.subarray(start, end)
    if (length === 1 && (value[0] as number) < 0x80) throw new RlpError('a single byte is not written as itself')
    return { value, end }
  }
  const items: Rlp[] = []
  for (let next = start; next < end; ) {
    const item = decodeAt(bytes, next)
    items.push(item.value)
    next = item.end
  }
  return { value: items, end }
}

/** Reads one value that fills the bytes exactly. Throws `RlpError`. */
export function rlpDecode(bytes: Uint8Array): Rlp {
  const { value, end } = decodeAt(bytes, 0)
  if (end !== bytes.length) throw new RlpError('bytes follow the value')
  return value
}

/** A whole number as RLP writes it: big-endian, no leading zeros, and zero as no bytes. */
export function bigintBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new RlpError('a negative number')
  if (value === 0n) return new Uint8Array(0)
  const hex = value.toString(16)
  const padded = hex.length % 2 ? `0${hex}` : hex
  return Uint8Array.from(padded.match(/../g)!.map((pair) => parseInt(pair, 16)))
}

/** A whole number from RLP's bytes, refusing leading zeros. */
export function bytesBigint(bytes: Rlp): bigint {
  if (!(bytes instanceof Uint8Array)) throw new RlpError('a number is a list')
  if (bytes.length > 0 && bytes[0] === 0) throw new RlpError('a number has leading zeros')
  return bytes.reduce((sum, byte) => sum * 256n + BigInt(byte), 0n)
}
