import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { SecretBox } from '../external/sign-ins'

/** What a Zerion key looks like: one word of letters, digits and a few marks. Anything else isn't one, and isn't sent anywhere. */
export function isZerionKey(text: unknown): text is string {
  return typeof text === 'string' && /^[A-Za-z0-9_.:-]{8,200}$/.test(text)
}

export interface ZerionKeyStore {
  /** The key, or null when none is set. Only main reads it, to send to Zerion. */
  get(): string | null
  /** Whether a saved key lasts past this run: false where the OS has no keyring. */
  kept(): boolean
  save(key: string): void
  remove(): void
}

/**
 * The person's own Zerion API key. Encrypted on disk by the OS's keyring, or held in
 * memory for this run only where there is none, so it is never plain text on disk.
 * The page can set and remove it but never read it back.
 */
export function createZerionKeyStore({ file, box }: { file: string; box: SecretBox }): ZerionKeyStore {
  let key: string | null | undefined

  const load = (): string | null => {
    if (!box.canKeep()) return null
    try {
      const saved = box.open(readFileSync(file))
      return isZerionKey(saved) ? saved : null
    } catch {
      // Missing or unreadable: no key, which only means fewer chains are read.
      return null
    }
  }

  return {
    get() {
      if (key === undefined) key = load()
      return key
    },
    kept: () => box.canKeep(),
    save(next) {
      if (!isZerionKey(next)) throw new Error('not a Zerion key')
      key = next
      if (!box.canKeep()) return
      const temporary = `${file}.${randomUUID()}`
      writeFileSync(temporary, box.seal(next), { mode: 0o600 })
      renameSync(temporary, file)
    },
    remove() {
      key = null
      rmSync(file, { force: true })
    },
  }
}
