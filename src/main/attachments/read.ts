import { extname } from 'node:path'
import { getDocumentProxy } from 'unpdf'
import type { AttachmentFailure } from '../../shared/ipc'

/** Larger than any invoice needs to be. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** The most of a file's text the agent is given. An invoice is far shorter. */
export const MAX_ATTACHMENT_CHARS = 40_000
/** The most pages read from a PDF. */
const MAX_PAGES = 30

/** Control characters but tab and line break, and the invisible ones that can hide or reorder text. */
// eslint-disable-next-line no-control-regex -- these are what's being removed.
export const HIDDEN_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g

/** The files Ink reads, by extension: PDFs, and plain text in a few forms. */
export const ATTACHMENT_EXTENSIONS = ['pdf', 'txt', 'md', 'csv', 'json'] as const

export type { AttachmentFailure }

export type AttachmentRead = { ok: true; text: string; pages: number | null; cut: boolean } | { ok: false; reason: AttachmentFailure }

/**
 * Plain words from a file's text: control characters gone, runs of spaces and blank lines
 * squeezed, and cut to the most the agent is given. Nothing else is changed, so an address
 * in it reads exactly as the file has it.
 */
export function cleanText(raw: string): { text: string; cut: boolean } {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(HIDDEN_CHARS, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > MAX_ATTACHMENT_CHARS ? { text: text.slice(0, MAX_ATTACHMENT_CHARS), cut: true } : { text, cut: false }
}

/** A PDF's text, page by page, read with nothing in the file able to run code. */
async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  // This pdf.js build has no way to evaluate code from a file; Ink also loads no fonts and no XFA forms, and fetches nothing.
  const pdf = await getDocumentProxy(bytes, { disableFontFace: true, useSystemFonts: false, enableXfa: false, stopAtErrors: false })
  try {
    const pages = Math.min(pdf.numPages, MAX_PAGES)
    const texts: string[] = []
    for (let page = 1; page <= pages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent()
      texts.push(content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join(''))
    }
    return { text: texts.join('\n\n'), pages: pdf.numPages }
  } finally {
    await pdf.loadingTask.destroy()
  }
}

/**
 * What Ink reads from a file the person picked: a PDF's text, or a text file's. A PDF with no
 * text, such as a scan, is `no-text`; Ink doesn't read images.
 */
export async function readAttachment(name: string, bytes: Uint8Array): Promise<AttachmentRead> {
  const extension = extname(name).slice(1).toLowerCase()
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) return { ok: false, reason: 'not-supported' }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'too-big' }
  let raw: string
  let pages: number | null = null
  try {
    if (extension === 'pdf') {
      const read = await pdfText(bytes)
      raw = read.text
      pages = read.pages
    } else {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  const { text, cut } = cleanText(raw)
  if (!/[\p{L}\p{N}]/u.test(text)) return { ok: false, reason: 'no-text' }
  return { ok: true, text, pages, cut }
}
