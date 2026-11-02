import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { contentSecurityPolicy } from './src/shared/csp'

/**
 * The CSP is written into index.html at build time rather than kept as a literal
 * in the file, so dev (which needs the Vite websocket) and production (which
 * needs nothing beyond 'self') cannot drift into one loose policy for both.
 */
function cspPlugin(): Plugin {
  let dev = false
  return {
    name: 'ink-csp',
    configResolved(config) {
      dev = config.command === 'serve'
    },
    transformIndexHtml(html) {
      return html.replace('%INK_CSP%', contentSecurityPolicy({ dev }))
    },
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // The signer runs as its own utilityProcess. It is a separate entry so
          // nothing in the main bundle can reach signing code by import.
          signer: resolve('src/signer/index.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // Sandboxed preloads cannot be ES modules.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), cspPlugin()],
  },
})
