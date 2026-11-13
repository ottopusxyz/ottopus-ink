import { describe, expect, it } from 'vitest'
import { MAX_ICON_BYTES, iconUrlOf, tokenIcons } from './token-icons'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

function cdn(answer: (url: string) => Response) {
  const asked: string[] = []
  const fetch = (async (url: string) => (asked.push(url), answer(url))) as unknown as typeof globalThis.fetch
  return { fetch, asked }
}

describe('token icons', () => {
  it('fetches only https icons on Zerion’s image hosts', () => {
    expect(iconUrlOf('https://cdn.zerion.io/0xabc.png')).toBe('https://cdn.zerion.io/0xabc.png')
    expect(iconUrlOf('https://token-icons.s3.amazonaws.com/eth.png')).toBe('https://token-icons.s3.amazonaws.com/eth.png')
    for (const bad of ['http://cdn.zerion.io/a.png', 'https://evil.test/a.png', 'https://cdn.zerion.io.evil.test/a.png', 'https://user@cdn.zerion.io/a.png', 'https://cdn.zerion.io:8443/a.png', 'data:image/png;base64,AA', 42, null]) {
      expect(iconUrlOf(bad)).toBeNull()
    }
  })

  it('gives a small image as a data: URL, and fetches each icon once', async () => {
    const { fetch, asked } = cdn(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }))
    const icons = tokenIcons({ fetch })
    const [a, b] = await Promise.all([icons.icon('https://cdn.zerion.io/a.png'), icons.icon('https://cdn.zerion.io/a.png')])
    expect(a).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
    expect(b).toBe(a)
    expect(asked).toEqual(['https://cdn.zerion.io/a.png'])
  })

  it('refuses what isn’t a small raster image, or doesn’t arrive, without asking again', async () => {
    const answers: Record<string, Response> = {
      'https://cdn.zerion.io/svg.png': new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
      'https://cdn.zerion.io/html.png': new Response('<p>hi</p>', { headers: { 'content-type': 'text/html' } }),
      'https://cdn.zerion.io/big.png': new Response(new Uint8Array(MAX_ICON_BYTES + 1), { headers: { 'content-type': 'image/png' } }),
      'https://cdn.zerion.io/gone.png': new Response('', { status: 404, headers: { 'content-type': 'image/png' } }),
    }
    const { fetch, asked } = cdn((url) => answers[url]!)
    const icons = tokenIcons({ fetch })
    for (const url of Object.keys(answers)) expect(await icons.icon(url)).toBeNull()
    expect(await icons.icon('https://evil.test/a.png')).toBeNull()
    await icons.icon('https://cdn.zerion.io/gone.png')
    expect(asked).toHaveLength(4)
    const down = tokenIcons({ fetch: (async () => Promise.reject(new Error('offline'))) as unknown as typeof globalThis.fetch })
    expect(await down.icon('https://cdn.zerion.io/a.png')).toBeNull()
  })
})
