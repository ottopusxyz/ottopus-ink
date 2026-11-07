import { utilityProcess, type UtilityProcess } from 'electron'
import type { SignerRequest, SignerResponse, SignerStatus } from '../shared/ipc'
import type { VaultRequest, VaultResult } from '../shared/vault'

/** Far longer than encrypting takes. A signer this late is stuck, and is stopped so it can't keep a seed. */
const ANSWER_MS = 60_000

const stopped: VaultResult<never> = { ok: false, reason: 'signer-stopped' }

/**
 * Owns the signer utility process. The process boundary exists so signing code
 * has nowhere else to live, and so ending the process is a sure way to lock.
 */
export class SignerHost {
  private child: UtilityProcess | null = null
  private status: SignerStatus = 'stopped'
  private nextId = 1
  private readonly waiting = new Map<number, (result: VaultResult<object>) => void>()

  /** onStatus hears every change, so the window is told rather than asking. */
  constructor(
    private readonly entry: string,
    private readonly onStatus: (status: SignerStatus) => void,
  ) {}

  getStatus(): SignerStatus {
    return this.status
  }

  private setStatus(status: SignerStatus): void {
    if (status === this.status) return
    this.status = status
    this.onStatus(status)
  }

  private abandonWaiting(): void {
    for (const answer of this.waiting.values()) answer(stopped)
    this.waiting.clear()
  }

  start(): void {
    if (this.child) return
    this.setStatus('starting')
    const child = utilityProcess.fork(this.entry, [], {
      serviceName: 'Ottopus Ink Signer',
      // The signer gets a clean environment: nothing the user's shell or an
      // agent may have exported reaches it.
      env: {},
      stdio: 'inherit',
    })
    this.child = child
    // A process that was stopped and replaced can still report in late. Only
    // the current child may change the state.
    child.on('message', (message: SignerResponse) => {
      if (this.child !== child) return
      if (message.type === 'pong') this.setStatus('ready')
      if (message.type === 'vault') {
        this.waiting.get(message.id)?.(message.result)
        this.waiting.delete(message.id)
      }
    })
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.abandonWaiting()
      this.setStatus('stopped')
    })
    const ping: SignerRequest = { type: 'ping', id: this.nextId++ }
    child.postMessage(ping)
  }

  /** Starts the signer if it has stopped: a new one holds nothing, so that's safe. */
  askVault(request: VaultRequest): Promise<VaultResult<object>> {
    this.start()
    const child = this.child
    if (!child) return Promise.resolve(stopped)
    return new Promise((resolve) => {
      const id = this.nextId++
      const timer = setTimeout(() => this.stop(), ANSWER_MS)
      this.waiting.set(id, (result) => {
        clearTimeout(timer)
        resolve(result)
      })
      const message: SignerRequest = { type: 'vault', id, request }
      child.postMessage(message)
    })
  }

  stop(): void {
    this.child?.kill()
    this.child = null
    this.abandonWaiting()
    this.setStatus('stopped')
  }
}
