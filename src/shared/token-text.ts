/**
 * A token's symbol as Ink will show it or pass it to an agent, or null when it
 * isn't one. Anyone can deploy a token and send it to anyone, and some symbols
 * are whole sentences ("You won 500 NEAR! Claim at …") written to be read as a
 * message. A symbol is one short word of letters, digits and a few marks, so
 * anything else isn't shown by name at all.
 */
export function cleanSymbol(symbol: unknown): string | null {
  if (typeof symbol !== 'string') return null
  const trimmed = symbol.trim()
  return /^[A-Za-z0-9$._+-]{1,16}$/.test(trimmed) ? trimmed : null
}

/** A token amount in its smallest unit as a decimal with no trailing zeros: 1500000n at 6 decimals is "1.5". */
export function formatUnits(raw: bigint, decimals: number): string {
  if (raw < 0n) return `-${formatUnits(-raw, decimals)}`
  if (decimals === 0) return raw.toString()
  const unit = 10n ** BigInt(decimals)
  const fraction = (raw % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${raw / unit}.${fraction}` : `${raw / unit}`
}

/**
 * A decimal amount in whole tokens as the token's smallest unit: "1.5" at 6 decimals is
 * 1500000n. Null for anything but a plain decimal, or one with more places than the token has.
 */
export function parseUnits(decimal: string, decimals: number): bigint | null {
  const match = /^(0|[1-9][0-9]{0,39})(?:\.([0-9]{1,40}))?$/.exec(decimal)
  if (!match) return null
  const fraction = (match[2] ?? '').replace(/0+$/, '')
  if (fraction.length > decimals) return null
  return BigInt(match[1] as string) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

/** What an amount is worth in dollars, near enough to show. Amounts stay exact; only the value is a float. */
export function usdValue(raw: bigint, decimals: number, usdPrice: number): number {
  return Number(formatUnits(raw, decimals)) * usdPrice
}
