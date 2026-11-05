import { describe, expect, it } from 'vitest'
import { claudeArgs, claudeEnv, claudeMcpServers } from './claude-launch'
import { AGENT_SPECS } from './specs'

describe('claudeMcpServers', () => {
  const servers = claudeMcpServers({ shim: '/app/out/main/shim.js', socketPath: '/run/ink/mcp.sock' })

  it('is only the Ink server, under that name and not `ottopus`', () => {
    expect(Object.keys(servers)).toEqual(['ottopus-ink'])
  })

  it('runs the shim with the app binary, as plain Node', () => {
    expect(servers['ottopus-ink']).toMatchObject({
      command: process.execPath,
      args: ['/app/out/main/shim.js'],
      env: { ELECTRON_RUN_AS_NODE: '1', OTTOPUS_INK_SOCKET: '/run/ink/mcp.sock' },
    })
  })

  it('refuses a shim path that is not absolute', () => {
    expect(() => claudeMcpServers({ shim: 'shim.js', socketPath: '/run/ink/mcp.sock' })).toThrow(/absolute/)
  })

  it('names the token rather than holding it', () => {
    expect(servers['ottopus-ink']).toMatchObject({ env: { OTTOPUS_INK_TOKEN: '${OTTOPUS_INK_TOKEN}' } })
  })
})

describe('claudeArgs', () => {
  const args = claudeArgs({ mcpConfig: '/tmp/ink/mcp.json', pluginDir: null })
  const valueOf = (flag: string) => args[args.indexOf(flag) + 1]

  it('turns off every built-in tool and all of the user setup', () => {
    expect(valueOf('--tools')).toBe('')
    expect(valueOf('--setting-sources')).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--no-session-persistence')
  })

  it('denies anything that is not an Ink tool', () => {
    expect(valueOf('--permission-mode')).toBe('dontAsk')
    expect(valueOf('--allowedTools')).toBe('mcp__ottopus-ink__*')
  })

  it('reads its MCP servers from the given file', () => {
    expect(valueOf('--mcp-config')).toBe('/tmp/ink/mcp.json')
  })

  it('never asks to skip permissions', () => {
    expect(args.join(' ')).not.toMatch(/bypass|dangerously/i)
  })

  it('loads the Ink skills only when given them', () => {
    expect(args).not.toContain('--plugin-dir')
    const withSkills = claudeArgs({ mcpConfig: 'm', pluginDir: '/app/skills' })
    expect(withSkills[withSkills.indexOf('--plugin-dir') + 1]).toBe('/app/skills')
  })

  it('uses only flags that detection requires, so an older CLI shows as outdated', () => {
    const claude = AGENT_SPECS.find((spec) => spec.id === 'claude-code')
    const flags = claudeArgs({ mcpConfig: 'm', pluginDir: 'p' }).filter((arg) => arg.startsWith('--'))
    expect(claude?.requires).toEqual(expect.arrayContaining(flags))
  })
})

describe('claudeArgs with external tools', () => {
  it('allows only the servers named, and adds skills as a file', () => {
    const args = claudeArgs({ mcpConfig: '/x', pluginDir: null, externalServers: ['one', 'two'], skillsFile: '/x/skills.md' })
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__ottopus-ink__*,mcp__one__*,mcp__two__*')
    expect(args[args.indexOf('--append-system-prompt-file') + 1]).toBe('/x/skills.md')
  })

  it('keeps every lockdown flag and never loads a plugin folder', () => {
    const args = claudeArgs({ mcpConfig: '/x', pluginDir: null, externalServers: ['one'], skillsFile: '/x/skills.md' })
    expect(args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence', '--permission-mode', 'dontAsk']))
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args).not.toContain('--plugin-dir')
  })
})

describe('claudeEnv', () => {
  it('keeps what the CLI needs to run, reach the network and sign in', () => {
    const env = {
      HOME: '/h',
      PATH: '/bin',
      LANG: 'C',
      LC_ALL: 'C',
      XDG_CONFIG_HOME: '/h/.c',
      HTTPS_PROXY: 'http://proxy',
      NODE_EXTRA_CA_CERTS: '/ca.pem',
      CLAUDE_CONFIG_DIR: '/h/.other',
      ANTHROPIC_API_KEY: 'test-value',
      ANTHROPIC_AUTH_TOKEN: 'test-value',
      CLAUDE_CODE_OAUTH_TOKEN: 'test-value',
    }
    expect(claudeEnv(env)).toMatchObject(env)
  })

  it('drops the ANTHROPIC_ variables that could send a chat elsewhere or change its model', () => {
    const env = claudeEnv({
      ANTHROPIC_BASE_URL: 'https://elsewhere.test',
      ANTHROPIC_CUSTOM_HEADERS: 'x: y',
      ANTHROPIC_MODEL: 'other',
      ANTHROPIC_SMALL_FAST_MODEL: 'other',
    })
    expect(Object.keys(env).filter((name) => name.startsWith('ANTHROPIC_'))).toEqual([])
  })

  it('drops what would change the session or does not concern it', () => {
    const env = claudeEnv({
      HOME: '/h',
      CLAUDE_CODE_PLUGIN_DIRS: '/other/plugin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk',
      CLAUDE_CODE_SHELL: '/bin/evil',
      NODE_OPTIONS: '--require /evil.js',
      GITHUB_TOKEN: 'test-value',
      AWS_SECRET_ACCESS_KEY: 'test-value',
      XDG_CONFIG_DIRS: '/etc',
    })
    for (const name of [
      'CLAUDE_CODE_PLUGIN_DIRS',
      'CLAUDECODE',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_SHELL',
      'NODE_OPTIONS',
      'GITHUB_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'XDG_CONFIG_DIRS',
    ]) {
      expect(env).not.toHaveProperty(name)
    }
    expect(env.HOME).toBe('/h')
  })

  it('turns off the housekeeping it can, whatever was set before', () => {
    expect(claudeEnv({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' })).toMatchObject({
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
    })
  })
})
