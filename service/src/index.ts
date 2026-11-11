import { env } from 'cloudflare:workers'
import { createApp } from './app'

export default {
  fetch(request, _env, ctx) {
    const app = createApp({
      zerionKey: env.ZERION_API_KEY || undefined,
      perIp: env.PER_IP,
      perInstall: env.PER_INSTALL,
      cache: caches.default,
      fetch: (input, init) => fetch(input, init),
      waitUntil: (work) => ctx.waitUntil(work),
    })
    return app.fetch(request)
  },
} satisfies ExportedHandler
