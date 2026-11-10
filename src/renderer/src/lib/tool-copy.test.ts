import { describe, expect, it } from 'vitest'
import { inkTool, toolLabel } from './chats'
import { TOOL_COPY, toolSummary, toolTitle } from './tool-copy'
import { INK_TOOLS } from '../../../shared/ipc'

describe('which tool a call was', () => {
  it('knows Ink’s own tools by their full name', () => {
    expect(inkTool('mcp__ottopus-ink__get_portfolio')).toBe('get_portfolio')
    expect(toolLabel('mcp__ottopus-ink__get_portfolio')).toBe('get_portfolio')
  })

  it('treats a made-up name under Ink’s prefix, or a bare name, as someone else’s', () => {
    expect(inkTool('mcp__ottopus-ink__sign')).toBeNull()
    expect(toolLabel('mcp__ottopus-ink__sign')).toBe('mcp__ottopus-ink__sign')
    expect(inkTool('get_portfolio')).toBeNull()
  })
})

describe('a tool call’s heading', () => {
  it('has words for every Ink tool in every state', () => {
    for (const tool of INK_TOOLS) {
      for (const state of ['running', 'done', 'failed'] as const) expect(TOOL_COPY[tool][state]).toMatch(/\S/)
    }
    expect(toolTitle('get_portfolio', 'get_portfolio', 'done')).toBe('Read your balances')
  })

  it('shows anything else by its name', () => {
    expect(toolTitle(null, 'mcp__github__search', 'running')).toBe('mcp__github__search')
  })
})

describe('a tool call’s summary', () => {
  it('is the first line with words in it, collapsed', () => {
    expect(toolSummary('\n\n  41.2   NEAR on NEAR\nsecond line')).toBe('41.2 NEAR on NEAR')
  })

  it('is cut to one line with an ellipsis', () => {
    expect(toolSummary('a'.repeat(120), 20)).toBe(`${'a'.repeat(19)}…`)
  })

  it('is nothing when nothing came back', () => {
    expect(toolSummary('')).toBeNull()
    expect(toolSummary(null)).toBeNull()
    expect(toolSummary('   \n  ')).toBeNull()
  })
})
