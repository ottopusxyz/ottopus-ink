import { useEffect, useState } from 'react'
import type { VaultStatus } from '../../../shared/vault'

/**
 * The vault's state, kept current by main. Null until the first answer, so the
 * app shows nothing rather than a screen it might have to take back.
 */
export function useVault(): VaultStatus | null {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  useEffect(() => {
    // Subscribe before asking, so a change between the two isn't missed. A pushed status wins.
    let pushed = false
    const unsubscribe = window.ink.onVaultStatus((next) => {
      pushed = true
      setStatus(next)
    })
    window.ink.vaultStatus().then(
      (next) => {
        if (!pushed) setStatus(next)
      },
      (error: unknown) => console.error('Could not read the vault status', error),
    )
    return unsubscribe
  }, [])
  return status
}
