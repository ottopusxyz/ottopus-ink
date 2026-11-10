import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/**
 * L1 · Tentacle ring, from the Ottopus loader family: eight dots, one per arm.
 * The inline wait, for a badge or a button. It takes the text colour unless told
 * to use the plan blue.
 */
export function Ring({ size = 14, tone = 'current', label, className }: { size?: number; tone?: 'current' | 'plan'; label?: string; className?: string }) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('ink-ring', tone === 'plan' && 'ink-ring--plan', className)}
      style={{ '--ink-ring': `${size}px` } as CSSProperties}
    >
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
  )
}
