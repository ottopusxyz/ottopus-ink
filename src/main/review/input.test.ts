import { describe, expect, it } from 'vitest'
import { explorerUrl, isApprovalClick, isApprovalKey, isExplorerUrl } from './input'

const TX = '6kX8Q2pS4nYbW1cR7dF3gH5jK9mL2nP4qR6sT8uV1wXy'

describe('what counts as a person approving', () => {
  it('counts a press or release of the main mouse button', () => {
    expect(isApprovalClick({ type: 'mouseDown', button: 'left' })).toBe(true)
    expect(isApprovalClick({ type: 'mouseUp', button: 'left' })).toBe(true)
  })

  it('doesn’t count other buttons, moves, wheels or a missing button', () => {
    expect(isApprovalClick({ type: 'mouseDown', button: 'right' })).toBe(false)
    expect(isApprovalClick({ type: 'mouseUp', button: 'middle' })).toBe(false)
    expect(isApprovalClick({ type: 'mouseMove', button: 'left' })).toBe(false)
    expect(isApprovalClick({ type: 'mouseWheel', button: 'left' })).toBe(false)
    expect(isApprovalClick({ type: 'mouseDown' })).toBe(false)
  })

  it('counts Enter and Space, which press a focused button', () => {
    for (const type of ['keyDown', 'keyUp']) {
      expect(isApprovalKey({ type, key: 'Enter', isAutoRepeat: false })).toBe(true)
      expect(isApprovalKey({ type, key: ' ', isAutoRepeat: false })).toBe(true)
    }
  })

  it('doesn’t count other keys, or a key held down', () => {
    expect(isApprovalKey({ type: 'keyDown', key: 'a', isAutoRepeat: false })).toBe(false)
    expect(isApprovalKey({ type: 'keyDown', key: 'Tab', isAutoRepeat: false })).toBe(false)
    expect(isApprovalKey({ type: 'keyDown', key: 'Enter', isAutoRepeat: true })).toBe(false)
    expect(isApprovalKey({ type: 'char', key: 'Enter', isAutoRepeat: false })).toBe(false)
  })
})

describe('links the review window opens', () => {
  it('opens a transaction on the explorer', () => {
    expect(isExplorerUrl(explorerUrl(TX))).toBe(true)
  })

  it('opens nothing else', () => {
    for (const url of [
      `http://nearblocks.io/txns/${TX}`,
      `https://nearblocks.io.evil.example/txns/${TX}`,
      `https://evil.example/txns/${TX}`,
      `https://nearblocks.io/address/${TX}`,
      `https://nearblocks.io/txns/${TX}?next=https://evil.example`,
      `https://nearblocks.io/txns/${TX}#x`,
      'https://nearblocks.io/txns/not-an-id',
      `https://nearblocks.io/txns/${TX}/../../evil`,
      `https://user:pw@nearblocks.io/txns/${TX}`,
      `https://nearblocks.io:8443/txns/${TX}`,
      'not a url',
    ]) {
      expect(isExplorerUrl(url), url).toBe(false)
    }
  })
})
