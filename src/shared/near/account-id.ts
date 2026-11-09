/**
 * NEAR account ids. 2 to 64 characters of lower-case letters, digits, `-` and
 * `_`, in parts joined by dots, where a separator never starts, ends or doubles
 * up inside a part. This is nearcore's own rule.
 */
const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/

/**
 * - `implicit`: 64 lower-case hex, the ed25519 public key itself. Its first incoming transfer creates it.
 * - `eth-implicit`: `0x` and 40 lower-case hex (NEP-518). Also created by a transfer.
 * - `named`: anything else, such as `alice.near`. Only exists once someone creates it.
 */
export type NearAccountKind = 'implicit' | 'eth-implicit' | 'named'

export function nearAccountKind(id: string): NearAccountKind | null {
  if (id.length < 2 || id.length > 64 || !ACCOUNT_ID.test(id)) return null
  if (/^[0-9a-f]{64}$/.test(id)) return 'implicit'
  if (/^0x[0-9a-f]{40}$/.test(id)) return 'eth-implicit'
  return 'named'
}

export const isNearAccountId = (id: string): boolean => nearAccountKind(id) !== null
