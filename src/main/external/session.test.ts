import { describe, expect, it, vi } from 'vitest'
import { SECRET_ENV_NAMES, type CatalogEntry, type ServerDef } from './catalog'
import { buildSessionExternal } from './session'

const stdio = (fields: Partial<Extract<ServerDef, { transport: 'stdio' }>> = {}): ServerDef => ({
  transport: 'stdio',
  command: '/bin/tool',
  args: [],
  env: {},
  envNames: [],
  ...fields,
})

const entry = (name: string, servers: Record<string, ServerDef>, fields: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: name,
  name,
  kind: 'mcp',
  source: 'detected',
  origin: 'claude-code',
  servers,
  skills: [],
  description: null,
  unavailable: null,
  ...fields,
})

const build = (entries: CatalogEntry[], env: Record<string, string> = {}) => buildSessionExternal(entries, async () => env)
const envOf = (config: unknown) => (config as { env: Record<string, string> }).env

describe('what an external server is given', () => {
  it("blanks Ink's token and the agent's sign-in, which it would otherwise inherit", async () => {
    const { servers } = await build([entry('one', { one: stdio() })])
    for (const name of SECRET_ENV_NAMES) expect(envOf(servers.one)[name]).toBe('')
  })

  it('blanks them even when its own config sets them', async () => {
    const { servers } = await build([entry('one', { one: stdio({ env: { ANTHROPIC_API_KEY: 'theirs', KEEP: 'this' } }) })])
    expect(envOf(servers.one)).toMatchObject({ ANTHROPIC_API_KEY: '', KEEP: 'this' })
  })

  it('reads named variables from the shell, and only the ones it needs', async () => {
    const readEnv = vi.fn(async () => ({ NEAR_KEY: 'secret', OTHER: 'value' }))
    const server = stdio({ envNames: ['NEAR_KEY'], args: ['--x', '${OTHER}'] })
    const { servers } = await buildSessionExternal([entry('one', { one: server })], readEnv)
    expect(readEnv).toHaveBeenCalledExactlyOnceWith(['NEAR_KEY', 'OTHER'])
    expect(envOf(servers.one).NEAR_KEY).toBe('secret')
    expect(servers.one).toMatchObject({ args: ['--x', 'value'] })
  })

  it('reads no shell at all when nothing asks', async () => {
    const readEnv = vi.fn(async () => ({}))
    await buildSessionExternal([entry('one', { one: stdio() })], readEnv)
    expect(readEnv).not.toHaveBeenCalled()
  })

  it('fills in every reference itself, with defaults, so the CLI expands nothing', async () => {
    const server = stdio({ env: { A: '${SET}', B: '${UNSET}', C: '${UNSET:-fallback}' } })
    const { servers } = await build([entry('one', { one: server })], { SET: 'value' })
    expect(envOf(servers.one)).toMatchObject({ A: 'value', B: '', C: 'fallback' })
    expect(JSON.stringify(servers.one)).not.toContain('${')
  })

  it('skips a server whose filled-in value would still be expanded', async () => {
    const result = await build([entry('one', { one: stdio({ args: ['${SNEAKY}'] }) })], { SNEAKY: '${OTTOPUS_INK_TOKEN}' })
    expect(result.servers).toEqual({})
    expect(result.serverNames).toEqual([])
    expect(result.skipped).toEqual(['one'])
  })

  it('passes a web server its address and headers, filled in', async () => {
    const server: ServerDef = { transport: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer ${KEY}' } }
    const { servers } = await build([entry('one', { one: server })], { KEY: 'abc' })
    expect(servers.one).toEqual({ type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer abc' } })
  })
})

describe('the names servers get in a session', () => {
  const namesFor = async (...names: string[]) => (await build(names.map((name) => entry(name, { [name]: stdio() })))).serverNames

  it('keeps a plain name', async () => {
    expect(await namesFor('near-tools')).toEqual(['near-tools'])
  })

  it('has no underscores, so a name cannot pass for a tool of another server', async () => {
    expect(await namesFor('a__b', 'c.d e')).toEqual(['a-b', 'c-d-e'])
  })

  it("never takes Ink's own name", async () => {
    expect(await namesFor('ottopus-ink')).toEqual(['ottopus-ink-2'])
  })

  it('keeps two that come out the same apart', async () => {
    expect(await namesFor('a b', 'a.b')).toEqual(['a-b', 'a-b-2'])
  })

  it('gives a name with nothing usable in it something to go by', async () => {
    expect(await namesFor('___')).toEqual(['server'])
  })
})

describe('skills', () => {
  const skill = (name: string, text: string) => entry(name, {}, { kind: 'skill', skills: [{ name, text }] })

  it('has no text when none is enabled', async () => {
    expect((await build([entry('one', { one: stdio() })])).skillsText).toBeNull()
  })

  it('gathers the text of each one and says who it came from', async () => {
    const { skillsText, labels } = await build([skill('one', 'first'), skill('two', 'second')])
    expect(skillsText).toContain('first')
    expect(skillsText).toContain('second')
    expect(skillsText).toContain('from outside Ink')
    expect(labels).toEqual(['one', 'two'])
  })

  it('skips what would take the prompt past its limit, and leaves it out of the status', async () => {
    const big = 'x'.repeat(200 * 1024)
    const { skipped, skillsText, labels } = await build([skill('one', big), skill('two', big)])
    expect(skipped).toEqual(['two'])
    expect(labels).toEqual(['one'])
    expect(skillsText?.split(big)).toHaveLength(2)
  })
})

describe('an item that can only partly load', () => {
  it('loads none of a plugin if one of its servers cannot be made safe', async () => {
    const plugin = entry(
      'both',
      { good: stdio(), bad: stdio({ args: ['${SNEAKY}'] }) },
      { kind: 'plugin', skills: [{ name: 's', text: 'skill text' }] },
    )
    const result = await build([plugin], { SNEAKY: '${OTTOPUS_INK_TOKEN}' })
    expect(result).toMatchObject({ servers: {}, serverNames: [], skillsText: null, labels: [], skipped: ['both'] })
  })

  it('loads none of a plugin if its skills would not fit, not even its servers', async () => {
    const plugin = entry('both', { good: stdio() }, { kind: 'plugin', skills: [{ name: 's', text: 'x'.repeat(257 * 1024) }] })
    expect(await build([plugin])).toMatchObject({ serverNames: [], skillsText: null, labels: [], skipped: ['both'] })
  })

  it('still loads what else was enabled', async () => {
    const bad = entry('bad', { bad: stdio({ args: ['${SNEAKY}'] }) })
    const result = await build([bad, entry('good', { good: stdio() })], { SNEAKY: '${X}' })
    expect(result).toMatchObject({ serverNames: ['good'], labels: ['good'], skipped: ['bad'] })
  })
})

describe('a plugin', () => {
  it('brings its servers and skills', async () => {
    const plugin = entry('both', { tools: stdio() }, { kind: 'plugin', skills: [{ name: 's', text: 'skill text' }] })
    const result = await build([plugin])
    expect(result.serverNames).toEqual(['tools'])
    expect(result.skillsText).toContain('skill text')
    expect(result.labels).toEqual(['both'])
  })
})
