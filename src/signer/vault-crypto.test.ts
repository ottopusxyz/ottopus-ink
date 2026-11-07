import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { openEntropy, sealEntropy } from './vault-crypto'

/** Every buffer decryption hands back, so a test can see whether each was wiped. */
const decrypted = vi.hoisted(() => [] as Buffer[])

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return {
    ...actual,
    createDecipheriv: (...args: Parameters<typeof actual.createDecipheriv>) => {
      const decipher = actual.createDecipheriv(...args)
      const update = decipher.update.bind(decipher) as (data: Buffer) => Buffer
      const final = decipher.final.bind(decipher) as () => Buffer
      return Object.assign(decipher, {
        update: (data: Buffer) => {
          const out = update(data)
          decrypted.push(out)
          return out
        },
        final: () => {
          const out = final()
          decrypted.push(out)
          return out
        },
      })
    },
  }
})

const logN = 10
const PASSWORD = 'correct horse battery'
const zeroed = (bytes: Buffer) => bytes.every((byte) => byte === 0)

describe('opening a sealed seed', () => {
  it('wipes every buffer the decrypted bytes passed through', async () => {
    const entropy = new Uint8Array(randomBytes(32))
    const blob = await sealEntropy(entropy, PASSWORD, logN)
    decrypted.length = 0
    expect(await openEntropy(blob, PASSWORD, logN)).toEqual(entropy)
    expect(decrypted.some((bytes) => bytes.length === 32)).toBe(true)
    expect(decrypted.every(zeroed)).toBe(true)
  })

  it('wipes them too when the password is wrong', async () => {
    const blob = await sealEntropy(new Uint8Array(randomBytes(32)), PASSWORD, logN)
    decrypted.length = 0
    await expect(openEntropy(blob, 'not the right one', logN)).rejects.toMatchObject({ reason: 'wrong-password' })
    expect(decrypted.some((bytes) => bytes.length === 32)).toBe(true)
    expect(decrypted.every(zeroed)).toBe(true)
  })
})
