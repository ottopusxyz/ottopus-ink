import { cloneElement, useEffect, useId, useRef, type CSSProperties, type ReactElement } from 'react'
import { cn } from '@/lib/cn'

/** Long enough that moving past something doesn't flash a tooltip. */
const OPEN_MS = 250
/** Long enough to move the pointer onto the tooltip, to read or select it. */
const CLOSE_MS = 120

export interface TooltipProps {
  text: string
  /**
   * One element that can take focus, so a keyboard reaches the tooltip too. An
   * unavailable button should use aria-disabled here rather than disabled, which
   * can't be focused.
   */
  children: ReactElement<{ 'aria-describedby'?: string }>
  className?: string
}

/**
 * Says what something means or why it's off, on hover or focus. A native hint
 * popover anchored to the trigger: it sits in the top layer, so no panel clips it,
 * and the browser handles Escape.
 */
export function Tooltip({ text, children, className }: TooltipProps) {
  const id = useId()
  const anchor = `--ink-tip-${id.replace(/[^\w-]/g, '')}`
  const tip = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const set = (open: boolean, delay: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => tip.current?.togglePopover(open), delay)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <span
      className={cn('ink-tip', className)}
      style={{ anchorName: anchor } as CSSProperties}
      onMouseEnter={() => set(true, OPEN_MS)}
      onMouseLeave={() => set(false, CLOSE_MS)}
      onFocus={() => set(true, 0)}
      onBlur={() => set(false, 0)}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span ref={tip} id={id} role="tooltip" popover="hint" className="ink-tooltip" style={{ positionAnchor: anchor } as CSSProperties}>
        {text}
      </span>
    </span>
  )
}
