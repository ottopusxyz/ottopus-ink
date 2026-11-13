import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { Portfolio } from '../../shared/portfolio'
import type { SecretBox } from '../external/sign-ins'
import type { PortfolioAccounts } from './reader'

/** Which wallet a saved read belongs to: a hash of its addresses, so a different wallet never sees another's figures. */
export function walletKey(accounts: PortfolioAccounts): string {
  return createHash('sha256').update(JSON.stringify([accounts.near, accounts.evm ?? null, accounts.solana ?? null, accounts.tron ?? null])).digest('hex')
}

export interface SavedPortfolios {
  /** The last good read for this wallet, or null. */
  get(wallet: string): Portfolio | null
  save(wallet: string, portfolio: Portfolio): void
  forget(): void
}

/**
 * The last good read of the wallet's portfolio, so a screen can show it at once and update
 * it in the background. It holds addresses and balances, so it's kept like a sign-in:
 * encrypted by the OS keyring, or in memory for this run only where there is none. Main
 * hands it out only while the vault is unlocked, the same as a live read.
 */
export function createSavedPortfolios({ file, box }: { file: string; box: SecretBox }): SavedPortfolios {
  let kept: { wallet: string; portfolio: Portfolio } | null | undefined

  const load = (): { wallet: string; portfolio: Portfolio } | null => {
    if (!box.canKeep()) return null
    try {
      const parsed: unknown = JSON.parse(box.open(readFileSync(file)))
      if (typeof parsed !== 'object' || parsed === null) return null
      const { wallet, portfolio } = parsed as { wallet?: unknown; portfolio?: unknown }
      // Only the shape this version writes: an older or damaged file is dropped, not trusted.
      if (typeof wallet !== 'string' || typeof portfolio !== 'object' || portfolio === null || !Array.isArray((portfolio as Portfolio).tokens) || typeof (portfolio as Portfolio).readAt !== 'number') return null
      return { wallet, portfolio: portfolio as Portfolio }
    } catch {
      return null
    }
  }

  return {
    get(wallet) {
      if (kept === undefined) kept = load()
      return kept?.wallet === wallet ? kept.portfolio : null
    },
    save(wallet, portfolio) {
      kept = { wallet, portfolio }
      if (!box.canKeep()) return
      try {
        const temporary = `${file}.${randomUUID()}`
        writeFileSync(temporary, box.seal(JSON.stringify(kept)), { mode: 0o600 })
        renameSync(temporary, file)
      } catch {
        // Not kept on disk this time; the copy in memory still serves this run.
      }
    },
    forget() {
      kept = null
      rmSync(file, { force: true })
    },
  }
}
