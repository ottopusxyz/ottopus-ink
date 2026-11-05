import type { ChatEvent } from '../../shared/ipc'
import { MCP_SERVER_NAME } from '../mcp/protocol'

const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`

const MAX_FOUND = 10

/**
 * What a session's report shows beyond Ink's own tools, in words for the person.
 * Skills and subagents aren't checked: a session lists Claude Code's built-in ones
 * whatever it was given, and they can't run without the `Skill` and `Agent` tools,
 * which this rejects.
 */
function outsideInk(tools: string[] | null, servers: string[] | null, plugins: string[] | null): string[] {
  const found: string[] = []
  if (tools === null) found.push("a tool list Ink can't read")
  if (servers === null) found.push("a server list Ink can't read")
  if (plugins === null) found.push("a plugin list Ink can't read")
  for (const tool of tools ?? []) if (!tool.startsWith(TOOL_PREFIX)) found.push(`the tool ${tool}`)
  for (const server of servers ?? []) if (server !== MCP_SERVER_NAME) found.push(`the MCP server ${server}`)
  for (const plugin of plugins ?? []) found.push(`the plugin ${plugin}`)
  // This goes in a notice for the person, who doesn't need all of a long list.
  return found.length > MAX_FOUND ? [...found.slice(0, MAX_FOUND), `${found.length - MAX_FOUND} more`] : found
}

/**
 * Follows a chat's events and says when its lock is settled: null when an event
 * changes nothing, otherwise everything found outside Ink's tools, which is empty
 * for a locked session. Works from the agent-neutral events, so a new driver is
 * covered by reporting `session` at the start of each turn.
 *
 * This catches a flag that stopped working or a new way for tools to get in. It
 * can't catch an agent that lies about itself; that's why nothing it can reach
 * can sign. A report comes only once the first message is on its way, so that
 * message goes out before anything has been checked.
 *
 * @param shimConnected whether this session's token has reached the socket. Ink's
 *   tools can only be listed by way of that connection, so without it they're
 *   coming from some other server that uses the name.
 */
export function lockWatcher(shimConnected: () => boolean): (event: ChatEvent) => string[] | null {
  let reportedThisTurn = false

  return (event) => {
    switch (event.type) {
      case 'session': {
        reportedThisTurn = true
        const found = outsideInk(event.tools, event.servers, event.plugins)
        if (event.tools?.some((tool) => tool.startsWith(TOOL_PREFIX)) && !shimConnected()) {
          found.push(`${MCP_SERVER_NAME} tools that didn't come through Ink's shim`)
        }
        return found
      }
      case 'subagent':
        return ['a subagent at work']
      case 'tool-call':
        if (!reportedThisTurn) return [`a call to ${event.name} before the agent reported its tools`]
        return event.name.startsWith(TOOL_PREFIX) ? null : [`a call to ${event.name}`]
      case 'turn-end': {
        // A stopped or failed turn can end before the report goes out.
        const silent = event.outcome === 'done' && !reportedThisTurn
        reportedThisTurn = false
        return silent ? ['a finished turn with no report of its tools'] : null
      }
      default:
        return null
    }
  }
}
