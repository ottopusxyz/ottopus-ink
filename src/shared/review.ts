import type { PlanStatus } from './plan'

/**
 * What the review window shows and can ask for. Main works out every value
 * here from the plan's own fixed steps, the bytes the signer will sign, never
 * from the agent's words.
 */

/** One plan as the review window draws it. Amounts are NEAR decimals, written by main. */
export interface ReviewPlan {
  id: string
  /** A plain send, a swap through NEAR Intents, or a payment of an exact amount made of several swaps. */
  kind: 'send' | 'swap' | 'pay'
  /** What a swap's quote promised, for a swap. Null for a send. */
  swap: ReviewSwap | null
  /** A payment's legs, each an exact swap paying part of it. Absent from anything else. */
  legs?: ReviewLeg[]
  /**
   * For a payment, whose steps run on more than one chain: each step's chain and the most
   * its fees could take, in its own coin. Main sends only while no step's fees can cost
   * more than its own. Absent from anything else, which has one fee, `maxFee`.
   */
  stepFees?: { chain: string; feeAsset: string; maxFee: string | null; maxFeeYocto: string | null }[]
  /** The hash the person approves. The signer signs only a plan that hashes to it. */
  hash: string
  /** The network banner, such as `NEAR mainnet` or `Base mainnet`. */
  network: string
  /** The chain that runs it, as people say it: `NEAR`, `Base`. */
  chain: string
  /** The coin that pays its fees and anything the actions attach: `NEAR`, `ETH`, `BNB`. */
  feeAsset: string
  /** Ink's name for the chain, for its logo: `near`, `base`, `bsc`. */
  chainMark: string
  /** For a payment: Ink's name for the chain it pays out on, for the amount's badge, and that chain as people say it. */
  payChain?: { mark: string; name: string }
  /** Where the chain shows a transaction: the explorer's name, and the page a transaction id is added to. */
  explorer: { name: string; tx: string }
  /** The account that pays: the person's own. */
  from: string
  /** The key that signs for it. */
  publicKey: string
  /** Who gets paid, in full: for a swap, who NEAR Intents pays out to. */
  to: string
  /**
   * What kind of NEAR account `to` is. A transfer creates an implicit one that doesn't exist yet.
   * `other-chain` is a swap's payout address on another chain, and `evm` an address on the EVM chain that sends.
   */
  toKind: 'implicit' | 'eth-implicit' | 'named' | 'other-chain' | 'evm'
  /** Why Ink lets this plan pay `to`: it's the person's own address, or they typed it in the chat. */
  toWhy: 'own' | 'typed'
  /** What's sent, in `asset`: the NEAR sent or swapped, or the token a swap moves from the Intents balance. */
  amount: string
  /** Exactly what is sent, in the asset's smallest unit (yoctoNEAR for NEAR), for anyone checking the decimals. */
  amountYocto: string
  /** `NEAR`, or the symbol of the token a swap pays from the Intents balance. */
  asset: string
  /** The most the fees could take up front at today's gas price, in `feeAsset`. Null when the chain couldn't be asked. */
  maxFee: string | null
  /** The same in its smallest unit: yoctoNEAR, or wei. Main signs only while the fees can't cost more than this, and asks again if they could. */
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
  kind: 'Transfer' | 'FunctionCall'
  /** What it attaches, in `feeAsset`. */
  amount: string
  /** The contract method a call action runs. */
  method: string | null
  /** What it does, in plain words, written by main from the decoded action. */
  summary: string
}

/** One leg of a payment: what pays, from where, and exactly what it pays out. */
export interface ReviewLeg {
  /** "10 USDC". */
  send: string
  from: 'evm' | 'intents'
  /** Where it pays from, as a person reads it: "Base", "your NEAR Intents balance". */
  fromPlace: string
  /** Exactly what it pays out: "9.7 USDC". */
  get: string
  depositAddress: string
  /** Where a refund of anything unswapped goes. */
  refundTo: string
  fee: string
  seconds: number
}

/** A swap through NEAR Intents, as main read it from the plan's fixed terms. */
export interface ReviewSwap {
  /** "5 NEAR", "25 USDC". */
  send: string
  /** What pays: NEAR from the wallet, a coin or token from the wallet on an EVM chain, or a token in the NEAR Intents balance. A refund goes back to the same place. */
  from: 'wallet' | 'evm' | 'intents'
  /** What the quote expects to pay out: "17.400531 USDC". */
  get: string
  /** The least it pays out, or it's refunded. */
  least: string
  /** Where it pays out, as a person reads it: "Base", or "your NEAR Intents balance". */
  getChain: string
  /** Where a refund goes: the person's own NEAR account, or its Intents balance when that paid. */
  refundTo: string
  /** 1Click's deposit address, which the transaction pays. */
  depositAddress: string
  /** ISO 8601. After this the deposit address is dead. */
  deadline: string
  /** NEAR Intents' own fee, already out of `get`: "0.2%". */
  fee: string
  /** How long it should take once the deposit lands. */
  seconds: number
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
