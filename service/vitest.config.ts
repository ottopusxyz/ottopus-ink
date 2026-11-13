import { defineConfig } from 'vitest/config'

// The app is plain fetch handlers with its Cloudflare parts passed in, so it's tested in Node.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
