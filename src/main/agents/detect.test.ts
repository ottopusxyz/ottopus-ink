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
    '--help': `printf '  -p, --print\\n  --input-format <f>\\n  --output-format <f>\\n  --verbose\\n  --include-partial-messages\\n  --no-session-persistence\\n  --mcp-config <c>\\n  --strict-mcp-config\\n  --tools <t>\\n  --setting-sources <s>\\n  --allowedTools, --allowed-tools <t>\\n  --permission-mode <m>\\n  --plugin-dir <p>\\n'`,
    auth: `echo '{"loggedIn":true}'`,
  })
  await fakeCli('codex', {
    '--version': `echo 'codex-cli 0.1.0'`,
    '--help': `printf 'Commands:\\n  exec  Run\\nOptions:\\n  -c, --config <key=value>\\n'`,
    login: `echo 'Not logged in' >&2; exit 1`,
  })
  // Present but not executable: must not count as installed.
  await writeFile(join(bin, 'grok'), '#!/bin/sh\necho 1.0.0\n')
})

afterAll(() => rm(root, { recursive: true, force: true }))

describe('findExecutable', () => {
  it('finds an executable in the first folder that has one', async () => {
    expect(await findExecutable('claude', ['/nonexistent', bin].join(delimiter))).toBe(join(bin, 'claude'))
  })

  it('skips files that are not executable, and folders', async () => {
    expect(await findExecutable('grok', bin)).toBeNull()
    expect(await findExecutable('bin', root)).toBeNull()
  })
})

describe('detectAgents', () => {
  it('reports each agent’s state, version, missing flags and sign-in', async () => {
    const [claude, codex, grok] = await detectAgents({ PATH: bin })
    expect(claude).toEqual({
      id: 'claude-code',
      state: 'ready',
      path: join(bin, 'claude'),
      version: '2.1.316',
      missing: [],
      signedIn: true,
    })
    expect(codex).toMatchObject({ id: 'codex', state: 'outdated', version: '0.1.0', missing: ['app-server'], signedIn: false })
    expect(grok).toMatchObject({ id: 'grok', state: 'missing', path: null })
  })

  it('calls an agent broken, not outdated, when --help fails, and tries again next time', async () => {
    const other = join(root, 'help-fails')
    await mkdir(other)
    const file = join(other, 'codex')
    const write = async (help: string) => {
      await writeFile(
        file,
        `#!/bin/sh
case "$1" in
  --version) echo 'codex-cli 0.3.0' ;;
  --help) ${help} ;;
  login) echo 'Logged in using ChatGPT' ;;
esac
`,
      )
      await chmod(file, 0o755)
    }
    await write(`echo 'config file is corrupt' >&2; exit 1`)
    expect((await detectAgents({ PATH: other }))[1]).toMatchObject({ state: 'broken', version: '0.3.0', missing: [] })
    await write(`printf '  app-server  Run\\n  -c, --config <k=v>\\n'`)
    expect((await detectAgents({ PATH: other }))[1]).toMatchObject({ state: 'ready', version: '0.3.0' })
  })

  it('runs CLIs with the login shell’s variables, so a custom config folder is seen', async () => {
    const other = join(root, 'other')
    await mkdir(other)
    const file = join(other, 'codex')
    await writeFile(
      file,
      `#!/bin/sh
case "$1" in
  --version) echo 'codex-cli 0.2.0' ;;
  --help) printf '  app-server  Run\\n  -c, --config <k=v>\\n' ;;
  login) if [ "$CODEX_HOME" = /custom/codex ]; then echo 'Logged in using ChatGPT'; else echo 'Not logged in'; exit 1; fi ;;
esac
`,
    )
    await chmod(file, 0o755)
    const signedIn = await detectAgents({ PATH: other, CODEX_HOME: '/custom/codex' })
    expect(signedIn[1]).toMatchObject({ id: 'codex', state: 'ready', signedIn: true })
    const signedOut = await detectAgents({ PATH: other })
    expect(signedOut[1]).toMatchObject({ id: 'codex', state: 'signed-out', signedIn: false })
  })
})
