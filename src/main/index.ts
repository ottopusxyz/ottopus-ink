import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerMonitor, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron'
import type { Account } from '../shared/accounts'
import type { PlanStatus } from '../shared/plan'
import { IPC, type AgentId, type AgentStatus, type AppInfo, type ChatEvent, type ChatSwap, type PlanJourney, type IntentsDepositChain, type ReceiveAnswer, type RecentSwap, type ZerionKeyStatus } from '../shared/ipc'
import { createDepositJournal } from './intents/deposit-journal'
import { evmChainById, type EvmChain } from '../shared/evm/chains'
import { evmTransferOfStep } from '../shared/evm/transaction'
import { buildEvmSend, evmFeeCeiling, isEvmSend } from './evm/build'
import { createEvmRpc, type EvmRpc } from './evm/rpc'
import { depositEnding } from './intents/deposit-note'
import { createDepositWatcher, type DepositJournal } from './intents/deposit-watch'
import { depositAddress, depositChains, recentDeposits } from './intents/deposits'
import { pickReceive, receiveChainOf, receiveChains, searchTokens, type ReceiveAsk } from './intents/receive'
import { lastGood } from './last-good'
import { CHAT_ID, type SavedChat } from '../shared/history'
import { callsGas, callsOfStep } from '../shared/near/calls'
import type { PortfolioResult } from '../shared/portfolio'
import type { VaultResult } from '../shared/vault'
import { closeChat, killChats, sendFromInk, sendToChat, startChat, stopChatTurn, type DepositListen, type PlanEnding } from './agents/chats'
import { createChatHistory, savedEventOf, type ChatHistory } from './history/chat-history'
import { recapOf } from './history/recap'
import { detectAgents } from './agents/detect'
import { agentEnv, readNamedShellEnv } from './agents/login-env'
import { run, stopRuns } from './agents/run'
import { detectEntries } from './external/detect'
import { createSignIns, type SecretBox } from './external/sign-ins'
import { createExternalTools, type Confirm, type ExternalTools } from './external/tools'
import { startMcpBridge, type McpBridge } from './mcp/bridge'
import { buildNearSend, callsFeeCeiling, isNearSend, nearCallsFit, nearSendFeeCeiling, nearTransferOf } from './near/build'
import { createNearRpc } from './near/rpc'
import { appMenuTemplate } from './menu'
import { agentPlanTools } from './plans/agent-tools'
import { planOutcome } from './plans/outcome'
import { createPlanStore, type PlanView } from './plans/store'
import { createPortfolioReader, type PortfolioAccounts } from './portfolio/reader'
import { createSavedPortfolios, walletKey, type SavedPortfolios } from './portfolio/saved'
import { installId, INK_SERVICE_URL } from './portfolio/service'
import { tokenIcons } from './portfolio/token-icons'
import { checkZerionKey, zerionHoldings, zerionOptions, zerionTokenSearch, type ZerionAccess } from './portfolio/zerion'
import { createZerionKeyStore, isZerionKey, type ZerionKeyStore } from './portfolio/zerion-key'
import { createReviewBroker } from './review/broker'
import { oneClickQuote, oneClickTokens, submitDeposit, swapStatus, type OneClickToken } from './routes/one-click'
import { buildOneClickSwap } from './routes/swap-plan'
import { buildPayment, legsOfStep, paymentProgress } from './routes/pay-plan'
import { journeyOf, type StepTx } from './plans/journey'
import { createPayoutJournal, type PayoutJournal } from './routes/payout-journal'
import { swapSent } from './routes/swap-terms'
import { createSwapJournal, type SwapJournal } from './routes/swap-journal'
import { createSwapTracker } from './routes/swap-tracker'
import { chainName } from './routes/route'
import { createQuoter, holdingsOf } from './routes/quoter'
import { describeForReview } from './review/describe'
import { createReviewWindow } from './review/window'
import { isAppUrl, isSafeExternalUrl, secureWebPreferences } from './security'
import { SignerHost } from './signer-host'
import { createAutoLock } from './vault/auto-lock'
import { copyAddress } from './vault/copy-address'
import { createPlanSender, NEAR_NETWORK } from './vault/send-plan'
import { createVaultService, type VaultService } from './vault/service'
import { createVaultStore } from './vault/store'

const devServerUrl = process.env.ELECTRON_RENDERER_URL
const rendererIndex = join(import.meta.dirname, '../renderer/index.html')
/** The page the window loads; navigations and IPC are checked against it. */
const appEntry = devServerUrl ?? pathToFileURL(rendererIndex).href
const reviewIndex = join(import.meta.dirname, '../renderer/review.html')
/** The review window's page, the only one the review channels answer. */
const reviewEntry = devServerUrl ? new URL('review.html', devServerUrl).href : pathToFileURL(reviewIndex).href
const signer = new SignerHost(join(import.meta.dirname, 'signer.js'), (status) => {
  sendToWindows(IPC.signerStatus, status)
  if (status === 'stopped') vault?.signerStopped()
})

/** The app's own windows, leaving out the review window, which hears only about its plan. */
const appWindows = (): BrowserWindow[] => BrowserWindow.getAllWindows().filter((win) => !reviewWindow.owns(win.webContents))

function sendToWindows(channel: string, ...args: unknown[]): void {
  for (const win of appWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

app.enableSandbox()

// A second launch only hands focus to the first. app.quit() does not stop
// whenReady from firing, so startup is gated on the lock below, not on quit.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

/** Moves on when a page goes away, so a chat it asked for that's still starting is refused. */
let pageGeneration = 0

function endPageChats(): void {
  pageGeneration++
  killChats()
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Ottopus Ink',
    backgroundColor: '#F7F2EA',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs'), {
      devTools: Boolean(devServerUrl),
    }),
  })

  win.once('ready-to-show', () => win.show())

  // A page that goes away takes what it knows about its chats with it, leaving
  // nothing that could ever close them.
  win.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) endPageChats()
  })
  win.on('closed', endPageChats)

  // The renderer never opens windows or navigates away. Links go to the OS
  // browser, and only https ones.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, appEntry)) event.preventDefault()
  })

  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(rendererIndex)
  }
  return win
}

/** Every handler starts here: only the app's own page may call in, and never the review window's. */
function assertAppFrame(event: IpcMainInvokeEvent): void {
  if (reviewWindow.owns(event.sender) || !isAppUrl(event.senderFrame?.url ?? '', appEntry)) {
    throw new Error('IPC from an unexpected frame')
  }
}

/** The last detection, shared by every caller until a refresh asks for a new one. */
let agents: Promise<AgentStatus[]> | null = null

/** NEAR mainnet, for balances and for building and sending transfers. */
const nearRpc = createNearRpc()

/** Each EVM chain's RPC client, made on first use. */
const evmRpcs = new Map<string, EvmRpc>()
function evmRpcFor(chain: EvmChain): EvmRpc {
  let rpc = evmRpcs.get(chain.id)
  if (!rpc) {
    rpc = createEvmRpc(chain)
    evmRpcs.set(chain.id, rpc)
  }
  return rpc
}

/** Every plan made while the app runs. Each chain module builds the steps it knows; anything else stays a draft. */
const plans = createPlanStore({
  // A plan's chat hears each move as it happens, not only when the review window next looks.
  onMove: (plan) => {
    const txs = [...(planTxs.get(plan.id)?.values() ?? [])]
    statusListeners.get(plan.id)?.(plan.status, txs.at(-1)?.id ?? null)
    pushJourney(plan.id)
  },
  buildSteps: async (intent, own) => {
    if (isNearSend(intent)) return buildNearSend(intent, own, nearRpc)
    if (isEvmSend(intent)) return buildEvmSend(intent, own, { rpcFor: evmRpcFor, tokens: listedTokens })
    if (intent.outcome === 'pay') {
      return buildPayment(intent, own, {
        tokens: listedTokens,
        evmRpc: evmRpcFor,
        held: async () => {
          const read = await ownPortfolio({ fresh: true })
          return read.ok ? holdingsOf(read, (await listedTokens()) ?? []) : null
        },
        quote: (request) => oneClickQuote(request),
        fits: (from, deposit, gas, calls) => nearCallsFit(nearRpc, from, deposit, gas, calls),
      })
    }
    if (intent.outcome === 'swap') {
      return buildOneClickSwap(intent, own, {
        tokens: listedTokens,
        evmRpc: evmRpcFor,
        // Read afresh, so a deposit that just landed can pay; only while the vault stays unlocked.
        held: async () => {
          const read = await ownPortfolio({ fresh: true })
          return read.ok ? holdingsOf(read, (await listedTokens()) ?? []) : null
        },
        quote: (request) => oneClickQuote(request),
        fits: (from, deposit, gas, calls) => nearCallsFit(nearRpc, from, deposit, gas, calls),
      })
    }
    return { ok: true, steps: [] }
  },
})

/** What a chat follows of each plan it made after review, by plan id: its swap's progress and how it ended. */
interface Followed {
  owner: string
  swap: (swap: ChatSwap) => void
  journey: (journey: PlanJourney) => void
  ending: (ending: PlanEnding) => void
  transactionId: string | null
  ended: boolean
}
const followed = new Map<string, Followed>()
/** Room for every plan the store keeps, and no more. */
const MAX_FOLLOWED = 500

/** Tells the plan's chat how it ended, once it has, with Ink's note and the facts for the agent. Only once per plan. */
/** Where a plan's swap stands: its one swap's, or all of a payment's legs together. */
function swapStateOf(planId: string, core: PlanView['core']): ChatSwap | null {
  if (!core.swaps) return swapTracker.get(planId)
  return paymentProgress(core.swaps, core.swaps.map((_, leg) => swapTracker.get(`${planId}#${leg}`)))
}

function endingOf(planId: string): void {
  const follow = followed.get(planId)
  const plan = follow && !follow.ended ? plans.get(planId, follow.owner) : null
  if (!follow || !plan) return
  const outcome = planOutcome(planId, plan.core, plan.status, follow.transactionId, swapStateOf(planId, plan.core))
  if (!outcome) return
  follow.ended = true
  follow.ending(outcome)
}

let swapJournal: SwapJournal | null = null

/** The swaps Ink follows, sealed by the OS keyring, made on first use once the keyring can be asked. */
function getSwapJournal(): SwapJournal {
  swapJournal ??= createSwapJournal({ file: join(app.getPath('userData'), 'swaps.bin'), box: osSecretBox })
  return swapJournal
}

/** Follows each swap once NEAR ran its deposit, across restarts, and tells the chat that made it and Home. */
/** Each plan's transactions, by step, as the sender reported them: what a journey is drawn from. */
const planTxs = new Map<string, Map<number, StepTx>>()

/** A plan's journey as main sees it now, or null for a plan no chat follows. */
function journeyFor(planId: string): PlanJourney | null {
  const follow = followed.get(planId)
  const plan = follow ? plans.get(planId, follow.owner) : null
  if (!plan) return null
  const progress = plan.core.swap ? [swapTracker.get(planId)] : (plan.core.swaps ?? []).map((_, leg) => swapTracker.get(`${planId}#${leg}`))
  return journeyOf({ core: plan.core, status: plan.status, txs: planTxs.get(planId) ?? new Map(), swaps: progress, held: sender.holds(planId) })
}

/** Tells a plan's chat its journey, whenever anything along it moved. */
function pushJourney(planId: string): void {
  const journey = journeyFor(planId)
  if (journey) followed.get(planId)?.journey(journey)
}

/** Each plan's chat, told of a status the review window didn't see: a payment's payout, sent after it closed. */
const statusListeners = new Map<string, (status: PlanStatus, transactionId: string | null) => void>()

/**
 * Sends a payment's kept payout once every leg it waits for has landed in the Intents
 * balance, or drops it, never sent, once any leg failed or was refunded. It works from the
 * legs alone, so a payout picked up after a restart, whose plan is gone, still goes. The
 * payout is then followed to the recipient, and the plan's chat, if it's still open, hears.
 */
function settlePayout(planId: string): void {
  const legIds = sender.heldLegs().get(planId)
  if (!legIds) return
  const legs = legIds.map((id) => swapTracker.get(id))
  const told = (status: PlanStatus, transactionId: string | null) => {
    statusListeners.get(planId)?.(status, transactionId)
    const follow = followed.get(planId)
    if (follow && transactionId) follow.transactionId = transactionId
    endingOf(planId)
  }
  if (legs.some((leg) => leg && (leg.stage === 'failed' || leg.stage === 'refunded' || leg.stage === 'unknown'))) {
    sender.dropPayout(planId)
    told('failed', null)
    pushJourney(planId)
    return
  }
  if (!legs.every((leg) => leg?.stage === 'done')) return
  void sender.releasePayout(planId).then((sent) => {
    if (!sent) return
    if (sent.ran) void swapTracker.follow(`${planId}#${sent.swap}`, sent.payout, sent.transactionId)
    if (sent.ran !== null) told(sent.ran ? 'confirmed' : 'failed', sent.transactionId)
    pushJourney(planId)
  })
}

let payoutJournal: PayoutJournal | null = null

/** Payouts Ink holds for payments, sealed by the OS keyring, made on first use once the keyring can be asked. */
function getPayoutJournal(): PayoutJournal {
  payoutJournal ??= createPayoutJournal({ file: join(app.getPath('userData'), 'payouts.bin'), box: osSecretBox })
  return payoutJournal
}

const swapTracker = createSwapTracker({
  submit: (deposit) => submitDeposit(deposit),
  status: (depositAddress) => swapStatus(depositAddress),
  onUpdate: (followedId, swap) => {
    // A payment's legs are followed as `<plan>#<leg>`; its chat hears them together.
    const [planId = followedId] = followedId.split('#')
    const follow = followed.get(planId)
    if (planId === followedId) follow?.swap(swap)
    else if (follow) {
      const plan = plans.get(planId, follow.owner)
      const together = plan ? swapStateOf(planId, plan.core) : null
      if (together) follow.swap(together)
    }
    settlePayout(planId)
    pushJourney(planId)
    endingOf(planId)
    sendToWindows(IPC.swapsChanged)
  },
  journal: { list: () => getSwapJournal().list(), put: (entry) => getSwapJournal().put(entry), update: (planId, progress) => getSwapJournal().update(planId, progress) },
})

let chatHistory: ChatHistory | null = null

/** Chats kept across restarts, sealed by the OS keyring, made on first use once the keyring can be asked. */
function getChatHistory(): ChatHistory {
  chatHistory ??= createChatHistory({ file: join(app.getPath('userData'), 'chats.bin'), box: osSecretBox })
  return chatHistory
}

/**
 * The bridge's chains and tokens change rarely, so Receive reuses them for a while, and
 * keeps the last good copy when the bridge is slow or down.
 */
const listedDepositChains: () => Promise<IntentsDepositChain[] | null> = lastGood(() => depositChains(), { maxAgeMs: 10 * 60_000 })

/** Token icons fetched for the page's searches, kept for the session. */
const icons = tokenIcons()
/** Deposit addresses are fixed for an account, so each is asked for once a run. */
const depositAddresses = new Map<string, { address: string; memo: string | null }>()

async function keptDepositAddress(account: string, key: string): Promise<{ address: string; memo: string | null } | null> {
  const id = `${account} ${key}`
  const kept = depositAddresses.get(id) ?? (await depositAddress(account, key))
  if (kept) depositAddresses.set(id, kept)
  return kept
}

/** A receive the page or the agent asked about, checked: a chain, a token, and an amount or none. */
function receiveAskOf(value: unknown): ReceiveAsk | null {
  if (typeof value !== 'object' || value === null) return null
  const { chain, asset, amount } = value as Record<string, unknown>
  if (typeof chain !== 'string' || chain.length > 40 || typeof asset !== 'string' || !/^[A-Za-z0-9$._+-]{1,16}$/.test(asset.trim())) return null
  if (amount !== null && amount !== undefined && (typeof amount !== 'string' || amount.length > 80)) return null
  return { chain, asset: asset.trim(), amount: typeof amount === 'string' && amount.trim() ? amount.trim() : null }
}

/**
 * Where the wallet receives a token, NEAR Intents first, for the Receive screen and the
 * agent alike. Only while unlocked: either address ties a chain to the wallet.
 */
async function ownReceive(value: unknown): Promise<ReceiveAnswer> {
  const ask = receiveAskOf(value)
  if (!ask) return { ok: false, reason: 'unknown-chain' }
  if (vault?.isUnlocked() !== true) return { ok: false, reason: 'locked' }
  const own = await ownAccounts().catch(() => null)
  if (!own?.ok) return { ok: false, reason: own?.ok === false && own.reason === 'locked' ? 'locked' : 'unavailable' }
  return pickReceive(ask, { bridge: await listedDepositChains(), accounts: own.accounts, depositAddress: keptDepositAddress })
}

/** Which kept chat each running session belongs to, and with which agent. A continued chat runs in a new session. */
const historyOf = new Map<string, { id: string; agent: AgentId }>()

let depositJournal: DepositJournal | null = null

/** The deposits Ink watches, sealed by the OS keyring, made on first use once the keyring can be asked. */
function getDepositJournal(): DepositJournal {
  depositJournal ??= createDepositJournal({ file: join(app.getPath('userData'), 'deposits.bin'), box: osSecretBox })
  return depositJournal
}

/** The chat each watched deposit is shown in, while it's open. */
const depositListeners = new Map<string, DepositListen>()

/**
 * Watches the addresses deposit cards show, across restarts, and tells the card's chat
 * as each deposit moves on, and its agent once it lands. Once that chat's session is
 * gone, what happens is kept in its history and sent to the page for the kept chat.
 */
const depositWatcher = createDepositWatcher({
  recent: (account, bridge) => recentDeposits(account, bridge),
  balance: async (address, zerion, symbol) => {
    const access = zerionAccess()
    if (!access) return null
    const held = (await zerionHoldings(address, zerionOptions(access))).filter((holding) => holding.network === zerion && holding.symbol.toLowerCase() === symbol.toLowerCase())
    return { raw: held.reduce((sum, holding) => sum + holding.raw, 0n), decimals: held[0]?.decimals ?? 18 }
  },
  onUpdate: (entry) => {
    const { id, progress } = entry.deposit
    const ending = depositEnding(entry.deposit)
    const listen = depositListeners.get(id)
    if (listen?.progress(id, progress)) {
      if (ending) listen.ending(id, ending)
      return
    }
    depositListeners.delete(id)
    if (!entry.historyId) return
    const events: Extract<ChatEvent, { type: 'deposit-progress' | 'deposit-note' }>[] = [{ type: 'deposit-progress', id, progress }, ...(ending ? [{ type: 'deposit-note' as const, id, note: ending.note }] : [])]
    for (const event of events) {
      getChatHistory().record(entry.historyId, event)
      if (vault?.isUnlocked() === true) sendToWindows(IPC.depositEvent, entry.historyId, event)
    }
  },
  journal: { list: () => getDepositJournal().list(), put: (entry) => getDepositJournal().put(entry) },
})

/** A token's icon for a deposit card, from Zerion's search, when it answers in a moment. */
async function depositIcon(zerion: string | null, symbol: string): Promise<string | null> {
  const access = zerionAccess()
  if (!zerion || !access) return null
  const look = (async () => {
    const found = (await zerionTokenSearch(symbol, zerion, zerionOptions(access))).find((token) => token.symbol.toLowerCase() === symbol.toLowerCase())
    return found?.icon ? icons.icon(found.icon) : null
  })().catch(() => null)
  return Promise.race([look, new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_500))])
}

/** Shows an address get_deposit_address gave a chat's agent as a card there, and watches it. */
async function showDeposit(chatId: string, owner: string, ask: ReceiveAsk, answer: Extract<ReceiveAnswer, { ok: true }>, listen: DepositListen): Promise<void> {
  const chain = receiveChainOf(answer.chain)
  const intents = answer.kind === 'intents'
  const token = intents ? (await listedDepositChains())?.find((each) => each.key === chain?.bridge)?.tokens.find((each) => each.symbol === answer.asset) : undefined
  const icon = await depositIcon(chain?.zerion ?? null, answer.asset)
  const entry = depositWatcher.watch({
    owner,
    historyId: historyOf.get(chatId)?.id ?? null,
    bridge: intents ? (chain?.bridge ?? null) : null,
    assetIds: token?.ids ?? [],
    zerion: intents ? null : (chain?.zerion ?? null),
    deposit: {
      id: randomUUID(),
      kind: answer.kind,
      chain: answer.chain,
      chainName: answer.chainName,
      mark: chain?.mark ?? null,
      asset: answer.asset,
      icon,
      amount: ask.amount,
      address: answer.address,
      memo: intents ? answer.memo : null,
      min: answer.min,
      account: intents ? answer.account : null,
      why: intents ? null : answer.why,
    },
  })
  depositListeners.set(entry.deposit.id, listen)
  listen.show(entry.deposit)
}

/** The swaps followed lately, for Home, only while unlocked: they hold addresses and amounts. */
function recentSwaps(): RecentSwap[] {
  if (vault?.isUnlocked() !== true) return []
  return swapTracker.recent().map(({ planId, swap, progress, startedAt }) => ({
    planId,
    send: swapSent(swap) ?? swap.sendSymbol,
    get: swap.getSymbol,
    where: swap.getChain === 'intents' ? 'in your NEAR Intents balance' : `on ${chainName(swap.getChain)}`,
    progress,
    startedAt,
  }))
}

/** The review window. It opens whenever a plan waits for review. */
const reviewWindow = createReviewWindow({
  preload: join(import.meta.dirname, '../preload/review.cjs'),
  entry: reviewEntry,
  load: (win) => void (devServerUrl ? win.loadURL(reviewEntry) : win.loadFile(reviewIndex)),
  devTools: Boolean(devServerUrl),
})

/** What the review window shows for a plan: its own step decoded, and today's fee ceiling if NEAR answers. */
async function describePlan(plan: PlanView) {
  // A payment's steps each have their own fee, in their own chain's coin.
  if (plan.core.swaps) {
    const fees = await Promise.all(
      plan.core.steps.map(async (step) => {
        try {
          if (step.chain === 'evm') {
            const transfer = evmTransferOfStep(step)
            const chain = evmChainById(transfer.chainId)
            return chain ? await evmFeeCeiling(evmRpcFor(chain), transfer.gas) : null
          }
          const { calls } = callsOfStep(step)
          return callsFeeCeiling(await nearRpc.gasPrice(), callsGas(calls), calls.length)
        } catch {
          return null
        }
      }),
    )
    return describeForReview(plan, '', null, fees)
  }
  const [first] = plan.core.steps
  if (first?.chain === 'evm') {
    let fee: bigint | null = null
    try {
      const transfer = evmTransferOfStep(first)
      const chain = evmChainById(transfer.chainId)
      if (chain) fee = await evmFeeCeiling(evmRpcFor(chain), transfer.gas).catch(() => null)
    } catch {
      // A step that doesn't read as Ink's own transfer isn't shown at all.
    }
    return describeForReview(plan, '', fee)
  }
  const transfer = nearTransferOf(plan.core)
  let fee: bigint | null = null
  if (transfer) fee = await nearSendFeeCeiling(nearRpc, transfer.receiverId).catch(() => null)
  const [step] = plan.core.steps
  if (!transfer && step?.action === 'call') {
    let calls: ReturnType<typeof callsOfStep>['calls'] | null = null
    try {
      calls = callsOfStep(step).calls
    } catch {
      // A step that doesn't read as Ink's own calls isn't shown at all.
    }
    if (calls) {
      const read = calls
      fee = await nearRpc
        .gasPrice()
        .then((price) => callsFeeCeiling(price, callsGas(read), read.length))
        .catch(() => null)
    }
  }
  return describeForReview(plan, `NEAR ${NEAR_NETWORK}`, fee)
}

/** Signs and sends each plan approved in the review window. */
const sender = createPlanSender({
    store: plans,
    // Looked up each time, since the vault is made on first use.
    vault: { sign: (core, hash, live) => getVault().sign(core, hash, live) },
    rpc: nearRpc,
    evmRpc: evmRpcFor,
    payouts: { list: () => getPayoutJournal().list(), put: (entry) => getPayoutJournal().put(entry), remove: (planId) => getPayoutJournal().remove(planId) },
    onConfirmed: (plan, transactionId) => {
      if (plan.core.swap) void swapTracker.follow(plan.id, plan.core.swap, transactionId)
    },
    // Every transaction, as it's sent and once its chain answers, moves the plan's journey on.
    onStep: (planId, step, state, transactionId) => {
      const txs = planTxs.get(planId) ?? new Map<number, StepTx>()
      txs.set(step, { state, id: transactionId })
      planTxs.set(planId, txs)
      if (planTxs.size > MAX_FOLLOWED) planTxs.delete(planTxs.keys().next().value as string)
      pushJourney(planId)
    },
    // Each leg a payment's step paid is followed from that step's transaction.
    onStepConfirmed: (plan, step, transactionId) => {
      for (const leg of legsOfStep(plan.core, step)) {
        const swap = plan.core.swaps?.[leg]
        if (swap) void swapTracker.follow(`${plan.id}#${leg}`, swap, transactionId)
      }
    },
})

/** The only way a plan is approved: from the review window, by a person, then signed and sent. */
const reviews = createReviewBroker({
  store: plans,
  sender,
  describe: describePlan,
  unlocked: () => vault?.isUnlocked() === true,
  onState: (state) => reviewWindow.update(state),
})

/** The wallet's public addresses, for the agent's tools and plans. */
const ownAccounts = async (): Promise<VaultResult<{ accounts: Account[] }>> => {
  const wallet = getVault()
  return wallet.status().state === 'none' ? { ok: false, reason: 'no-vault' } : wallet.accounts()
}

let zerionKeys: ZerionKeyStore | null = null

/** The person's own Zerion key, sealed by the OS keyring. Main alone reads it, to send to Zerion. */
function getZerionKeys(): ZerionKeyStore {
  zerionKeys ??= createZerionKeyStore({ file: join(app.getPath('userData'), 'zerion.bin'), box: osSecretBox })
  return zerionKeys
}

let install: string | null = null

/**
 * How Ink reaches Zerion: the person's own key when they set one, otherwise Ottopus's
 * service when this build has one, otherwise not at all.
 */
function zerionAccess(): ZerionAccess | null {
  const key = getZerionKeys().get()
  if (key) return { via: 'own-key', key }
  if (!INK_SERVICE_URL) return null
  install ??= installId(join(app.getPath('userData'), 'install-id'))
  return { via: 'ottopus', url: `${INK_SERVICE_URL}/v1/zerion`, install }
}

/** Reads what the wallet holds, and keeps it a minute so the screen and the agent don't each ask again. */
const portfolioReader = createPortfolioReader({ rpc: nearRpc, zerionAccess })

/** What the wallet holds, for get_portfolio and the Portfolio screen. Public figures only, and only while unlocked, like the addresses. */
let savedPortfolios: SavedPortfolios | null = null

/** The last good read, sealed by the OS keyring, so the screens can show it at once and update behind it. */
function getSavedPortfolios(): SavedPortfolios {
  savedPortfolios ??= createSavedPortfolios({ file: join(app.getPath('userData'), 'portfolio.bin'), box: osSecretBox })
  return savedPortfolios
}

/** The addresses the portfolio is read for, from the wallet's accounts. */
function portfolioAccounts(accounts: Account[]): PortfolioAccounts | null {
  const address = (chain: Account['chain']) => accounts.find((account) => account.chain === chain)?.address
  const near = address('near')
  return near ? { near, evm: address('evm'), solana: address('solana'), tron: address('tron') } : null
}

/** What the wallet holds, for get_portfolio and the Portfolio screen. Public figures only, and only while unlocked, like the addresses. */
const ownPortfolio = async ({ fresh = false }: { fresh?: boolean } = {}): Promise<PortfolioResult> => {
  const wallet = getVault()
  if (wallet.status().state === 'none') return { ok: false, reason: 'no-vault' }
  // The vault answers only if it stayed unlocked for the whole read, so a lock while NEAR answers holds the figures back.
  const read = await wallet.withAccounts(async (accounts): Promise<PortfolioResult> => {
    const own = portfolioAccounts(accounts)
    if (!own) return { ok: false, reason: 'unavailable' }
    try {
      const portfolio = await portfolioReader.read(own, { fresh })
      getSavedPortfolios().save(walletKey(own), portfolio)
      return { ok: true, ...portfolio }
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
  })
  if (!read.ok) return { ok: false, reason: read.reason === 'locked' ? 'locked' : 'unavailable' }
  return read.value
}

/**
 * 1Click's token list changes rarely, so a quote reuses it for a few minutes, and keeps
 * the last good copy when 1Click is slow or down.
 */
const listedTokens: () => Promise<OneClickToken[] | null> = lastGood(() => oneClickTokens(), { maxAgeMs: 5 * 60_000 })

/** get_quote: the route main picks for a payment, and what it would give. Only while unlocked, since it reads the addresses. */
const quoteRoute = createQuoter({
  accounts: ownAccounts,
  portfolio: () => ownPortfolio(),
  tokens: listedTokens,
  quote: (request) => oneClickQuote(request),
  nearFee: (to) => nearSendFeeCeiling(nearRpc, to),
})

/** The last good read of this wallet, without reading again. Only while unlocked; null when there's none. */
const savedPortfolio = async (): Promise<PortfolioResult | null> => {
  const wallet = getVault()
  if (wallet.status().state === 'none') return null
  const read = await wallet.withAccounts(async (accounts) => {
    const own = portfolioAccounts(accounts)
    return own ? getSavedPortfolios().get(walletKey(own)) : null
  })
  return read.ok && read.value ? { ok: true, ...read.value } : null
}

/** Started with the first chat, so the app opens no socket until something needs one. */
let mcpBridge: Promise<McpBridge> | null = null

function getMcpBridge(): Promise<McpBridge> {
  mcpBridge ??= startMcpBridge({
    // Private to the user on Linux. macOS has no such folder, so the app's own data folder.
    parentDir: process.env.XDG_RUNTIME_DIR ?? app.getPath('userData'),
    version: app.getVersion(),
    // Public addresses only, and only while unlocked. The agent's tools get this function, never the vault.
    accounts: ownAccounts,
    portfolio: () => ownPortfolio(),
    quote: quoteRoute,
    receive: (ask) => ownReceive(ask),
    plans: ({ owner, typed }) =>
      agentPlanTools({
        store: plans,
        owner,
        typed,
        accounts: ownAccounts,
        // A swap's progress, or a payment's legs together: they're followed as `<plan>#<leg>`, never by the plan's own id.
        swapOf: (id) => {
          const plan = plans.get(id, owner)
          return plan ? swapStateOf(id, plan.core) : null
        },
        journeyOf: (id) => (plans.get(id, owner) ? journeyFor(id) : null),
      }),
  }).catch((error: unknown) => {
    mcpBridge = null
    throw error
  })
  return mcpBridge
}

const osSecretBox: SecretBox = {
  // Without a keyring, Linux "encrypts" with a key anyone can look up.
  canKeep: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  seal: (text) => safeStorage.encryptString(text),
  open: (data) => safeStorage.decryptString(data),
}

let vault: VaultService | null = null

function getVault(): VaultService {
  vault ??= createVaultService({
    store: createVaultStore({ file: join(app.getPath('userData'), 'vault.bin'), box: osSecretBox }),
    ask: (request) => signer.askVault(request),
    onStatus: (status) => {
      if (status.state === 'unlocked') autoLock.noteInput()
      sendToWindows(IPC.vaultStatusChanged, status)
      reviews.refresh()
    },
  })
  return vault
}

const autoLock = createAutoLock({
  isUnlocked: () => vault?.isUnlocked() === true,
  lock: () => void vault?.lock(),
})

let externalTools: ExternalTools | null = null

function getExternalTools(): ExternalTools {
  externalTools ??= createExternalTools({
    file: join(app.getPath('userData'), 'external-tools.json'),
    // Nothing ships yet. Issue #11 chooses what does.
    bundled: [],
    readEnv: readNamedShellEnv,
    signIns: createSignIns({
      file: join(app.getPath('userData'), 'external-sign-ins.bin'),
      box: osSecretBox,
      // oauth.ts has checked the address: https, or this computer for a server that's here too.
      openBrowser: (url) => shell.openExternal(url),
    }),
    detect: async () => {
      const env = await agentEnv()
      agents ??= agentEnv().then(detectAgents)
      const codex = (await agents).find(({ id }) => id === 'codex')?.path
      // This process's own if the login shell couldn't be read.
      const claudeConfig = env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR
      return detectEntries({
        claudeDir: claudeConfig ?? join(homedir(), '.claude'),
        claudeJson: claudeConfig ? join(claudeConfig, '.claude.json') : join(homedir(), '.claude.json'),
        codexDir: env.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'),
        codexServers: async () => {
          if (!codex) return null
          const { stdout } = await run(codex, ['mcp', 'list', '--json'], { env: { ...process.env, ...env }, timeoutMs: 5000 })
          return JSON.parse(stdout) as unknown
        },
      })
    },
  })
  return externalTools
}

/**
 * Asks in a native dialog, drawn by the OS and answered by the person. The page
 * asked for this but can't see or click it, which is the point: anything running
 * in the page could otherwise switch on a tool that can move funds.
 */
function nativeConfirm(event: IpcMainInvokeEvent): Confirm {
  return async ({ message, detail, confirm }) => {
    const options = { type: 'warning' as const, buttons: ['Cancel', confirm], defaultId: 0, cancelId: 0, noLink: true, message, detail }
    const win = BrowserWindow.fromWebContents(event.sender)
    const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
    return response === 1
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    assertAppFrame(event)
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      signer: signer.getStatus(),
    }
  })

  ipcMain.handle(IPC.detectAgents, (event, options: unknown): Promise<AgentStatus[]> => {
    assertAppFrame(event)
    const refresh = typeof options === 'object' && options !== null && 'refresh' in options && options.refresh === true
    if (!agents || refresh) agents = agentEnv({ refresh }).then(detectAgents)
    return agents
  })

  ipcMain.handle(IPC.startChat, async (event, agent: unknown, options: unknown): Promise<string> => {
    assertAppFrame(event)
    const asked = typeof options === 'object' && options !== null ? (options as { historyId?: unknown; continue?: unknown }) : {}
    const historyId = typeof asked.historyId === 'string' && CHAT_ID.test(asked.historyId) ? asked.historyId : null
    // A chat goes on only from Ink's own record of it, which is read only while Ink is unlocked.
    let continuing: SavedChat | null = null
    if (asked.continue === true) {
      if (!historyId || vault?.isUnlocked() !== true) throw new Error('Unlock Ink to continue this chat')
      continuing = getChatHistory().get(historyId)
      if (!continuing) throw new Error('Ink no longer keeps that chat')
    }
    const askedIn = pageGeneration
    agents ??= agentEnv().then(detectAgents)
    const status = (await agents).find(({ id }) => id === agent)
    if (!status) throw new Error('Unknown agent')
    const tools = {
      bridge: await getMcpBridge(),
      shim: join(import.meta.dirname, 'shim.js'),
      review: (planId: string, owner: string, notify: NonNullable<Parameters<typeof reviews.offer>[2]>) =>
        void reviews.offer(planId, owner, (status, transactionId) => {
          statusListeners.set(planId, notify)
          if (statusListeners.size > MAX_FOLLOWED) statusListeners.delete(statusListeners.keys().next().value as string)
          notify(status, transactionId)
          const follow = followed.get(planId)
          if (follow && transactionId) follow.transactionId = transactionId
          endingOf(planId)
        }),
      follow: (planId: string, owner: string, listen: { swap: (swap: ChatSwap) => void; journey: (journey: PlanJourney) => void; ending: (ending: PlanEnding) => void }) => {
        followed.set(planId, { owner, ...listen, transactionId: null, ended: false })
        if (followed.size > MAX_FOLLOWED) followed.delete(followed.keys().next().value as string)
      },
      deposits: (chatId: string, owner: string, ask: ReceiveAsk, answer: Extract<ReceiveAnswer, { ok: true }>, listen: DepositListen) => void showDeposit(chatId, owner, ask, answer, listen),
    }
    const env = await agentEnv()
    const external = await getExternalTools().forNewChat()
    // Nothing is left to show or close a chat for a page that went away during those waits.
    if (askedIn !== pageGeneration) throw new Error('The page that asked for this chat has gone')
    const chatId = startChat(status, env, tools, external, (sessionId, chatEvent) => {
      if (chatEvent.type === 'session') getExternalTools().noteSignIn(external, chatEvent.needsSignIn)
      const kept = historyOf.get(sessionId)
      const saved = kept ? savedEventOf(chatEvent) : null
      if (kept && saved) getChatHistory().record(kept.id, saved)
      if (chatEvent.type === 'ended') historyOf.delete(sessionId)
      sendToWindows(IPC.chatEvent, sessionId, chatEvent)
    })
    if (historyId) historyOf.set(chatId, { id: historyId, agent: status.id })
    if (continuing && historyId) {
      // The new session hears the chat so far from Ink, then the person carries on.
      const recap = recapOf(continuing)
      getChatHistory().begin(historyId, status.id, continuing.opening)
      getChatHistory().record(historyId, { type: 'continued', agent: status.id, at: Date.now() })
      sendFromInk(chatId, recap)
    }
    return chatId
  })

  ipcMain.handle(IPC.receiveChains, async (event) => {
    assertAppFrame(event)
    return receiveChains(await listedDepositChains())
  })

  ipcMain.handle(IPC.searchReceiveTokens, async (event, chain: unknown, query: unknown) => {
    assertAppFrame(event)
    if (typeof chain !== 'string' || typeof query !== 'string' || !/^[A-Za-z0-9 $._+-]{1,32}$/.test(query.trim())) return []
    const known = receiveChainOf(chain)
    const access = zerionAccess()
    // Zerion knows only some chains; it's asked only for those, and only for a few letters, never an address.
    const found = known?.zerion && access ? await zerionTokenSearch(query.trim(), known.zerion, zerionOptions(access)) : []
    // The page can't load images from the web; main fetches each icon and hands it over as data.
    const zerion = await Promise.all(found.map(async (token) => ({ ...token, icon: token.icon ? await icons.icon(token.icon) : null })))
    return searchTokens(chain, query, await listedDepositChains(), zerion)
  })

  ipcMain.handle(IPC.receiveAddress, (event, ask: unknown) => {
    assertAppFrame(event)
    return ownReceive(ask)
  })

  ipcMain.handle(IPC.copyReceive, async (event, ask: unknown, part: unknown) => {
    assertAppFrame(event)
    // Only for the window in front, and only what main worked out itself.
    const focused = () => BrowserWindow.fromWebContents(event.sender)?.isFocused() === true
    if (!focused() || (part !== 'address' && part !== 'memo')) return { ok: false }
    const found = await ownReceive(ask)
    const text = !found.ok ? null : part === 'memo' ? (found.kind === 'intents' ? found.memo : null) : found.address
    if (!text || !focused()) return { ok: false }
    clipboard.writeText(text)
    return { ok: true }
  })

  ipcMain.handle(IPC.watchDepositAgain, (event, id: unknown) => {
    assertAppFrame(event)
    if (typeof id !== 'string' || id.length > 64) return { ok: false }
    return { ok: depositWatcher.again(id) !== null }
  })

  ipcMain.handle(IPC.savedChats, (event) => {
    assertAppFrame(event)
    return vault?.isUnlocked() === true ? getChatHistory().list() : []
  })

  ipcMain.handle(IPC.deleteSavedChat, (event, id: unknown) => {
    assertAppFrame(event)
    if (typeof id !== 'string' || !CHAT_ID.test(id)) throw new Error('Bad chat')
    getChatHistory().remove(id)
  })

  ipcMain.handle(IPC.clearChatHistory, (event) => {
    assertAppFrame(event)
    getChatHistory().clear()
  })

  ipcMain.handle(IPC.listExternalTools, (event) => {
    assertAppFrame(event)
    return getExternalTools().list()
  })

  ipcMain.handle(IPC.addExternalServer, (event, server: unknown) => {
    assertAppFrame(event)
    return getExternalTools().add(server, nativeConfirm(event))
  })

  ipcMain.handle(IPC.removeExternalServer, (event, id: unknown) => {
    assertAppFrame(event)
    return getExternalTools().remove(id)
  })

  ipcMain.handle(IPC.setExternalEnabled, (event, id: unknown, enabled: unknown) => {
    assertAppFrame(event)
    return getExternalTools().setEnabled(id, enabled, nativeConfirm(event))
  })

  ipcMain.handle(IPC.signInExternal, (event, id: unknown) => {
    assertAppFrame(event)
    return getExternalTools().signIn(id, nativeConfirm(event))
  })

  ipcMain.handle(IPC.cancelExternalSignIn, (event) => {
    assertAppFrame(event)
    getExternalTools().cancelSignIn()
  })

  ipcMain.handle(IPC.signOutExternal, (event, id: unknown) => {
    assertAppFrame(event)
    return getExternalTools().signOut(id)
  })

  ipcMain.handle(IPC.vaultStatus, (event) => {
    assertAppFrame(event)
    return getVault().status()
  })

  ipcMain.handle(IPC.startVaultCreate, (event, words: unknown) => {
    assertAppFrame(event)
    return getVault().startCreate(words)
  })

  ipcMain.handle(IPC.finishVaultCreate, (event, password: unknown, answers: unknown) => {
    assertAppFrame(event)
    return getVault().finishCreate(password, answers)
  })

  ipcMain.handle(IPC.cancelVaultCreate, (event) => {
    assertAppFrame(event)
    return getVault().cancelCreate()
  })

  ipcMain.handle(IPC.restoreVault, (event, words: unknown, password: unknown) => {
    assertAppFrame(event)
    return getVault().restore(words, password)
  })

  ipcMain.handle(IPC.unlockVault, (event, password: unknown) => {
    assertAppFrame(event)
    return getVault().unlock(password)
  })

  ipcMain.handle(IPC.lockVault, (event) => {
    assertAppFrame(event)
    return getVault().lock()
  })

  ipcMain.handle(IPC.vaultAccounts, (event) => {
    assertAppFrame(event)
    return getVault().accounts()
  })

  ipcMain.handle(IPC.portfolio, (event, options: unknown) => {
    assertAppFrame(event)
    const fresh = typeof options === 'object' && options !== null && (options as { fresh?: unknown }).fresh === true
    return ownPortfolio({ fresh })
  })

  ipcMain.handle(IPC.recentSwaps, (event) => {
    assertAppFrame(event)
    return recentSwaps()
  })

  ipcMain.handle(IPC.savedPortfolio, (event) => {
    assertAppFrame(event)
    return savedPortfolio()
  })

  ipcMain.handle(IPC.zerionKeyStatus, (event): ZerionKeyStatus => {
    assertAppFrame(event)
    const keys = getZerionKeys()
    return { set: keys.get() !== null, kept: keys.kept(), shared: INK_SERVICE_URL !== null }
  })

  ipcMain.handle(IPC.saveZerionKey, async (event, key: unknown) => {
    assertAppFrame(event)
    const text = typeof key === 'string' ? key.trim() : ''
    if (!isZerionKey(text)) return { ok: false, reason: 'invalid' } as const
    // Checked before it's kept, so a mistyped key never sits there failing every read.
    const checked = await checkZerionKey({ key: text })
    if (checked !== 'ok') return { ok: false, reason: checked } as const
    getZerionKeys().save(text)
    portfolioReader.forget()
    return { ok: true } as const
  })

  ipcMain.handle(IPC.removeZerionKey, (event) => {
    assertAppFrame(event)
    getZerionKeys().remove()
    portfolioReader.forget()
  })

  ipcMain.handle(IPC.copyAddress, (event, chain: unknown) => {
    assertAppFrame(event)
    return copyAddress(chain, {
      // Looked up each time, since the window may close while the signer answers.
      // Only for the window in front: otherwise a page could write the clipboard in the background.
      focused: () => BrowserWindow.fromWebContents(event.sender)?.isFocused() === true,
      address: (asked) => getVault().address(asked),
      write: (text) => clipboard.writeText(text),
    })
  })

  ipcMain.handle(IPC.sendToChat, (event, chatId: unknown, text: unknown) => {
    assertAppFrame(event)
    if (typeof chatId !== 'string' || typeof text !== 'string') throw new Error('Bad message')
    sendToChat(chatId, text)
    const kept = historyOf.get(chatId)
    if (kept) {
      // A chat is kept from its first message, which names it.
      if (!getChatHistory().get(kept.id)) getChatHistory().begin(kept.id, kept.agent, text)
      const saved = savedEventOf({ type: 'you', text })
      if (saved) getChatHistory().record(kept.id, saved)
    }
  })

  ipcMain.handle(IPC.stopChatTurn, (event, chatId: unknown) => {
    assertAppFrame(event)
    if (typeof chatId !== 'string') throw new Error('Bad chat')
    stopChatTurn(chatId)
  })

  ipcMain.handle(IPC.closeChat, (event, chatId: unknown) => {
    assertAppFrame(event)
    if (typeof chatId !== 'string') throw new Error('Bad chat')
    closeChat(chatId)
  })
}

app.on('second-instance', () => {
  const [win] = appWindows()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
  // Real input only: a page's script can't raise this to keep the wallet unlocked.
  contents.on('input-event', () => autoLock.noteInput())
})

void app.whenReady().then(() => {
  if (!primary) return

  // No camera, microphone, notifications-by-prompt or anything else a page can
  // ask for. Features that need one are granted from main, not by the page.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  // Dev keeps Electron's default menu, with Reload and DevTools.
  if (!devServerUrl) Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(process.platform)))

  registerIpc()
  reviewWindow.attach(reviews)
  // Swaps a quit cut off are followed again: NEAR Intents pays them out or refunds them whatever Ink does.
  // Payouts a quit left held come back first, so legs that land as their swaps are picked up release them.
  sender.resumePayouts()
  swapTracker.resume()
  // Legs that landed while Ink was closed have nothing more to report, so their payouts are settled now.
  for (const planId of sender.heldLegs().keys()) settlePayout(planId)
  // Deposits too: what's sent to an address lands whether or not Ink is running.
  depositWatcher.resume()
  signer.start()
  autoLock.start()
  powerMonitor.on('suspend', () => void vault?.lock())
  powerMonitor.on('lock-screen', () => void vault?.lock())
  createMainWindow()

  app.on('activate', () => {
    if (appWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  signer.stop()
  stopRuns()
  killChats()
  chatHistory?.flush()
  void mcpBridge?.then((bridge) => bridge.close())
})
