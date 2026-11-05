import { isAbsolute } from 'node:path'
import { MCP_SERVER_NAME } from '../mcp/protocol'

/** The MCP tools a locked session may call without asking. Everything else is denied. */
const ALLOWED_TOOLS = `mcp__${MCP_SERVER_NAME}__*`

/** Where a session's process finds its token. */
export const MCP_TOKEN_ENV = 'OTTOPUS_INK_TOKEN'

export interface ClaudeLaunch {
  /** Path of the file holding the session's MCP servers. */
  mcpConfig: string
  /** The Ink skills, loaded as a plugin for this session only. */
  pluginDir: string | null
  /** External MCP servers the person enabled, as the session's config names them. */
  externalServers?: readonly string[]
  /** A file of skill text for the system prompt. Skills can't load the usual way: `--tools ""` removes `Skill`. */
  skillsFile?: string | null
}

export interface InkMcpServer {
  /** The shim, built next to the main bundle. */
  shim: string
  socketPath: string
}

/**
 * The session's MCP config: the shim, run by this app's own binary so that no
 * separate Node is needed. The token is named here, not written: Claude Code
 * fills it in from its environment, so it stays out of the file and off argv.
 */
export function claudeMcpServers({ shim, socketPath }: InkMcpServer): Record<string, unknown> {
  // A relative path would mean whatever sits at that path in the session's folder.
  if (!isAbsolute(shim)) throw new Error('The MCP shim needs an absolute path')
  return {
    [MCP_SERVER_NAME]: {
      type: 'stdio',
      command: process.execPath,
      args: [shim],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        OTTOPUS_INK_SOCKET: socketPath,
        OTTOPUS_INK_TOKEN: `\${${MCP_TOKEN_ENV}}`,
      },
    },
  }
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
export function claudeArgs({ mcpConfig, pluginDir, externalServers = [], skillsFile = null }: ClaudeLaunch): string[] {
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
    [ALLOWED_TOOLS, ...externalServers.map((server) => `mcp__${server}__*`)].join(','),
    '--permission-mode',
    'dontAsk',
    ...(pluginDir ? ['--plugin-dir', pluginDir] : []),
    ...(skillsFile ? ['--append-system-prompt-file', skillsFile] : []),
  ]
}

/**
 * What a session's process may see of the environment: how to run, how to reach
 * the network, and how the user signs in. An allowlist, because Claude Code reads
 * many variables that would undo the flags above. CLAUDE_CODE_PLUGIN_DIRS, for
 * one, loads plugins whatever `--setting-sources` says, and a launch from a
 * terminal inherits it. It also keeps the user's other secrets from the agent.
 * Of the ANTHROPIC_ variables only the sign-in ones pass: others can send every
 * chat, wallet tool results included, to another server (ANTHROPIC_BASE_URL).
 */
const PASSED_THROUGH = [
  /^(?:HOME|USER|LOGNAME|PATH|SHELL|TERM|TZ|TMPDIR|TEMP|TMP|LANG|LC_[A-Z]+)$/,
  /^XDG_(?:CONFIG|DATA|STATE|CACHE)_HOME$/,
  /^XDG_RUNTIME_DIR$/,
  /^(?:https?_proxy|all_proxy|no_proxy|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/,
  /^(?:NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/,
  /^(?:CLAUDE_CONFIG_DIR|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN)$/,
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
