/**
 * An amount cut for a glance: whole, or to four decimals, more for an amount under one
 * where that would leave only zeros, so 0.0000001 still reads as more than nothing.
 * `cut` says whether digits were left off; the exact amount stays a tap or a hover away.
 */
export function shortAmount(amount: string): { text: string; cut: boolean } {
  const [whole = '0', fraction = ''] = amount.split('.')
  // Below one, keep the first two digits that aren't zero, however far in.
  const keep = whole === '0' ? Math.max(4, fraction.search(/[1-9]/) + 2) : 4
  if (fraction.length <= keep) return { text: amount, cut: false }
  const kept = fraction.slice(0, keep).replace(/0+$/, '')
  return { text: kept ? `${whole}.${kept}` : whole, cut: true }
}

/** A line of text with each long amount in it cut for a glance: "≈7.0068 USDT on BNB Chain". */
export const shortAmounts = (text: string): string =>
  text.replace(/\b\d+\.\d{5,}\b/g, (amount) => {
    const { text: short, cut } = shortAmount(amount)
    return cut ? `≈${short}` : short
  })
