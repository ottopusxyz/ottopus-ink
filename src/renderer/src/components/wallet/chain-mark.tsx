import { ChainLogo, IntentsLogo } from '@/components/ui'
import { cn } from '@/lib/cn'
import { isChainId } from '@/lib/logos'

/** A chain's mark: Ink's own where it has one, else its initial. */
export function ChainMark({ chain, size = 'md' }: { chain: { mark: string | null; name: string }; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  if (chain.mark && isChainId(chain.mark)) return <ChainLogo chain={chain.mark} size={size} />
  if (chain.mark === 'ton' || chain.mark === 'xrp') return <IntentsLogo chain={chain.mark} size={size} />
  return (
    <span className={cn('ink-logo ink-logo--text', `ink-logo--${size}`)} aria-hidden>
      {chain.name.slice(0, 1)}
    </span>
  )
}
