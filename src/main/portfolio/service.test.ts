import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SERVICE_URL, installId, serviceUrl } from './service'

describe('the service’s address', () => {
  it('is an https address, with any trailing slash dropped', () => {
    expect(serviceUrl('https://ottopus-ink-service.example.workers.dev/')).toBe('https://ottopus-ink-service.example.workers.dev')
    expect(serviceUrl(' https://api.example.test/ink ')).toBe('https://api.example.test/ink')
  })

  it('is Ottopus’s deployment by default, which is a valid address', () => {
    expect(serviceUrl(DEFAULT_SERVICE_URL)).toBe('https://api.ink.ottopus.xyz')
  })

  it('is nothing when unset, not https, or carrying anything but a path', () => {
    for (const raw of [undefined, '', 'http://api.example.test', 'https://user:pass@api.example.test', 'https://api.example.test/?k=1', 'https://api.example.test/#x', 'not a url', 42])
      expect(serviceUrl(raw)).toBeNull()
  })
})

describe('the install id', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ink-install-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is made once, kept, and the same next run', () => {
    const file = join(dir, 'install-id')
    const first = installId(file)
    expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(readFileSync(file, 'utf8')).toBe(first)
    expect(installId(file)).toBe(first)
  })

  it('is made again when the kept one isn’t an id', () => {
    const file = join(dir, 'install-id')
    writeFileSync(file, 'not an id at all!')
    expect(installId(file)).toMatch(/^[A-Za-z0-9_-]{24}$/)
  })
})
