import { useMemo } from 'react'
import { qrShape } from '@/lib/qr'

/**
 * Dark modules on white in both themes: scanners expect a light background,
 * and an inverted code fails on many phones.
 */
export function QrCode({ value, label, size = 176 }: { value: string; label: string; size?: number }) {
  const shape = useMemo(() => qrShape(value), [value])
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${shape.size} ${shape.size}`}
      shapeRendering="crispEdges"
      className="flex-none rounded-[10px]"
    >
      <rect width={shape.size} height={shape.size} fill="#ffffff" />
      <path d={shape.path} fill="#0b1320" />
    </svg>
  )
}
