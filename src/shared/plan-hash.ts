import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { canonicalize } from './canonical'
import type { PlanCore } from './plan'

/** Names what's hashed, so a planHash can never be mistaken for a hash of anything else. */
export const PLAN_DOMAIN = 'ottopus-ink/plan/v1'

/**
 * The one value the review, the signer and every status report bind to:
 * SHA-256 over the domain, a NUL byte and the plan's canonical JSON as UTF-8,
 * as 64 lowercase hex characters. Main and the signer both compute it here, so
 * the signer can check for itself that it was given the plan the person approved.
 */
export function planHash(core: PlanCore): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${PLAN_DOMAIN}\0${canonicalize(core)}`)))
}
