import { describe, expect, it } from 'vitest'
import { describeIssue } from '../../src/ui/describeIssue'
import type { ValidationIssue } from '../../src/core/types'

describe('describeIssue', () => {
  it('describes bad-length', () => {
    expect(describeIssue({ kind: 'bad-length' })).toBe(
      "That doesn't look like a full cube yet — every sticker needs a color.",
    )
  })

  it('names the color and count for bad-color-count', () => {
    expect(describeIssue({ kind: 'bad-color-count', face: 'R', count: 11 })).toBe(
      "You've used red 11 times — every color should appear exactly 9 times.",
    )
    expect(describeIssue({ kind: 'bad-color-count', face: 'U', count: 7 })).toBe(
      "You've used white 7 times — every color should appear exactly 9 times.",
    )
  })

  it('describes bad-centers', () => {
    expect(describeIssue({ kind: 'bad-centers' })).toBe(
      'The center stickers should show all six colors, one per side.',
    )
  })

  it('describes invalid-piece without echoing the internal detail', () => {
    const issue: ValidationIssue = {
      kind: 'invalid-piece',
      detail: 'corner slot UFL has an impossible color combination',
    }
    expect(describeIssue(issue)).toBe(
      "One piece has a color combination that doesn't exist on a real cube.",
    )
  })

  it('describes edge-orientation', () => {
    expect(describeIssue({ kind: 'edge-orientation' })).toBe(
      'One edge looks flipped — a piece is turned the wrong way.',
    )
  })

  it('describes corner-orientation with the architect-specified copy', () => {
    expect(describeIssue({ kind: 'corner-orientation' })).toBe(
      'One corner appears twisted. Check the highlighted corners.',
    )
  })

  it('describes permutation-parity', () => {
    expect(describeIssue({ kind: 'permutation-parity' })).toBe(
      "Two pieces look swapped — that combination isn't possible on a real cube.",
    )
  })
})
