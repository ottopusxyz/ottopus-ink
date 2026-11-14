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
  /** A payment's legs, each an exact swap into the Intents balance. Absent from anything else. */
  legs?: ReviewLeg[]
  /**
   * A payment's one payout to the recipient: exactly what it pays, how much of what it moves
   * was in the Intents balance already, and NEAR Intents' fee. Ink sends it once the legs land.
   */
  payout?: { get: string; fromBalance: string | null; fee: string; seconds: number }
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
  toKind: 'implicit' | 'eth-implicit' | 'named' | 'other-chain' | 'evm' | 'solana'
  /** Why Ink lets this plan pay `to`: it's the person's own address, or they typed it in the chat. */
  toWhy: 'own' | 'typed' | 'attached'
  /** For `attached`: the name of the file the address came from. */
  toFile?: string
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
  /** What leaves, through what, and what arrives where, for the money map. Written from the same checked fields. */
  flow: ReviewFlow
  /** Each transaction the person signs, in the order Ink sends them, with its own actions. */
  transactions: ReviewTransaction[]
  /** ISO 8601. After this the plan can't be approved. */
  expiresAt: string
}

/** A token as the review window draws it: its logo, its chain's badge, and where it sits. */
export interface ReviewToken {
  symbol: string
  /** Ink's name for the chain it's on, for the badge: `base`, `bsc`, `solana`, or `near`, also for the NEAR Intents balance. */
  chain: string
  /** Where it is, as a person reads it: "Base", "NEAR Intents". */
  place: string
  /**
   * What the plan checked it to be: its contract or mint, or 1Click's id for it. Null for a
   * chain's own coin. Main finds its icon by this, never by the symbol, which anyone can copy.
   */
  id: string | null
  /** Its icon from Zerion as a data: URL, when Ink ships no logo for it. Filled in by main, or null. */
  icon: string | null
}

/** An amount of a token, as the money map draws it. */
export interface ReviewAmount {
  token: ReviewToken
  /** In whole tokens, exactly: "5.289514481275175937". */
  amount: string
}

/**
 * What the plan moves: each source that leaves the person's wallet or Intents balance, and
 * what arrives where. `via` is `intents` when NEAR Intents swaps or carries it in between.
 */
export interface ReviewFlow {
  /** For a payment, `brings` is exactly what the source adds to the payout, in the payout's token. */
  out: (ReviewAmount & { brings?: string })[]
  via: 'direct' | 'intents'
  /** `exact` when exactly this arrives; otherwise `least` is the floor, below which it's refunded. */
  in: ReviewAmount & { exact: boolean; least?: string; to: string }
}

/** One transaction the person signs: where it runs, the key that signs it, when Ink sends it, and what's in it. */
export interface ReviewTransaction {
  chain: { mark: string; name: string }
  key: 'ed25519' | 'secp256k1'
  /** `later` for a payment's payout: signed now with the rest, and sent once every part has landed. */
  when: 'now' | 'later'
  /** The most its fees could take, in `feeAsset`. Null when the chain couldn't be asked. */
  maxFee: string | null
  feeAsset: string
  actions: ReviewAction[]
}

/** One decoded action. A transfer calls no contract, so `method` is null for it. */
export interface ReviewAction {
  kind: 'Transfer' | 'FunctionCall'
  /** What it attaches, in `attachAsset`. */
  amount: string
  /** The coin it attaches: the coin of the chain that runs it. */
  attachAsset: string
  /** The contract method a call action runs. */
  method: string | null
  /** What it does, in plain words, written by main from the decoded action. */
  summary: string
  /** What it moves and to whom, for the action's row: null for a call that moves no token, such as registering. */
  move: { amount: string; token: ReviewToken; to: string; role: 'recipient' | 'deposit' } | null
}

/** One leg of a payment: what pays, from where, and exactly what it pays out. */
export interface ReviewLeg {
  /** "10 USDC". */
  send: string
  from: 'evm' | 'solana' | 'intents'
  /** Where it pays from, as a person reads it: "Base", "your NEAR Intents balance". */
  fromPlace: string
  /** Exactly what it puts in the Intents balance: "9.7 USDC". */
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
  from: 'wallet' | 'evm' | 'solana' | 'intents'
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
