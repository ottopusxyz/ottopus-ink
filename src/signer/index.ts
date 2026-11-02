import type { SignerRequest, SignerResponse } from '../shared/ipc'

/**
 * The signer utility process. It will hold the decrypted seed while the app is
 * unlocked (M2). For now it only proves the boundary by answering pings.
 */
process.parentPort.on('message', (event: { data: SignerRequest }) => {
  const request = event.data
  if (request.type === 'ping') {
    const response: SignerResponse = { type: 'pong', id: request.id }
    process.parentPort.postMessage(response)
  }
})
