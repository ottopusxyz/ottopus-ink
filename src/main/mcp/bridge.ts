import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import type { ChatPlan } from '../../shared/ipc'
import type { PlanTools } from '../../shared/plan'
import { handleMcpMessage, parseErrorResponse, rpcError, type McpHandlers, type RpcId } from './protocol'

export interface McpBridgeOptions {
  /** Where the socket's private folder goes. It must be the user's own. */
  parentDir: string
  /** The app's version, as the server reports it. */
  version: string
  /** How long a new connection gets to prove itself. */
  helloTimeoutMs?: number
  /** The wallet's public addresses, for get_accounts. Main passes this in so agent code never imports the vault. */
  accounts?: McpHandlers['accounts']
  /**
   * One session's plan tools. `owner` names the session, so a chat only ever sees
   * its own plans, and `typed` gives the person's own messages in it.
   */
  plans?: (session: { owner: string; typed: () => readonly string[] }) => PlanTools
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
  /** onPlan gets each plan the session's agent makes; typed gives what the person typed in that chat. */
  addSession(handlers?: { onPlan?: (plan: ChatPlan) => void; typed?: () => readonly string[] }): McpSession
  close(): void
}

/** Past any real request, and all of it held in memory until the line ends. */
const MAX_LINE_CHARS = 1024 * 1024

/** Replies a reader isn't taking are dropped with the connection, not piled up here. */
const MAX_UNREAD_CHARS = 1024 * 1024

/**
 * Requests one connection may have waiting for an answer. An agent is untrusted, and
 * one that sends without waiting would otherwise start work, some of it in the signer,
 * for every line. More get an error at once rather than a place in a queue.
 */
export const MAX_IN_FLIGHT_PER_CONNECTION = 16

/** The same across every connection, so many sessions together can't pile up work either. */
export const MAX_IN_FLIGHT = 64

/** JSON-RPC's range for server errors. */
const BUSY = -32000

/** The id of a request line, to answer it with an error without handling it. */
function idOf(line: string): RpcId | undefined {
  try {
    const message: unknown = JSON.parse(line)
    if (typeof message !== 'object' || message === null || !('id' in message)) return undefined
    return typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null
  } catch {
    return null
  }
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

interface BridgeSession {
  connection: Socket | null
  everConnected: boolean
  onPlan: ((plan: ChatPlan) => void) | undefined
  plans: PlanTools | undefined
}

/**
 * The agent side of the app: a Unix socket the MCP shim connects to. A connection
 * opens with `{"token":…}` for a live session, and is dropped otherwise. After
 * that each line is a JSON-RPC message from an agent, which is untrusted.
 *
 * The socket sits in a new 0700 folder and is itself 0600. Only hashes of tokens
 * are kept, so a lookup doesn't compare against the secret.
 */
export function startMcpBridge({ parentDir, version, helloTimeoutMs = 2000, accounts, plans }: McpBridgeOptions): Promise<McpBridge> {
  mkdirSync(parentDir, { recursive: true })
  const dir = mkdtempSync(join(parentDir, 'ottopus-ink-'))
  const socketPath = join(dir, 'mcp.sock')

  /** Each live session's connection, by the hash of its token. */
  const sessions = new Map<string, BridgeSession>()
  const connections = new Set<Socket>()
  /** Requests being worked on, across every connection. */
  let inFlight = 0

  const server = createServer((connection) => {
    connections.add(connection)
    connection.setEncoding('utf8')
    connection.on('error', () => undefined)
    connection.once('close', () => connections.delete(connection))

    let connectionInFlight = 0
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

    const reply = (response: object) => {
      connection.write(`${JSON.stringify(response)}\n`)
      if (connection.writableLength > MAX_UNREAD_CHARS) connection.destroy()
    }

    const onRequest = async (session: BridgeSession, line: string) => {
      if (connectionInFlight >= MAX_IN_FLIGHT_PER_CONNECTION || inFlight >= MAX_IN_FLIGHT) {
        // A notification has no id and wants no answer, so it's simply not handled.
        const id = idOf(line)
        if (id !== undefined) reply(rpcError(id, BUSY, 'Too many requests at once. Wait for answers before sending more.'))
        return
      }
      connectionInFlight++
      inFlight++
      let response: object | null
      try {
        response = await handleMcpMessage(JSON.parse(line), version, { onPlan: session.onPlan, accounts, plans: session.plans })
      } catch {
        response = parseErrorResponse()
      } finally {
        connectionInFlight--
        inFlight--
      }
      // An answer that takes a moment may find its connection gone: removing the session
      // and a restarted shim taking over both destroy it. It only ever goes to the asker.
      if (!response || connection.destroyed) return
      reply(response)
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
          const typed = handlers?.typed ?? (() => [])
          const session: BridgeSession = { connection: null, everConnected: false, onPlan: handlers?.onPlan, plans: plans?.({ owner: key, typed }) }
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
