import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { extractPath, mergePaths, PATH_COMMAND } from './login-path'

describe('extractPath', () => {
  it('reads PATH between the marks, ignoring anything an rc file printed', () => {
    expect(extractPath('Welcome back!\n__INK_PATH__/a:/b\n__INK_PATH__')).toBe('/a:/b')
  })

  it('returns null when the marks are missing or empty', () => {
    expect(extractPath('')).toBeNull()
    expect(extractPath('__INK_PATH__/a:/b')).toBeNull()
    expect(extractPath('__INK_PATH____INK_PATH__')).toBeNull()
  })
})

describe('mergePaths', () => {
  it('keeps the first list first and each folder once', () => {
    expect(mergePaths('/home/me/.local/bin:/usr/bin', '/usr/bin:/bin', '/opt/homebrew/bin')).toBe(
      '/home/me/.local/bin:/usr/bin:/bin:/opt/homebrew/bin',
    )
  })

  it('skips missing lists and empty entries', () => {
    expect(mergePaths(null, undefined, '/usr/bin::/bin:')).toBe('/usr/bin:/bin')
  })
})

describe('PATH_COMMAND', () => {
  it('prints the PATH a shell has, between the marks', () => {
    // printenv itself must be findable, so the shell's PATH includes the system folders.
    const output = execFileSync('/bin/sh', ['-c', PATH_COMMAND], { env: { PATH: '/x/bin:/usr/bin:/bin' } }).toString()
    expect(extractPath(output)).toBe('/x/bin:/usr/bin:/bin')
  })

  it('uses no variable syntax, which differs between bash, zsh and fish', () => {
    expect(PATH_COMMAND).not.toContain('$')
  })
})
