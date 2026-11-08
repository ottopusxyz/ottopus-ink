import { encode } from 'uqr'

/** The quiet zone scanners expect around a code, in modules. */
const QUIET = 4

export interface QrShape {
  /** Width and height in modules, quiet zone included. */
  size: number
  /** One SVG path of the dark modules, a run of them per rectangle. */
  path: string
}

/**
 * A QR code for text, drawn in the page with no network call. Medium error
 * correction, so a scuffed screen or a glare still scans.
 */
export function qrShape(text: string): QrShape {
  const { data } = encode(text, { ecc: 'M', border: QUIET })
  let path = ''
  data.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x++
        continue
      }
      const start = x
      while (x < row.length && row[x]) x++
      path += `M${start} ${y}h${x - start}v1h${start - x}z`
    }
  })
  return { size: data.length, path }
}
