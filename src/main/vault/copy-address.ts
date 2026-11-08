import type { VaultResult } from '../../shared/vault'

export interface CopyAddressDeps {
  /** Whether the window that asked is in front right now. */
  focused: () => boolean
  /** The chain's address as the signer gave it. The chain comes from the page, so this checks it. */
  address: (chain: unknown) => Promise<VaultResult<{ address: string }>>
  write: (text: string) => void
}

/**
 * Copies a chain's address as the signer gave it, never text from the page, and only
 * while the window that asked is in front. Focus is checked again after the signer
 * answers: the person may have switched to another app meanwhile, and writing then
 * would overwrite whatever they had just copied there.
 */
export async function copyAddress(chain: unknown, { focused, address, write }: CopyAddressDeps): Promise<VaultResult> {
  if (!focused()) return { ok: false, reason: 'bad-input' }
  const answer = await address(chain)
  if (!answer.ok) return answer
  if (!focused()) return { ok: false, reason: 'bad-input' }
  write(answer.address)
  return { ok: true }
}
