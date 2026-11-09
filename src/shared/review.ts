import type { PlanStatus } from './plan'

/**
 * What the review window shows and can ask for. Main works out every value
 * here from the plan's own fixed steps, the bytes the signer will sign, never
 * from the agent's words.
 */

/** One plan as the review window draws it. Amounts are NEAR decimals, written by main. */
export interface ReviewPlan {
  id: string
  /** The hash the person approves. The signer signs only a plan that hashes to it. */
  hash: string
  /** The network banner, such as `NEAR mainnet`. */
  network: string
  /** The account that pays: the person's own. */
  from: string
  /** The key that signs for it. */
  publicKey: string
  /** Who gets paid, in full. */
  to: string
  /** What kind of NEAR account `to` is. A transfer creates an implicit one that doesn't exist yet. */
  toKind: 'implicit' | 'eth-implicit' | 'named'
  /** Why Ink lets this plan pay `to`: it's the person's own address, or they typed it in the chat. */
  toWhy: 'own' | 'typed'
  /** The deposit, in NEAR. */
  amount: string
  /** Exactly what is sent, in yoctoNEAR, for anyone checking the decimals. */
  amountYocto: string
  asset: 'NEAR'
  /** The most the fees could take up front at today's gas price, in NEAR. Null when the chain couldn't be asked. */
  maxFee: string | null
  /** The same in yoctoNEAR. Main signs only while the fees can't cost more than this, and asks again if they could. */
  maxFeeYocto: string | null
  /** The deposit and that fee ceiling together, the most that can leave the account. Null without the fee. */
  maxTotal: string | null
  /** Each action the transaction holds, decoded. */
  actions: ReviewAction[]
  /** ISO 8601. After this the plan can't be approved. */
  expiresAt: string
}

/** One decoded action. A transfer calls no contract, so `method` is null for it. */
export interface ReviewAction {
  kind: 'Transfer'
  /** In NEAR. */
  amount: string
  /** The contract method a call action runs. */
  method: string | null
}

/** Why an approval or a send didn't go ahead. */
export type ReviewFailure =
  /** Ink is locked: unlock it in the main window, then approve again. */
  | 'locked'
  /** The approval came too soon after the window came up or took focus. */
  | 'not-armed'
  /** No real click or key press in the review window came with it. */
  | 'no-gesture'
  /** It's not the plan, or the version of it, the window is showing. */
  | 'stale'
  /** The fees could now cost more than the window showed, or it showed none: it shows the new maximum to check first. */
  | 'fee-changed'
  /** The plan can't be approved or sent from where it is now. */
  | 'cannot-move'
  /** Another plan is being sent. */
  | 'busy'
  | 'wrong-network'
  | 'chain-unavailable'
  | 'insufficient-funds'
  | 'recipient-unknown'
  | 'earlier-pending'
  | 'plan-mismatch'
  | 'refused'
  | 'signer-stopped'
  | 'not-found'
  | 'bad-request'

/** Everything the review window needs to draw itself. Null means there's nothing to review. */
export interface ReviewState {
  plan: ReviewPlan
  status: PlanStatus
  /** Approve works now: the window has been up and in front long enough. */
  armed: boolean
  /** Ink is unlocked, so a signature is possible. */
  unlocked: boolean
  /** Main is signing or sending this plan. */
  sending: boolean
  /** What stopped the last approval or send, if anything did. */
  failure: ReviewFailure | null
  /** Once signed: the transaction's id on NEAR. */
  transactionId: string | null
  /** More plans waiting behind this one. */
  waiting: number
}

/** The review window's channels. Only the review window's own page may use them. */
export const REVIEW_IPC = {
  state: 'review:state',
  approve: 'review:approve',
  reject: 'review:reject',
  dismiss: 'review:dismiss',
  /** Main to the review window: the state, sent on every change. */
  changed: 'review:changed',
} as const

/** What the review window's preload exposes, as `window.inkReview`. */
export interface ReviewBridge {
  state(): Promise<ReviewState | null>
  /** Asks main to approve and send the plan shown, by its id and hash. Main checks for a real click or key press itself. */
  approve(id: string, hash: string): Promise<{ ok: true } | { ok: false; reason: ReviewFailure }>
  /** Cancels the plan shown. Nothing is signed. */
  reject(id: string): Promise<void>
  /** Done with a plan that's finished: shows the next, or closes the window. */
  dismiss(id: string): Promise<void>
  onState(listener: (state: ReviewState | null) => void): () => void
}
