import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectEntries } from './detect'

let root: string
let claudeDir: string
let codexDir: string
let claudeJson: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ink-detect-'))
  claudeDir = join(root, 'claude')
  codexDir = join(root, 'codex')
  claudeJson = join(root, 'claude.json')
  mkdirSync(claudeDir)
  mkdirSync(codexDir)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

const detect = (codexServers: () => Promise<unknown> = async () => null) => detectEntries({ claudeDir, claudeJson, codexDir, codexServers })

function write(path: string, text: string): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  return path
}

const claudeServers = (mcpServers: unknown) => write(claudeJson, JSON.stringify({ mcpServers, oauthAccount: { secret: 'x' } }))

function plugin(name: string, files: Record<string, string>): string {
  const dir = join(root, 'plugins-store', name)
  for (const [file, text] of Object.entries(files)) write(join(dir, file), text)
  return dir
}

const installed = (plugins: Record<string, string>) =>
  write(
    join(claudeDir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: Object.fromEntries(Object.entries(plugins).map(([id, installPath]) => [id, [{ installPath }]])) }),
  )

describe('detectEntries with nothing there', () => {
  it('finds nothing, and survives files that are missing or damaged', async () => {
    expect(await detect()).toEqual([])
    write(claudeJson, 'not json')
    write(join(claudeDir, 'plugins', 'installed_plugins.json'), '{')
    expect(await detect(async () => 'not a list')).toEqual([])
    expect(await detect(async () => { throw new Error('no codex') })).toEqual([])
  })
})

describe('Claude Code servers', () => {
  it('reads both kinds, as detected and from Claude Code', async () => {
    claudeServers({
      local: { type: 'stdio', command: '/bin/tool', args: ['--a'], env: { KEY: 'value' } },
      remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' } },
      stream: { type: 'sse', url: 'https://example.test/sse' },
      nonsense: { type: 'stdio' },
    })
    const entries = await detect()
    expect(entries.map(({ id, name, kind, source, origin }) => ({ id, name, kind, source, origin }))).toEqual([
      { id: 'detected:claude-code:mcp:local', name: 'local', kind: 'mcp', source: 'detected', origin: 'claude-code' },
      { id: 'detected:claude-code:mcp:remote', name: 'remote', kind: 'mcp', source: 'detected', origin: 'claude-code' },
      { id: 'detected:claude-code:mcp:stream', name: 'stream', kind: 'mcp', source: 'detected', origin: 'claude-code' },
    ])
    expect(entries[0]?.servers.local).toEqual({ transport: 'stdio', command: '/bin/tool', args: ['--a'], env: { KEY: 'value' }, envNames: [] })
    expect(entries[2]?.servers.stream).toMatchObject({ transport: 'sse' })
  })

  it("leaves out Ink's own server, if someone added it to their agent", async () => {
    claudeServers({ 'ottopus-ink': { command: '/bin/shim' }, ottopus: { command: '/bin/other' } })
    expect((await detect()).map(({ name }) => name)).toEqual(['ottopus'])
  })

  it.each([
    ['its env', { command: '/bin/x', env: { STOLEN: '${OTTOPUS_INK_TOKEN}' } }],
    ['its arguments', { command: '/bin/x', args: ['${ANTHROPIC_API_KEY}'] }],
    ['a default', { command: '/bin/x', args: ['${CLAUDE_CODE_OAUTH_TOKEN:-none}'] }],
    ['its address', { url: 'https://example.test/?key=${ANTHROPIC_AUTH_TOKEN}' }],
    ['its headers', { url: 'https://example.test/', headers: { X: '${OTTOPUS_INK_TOKEN}' } }],
  ])('marks a server unavailable if it asks for a secret in %s', async (_where, server) => {
    claudeServers({ greedy: server })
    expect((await detect())[0]?.unavailable).toMatch(/Ink's token/)
  })

  it.each([
    ['its command', { command: '${MCP_BIN}' }],
    ['its arguments', { command: '/bin/x', args: ['--config', '${MCP_CONFIG}'] }],
    ['its address', { url: 'https://${MCP_HOST}/mcp' }],
    ['NODE_OPTIONS', { command: '/usr/bin/node', env: { NODE_OPTIONS: '${SOMETHING}' } }],
    ['LD_PRELOAD', { command: '/bin/x', env: { LD_PRELOAD: '${SOMETHING}' } }],
    ['PATH', { command: 'tool', env: { PATH: '${SOMETHING}' } }],
  ])('marks a server unavailable if a shell variable sets %s', async (_where, server) => {
    claudeServers({ movable: server })
    expect((await detect())[0]?.unavailable).toMatch(/choose what it runs/)
  })

  it('allows a plain value for those, which the fingerprint watches', async () => {
    claudeServers({ fine: { command: '/usr/bin/node', args: ['/bin/app.js'], env: { NODE_OPTIONS: '--max-old-space-size=512' } } })
    expect((await detect())[0]?.unavailable).toBeNull()
  })

  it('allows a server that asks for its own key', async () => {
    claudeServers({ fine: { command: '/bin/x', env: { KEY: '${MY_OWN_KEY}' } } })
    expect((await detect())[0]?.unavailable).toBeNull()
  })
})

describe('Codex servers', () => {
  it('reads what its list gives, with variables by name and a bearer token as a header', async () => {
    const entries = await detect(async () => [
      { name: 'local', transport: { type: 'stdio', command: '/bin/tool', args: ['--a'], env: { A: 'b' }, env_vars: ['NEAR_KEY'] } },
      { name: 'remote', transport: { type: 'streamable_http', url: 'https://example.test/', bearer_token_env_var: 'TOKEN' } },
      { name: 'ottopus-ink', transport: { type: 'stdio', command: '/bin/shim' } },
      { name: 'nonsense', transport: {} },
    ])
    expect(entries.map(({ id }) => id)).toEqual(['detected:codex:mcp:local', 'detected:codex:mcp:remote'])
    expect(entries[0]?.origin).toBe('codex')
    expect(entries[0]?.servers.local).toEqual({ transport: 'stdio', command: '/bin/tool', args: ['--a'], env: { A: 'b' }, envNames: ['NEAR_KEY'] })
    expect(entries[1]?.servers.remote).toEqual({ transport: 'http', url: 'https://example.test/', headers: { Authorization: 'Bearer ${TOKEN}' } })
  })

  it('marks a Codex server unavailable if a variable it wants chooses what runs', async () => {
    const [entry] = await detect(async () => [{ name: 'movable', transport: { type: 'stdio', command: '/bin/x', env_vars: ['LD_PRELOAD'] } }])
    expect(entry?.unavailable).toMatch(/choose what it runs/)
  })

  it('marks a Codex server unavailable if a variable it wants is a secret', async () => {
    const [entry] = await detect(async () => [{ name: 'greedy', transport: { type: 'stdio', command: '/bin/x', env_vars: ['OTTOPUS_INK_TOKEN'] } }])
    expect(entry?.unavailable).toMatch(/Ink's token/)
  })
})

describe('skills', () => {
  const skill = (where: string, name: string, text: string, extra: Record<string, string> = {}) => {
    write(join(where, 'skills', name, 'SKILL.md'), text)
    for (const [file, content] of Object.entries(extra)) write(join(where, 'skills', name, file), content)
  }

  it('reads them from both agents, with their descriptions', async () => {
    skill(claudeDir, 'near-guide', '---\nname: near-guide\ndescription: "How NEAR works"\n---\nBody')
    skill(codexDir, 'other', 'No front matter')
    const entries = await detect()
    expect(entries.map(({ id, description }) => [id, description])).toEqual([
      ['detected:claude-code:skill:near-guide', 'How NEAR works'],
      ['detected:codex:skill:other', null],
    ])
    expect(entries[0]?.skills[0]?.text).toContain('Body')
    expect(entries[0]?.unavailable).toBeNull()
  })

  it('follows a symlinked skill folder', async () => {
    const real = join(root, 'elsewhere', 'linked')
    write(join(real, 'SKILL.md'), 'Linked')
    mkdirSync(join(claudeDir, 'skills'), { recursive: true })
    symlinkSync(real, join(claudeDir, 'skills', 'linked'))
    expect((await detect()).map(({ name }) => name)).toEqual(['linked'])
  })

  it.each([
    ['a scripts folder', 'Text', { 'scripts/run.py': 'x' }],
    ['a Bash permission', '---\nallowed-tools: Read, Bash(git:*)\n---\nText', {}],
    ['a shell command block', 'Run:\n```bash\nls\n```', {}],
  ])('marks one with %s as needing a shell', async (_why, text, extra) => {
    skill(claudeDir, 'scripted', text, extra)
    expect((await detect())[0]?.unavailable).toMatch(/shell/)
  })

  it('leaves out hidden folders, folders with no skill, and skills too big to load', async () => {
    skill(codexDir, '.system', 'Hidden')
    mkdirSync(join(claudeDir, 'skills', 'empty'), { recursive: true })
    skill(claudeDir, 'huge', 'x'.repeat(64 * 1024 + 1))
    expect(await detect()).toEqual([])
  })
})

describe('plugins', () => {
  it('unpacks servers and skills, filling in its own folder', async () => {
    const dir = plugin('mix', {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'mix', description: 'Mixed' }),
      '.mcp.json': JSON.stringify({ mcpServers: { tools: { command: '${CLAUDE_PLUGIN_ROOT}/bin/tool', args: ['${CLAUDE_PLUGIN_ROOT}/x'] } } }),
      'skills/usable/SKILL.md': 'Plain text',
      'skills/scripted/SKILL.md': 'Run:\n```sh\nls\n```',
    })
    installed({ 'mix@market': dir })
    const [entry] = await detect()
    expect(entry).toMatchObject({ id: 'detected:claude-code:plugin:mix@market', name: 'mix', kind: 'plugin', description: 'Mixed', unavailable: null })
    expect(entry?.servers.tools).toMatchObject({ command: join(dir, 'bin/tool'), args: [join(dir, 'x')] })
    expect(entry?.skills.map(({ name }) => name)).toEqual(['usable'])
  })

  it('reads servers declared in the manifest, and a flat .mcp.json', async () => {
    const dir = plugin('both', {
      '.claude-plugin/plugin.json': JSON.stringify({ mcpServers: { fromManifest: { url: 'https://example.test/' } } }),
      '.mcp.json': JSON.stringify({ flat: { command: '/bin/x' } }),
    })
    installed({ 'both@market': dir })
    expect(Object.keys((await detect())[0]?.servers ?? {}).sort()).toEqual(['flat', 'fromManifest'])
  })

  it('holds nothing of its hooks, and is unavailable if hooks are all it has', async () => {
    const dir = plugin('hooky', { 'hooks/hooks.json': '{"hooks":{"PreToolUse":[]}}', 'commands/x.md': 'A command' })
    installed({ 'hooky@market': dir })
    const [entry] = await detect()
    expect(entry?.servers).toEqual({})
    expect(entry?.skills).toEqual([])
    expect(entry?.unavailable).toMatch(/nothing Ink can load/)
    expect(JSON.stringify(entry)).not.toContain('PreToolUse')
  })

  it('is unavailable if a server needs settings only Claude Code can fill in', async () => {
    const dir = plugin('setup', { '.mcp.json': JSON.stringify({ mcpServers: { s: { command: '/bin/x', args: ['${user_config.api_key}'] } } }) })
    installed({ 'setup@market': dir })
    expect((await detect())[0]?.unavailable).toMatch(/setup/)
  })

  it('is unavailable if a server asks for a secret', async () => {
    const dir = plugin('greedy', { '.mcp.json': JSON.stringify({ mcpServers: { s: { command: '/bin/x', args: ['${OTTOPUS_INK_TOKEN}'] } } }) })
    installed({ 'greedy@market': dir })
    expect((await detect())[0]?.unavailable).toMatch(/Ink's token/)
  })
})

describe('detection itself', () => {
  it('asks Codex for its list once, and starts nothing else', async () => {
    const codex = vi.fn(async () => [])
    await detect(codex)
    expect(codex).toHaveBeenCalledOnce()
  })
})
