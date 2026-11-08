import { describe, expect, it, vi } from 'vitest'
import { copyAddress } from './copy-address'

const ADDRESS = 'bc1qg6ucjz7kgdedam7v5yarecy54uqw82yym06z3q'

describe('copyAddress', () => {
  it('copies the address the signer gave while the window stays in front', async () => {
    const write = vi.fn()
    const result = await copyAddress('bitcoin', { focused: () => true, address: async () => ({ ok: true, address: ADDRESS }), write })
    expect(result).toEqual({ ok: true })
    expect(write).toHaveBeenCalledExactlyOnceWith(ADDRESS)
  })

  it('asks for nothing while the window is in the background', async () => {
    const write = vi.fn()
    const address = vi.fn()
    expect(await copyAddress('bitcoin', { focused: () => false, address, write })).toEqual({ ok: false, reason: 'bad-input' })
    expect(address).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('writes nothing if the person switches away while the signer answers', async () => {
    const write = vi.fn()
    let focused = true
    let release = () => {}
    const pending = copyAddress('bitcoin', {
      focused: () => focused,
      address: () => new Promise((resolve) => (release = () => resolve({ ok: true, address: ADDRESS }))),
      write,
    })
    focused = false
    release()
    expect(await pending).toEqual({ ok: false, reason: 'bad-input' })
    expect(write).not.toHaveBeenCalled()
  })

  it('passes on why there is no address, and writes nothing', async () => {
    const write = vi.fn()
    expect(await copyAddress('bitcoin', { focused: () => true, address: async () => ({ ok: false, reason: 'locked' }), write })).toEqual({
      ok: false,
      reason: 'locked',
    })
    expect(write).not.toHaveBeenCalled()
  })
})
