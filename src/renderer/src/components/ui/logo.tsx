import aptosChain from '@/assets/crypto/chains/aptos.svg'
import arbitrumChain from '@/assets/crypto/chains/arbitrum.svg'
import baseChain from '@/assets/crypto/chains/base.svg'
import bitcoinChain from '@/assets/crypto/chains/bitcoin.svg'
import bscChain from '@/assets/crypto/chains/bsc.svg'
import ethereumChain from '@/assets/crypto/chains/ethereum.svg'
import nearChain from '@/assets/crypto/chains/near.svg'
import optimismChain from '@/assets/crypto/chains/optimism.svg'
import polygonChain from '@/assets/crypto/chains/polygon.svg'
import solanaChain from '@/assets/crypto/chains/solana.svg'
import suiChain from '@/assets/crypto/chains/sui.svg'
import tronChain from '@/assets/crypto/chains/tron.svg'
import aptToken from '@/assets/crypto/tokens/apt.svg'
import btcToken from '@/assets/crypto/tokens/btc.svg'
import ethToken from '@/assets/crypto/tokens/eth.svg'
import nearToken from '@/assets/crypto/tokens/near.svg'
import solToken from '@/assets/crypto/tokens/sol.svg'
import suiToken from '@/assets/crypto/tokens/sui.svg'
import trxToken from '@/assets/crypto/tokens/trx.svg'
import usdcToken from '@/assets/crypto/tokens/usdc.svg'
import usdtToken from '@/assets/crypto/tokens/usdt.svg'
import { capStack, chainBadge, isTokenSymbol, type ChainId, type TokenSymbol } from '@/lib/logos'
import { cn } from '@/lib/cn'

const CHAIN_SRC: Record<ChainId, string> = {
  near: nearChain,
  ethereum: ethereumChain,
  base: baseChain,
  arbitrum: arbitrumChain,
  optimism: optimismChain,
  polygon: polygonChain,
  bsc: bscChain,
  solana: solanaChain,
  bitcoin: bitcoinChain,
  tron: tronChain,
  sui: suiChain,
  aptos: aptosChain,
}

const TOKEN_SRC: Record<TokenSymbol, string> = {
  NEAR: nearToken,
  ETH: ethToken,
  USDC: usdcToken,
  USDT: usdtToken,
  SOL: solToken,
  BTC: btcToken,
  TRX: trxToken,
  SUI: suiToken,
  APT: aptToken,
}

export type LogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

/** A mark on a disc, white in light mode and a soft tint in dark, so every brand colour reads. */
function Mark({ src, size = 'md', label, className }: { src: string; size?: LogoSize; label?: string; className?: string }) {
  return (
    <span className={cn('ink-logo', `ink-logo--${size}`, className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <img src={src} alt="" draggable={false} />
    </span>
  )
}

export function ChainLogo({ chain, size, label }: { chain: ChainId; size?: LogoSize; label?: string }) {
  return <Mark src={CHAIN_SRC[chain]} size={size} label={label} />
}

/**
 * A token's mark, with its chain as a small badge only where the chain adds
 * something: USDC on Base gets one, NEAR on NEAR doesn't. A symbol Ink has no
 * mark for falls back to its chain's mark, then to its first letters.
 */
export function TokenLogo({ symbol, chain, size = 'md', label }: { symbol: string; chain?: string | null; size?: LogoSize; label?: string }) {
  const badge = chainBadge(symbol, chain)
  const src = isTokenSymbol(symbol) ? TOKEN_SRC[symbol.toUpperCase() as TokenSymbol] : badge ? CHAIN_SRC[badge] : null
  const mark = src ? (
    <Mark src={src} size={size} label={label} />
  ) : (
    <span className={cn('ink-logo ink-logo--text', `ink-logo--${size}`)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {symbol.slice(0, 3).toUpperCase()}
    </span>
  )
  if (!badge || !src || !isTokenSymbol(symbol)) return mark
  return (
    <span className="ink-logo-pair">
      {mark}
      <Mark src={CHAIN_SRC[badge]} size="xs" className="ink-logo-pair__badge" />
    </span>
  )
}

/** Overlapping chain marks, at most three, then "+N". */
export function ChainStack({ chains, size = 'sm', max = 3 }: { chains: readonly ChainId[]; size?: LogoSize; max?: number }) {
  const { shown, more } = capStack(chains, max)
  return (
    <span className="ink-logo-stack" aria-hidden>
      {shown.map((chain) => (
        <ChainLogo key={chain} chain={chain} size={size} />
      ))}
      {more > 0 ? <span className="ink-logo-more">+{more}</span> : null}
    </span>
  )
}
