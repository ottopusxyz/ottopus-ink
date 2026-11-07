import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import type { ChatPlan } from '../../shared/ipc'
import { handleMcpMessage, parseErrorResponse, type McpHandlers } from './protocol'

export interface McpBridgeOptions {
  /** Where the socket's private folder goes. It must be the user's own. */
  parentDir: string
  /** The app's version, as the server reports it. */
  version: string
  /** How long a new connection gets to prove itself. */
  helloTimeoutMs?: number
  /** The wallet's public addresses, for get_accounts. Main passes this in so agent code never imports the vault. */
  accounts?: McpHandlers['accounts']
}

export interface McpSession {
  token: string
  /** Whether the token has ever opened a connection. */
  connected(): boolean
  /** Revokes the token and drops the session's connection. */
  remove(): void
}

export interface McpBridge {
  socketPath: string
  /** onPlan gets each plan the session's agent proposes. */
  addSession(handlers?: { onPlan?: (plan: ChatPlan) => void }): McpSession
  close(): void
}

/** Past any real request, and all of it held in memory until the line ends. */
const MAX_LINE_CHARS = 1024 * 1024

/** Replies a reader isn't taking are dropped with the connection, not piled up here. */
const MAX_UNREAD_CHARS = 1024 * 1024

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

interface BridgeSession {
  connection: Socket | null
  everConnected: boolean
  onPlan: ((plan: ChatPlan) => void) | undefined
}

/**
 * The agent side of the app: a Unix socket the MCP shim connects to. A connection
 * opens with `{"token":…}` for a live session, and is dropped otherwise. After
 * that each line is a JSON-RPC message from an agent, which is untrusted.
 *
 * The socket sits in a new 0700 folder and is itself 0600. Only hashes of tokens
 * are kept, so a lookup doesn't compare against the secret.
 */
export function startMcpBridge({ parentDir, version, helloTimeoutMs = 2000, accounts }: McpBridgeOptions): Promise<McpBridge> {
  mkdirSync(parentDir, { recursive: true })
  const dir = mkdtempSync(join(parentDir, 'ottopus-ink-'))
  const socketPath = join(dir, 'mcp.sock')

  /** Each live session's connection, by the hash of its token. */
  const sessions = new Map<string, BridgeSession>()
  const connections = new Set<Socket>()

  const server = createServer((connection) => {
    connections.add(connection)
    connection.setEncoding('utf8')
    connection.on('error', () => undefined)
    connection.once('close', () => connections.delete(connection))

    const helloTimer = setTimeout(() => connection.destroy(), helloTimeoutMs)
    connection.once('close', () => clearTimeout(helloTimer))
    let helloed: BridgeSession | null = null
    let buffer = ''

    const onHello = (line: string) => {
      const session = sessions.get(hash(tokenFromHello(line)))
      if (!session) {
        connection.destroy()
        return
      }
      clearTimeout(helloTimer)
      helloed = session
      // One at a time for each session: a shim that restarts takes over from the old one.
      session.connection?.destroy()
      session.connection = connection
      session.everConnected = true
      connection.once('close', () => {
        if (session.connection === connection) session.connection = null
      })
    }

    const onRequest = async (session: BridgeSession, line: string) => {
      let response: object | null
      try {
        response = await handleMcpMessage(JSON.parse(line), version, { onPlan: session.onPlan, accounts })
      } catch {
        response = parseErrorResponse()
      }
      // Answers can take a moment now, and the session may have ended meanwhile.
      if (!response || connection.destroyed || session.connection !== connection) return
      connection.write(`${JSON.stringify(response)}\n`)
      if (connection.writableLength > MAX_UNREAD_CHARS) connection.destroy()
    }

    connection.on('data', (chunk: string) => {
      buffer += chunk
      if (chunk.includes('\n')) {
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (connection.destroyed) return
          if (!helloed) onHello(line)
          else if (line) void onRequest(helloed, line)
        }
      }
      if (buffer.length > MAX_LINE_CHARS) connection.destroy()
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      rmSync(dir, { recursive: true, force: true })
      reject(error)
    })
    server.listen(socketPath, () => {
      // The folder already keeps others out while this runs.
      chmodSync(socketPath, 0o600)
      resolve({
        socketPath,
        addSession(handlers) {
          const token = randomBytes(32).toString('hex')
          const key = hash(token)
          const session: BridgeSession = { connection: null, everConnected: false, onPlan: handlers?.onPlan }
          sessions.set(key, session)
          return {
            token,
            connected: () => session.everConnected,
            remove() {
              sessions.delete(key)
              session.connection?.destroy()
            },
          }
        },
        close() {
          sessions.clear()
          server.close()
          for (const connection of connections) connection.destroy()
          rmSync(dir, { recursive: true, force: true })
        },
      })
    })
  })
}

function tokenFromHello(line: string): string {
  try {
    const hello: unknown = JSON.parse(line)
    if (typeof hello === 'object' && hello !== null && 'token' in hello && typeof hello.token === 'string') {
      return hello.token
    }
  } catch {
    // Not a hello; no session has an empty token.
  }
  return ''
}
