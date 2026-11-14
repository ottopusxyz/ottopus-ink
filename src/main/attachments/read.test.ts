import { describe, expect, it } from 'vitest'
import { cleanText, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_CHARS, readAttachment } from './read'

/** A one-page PDF with each line of text drawn in Helvetica, offsets and all. */
function tinyPdf(lines: string[]): Uint8Array {
  const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`)
  const stream = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((line) => `(${escape(line)}) Tj T*`).join(' ')} ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

const SOL = '5QSRmvpHimVhXh2YP622A61vaThB8ut2iWJW9DPmCTNj'

describe('reading an attached file', () => {
  it('reads a PDF invoice’s text, address and all, and counts its pages', async () => {
    const read = await readAttachment('Invoice 42.PDF', tinyPdf(['Invoice 42', 'Amount due: 6 USDC on Solana', `Pay to: ${SOL}`]))
    expect(read).toMatchObject({ ok: true, pages: 1, cut: false })
    if (!read.ok) return
    expect(read.text).toContain('Amount due: 6 USDC on Solana')
    expect(read.text).toContain(SOL)
  })

  it('reads text files as they are', async () => {
    const read = await readAttachment('invoice.txt', new TextEncoder().encode(`Pay 25 USDC on Base\r\nto 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed\r\n`))
    expect(read).toEqual({ ok: true, text: 'Pay 25 USDC on Base\nto 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', pages: null, cut: false })
  })

  it('refuses other kinds of file, files too big, and files with no text to read', async () => {
    expect(await readAttachment('invoice.png', new Uint8Array([1, 2, 3]))).toEqual({ ok: false, reason: 'not-supported' })
    expect(await readAttachment('invoice.exe', new Uint8Array([1]))).toEqual({ ok: false, reason: 'not-supported' })
    expect(await readAttachment('big.pdf', new Uint8Array(MAX_ATTACHMENT_BYTES + 1))).toEqual({ ok: false, reason: 'too-big' })
    expect(await readAttachment('scan.pdf', tinyPdf([]))).toEqual({ ok: false, reason: 'no-text' })
    expect(await readAttachment('broken.pdf', new TextEncoder().encode('not a pdf at all'))).toEqual({ ok: false, reason: 'unreadable' })
    expect(await readAttachment('binary.txt', new Uint8Array([0xff, 0xfe, 0x00, 0xd8]))).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('cleaning a file’s text', () => {
  it('drops characters that can hide or reorder text, and squeezes spacing, but leaves addresses as they are', () => {
    expect(cleanText(`Pay\u200B to\u202E ${SOL}\u0007\n\n\n\nThanks   you`)).toEqual({ text: `Pay to ${SOL}\n\nThanks you`, cut: false })
  })

  it('cuts a very long text to the most the agent is given, and says so', () => {
    const read = cleanText('a'.repeat(MAX_ATTACHMENT_CHARS + 10))
    expect(read.text).toHaveLength(MAX_ATTACHMENT_CHARS)
    expect(read.cut).toBe(true)
  })
})
