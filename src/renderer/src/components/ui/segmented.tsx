import type { KeyboardEvent } from 'react'
import { stepIndex } from '@/lib/roving'

/**
 * A choice of a few options as one radio group: one tab stop on the chosen
 * option, and the arrow keys move the choice, as the role promises a screen reader.
 */
export function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly (readonly [string, string])[]
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = stepIndex(event.key, index, options.length)
    const option = next === null ? undefined : options[next]
    if (next === null || !option) return
    event.preventDefault()
    onChange(option[0])
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div className="ink-segmented" role="radiogroup" aria-label={label}>
      {options.map(([id, text], index) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          tabIndex={value === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
