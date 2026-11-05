/**
 * The address to open for a link, or null if it may not leave the app. Only
 * https, never file:, javascript: or custom schemes that could launch another
 * app, and never credentials, which make `https://app.ottopus.xyz@evil.example`
 * read as the wrong site. Parsing shows a lookalike host as the punycode it
 * really is.
 */
export function safeExternalUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
