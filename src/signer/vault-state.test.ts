import { randomBytes } from 'node:crypto'
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../shared/accounts'
import type { NewPhrase, VaultResult } from '../shared/vault'
import { deriveAccounts } from './accounts'
import { DEFAULT_LOG_N, openEntropy, sealEntropy } from './vault-crypto'
import { createVaultState } from './vault-state'

vi.mock('./accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./accounts')>()
  return { ...actual, deriveAccounts: vi.fn(actual.deriveAccounts) }
})

/** Far below the real cost, so tests run in moments. */
const logN = 10
const PASSWORD = 'correct horse battery'
/** Made when the test runs, so no recovery phrase is ever written in this repo. */
const phraseOf = (bytes: number) => entropyToMnemonic(new Uint8Array(randomBytes(bytes)), wordlist)

const make = () => createVaultState({ logN })

function expectOk<T extends object>(result: VaultResult<T>): T {
  if (!result.ok) throw new Error(`Expected success, got ${result.reason}`)
  return result
}

const answersFor = ({ words, check }: NewPhrase) => check.map((index) => ({ index, word: words[index] as string }))

async function created(state = make()) {
  const phrase = expectOk((await state.handle({ op: 'begin-create', words: 12 })) as VaultResult<NewPhrase>)
  const { blob } = expectOk((await state.handle({ op: 'finish', password: PASSWORD, answers: answersFor(phrase) })) as VaultResult<{ blob: string }>)
  return { state, phrase, blob }
}

afterEach(() => vi.restoreAllMocks())

describe('sealing a seed', () => {
  const entropy = new Uint8Array(16).fill(7)
  const edit = (blob: string, change: (file: { v: number; iv: string; data: string; kdf: { logN: number } }) => void) => {
    const file = JSON.parse(blob) as Parameters<typeof change>[0]
    change(file)
    return JSON.stringify(file)
  }

  it('gets the same bytes back with the password, and never writes them out', async () => {
    const blob = await sealEntropy(entropy, PASSWORD, logN)
    expect(blob).not.toContain(Buffer.from(entropy).toString('base64'))
    expect(await openEntropy(blob, PASSWORD, logN)).toEqual(entropy)
  })

  it('uses a new salt and nonce every time', async () => {
    const [one, two] = await Promise.all([sealEntropy(entropy, PASSWORD, logN), sealEntropy(entropy, PASSWORD, logN)])
    const [first, second] = [JSON.parse(one) as { iv: string; kdf: { salt: string } }, JSON.parse(two) as { iv: string; kdf: { salt: string } }]
    expect(first.iv).not.toBe(second.iv)
    expect(first.kdf.salt).not.toBe(second.kdf.salt)
  })

  it('refuses the wrong password', async () => {
    await expect(openEntropy(await sealEntropy(entropy, PASSWORD, logN), 'not the right one', logN)).rejects.toMatchObject({ reason: 'wrong-password' })
  })

  it('treats the same password typed in another Unicode form as the same', async () => {
    const blob = await sealEntropy(entropy, 'café password long', logN)
    expect(await openEntropy(blob, 'café password long', logN)).toEqual(entropy)
  })

  it('notices any setting that was changed', async () => {
    const blob = await sealEntropy(entropy, PASSWORD, logN)
    const changed = edit(blob, (file) => {
      file.iv = randomBytes(12).toString('base64')
    })
    await expect(openEntropy(changed, PASSWORD, logN)).rejects.toMatchObject({ reason: 'wrong-password' })
  })

  it.each([
    ['not JSON', () => 'nope'],
    ['JSON of the wrong kind', () => '[1]'],
    ['a later version', (blob: string) => edit(blob, (file) => void (file.v = 2))],
    ['a cost that would use all the memory', (blob: string) => edit(blob, (file) => void (file.kdf.logN = 40))],
    ['a cost below the floor', (blob: string) => edit(blob, (file) => void (file.kdf.logN = 2))],
    ['a cost that is not a whole number', (blob: string) => edit(blob, (file) => void (file.kdf.logN = 10.5))],
    ['a short nonce', (blob: string) => edit(blob, (file) => void (file.iv = 'AAAA'))],
    ['a seed of the wrong size', (blob: string) => edit(blob, (file) => void (file.data = 'AAAA'))],
  ])('calls %s damaged, before spending any effort on it', async (_name, build) => {
    await expect(openEntropy(build(await sealEntropy(entropy, PASSWORD, logN)), PASSWORD, logN)).rejects.toMatchObject({ reason: 'damaged' })
  })

  it('sets the real cost at 128 MB unless told otherwise', () => {
    expect(DEFAULT_LOG_N).toBe(17)
  })

  it('seals at the real cost when the signer is made as the app makes it', async () => {
    const { blob } = await created(createVaultState())
    expect((JSON.parse(blob) as { kdf: { logN: number } }).kdf.logN).toBe(DEFAULT_LOG_N)
  })
})

describe('creating a vault', () => {
  it.each([
    [12, 12],
    [24, 24],
  ] as const)('makes a %i word phrase and asks for three of its words back', async (count, length) => {
    const phrase = expectOk((await make().handle({ op: 'begin-create', words: count })) as VaultResult<NewPhrase>)
    expect(phrase.words).toHaveLength(length)
    expect(new Set(phrase.check).size).toBe(3)
    expect(phrase.check.every((index) => index >= 0 && index < length)).toBe(true)
  })

  it('refuses other sizes', async () => {
    expect(await make().handle({ op: 'begin-create', words: 15 as 12 })).toEqual({ ok: false, reason: 'bad-input' })
  })

  it('makes a different phrase each time', async () => {
    const state = make()
    const one = expectOk((await state.handle({ op: 'begin-create', words: 12 })) as VaultResult<NewPhrase>)
    const two = expectOk((await state.handle({ op: 'begin-create', words: 12 })) as VaultResult<NewPhrase>)
    expect(one.words).not.toEqual(two.words)
  })

  it('will not save until the backup check passes, and lets the person try again', async () => {
    const state = make()
    const phrase = expectOk((await state.handle({ op: 'begin-create', words: 12 })) as VaultResult<NewPhrase>)
    expect(await state.handle({ op: 'finish', password: PASSWORD, answers: [] })).toEqual({ ok: false, reason: 'backup-mismatch' })
    const wrong = answersFor(phrase).map((answer, position) => (position === 0 ? { ...answer, word: 'zzz' } : answer))
    expect(await state.handle({ op: 'finish', password: PASSWORD, answers: wrong })).toEqual({ ok: false, reason: 'backup-mismatch' })
    expectOk(await state.handle({ op: 'finish', password: PASSWORD, answers: answersFor(phrase) }))
  })

  it('accepts backup words typed with stray spaces or capitals', async () => {
    const state = make()
    const phrase = expectOk((await state.handle({ op: 'begin-create', words: 12 })) as VaultResult<NewPhrase>)
    const answers = answersFor(phrase).map((answer) => ({ ...answer, word: `  ${answer.word.toUpperCase()} ` }))
    expectOk(await state.handle({ op: 'finish', password: PASSWORD, answers }))
  })

  it.each([['short'], ['eleven char'], [`${'x'.repeat(1025)}`]])('refuses the password %j', async (password) => {
    const state = make()
    const phrase = expectOk((await state.handle({ op: 'begin-create', words: 12 })) as VaultResult<NewPhrase>)
    expect(await state.handle({ op: 'finish', password, answers: answersFor(phrase) })).toEqual({ ok: false, reason: 'weak-password' })
  })

  it('has nothing to finish before it starts, or after cancelling', async () => {
    const state = make()
    expect(await state.handle({ op: 'finish', password: PASSWORD, answers: [] })).toEqual({ ok: false, reason: 'nothing-pending' })
    const phrase = expectOk((await state.handle({ op: 'begin-create', words: 12 })) as VaultResult<NewPhrase>)
    await state.handle({ op: 'cancel' })
    expect(await state.handle({ op: 'finish', password: PASSWORD, answers: answersFor(phrase) })).toEqual({ ok: false, reason: 'nothing-pending' })
  })

  it('is not unlocked until the saved copy has been opened', async () => {
    const { state, blob } = await created()
    expect(state.isUnlocked()).toBe(false)
    expect(state.isPending()).toBe(true)
    expectOk(await state.handle({ op: 'unlock', blob, password: PASSWORD }))
    expect(state.isUnlocked()).toBe(true)
    expect(state.isPending()).toBe(false)
  })
})

describe('restoring a vault', () => {
  const restore = async (state: ReturnType<typeof make>, words: string) => {
    expectOk(await state.handle({ op: 'begin-restore', words }))
    return expectOk((await state.handle({ op: 'finish', password: PASSWORD, answers: [] })) as VaultResult<{ blob: string }>).blob
  }

  it.each([
    [12, 16],
    [24, 32],
  ] as const)('takes a %i word phrase and keeps the same seed', async (_count, bytes) => {
    const phrase = phraseOf(bytes)
    const blob = await restore(make(), phrase)
    expect(entropyToMnemonic(await openEntropy(blob, PASSWORD, logN), wordlist)).toBe(phrase)
  })

  it('forgives capitals and extra spaces', async () => {
    const phrase = phraseOf(16)
    const blob = await restore(make(), `  ${phrase.toUpperCase().replaceAll(' ', '  \n')} `)
    expect(entropyToMnemonic(await openEntropy(blob, PASSWORD, logN), wordlist)).toBe(phrase)
  })

  it.each([
    ['nothing', () => ''],
    ['too few words', () => phraseOf(16).split(' ').slice(0, 11).join(' ')],
    ['a size this wallet does not take', () => phraseOf(20)],
    ['a word that is not on the list', () => [...phraseOf(16).split(' ').slice(0, 11), 'zzz'].join(' ')],
    [
      'a bad checksum',
      () => {
        // Swapping two words can land on a valid checksum one time in sixteen, so keep trying until it doesn't.
        for (;;) {
          const words = phraseOf(16).split(' ')
          const swapped = [words[1], words[0], ...words.slice(2)].join(' ')
          if (!validateMnemonic(swapped, wordlist)) return swapped
        }
      },
    ],
  ])('refuses %s', async (_name, build) => {
    expect(await make().handle({ op: 'begin-restore', words: build() })).toEqual({ ok: false, reason: 'invalid-words' })
  })
})

describe('locking and unlocking', () => {
  it('opens with the right password only', async () => {
    const { state, blob } = await created()
    expect(await state.handle({ op: 'unlock', blob, password: 'not the right one' })).toEqual({ ok: false, reason: 'wrong-password' })
    expect(state.isUnlocked()).toBe(false)
    expectOk(await state.handle({ op: 'unlock', blob, password: PASSWORD }))
    expect(state.isUnlocked()).toBe(true)
  })

  it('wipes the seed on lock', async () => {
    const { state, blob } = await created()
    await state.handle({ op: 'unlock', blob, password: PASSWORD })
    const fill = vi.spyOn(Uint8Array.prototype, 'fill')
    await state.handle({ op: 'lock' })
    expect(fill).toHaveBeenCalledWith(0)
    const wiped = (fill.mock.contexts as Uint8Array[]).find((bytes) => bytes.length === 16 && !Buffer.isBuffer(bytes))
    expect(wiped && [...wiped].every((byte) => byte === 0)).toBe(true)
    expect(state.isUnlocked()).toBe(false)
  })

  it('stays locked if a lock arrives while unlocking', async () => {
    const { state, blob } = await created()
    const unlocking = state.handle({ op: 'unlock', blob, password: PASSWORD })
    await state.handle({ op: 'lock' })
    expect(await unlocking).toEqual({ ok: false, reason: 'locked-meanwhile' })
    expect(state.isUnlocked()).toBe(false)
  })

  it('forgets a phrase waiting to be saved on lock', async () => {
    const state = make()
    const phrase = expectOk((await state.handle({ op: 'begin-create', words: 12 })) as VaultResult<NewPhrase>)
    await state.handle({ op: 'lock' })
    expect(await state.handle({ op: 'finish', password: PASSWORD, answers: answersFor(phrase) })).toEqual({ ok: false, reason: 'nothing-pending' })
  })

  it('does not save a phrase cancelled while it was being encrypted', async () => {
    const state = make()
    const phrase = expectOk((await state.handle({ op: 'begin-create', words: 12 })) as VaultResult<NewPhrase>)
    const finishing = state.handle({ op: 'finish', password: PASSWORD, answers: answersFor(phrase) })
    await state.handle({ op: 'cancel' })
    expect(await finishing).toEqual({ ok: false, reason: 'nothing-pending' })
  })

  it('says a damaged file is damaged, not that the password is wrong', async () => {
    const { state } = await created()
    expect(await state.handle({ op: 'unlock', blob: 'nope', password: PASSWORD })).toEqual({ ok: false, reason: 'damaged' })
  })

  it('refuses a vault made to look cheap to guess', async () => {
    const weak = await sealEntropy(new Uint8Array(16), PASSWORD, 4)
    expect(await make().handle({ op: 'unlock', blob: weak, password: PASSWORD })).toEqual({ ok: false, reason: 'damaged' })
  })
})

describe('accounts', () => {
  const accountsOf = async (state: ReturnType<typeof make>) => (await state.handle({ op: 'accounts' })) as VaultResult<{ accounts: Account[] }>

  it('are only there while unlocked', async () => {
    const { state, blob } = await created()
    expect(await accountsOf(state)).toEqual({ ok: false, reason: 'locked' })
    await state.handle({ op: 'unlock', blob, password: PASSWORD })
    expect(expectOk(await accountsOf(state)).accounts).toHaveLength(7)
    await state.handle({ op: 'lock' })
    expect(await accountsOf(state)).toEqual({ ok: false, reason: 'locked' })
  })

  it('come from the phrase, so a restored phrase gives the same addresses as anywhere else', async () => {
    const state = make()
    const phrase = phraseOf(32)
    expectOk(await state.handle({ op: 'begin-restore', words: phrase }))
    const { blob } = expectOk((await state.handle({ op: 'finish', password: PASSWORD, answers: [] })) as VaultResult<{ blob: string }>)
    await state.handle({ op: 'unlock', blob, password: PASSWORD })
    expect(expectOk(await accountsOf(state)).accounts).toEqual(deriveAccounts(mnemonicToSeedSync(phrase)))
  })

  it('are the same after locking and unlocking again', async () => {
    const { state, blob } = await created()
    await state.handle({ op: 'unlock', blob, password: PASSWORD })
    const first = expectOk(await accountsOf(state)).accounts
    await state.handle({ op: 'lock' })
    await state.handle({ op: 'unlock', blob, password: PASSWORD })
    expect(expectOk(await accountsOf(state)).accounts).toEqual(first)
  })

  it('are not given out if a lock arrives while they are worked out', async () => {
    const { state, blob } = await created()
    await state.handle({ op: 'unlock', blob, password: PASSWORD })
    const asking = accountsOf(state)
    await state.handle({ op: 'lock' })
    expect(await asking).toEqual({ ok: false, reason: 'locked' })
    expect(await accountsOf(state)).toEqual({ ok: false, reason: 'locked' })
  })

  it('wipe the seed they were worked out from', async () => {
    const { state, blob } = await created()
    await state.handle({ op: 'unlock', blob, password: PASSWORD })
    const derive = vi.mocked(deriveAccounts)
    derive.mockClear()
    expectOk(await accountsOf(state))
    const seed = derive.mock.calls[0]?.[0]
    expect(seed).toHaveLength(64)
    expect([...seed!].every((byte) => byte === 0)).toBe(true)
  })
})
