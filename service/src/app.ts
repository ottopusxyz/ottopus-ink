import { Hono } from 'hono'
import { zerionPositions } from './zerion'

/** Cloudflare's rate limiter, as a binding exposes it. */
export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/** Somewhere to keep an answer for a short while: the Cache API in a Worker. */
export interface AnswerCache {
  match(key: Request): Promise<Response | undefined>
  put(key: Request, response: Response): Promise<void>
}

export interface ServiceDeps {
  /** Ottopus's Zerion key, or nothing when the secret isn't set. */
  zerionKey: string | undefined
  perIp: Limiter
  perInstall: Limiter
  cache: AnswerCache
  fetch: typeof globalThis.fetch
  /** Defers work past the response, such as filling the cache. */
  waitUntil?: (work: Promise<unknown>) => void
}

/** How long one address's answer is kept, in seconds. A refresh and the agent asking together cost one Zerion call. */
export const CACHE_SECONDS = 60

/** The address kinds Zerion reads for Ink: one EVM address for every EVM chain, a Solana one, a Tron one. */
const ADDRESS = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|T[1-9A-HJ-NP-Za-km-z]{33})$/

/** The random id an Ink install makes on its first run. It names nobody; it only shares out the limits fairly. */
const INSTALL = /^[A-Za-z0-9_-]{16,64}$/

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })

/**
 * Ink's service: one narrow route per provider, each with a key only the service has.
 * It takes public addresses and nothing else, keeps no record of them, and logs none.
 * Today it has one route, an EVM, Solana or Tron address's holdings from Zerion, in
 * Zerion's own shape cut down to what Ink reads, so Ink parses it the way it parses
 * an answer from Zerion itself.
 */
export function createApp(deps: ServiceDeps) {
  const app = new Hono()

  app.get('/v1/health', () => json({ ok: true, zerion: deps.zerionKey ? 'ready' : 'off' }))

  app.get('/v1/zerion/wallets/:address/positions/', async (c) => {
    const asked = c.req.param('address')
    if (!ADDRESS.test(asked)) return json({ errors: [{ detail: 'Address is not trackable here' }] }, 400)
    // One EVM address in any letter case is one wallet, and one cache entry.
    const address = asked.startsWith('0x') ? asked.toLowerCase() : asked
    if (!deps.zerionKey) return json({ error: 'not-configured' }, 503)

    const install = c.req.header('x-ink-install')
    if (install !== undefined && !INSTALL.test(install)) return json({ error: 'bad-install-id' }, 400)
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
    const [byIp, byInstall] = await Promise.all([deps.perIp.limit({ key: ip }), install ? deps.perInstall.limit({ key: install }) : { success: true }])
    if (!byIp.success || !byInstall.success) return json({ error: 'rate-limited' }, 429, { 'retry-after': '60' })

    // Keyed by address alone: the answer is the same whoever asks, and the key is never part of it.
    const cacheKey = new Request(`https://cache.ink.internal/v1/zerion/${address}`)
    const kept = await deps.cache.match(cacheKey)
    if (kept) return new Response(kept.body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-ink-cache': 'hit' } })

    const answer = await zerionPositions(address, { key: deps.zerionKey, fetch: deps.fetch })
    if (answer.kind === 'untracked') return json({ errors: [{ detail: 'Address is not trackable' }] }, 400)
    if (answer.kind === 'rate-limited') return json({ error: 'rate-limited' }, 429, { 'retry-after': String(answer.retryAfter ?? 60) })
    if (answer.kind === 'unavailable') return json({ error: 'unavailable' }, 503)

    const body = JSON.stringify({ data: answer.data, links: { next: null } })
    const stored = deps.cache.put(cacheKey, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_SECONDS}` } }))
    if (deps.waitUntil) deps.waitUntil(stored)
    else await stored
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-ink-cache': 'miss' } })
  })

  app.notFound(() => json({ error: 'not-found' }, 404))
  app.onError(() => json({ error: 'unavailable' }, 503))
  return app
}
