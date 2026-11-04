import { describe, expect, it } from 'vitest'
import type { RunResult } from './run'
import {
  agentState,
  missingFromHelp,
  parseClaudeAuth,
  parseCodexAuth,
  parseOpenCodeAuth,
  parseVersion,
} from './specs'

const run = (stdout: string, code: number | null = 0, stderr = ''): RunResult => ({ code, stdout, stderr })

describe('parseVersion', () => {
  it('reads each CLI’s version line', () => {
    expect(parseVersion('2.1.316 (Claude Code)')).toBe('2.1.316')
    expect(parseVersion('codex-cli 0.156.1')).toBe('0.156.1')
    expect(parseVersion('1.4.0-beta.2\n')).toBe('1.4.0-beta.2')
  })

  it('returns null without a version', () => {
    expect(parseVersion('command not found')).toBeNull()
  })
})

describe('missingFromHelp', () => {
  // Lines as the real CLIs print them: Claude Code 2.1.316 and codex-cli 0.156.1.
  const claudeHelp = `Options:
  --input-format <format>               Input format (only works with --print)
  --mcp-config <configs...>             Load MCP servers from JSON files
  --output-format <format>              Output format (only works with --print)
  --permission-prompts <target>         Who answers permission prompts with
                                        --print: "host" (the SDK host or
                                        --permission-prompt-tool) or "none"
  --plugin-dir <path>                   Load a plugin from a directory
  -p, --print                           Print response and exit
  --setting-sources <sources>           Comma-separated list of setting sources
  --strict-mcp-config                   Only use MCP servers from --mcp-config
  --tools <tools...>                    Specify the list of available tools`
  const codexHelp = `Commands:
  exec              Run Codex non-interactively [aliases: e]
  app-server        [experimental] Run the app server or related tooling
Options:
  -c, --config <key=value>`
  // OpenCode 1.19.5 builds its help with yargs and scriptName("opencode"), so
  // commands carry the program name. Written from its source, not captured.
  const opencodeHelp = `opencode [project]

Commands:
  opencode completion          generate shell completion script
  opencode acp                 start ACP (Agent Client Protocol) server
  opencode providers           manage AI providers and credentials  [aliases: auth]`
  // The rewritten CLI in OpenCode's dev branch lists commands bare.
  const opencodeNextHelp = `SUBCOMMANDS
  acp    Start the ACP server
  auth   Manage credentials`

  it('passes each CLI’s real help', () => {
    const claude = ['--print', '--input-format', '--output-format', '--mcp-config', '--strict-mcp-config']
    expect(missingFromHelp(claudeHelp, [...claude, '--setting-sources', '--plugin-dir', '--tools'], 'claude')).toEqual([])
    expect(missingFromHelp(codexHelp, ['app-server', '--config'], 'codex')).toEqual([])
    expect(missingFromHelp(opencodeHelp, ['acp'], 'opencode')).toEqual([])
    expect(missingFromHelp(opencodeNextHelp, ['acp'], 'opencode')).toEqual([])
  })

  it('doesn’t count a mention in another item’s description', () => {
    expect(missingFromHelp(claudeHelp, ['--permission-prompt-tool'], 'claude')).toEqual(['--permission-prompt-tool'])
    expect(missingFromHelp(codexHelp, ['app'], 'codex')).toEqual(['app'])
  })

  it('doesn’t match a longer flag or command that contains the word', () => {
    expect(missingFromHelp(claudeHelp, ['--strict', '--plugin'], 'claude')).toEqual(['--strict', '--plugin'])
    expect(missingFromHelp(opencodeHelp, ['ac'], 'opencode')).toEqual(['ac'])
  })

  it('doesn’t take another program’s name for the prefix', () => {
    expect(missingFromHelp('  other acp   something', ['acp'], 'opencode')).toEqual(['acp'])
  })
})

describe('parseClaudeAuth', () => {
  it('reads loggedIn from the JSON', () => {
    expect(parseClaudeAuth(run('{"loggedIn":true,"authMethod":"claude.ai"}'))).toBe(true)
    expect(parseClaudeAuth(run('{"loggedIn":false}', 1))).toBe(false)
  })

  it('returns null for anything else', () => {
    expect(parseClaudeAuth(run('error: unknown command'))).toBeNull()
    expect(parseClaudeAuth(run('{"loggedIn":"yes"}'))).toBeNull()
  })
})

describe('parseCodexAuth', () => {
  it('reads the status line', () => {
    expect(parseCodexAuth(run('Logged in using ChatGPT'))).toBe(true)
    expect(parseCodexAuth(run('', 1, 'Not logged in'))).toBe(false)
  })

  it('returns null when it can’t tell', () => {
    expect(parseCodexAuth(run('', null))).toBeNull()
  })
})

describe('parseOpenCodeAuth', () => {
  it('counts stored credentials and environment keys', () => {
    expect(parseOpenCodeAuth(run('●  Anthropic oauth\n└  1 credentials'))).toBe(true)
    expect(parseOpenCodeAuth(run('└  0 credentials\n└  2 environment variables'))).toBe(true)
    expect(parseOpenCodeAuth(run('└  0 credentials'))).toBe(false)
  })

  it('reads the newer CLI’s connection rows', () => {
    expect(parseOpenCodeAuth(run('Anthropic  Claude Max                  stored\n'))).toBe(true)
    expect(parseOpenCodeAuth(run('OpenAI     OPENAI_API_KEY              environment\n'))).toBe(true)
    expect(parseOpenCodeAuth(run('No authenticated integrations\n'))).toBe(false)
  })

  it('returns null when it fails or prints no count', () => {
    expect(parseOpenCodeAuth(run('', 1))).toBeNull()
    expect(parseOpenCodeAuth(run('something else'))).toBeNull()
  })
})

describe('agentState', () => {
  const ok = { path: '/usr/bin/claude', version: '2.1.316', missing: [], signedIn: true }

  it('is ready when everything checks out, or sign-in is unknown', () => {
    expect(agentState(ok)).toBe('ready')
    expect(agentState({ ...ok, signedIn: null })).toBe('ready')
  })

  it('reports the first problem', () => {
    expect(agentState({ ...ok, path: null, version: null })).toBe('missing')
    expect(agentState({ ...ok, version: null })).toBe('broken')
    expect(agentState({ ...ok, missing: null })).toBe('broken')
    expect(agentState({ ...ok, missing: ['--plugin-dir'], signedIn: false })).toBe('outdated')
    expect(agentState({ ...ok, signedIn: false })).toBe('signed-out')
  })
})
