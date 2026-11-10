import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/** Light from the surface, as [left, width, tilt]: one shaft near each edge. */
const SHAFTS: readonly [string, number, string][] = [
  ['6%', 120, '12deg'],
  ['78%', 170, '15deg'],
]

export interface SeaProps {
  /** Leave out the light shafts, for panes too narrow to hold two. */
  shafts?: boolean
  className?: string
}

/**
 * The water behind a panel: the gradient, caustics and light of the Ottopus
 * review page, in one inert layer. It holds still, so the things that move on
 * a screen are Otto, the loaders and the composer's edge while the agent works.
 * The panel's content sits above it in a relative container.
 */
export function Sea({ shafts = true, className }: SeaProps) {
  return (
    <div aria-hidden className={cn('ink-sea pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div className="ot-caustic ink-still" />
      <div className="ot-caustic ot-caustic--b ink-still" />
      {shafts
        ? SHAFTS.map(([left, width, tilt]) => (
            <span
              key={left}
              className="ot-shaft ot-land-shaft ink-still"
              style={{ left, width, height: '120%', '--ot-shaft-tilt': tilt, transform: `rotate(${tilt})` } as CSSProperties}
            />
          ))
        : null}
    </div>
  )
}
