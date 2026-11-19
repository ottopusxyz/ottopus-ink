import type { SwapReport } from '../routes/one-click'
import type { DepositAddress } from './deposits'

/** Past this, Ink asks for a new address before it shows a kept one again. */
export const ADDRESS_MARGIN_MS = 24 * 60 * 60_000
/** When 1Click can't give a new one, a kept address is still shown while this much is left, enough for a slow chain to confirm. */
export const ADDRESS_LAST_MS = 6 * 60 * 60_000
/** How long a check that nothing was sent to a kept address holds, so Receive asking again quickly costs nothing. */
export const STATUS_HOLD_MS = 15_000

export interface AddressKeeperDeps {
  /** A new address from 1Click, or null when it can't give one. */
  ask: (account: string, token: { id: string; decimals: number }) => Promise<DepositAddress | null>
  /** Where 1Click's deposit at an address, with its memo where it has one, stands, or null when it can't be read. */
  status: (depositAddress: string, memo: string | null) => Promise<SwapReport | null>
  now?: () => number
}

/**
 * NEAR Intents deposit addresses, one kept per account and token. Each is 1Click's, for
 * one quote, and closes after a few days. Ink keeps showing the same one, so what Receive
 * shows, what Copy copies and what the agent was told agree. It asks for a new one once
 * less than a day is left, or once anything was sent to the kept one: that quote's deposit
 * is under way or done, and a second one sent there wouldn't be its own. When 1Click can't
 * give a new one, a kept one nothing was sent to is still shown while hours are left.
 */
export function createAddressKeeper({ ask, status, now = Date.now }: AddressKeeperDeps) {
  const kept = new Map<string, { address: DepositAddress; checkedAt: number }>()

  /** Whether 1Click still has nothing at the kept address. Null when it can't say. */
  const unused = async (entry: { address: DepositAddress; checkedAt: number }): Promise<boolean | null> => {
    if (now() - entry.checkedAt < STATUS_HOLD_MS) return true
    const report = await status(entry.address.address, entry.address.memo).catch(() => null)
    if (!report) return null
    if (report.stage !== 'PENDING_DEPOSIT') return false
    entry.checkedAt = now()
    return true
  }

  return {
    async address(account: string, token: { id: string; decimals: number }): Promise<DepositAddress | null> {
      const id = `${account} ${token.id}`
      const entry = kept.get(id)
      const free = entry ? await unused(entry) : null
      if (entry && free === false) kept.delete(id)
      const left = entry ? entry.address.until - now() : 0
      if (entry && free === true && left > ADDRESS_MARGIN_MS) return entry.address
      const fresh = await ask(account, token)
      if (fresh) {
        kept.set(id, { address: fresh, checkedAt: now() })
        return fresh
      }
      // 1Click gave none: the kept one still serves while it's unused and hours are left.
      return entry && free === true && left > ADDRESS_LAST_MS ? entry.address : null
    },

    /** Forgets an address, with its memo where it has one, once something was sent to it, so the next ask gets a new one. */
    forget(depositAddress: string, memo: string | null): void {
      for (const [id, entry] of kept) if (entry.address.address === depositAddress && entry.address.memo === memo) kept.delete(id)
    },
  }
}

export type AddressKeeper = ReturnType<typeof createAddressKeeper>
