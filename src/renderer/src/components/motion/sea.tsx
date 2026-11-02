import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { BubbleField } from './bubble-field'
import { GUTTER_LIFE, SeaLife, type SeaCreature } from './sea-life'

/** Light from the surface, as [left, width, tilt]: one shaft near each edge. */
const SHAFTS: readonly [string, number, string][] = [
  ['6%', 120, '12deg'],
  ['78%', 170, '15deg'],
]

/**
 * The narrow plan pane beside a chat. Three creatures, low in the column,
 * because the top of it is where the plan's steps are read.
 */
export const PANE_LIFE: readonly SeaCreature[] = [
  { species: 'fish', left: 78, top: 70, size: 22, travel: -180, lift: -12, delay: 0, duration: 70, opacity: 0.85 },
  { species: 'jelly', left: 86, top: 82, size: 20, travel: 12, lift: -120, delay: 9, duration: 54, opacity: 0.7 },
  { species: 'crab', left: 14, top: 95, size: 20, travel: 70, lift: 0, delay: 3, duration: 40, opacity: 0.8 },
]

export interface SeaProps {
  creatures?: readonly SeaCreature[]
  /** Leave out the light shafts, for panes too narrow to hold two. */
  shafts?: boolean
  className?: string
}

/**
 * The water behind a panel: the gradient, caustics, light, bubbles and sea
 * life of the Ottopus review page, in one inert layer. The panel's content
 * sits above it in a relative container.
 */
export function Sea({ creatures = GUTTER_LIFE, shafts = true, className }: SeaProps) {
  return (
    <div aria-hidden className={cn('ink-sea pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div className="ot-caustic" />
      <div className="ot-caustic ot-caustic--b" />
      {shafts
        ? SHAFTS.map(([left, width, tilt]) => (
            <span
              key={left}
              className="ot-shaft ot-land-shaft"
              style={{ left, width, height: '120%', '--ot-shaft-tilt': tilt } as CSSProperties}
            />
          ))
        : null}
      <BubbleField pattern="canvas" />
      <SeaLife creatures={creatures} />
    </div>
  )
}
