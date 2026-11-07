import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'

/** Binds a vault to this format, so bytes from anywhere else can't be mistaken for one. */
const DOMAIN = 'ottopus-ink/vault/v1'
const CIPHER = 'aes-256-gcm'
const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const R = 8
const P = 1

/** scrypt's N is 2^17: 128 MB, and OWASP's first choice with r=8 and p=1. */
export const DEFAULT_LOG_N = 17
/** The most a vault file can ask for. A file is outside input, and this bounds the memory it can demand. */
const MAX_LOG_N = 20

export class VaultCryptoError extends Error {
  constructor(readonly reason: 'wrong-password' | 'damaged') {
    super(reason)
  }
}

interface Kdf {
  name: 'scrypt'
  logN: number
  r: number
  p: number
  salt: string
}

function wipe(bytes: Uint8Array | null): void {
  bytes?.fill(0)
}

async function deriveKey(password: string, kdf: Kdf): Promise<Buffer> {
  // The same password typed on another OS can arrive with different bytes.
  const secret = Buffer.from(password.normalize('NFKC'), 'utf8')
  const N = 2 ** kdf.logN
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(secret, Buffer.from(kdf.salt, 'base64'), KEY_BYTES, { N, r: kdf.r, p: kdf.p, maxmem: 128 * N * kdf.r + 1024 * 1024 }, (error, key) => {
        if (error) reject(error)
        else resolve(key)
      })
    })
  } finally {
    wipe(secret)
  }
}

/** The file format. It's in the bound data too, so a later format can never read this ciphertext as its own. */
const FORMAT = 1

/** Covers every setting in the file, so none can be changed without decryption failing. */
const additionalData = (kdf: Kdf, iv: string) => Buffer.from(`${DOMAIN}\0${JSON.stringify([FORMAT, kdf.name, kdf.logN, kdf.r, kdf.p, kdf.salt, CIPHER, iv])}`, 'utf8')

/** Encrypts a seed's entropy under a password, as text that's safe to keep on disk. */
export async function sealEntropy(entropy: Uint8Array, password: string, logN: number = DEFAULT_LOG_N): Promise<string> {
  const kdf: Kdf = { name: 'scrypt', logN, r: R, p: P, salt: randomBytes(SALT_BYTES).toString('base64') }
  const iv = randomBytes(IV_BYTES).toString('base64')
  const key = await deriveKey(password, kdf)
  try {
    const cipher = createCipheriv(CIPHER, key, Buffer.from(iv, 'base64'), { authTagLength: TAG_BYTES })
    cipher.setAAD(additionalData(kdf, iv))
    const data = Buffer.concat([cipher.update(entropy), cipher.final()])
    return JSON.stringify({ v: FORMAT, kdf, cipher: CIPHER, iv, tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })
  } finally {
    wipe(key)
  }
}

const isBase64Of = (value: unknown, bytes: number[]): value is string => typeof value === 'string' && bytes.includes(Buffer.from(value, 'base64').length)

interface Parsed {
  kdf: Kdf
  iv: string
  tag: string
  data: string
}

/** Checks every field before any of it reaches scrypt or the cipher. */
function parse(blob: string, minLogN: number): Parsed {
  let value: unknown
  try {
    value = JSON.parse(blob)
  } catch {
    throw new VaultCryptoError('damaged')
  }
  const file = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const kdf = (typeof file.kdf === 'object' && file.kdf !== null ? file.kdf : {}) as Record<string, unknown>
  const logN = kdf.logN
  const fits =
    file.v === FORMAT &&
    file.cipher === CIPHER &&
    kdf.name === 'scrypt' &&
    typeof logN === 'number' &&
    Number.isInteger(logN) &&
    logN >= minLogN &&
    logN <= MAX_LOG_N &&
    kdf.r === R &&
    kdf.p === P &&
    isBase64Of(kdf.salt, [SALT_BYTES]) &&
    isBase64Of(file.iv, [IV_BYTES]) &&
    isBase64Of(file.tag, [TAG_BYTES]) &&
    // A seed's entropy is 16 or 32 bytes, and this cipher adds no length.
    isBase64Of(file.data, [16, 32])
  if (!fits) throw new VaultCryptoError('damaged')
  return {
    kdf: { name: 'scrypt', logN: logN as number, r: R, p: P, salt: kdf.salt as string },
    iv: file.iv as string,
    tag: file.tag as string,
    data: file.data as string,
  }
}

/** Gets a seed's entropy back. The caller owns the bytes and must wipe them. */
export async function openEntropy(blob: string, password: string, minLogN: number = DEFAULT_LOG_N): Promise<Uint8Array> {
  const { kdf, iv, tag, data } = parse(blob, minLogN)
  const key = await deriveKey(password, kdf)
  // Every buffer that holds decrypted bytes, so each is wiped even when the password turns out wrong.
  const plain: Buffer[] = []
  try {
    const decipher = createDecipheriv(CIPHER, key, Buffer.from(iv, 'base64'), { authTagLength: TAG_BYTES })
    decipher.setAAD(additionalData(kdf, iv))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    plain.push(decipher.update(Buffer.from(data, 'base64')))
    plain.push(decipher.final())
    const joined = Buffer.concat(plain)
    plain.push(joined)
    return Uint8Array.from(joined)
  } catch {
    throw new VaultCryptoError('wrong-password')
  } finally {
    wipe(key)
    for (const bytes of plain) wipe(bytes)
  }
}
