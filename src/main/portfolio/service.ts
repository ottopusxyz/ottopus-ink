import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * The Ink service's base address, from the build: an https origin with an optional path,
 * and nothing else. Null when it isn't set or isn't one, and Ink then reads Zerion only
 * with the person's own key.
 */
export function serviceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** Ottopus's deployment of the Ink service. */
export const DEFAULT_SERVICE_URL = 'https://api.ink.ottopus.xyz'

/**
 * The service this build uses: Ottopus's by default. A build can point elsewhere with
 * MAIN_VITE_INK_SERVICE_URL, or turn the service off by setting it empty, and Ink then
 * reads Zerion only with the person's own key.
 */
export const INK_SERVICE_URL = serviceUrl(import.meta.env.MAIN_VITE_INK_SERVICE_URL ?? DEFAULT_SERVICE_URL)

const INSTALL_ID = /^[A-Za-z0-9_-]{16,64}$/

/**
 * This install's random id, made on first use and kept in the app's folder. It names
 * nobody and is no secret: the service only uses it to share its limits out fairly.
 */
export function installId(file: string): string {
  try {
    const kept = readFileSync(file, 'utf8').trim()
    if (INSTALL_ID.test(kept)) return kept
  } catch {
    // None yet.
  }
  const made = randomBytes(18).toString('base64url')
  try {
    const temporary = `${file}.${randomBytes(6).toString('hex')}`
    writeFileSync(temporary, made, { mode: 0o600 })
    renameSync(temporary, file)
  } catch {
    // Unwritable: this run uses the new id, and the next makes another.
  }
  return made
}
