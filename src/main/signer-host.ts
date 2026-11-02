import { utilityProcess, type UtilityProcess } from 'electron'
import type { SignerRequest, SignerResponse, SignerStatus } from '../shared/ipc'

/**
 * Owns the signer utility process. In M1 the signer holds nothing and only
 * answers a ping; the point is that the process boundary exists from day one,
 * so later signing code has nowhere else to live.
 */
export class SignerHost {
  private child: UtilityProcess | null = null
  private status: SignerStatus = 'stopped'
  private nextId = 1

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
      if (this.child === child && message.type === 'pong') this.setStatus('ready')
    })
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.setStatus('stopped')
    })
    const ping: SignerRequest = { type: 'ping', id: this.nextId++ }
    child.postMessage(ping)
  }

  stop(): void {
    this.child?.kill()
    this.child = null
    this.setStatus('stopped')
  }
}
