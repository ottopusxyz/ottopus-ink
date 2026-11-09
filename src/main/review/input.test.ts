import { describe, expect, it } from 'vitest'
import { explorerUrl, isApprovalClick, isApprovalKey, isExplorerUrl, isReviewCaller } from './input'

const TX = '6kX8Q2pS4nYbW1cR7dF3gH5jK9mL2nP4qR6sT8uV1wXy'

describe('who may call the review channels', () => {
  const ENTRY = 'file:///app/out/renderer/review.html'
  const mainFrame = { url: ENTRY }
  const review = { mainFrame }

  it('answers the review window’s own top frame on the review page', () => {
    expect(isReviewCaller({ sender: review, senderFrame: mainFrame }, review, ENTRY)).toBe(true)
  })

  it('refuses the chat’s page, even on the same files', () => {
    const chatFrame = { url: 'file:///app/out/renderer/index.html' }
    expect(isReviewCaller({ sender: { mainFrame: chatFrame }, senderFrame: chatFrame }, review, ENTRY)).toBe(false)
    // Even if it somehow reached the review page's address, it isn't the review window.
    const lookalike = { url: ENTRY }
    expect(isReviewCaller({ sender: { mainFrame: lookalike }, senderFrame: lookalike }, review, ENTRY)).toBe(false)
    // Or claimed the review window's frame as its own.
    expect(isReviewCaller({ sender: { mainFrame }, senderFrame: mainFrame }, review, ENTRY)).toBe(false)
  })

  it('refuses a frame inside the review page, and the review window once it’s on another page', () => {
    expect(isReviewCaller({ sender: review, senderFrame: { url: ENTRY } }, review, ENTRY)).toBe(false)
    const moved = { mainFrame: { url: 'file:///tmp/dropped.html' } }
    expect(isReviewCaller({ sender: moved, senderFrame: moved.mainFrame }, moved, ENTRY)).toBe(false)
  })

  it('refuses everything while there’s no review window, or no frame', () => {
    expect(isReviewCaller({ sender: review, senderFrame: mainFrame }, null, ENTRY)).toBe(false)
    expect(isReviewCaller({ sender: review, senderFrame: null }, review, ENTRY)).toBe(false)
  })
})

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
