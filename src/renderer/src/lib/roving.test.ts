import { describe, expect, it } from 'vitest'
import { stepIndex } from './roving'

describe('stepIndex', () => {
  it('steps with the arrows and wraps at both ends', () => {
    expect(stepIndex('ArrowRight', 0, 3)).toBe(1)
    expect(stepIndex('ArrowDown', 2, 3)).toBe(0)
    expect(stepIndex('ArrowLeft', 0, 3)).toBe(2)
    expect(stepIndex('ArrowUp', 1, 3)).toBe(0)
  })

  it('jumps to the ends with Home and End', () => {
    expect(stepIndex('Home', 2, 3)).toBe(0)
    expect(stepIndex('End', 0, 3)).toBe(2)
  })

  it('ignores other keys and empty groups', () => {
    expect(stepIndex('Tab', 0, 3)).toBeNull()
    expect(stepIndex(' ', 0, 3)).toBeNull()
    expect(stepIndex('ArrowRight', 0, 0)).toBeNull()
  })
})
