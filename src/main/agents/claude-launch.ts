/** The MCP tools a locked session may call without asking. Everything else is denied. */
const ALLOWED_TOOLS = 'mcp__ottopus-ink__*'

export interface ClaudeLaunch {
  /** Path of the file holding the session's MCP servers. */
  mcpConfig: string
  /** The Ink skills, loaded as a plugin for this session only. */
  pluginDir: string | null
}

/**
 * The flags of a locked session. Each one is there to keep the session to Ink's
 * tools and away from the user's own Claude Code setup:
 * - `--tools ""`: none of the built-in shell, file or web tools.
 * - `--strict-mcp-config`: only the servers in mcpConfig, not the user's.
 * - `--setting-sources ""`: none of the user's or a project's settings, so their
 *   hooks, plugins, permissions and CLAUDE.md stay out.
 * - `--permission-mode dontAsk`: no one is there to answer a prompt, so anything
 *   not allowed below is denied.
 * - `--no-session-persistence`: no transcript under `~/.claude/projects`.
 */
export function claudeArgs({ mcpConfig, pluginDir }: ClaudeLaunch): string[] {
  return [
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    // stream-json output requires it.
    '--verbose',
    '--include-partial-messages',
    '--no-session-persistence',
    '--mcp-config',
    mcpConfig,
    '--strict-mcp-config',
    '--tools',
    '',
    '--setting-sources',
    '',
    '--allowedTools',
    ALLOWED_TOOLS,
    '--permission-mode',
    'dontAsk',
    ...(pluginDir ? ['--plugin-dir', pluginDir] : []),
  ]
}

/**
 * What a session's process may see of the environment: how to run, how to reach
 * the network, and how the user signs in. An allowlist, because Claude Code reads
 * many variables that would undo the flags above. CLAUDE_CODE_PLUGIN_DIRS, for
 * one, loads plugins whatever `--setting-sources` says, and a launch from a
 * terminal inherits it. It also keeps the user's other secrets from the agent.
 */
const PASSED_THROUGH = [
  /^(?:HOME|USER|LOGNAME|PATH|SHELL|TERM|TZ|TMPDIR|TEMP|TMP|LANG|LC_[A-Z]+)$/,
  /^XDG_(?:CONFIG|DATA|STATE|CACHE)_HOME$/,
  /^XDG_RUNTIME_DIR$/,
  /^(?:https?_proxy|all_proxy|no_proxy|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/,
  /^(?:NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/,
  /^(?:CLAUDE_CONFIG_DIR|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_[A-Z_]+)$/,
]

export function claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = Object.entries(env).filter(([name]) => PASSED_THROUGH.some((allowed) => allowed.test(name)))
  return {
    ...Object.fromEntries(kept),
    // Less of Claude Code's own housekeeping: no memory folder for the session's
    // working directory, no rewrite of ~/.claude.json, no update check.
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
  }
}
