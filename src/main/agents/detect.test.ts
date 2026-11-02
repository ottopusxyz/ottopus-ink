import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { detectAgents, findExecutable } from './detect'

let root: string
let bin: string

/** A stand-in CLI: a shell script answering by its first argument. */
async function fakeCli(name: string, cases: Record<string, string>) {
  const branches = Object.entries(cases)
    .map(([arg, body]) => `  ${arg}) ${body} ;;`)
    .join('\n')
  const file = join(bin, name)
  await writeFile(file, `#!/bin/sh\ncase "$1" in\n${branches}\n  *) exit 2 ;;\nesac\n`)
  await chmod(file, 0o755)
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ink-detect-'))
  bin = join(root, 'bin')
  await mkdir(bin)
  await fakeCli('claude', {
    '--version': `echo '2.1.316 (Claude Code)'`,
    '--help': `echo '  -p, --print --input-format --output-format --mcp-config --strict-mcp-config --setting-sources --plugin-dir --tools --permission-prompt-tool'`,
    auth: `echo '{"loggedIn":true}'`,
  })
  await fakeCli('codex', {
    '--version': `echo 'codex-cli 0.1.0'`,
    '--help': `printf 'Commands:\\n  exec  Run\\nOptions:\\n  -c, --config <key=value>\\n'`,
    login: `echo 'Not logged in' >&2; exit 1`,
  })
  // Present but not executable: must not count as installed.
  await writeFile(join(bin, 'opencode'), '#!/bin/sh\necho 1.0.0\n')
})

afterAll(() => rm(root, { recursive: true, force: true }))

describe('findExecutable', () => {
  it('finds an executable in the first folder that has one', async () => {
    expect(await findExecutable('claude', ['/nonexistent', bin].join(delimiter))).toBe(join(bin, 'claude'))
  })

  it('skips files that are not executable, and folders', async () => {
    expect(await findExecutable('opencode', bin)).toBeNull()
    expect(await findExecutable('bin', root)).toBeNull()
  })
})

describe('detectAgents', () => {
  it('reports each agent’s state, version, missing flags and sign-in', async () => {
    const [claude, codex, opencode] = await detectAgents(bin)
    expect(claude).toEqual({
      id: 'claude-code',
      state: 'ready',
      path: join(bin, 'claude'),
      version: '2.1.316',
      missing: [],
      signedIn: true,
    })
    expect(codex).toMatchObject({ id: 'codex', state: 'outdated', version: '0.1.0', missing: ['app-server'], signedIn: false })
    expect(opencode).toMatchObject({ id: 'opencode', state: 'missing', path: null })
  })
})
