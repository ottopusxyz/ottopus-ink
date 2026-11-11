import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretBox } from '../external/sign-ins'
import { createZerionKeyStore, isZerionKey } from './zerion-key'

/** A stand-in keyring: reversible, and plainly not the text it sealed. */
const box = (canKeep = true): SecretBox => ({
  canKeep: () => canKeep,
  seal: (text) => Buffer.from(`sealed:${Buffer.from(text).toString('base64')}`),
  open: (data) => Buffer.from(data.toString().replace(/^sealed:/, ''), 'base64').toString(),
})

const KEY = 'zk_dev_test_not_a_real_key_0001'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ink-zerion-key-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('a Zerion key', () => {
  it('is one word of letters, digits and a few marks', () => {
    expect(isZerionKey(KEY)).toBe(true)
    for (const bad of ['short', 'has space in it ok', 'line\nbreak_123456', 'ключ_12345678', 'x'.repeat(201), 42, null]) expect(isZerionKey(bad)).toBe(false)
  })

  it('is kept sealed on disk, private to the user, and comes back next run', () => {
    const file = join(dir, 'zerion.bin')
    createZerionKeyStore({ file, box: box() }).save(KEY)
    expect(readFileSync(file, 'utf8')).not.toContain(KEY)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(createZerionKeyStore({ file, box: box() }).get()).toBe(KEY)
  })

  it('is held for this run only, never on disk, without a keyring', () => {
    const file = join(dir, 'zerion.bin')
    const store = createZerionKeyStore({ file, box: box(false) })
    store.save(KEY)
    expect(store.get()).toBe(KEY)
    expect(store.kept()).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('is gone after removing it, here and next run', () => {
    const file = join(dir, 'zerion.bin')
    const store = createZerionKeyStore({ file, box: box() })
    store.save(KEY)
    store.remove()
    expect(store.get()).toBeNull()
    expect(existsSync(file)).toBe(false)
    expect(createZerionKeyStore({ file, box: box() }).get()).toBeNull()
  })

  it('refuses to save something that isn’t a key, and reads an unreadable file as no key', () => {
    const file = join(dir, 'zerion.bin')
    expect(() => createZerionKeyStore({ file, box: box() }).save('not a key')).toThrow()
    const broken: SecretBox = { ...box(), open: () => Promise.reject(new Error('locked')) as never }
    expect(createZerionKeyStore({ file: join(dir, 'missing.bin'), box: broken }).get()).toBeNull()
  })
})
