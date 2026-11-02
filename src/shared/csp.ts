/**
 * The renderer's Content-Security-Policy.
 *
 * The renderer never talks to the network directly: balances, quotes and agent
 * output all arrive over IPC from the main process. So production allows
 * nothing beyond the app's own files. Dev adds the Vite server and its HMR
 * websocket, and the inline script React refresh injects.
 *
 * style-src keeps 'unsafe-inline' in both modes because React style attributes
 * need it; scripts never get it in production.
 *
 * No frame-ancestors: browsers ignore it in a <meta> policy, which is how this
 * one is delivered.
 */
export function contentSecurityPolicy({ dev }: { dev: boolean }): string {
  const devServer = 'http://localhost:* ws://localhost:*'
  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': dev ? "'self' 'unsafe-inline'" : "'self'",
    'style-src': "'self' 'unsafe-inline'",
    'img-src': "'self' data:",
    'font-src': "'self'",
    'connect-src': dev ? `'self' ${devServer}` : "'self'",
    'object-src': "'none'",
    'base-uri': "'none'",
    'form-action': "'none'",
  }
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ')
}
