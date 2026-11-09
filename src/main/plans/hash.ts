import { createHash } from 'node:crypto'
import type { PlanCore } from '../../shared/plan'
import { canonicalize } from './canonical'

/** Names what's hashed, so a planHash can never be mistaken for a hash of anything else. */
export const PLAN_DOMAIN = 'ottopus-ink/plan/v1'

/**
 * The one value the review, the signer and every status report bind to:
 * SHA-256 over the domain, a NUL byte and the plan's canonical JSON as UTF-8,
 * as 64 lowercase hex characters. Main computes it here and nowhere else, and
 * the signer recomputes it the same way before it signs.
 */
export function planHash(core: PlanCore): string {
  return createHash('sha256').update(`${PLAN_DOMAIN}\0${canonicalize(core)}`, 'utf8').digest('hex')
}
