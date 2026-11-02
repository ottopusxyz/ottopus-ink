import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from './csp'

describe('contentSecurityPolicy', () => {
  it('allows only the app itself in production', () => {
    const csp = contentSecurityPolicy({ dev: false })
    expect(csp).toContain("script-src 'self';")
    expect(csp).toContain("connect-src 'self';")
    expect(csp).not.toContain('localhost')
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(csp).not.toContain('unsafe-eval')
  })

  it('adds only the local dev server in dev', () => {
    const csp = contentSecurityPolicy({ dev: true })
    expect(csp).toContain('ws://localhost:*')
    expect(csp).not.toMatch(/https?:\/\/(?!localhost)/)
  })

  it('blocks plugins, base rewrites and form posts in both modes', () => {
    for (const dev of [true, false]) {
      const csp = contentSecurityPolicy({ dev })
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("base-uri 'none'")
      expect(csp).toContain("form-action 'none'")
    }
  })
})
