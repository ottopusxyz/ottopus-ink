import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { mergePaths, parseShellEnv, SHELL_ENV_COMMAND, SHELL_ENV_NAMES } from './login-env'

describe('SHELL_ENV_COMMAND', () => {
  it('prints what a real shell has, skipping what is unset', () => {
    const output = execFileSync('/bin/sh', ['-c', SHELL_ENV_COMMAND], {
      env: { PATH: '/x/bin:/usr/bin:/bin', CODEX_HOME: '/custom/codex', ANTHROPIC_API_KEY: 'not-for-the-app' },
    }).toString()
    expect(parseShellEnv(output)).toEqual({ PATH: '/x/bin:/usr/bin:/bin', CODEX_HOME: '/custom/codex' })
  })

  it('uses no variable syntax, which differs between bash, zsh and fish', () => {
    expect(SHELL_ENV_COMMAND).not.toContain('$')
  })
})

describe('SHELL_ENV_NAMES', () => {
  it('never reads anything that holds a secret', () => {
    for (const name of SHELL_ENV_NAMES) expect(name).not.toMatch(/KEY|TOKEN|SECRET|PASS/)
  })
})

describe('parseShellEnv', () => {
  const output = (...values: string[]) => `__INK_ENV__${values.join('\n__INK_ENV__')}\n__INK_ENV__`
  const empty = SHELL_ENV_NAMES.slice(1).map(() => '')

  it('ignores anything an rc file printed before the first mark or after the last', () => {
    expect(parseShellEnv(`Welcome back!\n${output('/a:/b', ...empty)}\nlogout`)).toEqual({ PATH: '/a:/b' })
  })

  it('returns null if the shell didn’t reach the last mark', () => {
    expect(parseShellEnv('')).toBeNull()
    expect(parseShellEnv('__INK_ENV__/a:/b\n__INK_ENV__')).toBeNull()
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
