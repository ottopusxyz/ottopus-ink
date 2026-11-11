import { bindings, defineConfig } from 'cf/config'
import * as entrypoint from './src/index.ts' with { type: 'cf-worker' }

export default defineConfig({
  worker: {
    name: 'ottopus-ink-service',
    compatibilityDate: '2026-11-04',
    entrypoint,
    env: {
      // Ottopus's Zerion API key. Set it as a secret on the deployed Worker; it is never in this repo.
      ZERION_API_KEY: bindings.secret(),
      // Requests per minute from one IP address, and from one Ink install. Namespace ids are this account's own numbers.
      PER_IP: bindings.rateLimit({ namespace: '7101', simple: { limit: 30, period: 60 } }),
      PER_INSTALL: bindings.rateLimit({ namespace: '7102', simple: { limit: 20, period: 60 } }),
    },
  },
})
