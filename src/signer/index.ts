import type { SignerRequest, SignerResponse } from '../shared/ipc'
import { createVaultState } from './vault-state'

const vault = createVaultState()

const reply = (response: SignerResponse) => process.parentPort.postMessage(response)

/**
 * The signer utility process, and the only process that holds the decrypted
 * seed. It reads no files and logs nothing: main hands it the encrypted vault.
 */
process.parentPort.on('message', (event: { data: SignerRequest }) => {
  const request = event.data
  if (request.type === 'ping') reply({ type: 'pong', id: request.id })
  if (request.type === 'vault') void vault.handle(request.request).then((result) => reply({ type: 'vault', id: request.id, result }))
})
