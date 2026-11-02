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

  constructor(private readonly entry: string) {}

  getStatus(): SignerStatus {
    return this.status
  }

  start(): void {
    if (this.child) return
    this.status = 'starting'
    const child = utilityProcess.fork(this.entry, [], {
      serviceName: 'Ottopus Ink Signer',
      // The signer gets a clean environment: nothing the user's shell or an
      // agent may have exported reaches it.
      env: {},
      stdio: 'inherit',
    })
    this.child = child
    child.on('message', (message: SignerResponse) => {
      if (message.type === 'pong') this.status = 'ready'
    })
    child.on('exit', () => {
      this.child = null
      this.status = 'stopped'
    })
    const ping: SignerRequest = { type: 'ping', id: this.nextId++ }
    child.postMessage(ping)
  }

  stop(): void {
    this.child?.kill()
    this.child = null
    this.status = 'stopped'
  }
}
