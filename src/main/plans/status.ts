import type { PlanStatus } from '../../shared/plan'

/**
 * Where a plan may go from each status, as data. One table answers every "may
 * this happen" question, so the store, the agent's tools and the review window
 * can't each hold a slightly different idea of it.
 *
 * - Nothing leaves a final status.
 * - Only `awaiting_review` leads to `approved`, so nothing is approved without
 *   being shown, and only `approved` leads to `signing`.
 * - Once `signing`, the plan can't be cancelled or expire: the signer has it,
 *   and from `submitted` only the chain decides between confirmed and failed.
 */
export const PLAN_TRANSITIONS: Readonly<Record<PlanStatus, readonly PlanStatus[]>> = {
  draft: ['awaiting_review', 'blocked', 'cancelled', 'expired'],
  awaiting_review: ['approved', 'blocked', 'cancelled', 'expired'],
  approved: ['signing', 'cancelled', 'expired'],
  signing: ['submitted', 'failed'],
  submitted: ['confirmed', 'failed'],
  confirmed: [],
  failed: [],
  cancelled: [],
  expired: [],
  blocked: [],
}

export function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  return PLAN_TRANSITIONS[from].includes(to)
}

/** Statuses a plan never leaves. Nothing is ever signed from one of these. */
export function isFinal(status: PlanStatus): boolean {
  return PLAN_TRANSITIONS[status].length === 0
}

/**
 * The status a plan is in right now, by the wall clock. A plan past its time
 * reads as expired the moment it passes, with no gap while something catches
 * up; the store then writes that down, so setting the clock back can't revive
 * it. A plan the signer has, or the chain has, never expires: its fate is out
 * of Ink's hands.
 */
export function effectiveStatus(status: PlanStatus, expiresAt: string, now: Date = new Date()): PlanStatus {
  if (!canTransition(status, 'expired')) return status
  return Date.parse(expiresAt) <= now.getTime() ? 'expired' : status
}
