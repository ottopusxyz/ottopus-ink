import type { PlanSwap } from '../../shared/plan'
import { formatUnits } from '../../shared/token-text'

/** What a swap sends, as a person reads it: "2 NEAR", "25 USDC". Null when its terms can't be read. */
export function swapSent(swap: Pick<PlanSwap, 'amountIn' | 'sendSymbol' | 'sendDecimals'>): string | null {
  const decimals = swap.sendDecimals ?? '24'
  if (!/^(0|[1-9][0-9]*)$/.test(swap.amountIn) || !/^[0-9]{1,2}$/.test(decimals)) return null
  return `${formatUnits(BigInt(swap.amountIn), Number(decimals))} ${swap.sendSymbol}`
}

/** Where a swap's refund goes, in a phrase: "your NEAR account", "your NEAR Intents balance". */
export const refundPlace = (swap: Pick<PlanSwap, 'payFrom'>): string => (swap.payFrom === 'intents' ? 'your NEAR Intents balance' : 'your NEAR account')
