/**
 * Where a key moves the selection in a radio group or similar row: the arrows
 * step and wrap, Home and End jump to the ends. Null for any other key, so it
 * keeps its normal meaning.
 */
export function stepIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
