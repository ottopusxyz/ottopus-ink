import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { run } from './run'

const env = { PATH: '/usr/bin:/bin' }
const fast = { env, timeoutMs: 200, killGraceMs: 200 }

let dir: string

async function script(name: string, body: string): Promise<string> {
  const file = join(dir, name)
  await writeFile(file, `#!/bin/sh\n${body}\n`)
  await chmod(file, 0o755)
  return file
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ink-run-'))
})

afterAll(() => rm(dir, { recursive: true, force: true }))

describe('run', () => {
  it('returns the exit code and output', async () => {
    const file = await script('ok', 'echo out; echo err >&2; exit 3')
    expect(await run(file, [], { env, timeoutMs: 5000 })).toEqual({ code: 3, stdout: 'out\n', stderr: 'err\n' })
  })

  it('settles with a null code when the command ignores SIGTERM', async () => {
    const file = await script('stubborn', 'trap "" TERM\nwhile :; do sleep 1; done')
    const start = Date.now()
    const result = await run(file, [], fast)
    expect(result.code).toBeNull()
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('settles when an interactive login shell blocks in its rc file', async () => {
    const home = await mkdtemp(join(dir, 'home-'))
    const blocking = 'trap "" TERM\nwhile :; do sleep 1; done\n'
    await writeFile(join(home, '.bashrc'), blocking)
    await writeFile(join(home, '.bash_profile'), blocking)
    const start = Date.now()
    const result = await run('/bin/bash', ['-ilc', 'echo never'], { ...fast, env: { HOME: home, PATH: env.PATH } })
    expect(result.code).toBeNull()
    expect(result.stdout).not.toContain('never')
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('kills the command’s children along with it', async () => {
    const pidFile = join(dir, 'child.pid')
    const file = await script('parent', `sleep 30 &\necho $! > "${pidFile}"\nwait`)
    await run(file, [], fast)
    const pid = Number(await readFile(pidFile, 'utf8'))
    // The child was signalled, not just abandoned; allow a moment for it to die.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(isAlive(pid)).toBe(false)
  })

  it('closes stdin, so a prompt reads end of file instead of waiting', async () => {
    const file = await script('asks', 'read answer; echo "got [$answer]"')
    expect(await run(file, [], { env, timeoutMs: 5000 })).toMatchObject({ code: 0, stdout: 'got []\n' })
  })

  it('settles soon after exit even if a background child holds the pipes', async () => {
    const file = await script('daemon', 'sleep 30 &\necho started\nexit 0')
    const start = Date.now()
    const result = await run(file, [], { env, timeoutMs: 5000 })
    expect(result).toMatchObject({ code: 0, stdout: 'started\n' })
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('settles with a null code when the command can’t start', async () => {
    expect(await run(join(dir, 'nothing-here'), [], { env, timeoutMs: 5000 })).toEqual({
      code: null,
      stdout: '',
      stderr: '',
    })
  })
})
