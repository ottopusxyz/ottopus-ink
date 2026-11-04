import { connect } from 'node:net'

/**
 * The `ottopus-ink` MCP server as the agent sees it: a process the agent launches
 * that joins its stdin and stdout to the app's socket. It understands none of what
 * passes through, holds no keys, and imports only Node. Everything an agent asks
 * is judged in the main process, so this side stays too small to get wrong.
 *
 * The socket's location and the session's token come from the environment. The
 * token is never on argv or in the MCP config, where it would be easy to read.
 */
const { OTTOPUS_INK_SOCKET: socketPath, OTTOPUS_INK_TOKEN: token } = process.env

if (!socketPath || !token) {
  console.error('ottopus-ink: this runs from Ottopus Ink chats only.')
  process.exit(1)
}

const bridge = connect(socketPath)
bridge.write(`${JSON.stringify({ token })}\n`)
process.stdin.pipe(bridge)
bridge.pipe(process.stdout)

bridge.on('error', (error) => {
  console.error(`ottopus-ink: can't reach the app: ${error.message}`)
})
// Without the app there's nothing to serve, and the agent should see that.
bridge.once('close', (hadError) => process.exit(hadError ? 1 : 0))
