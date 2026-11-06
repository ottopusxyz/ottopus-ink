import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { ServerDef } from './catalog'
import { checkServer, completeSignIn, planSignIn, renewSignIn, type Fetch, type SignIn, type SignInPlan } from './oauth'

/** The OS's secret store. Electron's safeStorage, kept behind this so tests don't need Electron. */
export interface SecretBox {
  /** False where the OS has nothing real to encrypt with, such as Linux with no keyring. */
  canKeep(): boolean
  seal(text: string): Buffer
  open(data: Buffer): string
}

/** What a server needs before a chat can use it. */
export type ServerAccess = { kind: 'open' } | { kind: 'token'; token: string } | { kind: 'needs-sign-in' }

export type RemoteServer = Exclude<ServerDef, { transport: 'stdio' }>

export interface SignInsOptions {
  file: string
  box: SecretBox
  openBrowser: (url: string) => Promise<void>
  fetchFn?: Fetch
}

export interface SignIns {
  /** Whether Ink would look after signing in to this server. One with its own headers sees to itself. */
  handles(server: ServerDef): server is RemoteServer
  isSignedIn(server: ServerDef): boolean
  /** Whether what's signed in lasts past this run of the app. */
  canKeep(): boolean
  /** Contacts the server, renewing a sign-in that has run out. */
  accessFor(server: ServerDef): Promise<ServerAccess>
  plan(server: RemoteServer): Promise<SignInPlan>
  signIn(server: RemoteServer, plan: SignInPlan, signal: AbortSignal): Promise<void>
  signOut(server: ServerDef): void
}

const RENEW_BEFORE_MS = 60_000

/**
 * Sign-ins by server address, so a token only ever goes to the address it came from:
 * if an item's address changes, what was signed in stays behind. Encrypted on disk, and
 * only in memory where the OS can't encrypt it, so a stored token is never plain text.
 */
export function createSignIns({ file, box, openBrowser, fetchFn = fetch }: SignInsOptions): SignIns {
  const load = (): Record<string, SignIn> => {
    if (!box.canKeep()) return {}
    try {
      const parsed: unknown = JSON.parse(box.open(readFileSync(file)))
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, SignIn>) : {}
    } catch {
      // Missing or unreadable: signed out, which is the safe way to be wrong.
      return {}
    }
  }
  const signIns = new Map(Object.entries(load()))

  const save = () => {
    if (!box.canKeep()) return
    if (signIns.size === 0) {
      rmSync(file, { force: true })
      return
    }
    const temporary = `${file}.${randomUUID()}`
    writeFileSync(temporary, box.seal(JSON.stringify(Object.fromEntries(signIns))), { mode: 0o600 })
    renameSync(temporary, file)
  }

  const handles = (server: ServerDef): server is RemoteServer => server.transport !== 'stdio' && Object.keys(server.headers).length === 0

  const renewed = async (url: string, current: SignIn): Promise<SignIn | null> => {
    try {
      const fresh = await renewSignIn(current, fetchFn)
      signIns.set(url, fresh)
      save()
      return fresh
    } catch {
      return null
    }
  }

  return {
    handles,
    isSignedIn: (server) => handles(server) && signIns.has(server.url),
    canKeep: () => box.canKeep(),

    async accessFor(server) {
      if (!handles(server)) return { kind: 'open' }
      const { url, transport } = server
      let current = signIns.get(url) ?? null
      if (current) {
        if (current.expiresAt !== null && current.expiresAt - RENEW_BEFORE_MS < Date.now() && current.refreshToken) current = (await renewed(url, current)) ?? current
        let state = await checkServer(url, transport, current.accessToken, fetchFn)
        if (state === 'needs-sign-in' && current.refreshToken) {
          const fresh = await renewed(url, current)
          if (fresh) {
            current = fresh
            state = await checkServer(url, transport, fresh.accessToken, fetchFn)
          }
        }
        // If it can't be reached, the token is still the best thing to go in with.
        if (state !== 'needs-sign-in') return { kind: 'token', token: current.accessToken }
        signIns.delete(url)
        save()
        return { kind: 'needs-sign-in' }
      }
      return (await checkServer(url, transport, null, fetchFn)) === 'needs-sign-in' ? { kind: 'needs-sign-in' } : { kind: 'open' }
    },

    plan: (server) => planSignIn(server.url, server.transport, fetchFn),

    async signIn(server, plan, signal) {
      signIns.set(server.url, await completeSignIn(plan, { openBrowser, signal, fetchFn }))
      save()
    },

    signOut(server) {
      if (server.transport !== 'stdio' && signIns.delete(server.url)) save()
    },
  }
}
