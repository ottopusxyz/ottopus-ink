import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { entropyToMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewPhrase, VaultRequest, VaultResult, VaultStatus } from '../../shared/vault'
import { createVaultState } from '../../signer/vault-state'
import type { SecretBox } from '../external/sign-ins'
import { createAutoLock } from './auto-lock'
import { createVaultService } from './service'
import { createVaultStore, VaultStoreError } from './store'

const PASSWORD = 'correct horse battery'

/** A pretend OS store that really changes the bytes, so a test can tell whether it was used. */
const keyringBox: SecretBox = {
  canKeep: () => true,
  seal: (text) => Buffer.from(`sealed:${text}`),
  open: (data) => {
    const text = data.toString()
    if (!text.startsWith('sealed:')) throw new Error('Not ours')
    return text.slice('sealed:'.length)
  },
}
const noKeyring: SecretBox = { canKeep: () => false, seal: () => Buffer.alloc(0), open: () => '' }

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ink-vault-'))
  file = join(dir, 'vault.bin')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** The real signer state behind the real service, with only the process boundary taken out. */
function setup(box: SecretBox = keyringBox) {
  const signer = createVaultState({ logN: 10 })
  const statuses: VaultStatus[] = []
  const asked: VaultRequest['op'][] = []
  const service = createVaultService({
    store: createVaultStore({ file, box }),
    ask: (request) => {
      asked.push(request.op)
      return signer.handle(request)
    },
    onStatus: (status) => statuses.push(status),
  })
  return { signer, service, statuses, asked }
}

function expectOk<T extends object>(result: VaultResult<T>): T {
  if (!result.ok) throw new Error(`Expected success, got ${result.reason}`)
  return result
}

const answersFor = ({ words, check }: NewPhrase) => check.map((index) => ({ index, word: words[index] as string }))

async function createVault(service: ReturnType<typeof setup>['service']) {
  const phrase = expectOk(await service.startCreate(12))
  expectOk(await service.finishCreate(PASSWORD, answersFor(phrase)))
  return phrase
}

describe('the vault file', () => {
  it('is only readable by this user, and holds no phrase or plain seed', async () => {
    const phrase = await createVault(setup().service)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const saved = readFileSync(file, 'utf8')
    for (const word of phrase.words) expect(saved).not.toMatch(new RegExp(`\\b${word}\\b`))
  })

  it('leaves nothing else behind', async () => {
    await createVault(setup().service)
    expect(readdirSync(dir)).toEqual(['vault.bin'])
  })

  it('wraps the password-encrypted vault in the keyring when there is one', async () => {
    await createVault(setup().service)
    const outer = JSON.parse(readFileSync(file, 'utf8')) as { keyring: boolean; data: string }
    expect(outer.keyring).toBe(true)
    expect(Buffer.from(outer.data, 'base64').toString()).toMatch(/^sealed:/)
    const inner = Buffer.from(outer.data, 'base64').toString().slice('sealed:'.length)
    expect((JSON.parse(inner) as { cipher: string }).cipher).toBe('aes-256-gcm')
  })

  it('has only the password where there is no keyring, and never asks the store to seal', async () => {
    const box = { ...noKeyring, seal: vi.fn(noKeyring.seal) }
    const { service } = setup(box)
    await createVault(service)
    const outer = JSON.parse(readFileSync(file, 'utf8')) as { keyring: boolean; data: string }
    expect(outer.keyring).toBe(false)
    expect(box.seal).not.toHaveBeenCalled()
    expect(service.status()).toEqual({ state: 'unlocked', keyring: false })
  })

  it('never replaces a vault, even if one appears while saving', () => {
    const store = createVaultStore({ file, box: noKeyring })
    store.write('first')
    expect(() => store.write('second')).toThrow(VaultStoreError)
    expect(store.read()).toBe('first')
  })

  it.each([
    ['not JSON', 'nope'],
    ['the wrong shape', '{"v":1}'],
    ['a later version', '{"v":2,"keyring":false,"data":"x"}'],
  ])('calls a file that is %s damaged', (_name, text) => {
    writeFileSync(file, text)
    expect(() => createVaultStore({ file, box: noKeyring }).read()).toThrow(expect.objectContaining({ reason: 'damaged' }))
  })
})

describe('creating', () => {
  it('saves nothing until the backup check passes', async () => {
    const { service } = setup()
    const phrase = expectOk(await service.startCreate(12))
    expect(existsSync(file)).toBe(false)
    expect(service.status().state).toBe('none')
    expect(await service.finishCreate(PASSWORD, [])).toEqual({ ok: false, reason: 'backup-mismatch' })
    expect(existsSync(file)).toBe(false)
    expectOk(await service.finishCreate(PASSWORD, answersFor(phrase)))
    expect(existsSync(file)).toBe(true)
  })

  it('ends unlocked, having read back what it saved', async () => {
    const { service, statuses, asked } = setup()
    await createVault(service)
    expect(asked).toEqual(['begin-create', 'finish', 'unlock'])
    expect(service.status()).toEqual({ state: 'unlocked', keyring: true })
    expect(statuses.at(-1)).toEqual({ state: 'unlocked', keyring: true })
  })

  it('removes a file it cannot read back, and can try again with the same phrase', async () => {
    const box: SecretBox = {
      ...keyringBox,
      open: () => {
        throw new Error('Cannot open')
      },
    }
    const first = setup(box)
    const phrase = expectOk(await first.service.startCreate(12))
    expect(await first.service.finishCreate(PASSWORD, answersFor(phrase))).toEqual({ ok: false, reason: 'write-failed' })
    expect(existsSync(file)).toBe(false)
    box.open = keyringBox.open
    expectOk(await first.service.finishCreate(PASSWORD, answersFor(phrase)))
  })

  it('says so if the keyring refuses, and keeps the phrase waiting', async () => {
    const box: SecretBox = {
      ...keyringBox,
      seal: () => {
        throw new Error('locked')
      },
    }
    const { service } = setup(box)
    const phrase = expectOk(await service.startCreate(12))
    expect(await service.finishCreate(PASSWORD, answersFor(phrase))).toEqual({ ok: false, reason: 'keyring-unavailable' })
    expect(existsSync(file)).toBe(false)
    box.seal = keyringBox.seal
    expectOk(await service.finishCreate(PASSWORD, answersFor(phrase)))
  })

  it('passes the page only the words and which to check', async () => {
    const service = createVaultService({
      store: createVaultStore({ file, box: noKeyring }),
      ask: async () => ({ ok: true, words: ['a'], check: [0], entropy: 'not for the page' }),
      onStatus: () => {},
    })
    expect(await service.startCreate(12)).toEqual({ ok: true, words: ['a'], check: [0] })
  })

  it('refuses to start over a vault that exists', async () => {
    const { service } = setup()
    await createVault(service)
    expect(await service.startCreate(12)).toEqual({ ok: false, reason: 'exists' })
    expect(await service.finishCreate(PASSWORD, [])).toEqual({ ok: false, reason: 'exists' })
    expect(await service.restore('anything', PASSWORD)).toEqual({ ok: false, reason: 'exists' })
  })
})

describe('restoring', () => {
  const phrase = () => entropyToMnemonic(new Uint8Array(randomBytes(16)), wordlist)

  it('saves and unlocks with no backup check, since the person already has the words', async () => {
    const { service, asked } = setup()
    expectOk(await service.restore(phrase(), PASSWORD))
    expect(asked).toEqual(['begin-restore', 'finish', 'unlock'])
    expect(service.status().state).toBe('unlocked')
  })

  it('saves nothing from bad words or a weak password, and keeps nothing waiting', async () => {
    const { service, signer } = setup()
    expect(await service.restore('not a phrase', PASSWORD)).toEqual({ ok: false, reason: 'invalid-words' })
    expect(await service.restore(phrase(), 'short')).toEqual({ ok: false, reason: 'weak-password' })
    expect(existsSync(file)).toBe(false)
    expect(signer.isPending()).toBe(false)
  })
})

describe('unlocking and locking', () => {
  it('needs the password on every unlock, even with a keyring', async () => {
    const { service, signer } = setup()
    await createVault(service)
    await service.lock()
    expect(signer.isUnlocked()).toBe(false)
    expect(service.status().state).toBe('locked')
    expect(await service.unlock('not the right one')).toEqual({ ok: false, reason: 'wrong-password' })
    expect(service.status().state).toBe('locked')
    expectOk(await service.unlock(PASSWORD))
    expect(signer.isUnlocked()).toBe(true)
  })

  it('opens the same vault after the app restarts', async () => {
    await createVault(setup().service)
    const { service } = setup()
    expect(service.status().state).toBe('locked')
    expectOk(await service.unlock(PASSWORD))
  })

  it('has nothing to unlock when there is no vault', async () => {
    expect(await setup().service.unlock(PASSWORD)).toEqual({ ok: false, reason: 'no-vault' })
  })

  it('says the keyring is the problem when it is, and leaves the file alone', async () => {
    await createVault(setup().service)
    const before = readFileSync(file)
    const { service } = setup(noKeyring)
    expect(await service.unlock(PASSWORD)).toEqual({ ok: false, reason: 'keyring-unavailable' })
    expect(readFileSync(file)).toEqual(before)
  })

  it('can read a vault saved without a keyring after a keyring appears', async () => {
    await createVault(setup(noKeyring).service)
    const { service } = setup(keyringBox)
    expect(service.status()).toEqual({ state: 'locked', keyring: false })
    expectOk(await service.unlock(PASSWORD))
  })

  it('stays locked if a lock arrives while unlocking', async () => {
    const { service, signer } = setup()
    await createVault(service)
    await service.lock()
    const unlocking = service.unlock(PASSWORD)
    await service.lock()
    expect(await unlocking).toEqual({ ok: false, reason: 'locked-meanwhile' })
    expect(service.status().state).toBe('locked')
    expect(signer.isUnlocked()).toBe(false)
  })

  it('stays locked if a lock arrives just as an unlock is answered', async () => {
    const signer = createVaultState({ logN: 10 })
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const service = createVaultService({
      store: createVaultStore({ file, box: noKeyring }),
      ask: async (request) => {
        const result = await signer.handle(request)
        if (request.op === 'unlock' && holding) await held
        return result
      },
      onStatus: () => {},
    })
    let holding = false
    await createVault(service)
    await service.lock()
    holding = true
    const unlocking = service.unlock(PASSWORD)
    await vi.waitFor(() => expect(signer.isUnlocked()).toBe(true))
    await service.lock()
    release()
    expect(await unlocking).toEqual({ ok: false, reason: 'locked-meanwhile' })
    expect(service.status().state).toBe('locked')
  })

  it.each([
    ['creating', async (service: ReturnType<typeof createVaultService>) => service.finishCreate(PASSWORD, answersFor(expectOk(await service.startCreate(12))))],
    ['restoring', async (service: ReturnType<typeof createVaultService>) => service.restore(entropyToMnemonic(new Uint8Array(randomBytes(16)), wordlist), PASSWORD)],
  ])('stays locked if a lock arrives while %s is answered', async (_name, run) => {
    const signer = createVaultState({ logN: 10 })
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    let sealed = false
    const service = createVaultService({
      store: createVaultStore({ file, box: noKeyring }),
      ask: async (request) => {
        const result = await signer.handle(request)
        // The signer has sealed and answered, and the answer is still on its way to main.
        if (request.op === 'finish' && result.ok) {
          sealed = true
          await held
        }
        return result
      },
      onStatus: () => {},
    })
    const saving = run(service)
    await vi.waitFor(() => expect(sealed).toBe(true))
    await service.lock()
    release()
    expect(await saving).toEqual({ ok: false, reason: 'locked-meanwhile' })
    expect(service.status().state).toBe('none')
    expect(signer.isUnlocked()).toBe(false)
  })

  it('does one thing at a time, except locking', async () => {
    const { service } = setup()
    await createVault(service)
    await service.lock()
    const first = service.unlock(PASSWORD)
    expect(await service.unlock(PASSWORD)).toEqual({ ok: false, reason: 'busy' })
    await first
  })

  it('counts as locked once the signer has stopped, and tells the page', async () => {
    const { service, statuses } = setup()
    await createVault(service)
    service.signerStopped()
    expect(service.status().state).toBe('locked')
    expect(statuses.at(-1)?.state).toBe('locked')
  })

  it('only announces real changes', async () => {
    const { service, statuses } = setup()
    await createVault(service)
    await service.lock()
    await service.lock()
    expect(statuses.map((status) => status.state)).toEqual(['unlocked', 'locked'])
  })
})

describe('what a page can send', () => {
  it.each([
    ['a number for a password', (s: ReturnType<typeof setup>['service']) => s.unlock(5)],
    ['a huge password', (s: ReturnType<typeof setup>['service']) => s.unlock('x'.repeat(5000))],
    ['an object for words', (s: ReturnType<typeof setup>['service']) => s.restore({}, PASSWORD)],
    ['a huge phrase', (s: ReturnType<typeof setup>['service']) => s.restore('word '.repeat(1000), PASSWORD)],
    ['answers that are not a list', (s: ReturnType<typeof setup>['service']) => s.finishCreate(PASSWORD, 'nope')],
    ['too many answers', (s: ReturnType<typeof setup>['service']) => s.finishCreate(PASSWORD, Array(25).fill({ index: 0, word: 'a' }))],
    ['an answer with a bad index', (s: ReturnType<typeof setup>['service']) => s.finishCreate(PASSWORD, [{ index: 0.5, word: 'a' }])],
    ['an answer with a huge word', (s: ReturnType<typeof setup>['service']) => s.finishCreate(PASSWORD, [{ index: 0, word: 'a'.repeat(99) }])],
    ['a phrase size this wallet does not take', (s: ReturnType<typeof setup>['service']) => s.startCreate(15)],
  ])('refuses %s without asking the signer', async (_name, call) => {
    const { service, asked } = setup()
    expect(await call(service)).toEqual({ ok: false, reason: 'bad-input' })
    expect(asked).toEqual([])
  })
})

describe('auto-lock', () => {
  const make = () => {
    let time = 0
    let unlocked = true
    const lock = vi.fn()
    const autoLock = createAutoLock({ isUnlocked: () => unlocked, lock, idleLimitMs: 1000, now: () => time })
    return {
      autoLock,
      lock,
      pass: (ms: number) => (time += ms),
      setUnlocked: (value: boolean) => (unlocked = value),
    }
  }

  it('locks once the limit has passed with no input', () => {
    const { autoLock, lock, pass } = make()
    pass(999)
    autoLock.check()
    expect(lock).not.toHaveBeenCalled()
    pass(1)
    autoLock.check()
    expect(lock).toHaveBeenCalledOnce()
  })

  it('starts counting again on input', () => {
    const { autoLock, lock, pass } = make()
    pass(900)
    autoLock.noteInput()
    pass(900)
    autoLock.check()
    expect(lock).not.toHaveBeenCalled()
  })

  it('has nothing to do while locked', () => {
    const { autoLock, lock, pass, setUnlocked } = make()
    setUnlocked(false)
    pass(5000)
    autoLock.check()
    expect(lock).not.toHaveBeenCalled()
  })
})
