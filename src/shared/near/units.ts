/** NEAR amounts. One NEAR is 10^24 yoctoNEAR, and every amount here is exact: decimal strings in, bigints out. */

export const YOCTO_DECIMALS = 24
export const YOCTO_PER_NEAR = 10n ** 24n

/** A plain decimal with no sign, exponent or leading zeros, as the plan store accepts. */
const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/

/**
 * A decimal NEAR amount in yoctoNEAR, or null when it isn't a plain decimal or
 * has more than 24 decimal places, since those can't be sent exactly.
 */
export function parseNear(amount: string): bigint | null {
  const match = DECIMAL.exec(amount)
  if (!match) return null
  const [, whole = '0', fraction = ''] = match
  if (fraction.length > YOCTO_DECIMALS) return null
  return BigInt(whole) * YOCTO_PER_NEAR + BigInt(fraction.padEnd(YOCTO_DECIMALS, '0'))
}

/** yoctoNEAR as a NEAR decimal with no trailing zeros: 1500000000000000000000000n is "1.5". */
export function formatNear(yocto: bigint): string {
  if (yocto < 0n) return `-${formatNear(-yocto)}`
  const whole = yocto / YOCTO_PER_NEAR
  const fraction = (yocto % YOCTO_PER_NEAR).toString().padStart(YOCTO_DECIMALS, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}
