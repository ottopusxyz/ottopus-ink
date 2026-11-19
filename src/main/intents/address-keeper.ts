import type { SwapReport, SwapStage } from '../routes/one-click'
import type { DepositAddress } from './deposits'

/** Past this, Ink asks for a new address before it shows a kept one again. */
export const ADDRESS_MARGIN_MS = 24 * 60 * 60_000
/** When 1Click can't give a new one, a kept address is still shown while this much is left, enough for a slow chain to confirm. */
export const ADDRESS_LAST_MS = 6 * 60 * 60_000
/**
 * Where a kept address can still be given out: nothing sent yet, or a deposit under the
 * minimum waiting for the rest, which goes to that same address.
 */
const OPEN: ReadonlySet<SwapStage> = new Set(['PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT'])

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
 * shows and what the agent was told agree. 1Click is asked where the kept one stands each
 * time. Ink asks for a new one once less than a day is left, or once a deposit there is
 * under way or done: a second one sent there wouldn't be its own. A deposit under the
 * minimum keeps it, since the rest goes to the same address. When 1Click can't give a new
 * one, a kept one that's still open is shown while hours are left.
 */
export function createAddressKeeper({ ask, status, now = Date.now }: AddressKeeperDeps) {
  const kept = new Map<string, DepositAddress>()

  /** Whether the kept address can still be given out, asked of 1Click each time. Null when it can't say. */
  const open = async (address: DepositAddress): Promise<boolean | null> => {
    const report = await status(address.address, address.memo).catch(() => null)
    return report ? OPEN.has(report.stage) : null
  }

  return {
    async address(account: string, token: { id: string; decimals: number }): Promise<DepositAddress | null> {
      const id = `${account} ${token.id}`
      const entry = kept.get(id)
      const free = entry ? await open(entry) : null
      if (entry && free === false) kept.delete(id)
      const left = entry ? entry.until - now() : 0
      if (entry && free === true && left > ADDRESS_MARGIN_MS) return entry
      const fresh = await ask(account, token)
      if (fresh) {
        kept.set(id, fresh)
        return fresh
      }
      // 1Click gave none: the kept one still serves while it's open and hours are left.
      return entry && free === true && left > ADDRESS_LAST_MS ? entry : null
    },

    /** Forgets an address, with its memo where it has one, once something was sent to it, so the next ask gets a new one. */
    forget(depositAddress: string, memo: string | null): void {
      for (const [id, entry] of kept) if (entry.address === depositAddress && entry.memo === memo) kept.delete(id)
    },
  }
}

export type AddressKeeper = ReturnType<typeof createAddressKeeper>
