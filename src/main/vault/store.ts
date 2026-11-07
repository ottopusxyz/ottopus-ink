import { randomUUID } from 'node:crypto'
import { existsSync, linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { SecretBox } from '../external/sign-ins'

export class VaultStoreError extends Error {
  constructor(readonly reason: 'damaged' | 'keyring-unavailable' | 'exists' | 'write-failed') {
    super(reason)
  }
}

export interface VaultStore {
  exists(): boolean
  /** Whether what's saved is sealed with the OS keyring, or what's saved next would be. */
  usesKeyring(): boolean
  /** Takes off the keyring's layer. What comes back still needs the password. */
  read(): string
  /** Never replaces a vault: that could destroy the only copy of someone's seed. */
  write(blob: string): void
  remove(): void
}

function readOuter(file: string): { keyring: boolean; data: string } {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new VaultStoreError('damaged')
  }
  const outer = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  if (outer.v !== 1 || typeof outer.keyring !== 'boolean' || typeof outer.data !== 'string') throw new VaultStoreError('damaged')
  return { keyring: outer.keyring, data: outer.data }
}

/**
 * The vault file, which only main touches, because only main can reach the OS
 * keyring. Everything here is already encrypted with the password. The keyring
 * adds a layer around that, so a copy of the file alone can't be attacked. A
 * same-user process can ask the keyring, so it never replaces the password.
 */
export function createVaultStore({ file, box }: { file: string; box: SecretBox }): VaultStore {
  return {
    exists: () => existsSync(file),

    usesKeyring() {
      if (!existsSync(file)) return box.canKeep()
      try {
        return readOuter(file).keyring
      } catch {
        return false
      }
    },

    read() {
      const { keyring, data } = readOuter(file)
      if (!keyring) return data
      if (!box.canKeep()) throw new VaultStoreError('keyring-unavailable')
      try {
        return box.open(Buffer.from(data, 'base64'))
      } catch {
        throw new VaultStoreError('keyring-unavailable')
      }
    },

    write(blob) {
      if (existsSync(file)) throw new VaultStoreError('exists')
      const keyring = box.canKeep()
      let data = blob
      if (keyring) {
        try {
          data = box.seal(blob).toString('base64')
        } catch {
          throw new VaultStoreError('keyring-unavailable')
        }
      }
      const temporary = `${file}.${randomUUID()}`
      try {
        writeFileSync(temporary, JSON.stringify({ v: 1, keyring, data }), { mode: 0o600, flush: true })
        // Unlike a rename, a link fails if the file appeared in the meantime.
        linkSync(temporary, file)
      } catch (error) {
        throw new VaultStoreError((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'exists' : 'write-failed')
      } finally {
        rmSync(temporary, { force: true })
      }
    },

    remove: () => rmSync(file, { force: true }),
  }
}
