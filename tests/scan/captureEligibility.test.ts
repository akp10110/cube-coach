import { describe, expect, it } from 'vitest'
import { evaluateCapture } from '../../src/scan/captureEligibility'
import type { Face } from '../../src/core/types'

const CONFIDENT: Face[] = ['U', 'U', 'U', 'U', 'U', 'U', 'U', 'U', 'U']
const FULL_CONFIDENCE = [1, 1, 1, 1, 1, 1, 1, 1, 1]

describe('evaluateCapture', () => {
  it('allows confirming when every sticker is confident and the center is new', () => {
    const result = evaluateCapture(
      { classifications: CONFIDENT, confidences: FULL_CONFIDENCE },
      ['R', 'F'],
      'U',
    )
    expect(result).toEqual({ canConfirm: true, blockingCells: [], duplicateMessage: null })
  })

  it('blocks on any single low-confidence cell', () => {
    const confidences = [...FULL_CONFIDENCE]
    confidences[3] = 0.2
    const result = evaluateCapture({ classifications: CONFIDENT, confidences }, [], 'U')
    expect(result.canConfirm).toBe(false)
    expect(result.blockingCells).toEqual([3])
    expect(result.duplicateMessage).toBeNull()
  })

  it('collects every low-confidence cell, not just the first', () => {
    const confidences = [...FULL_CONFIDENCE]
    confidences[0] = 0.1
    confidences[8] = 0.4
    const result = evaluateCapture({ classifications: CONFIDENT, confidences }, [], 'U')
    expect(result.blockingCells).toEqual([0, 8])
  })

  it('treats confidence exactly at the threshold as confident (blocking is strictly-below)', () => {
    const confidences = [...FULL_CONFIDENCE]
    confidences[0] = 0.5 // LOW_CONFIDENCE_THRESHOLD itself
    const result = evaluateCapture({ classifications: CONFIDENT, confidences }, [], 'U')
    expect(result.blockingCells).toEqual([])
  })

  it('blocks a duplicate center with the expected message, even if all cells are confident', () => {
    const result = evaluateCapture(
      { classifications: CONFIDENT, confidences: FULL_CONFIDENCE },
      ['R', 'U'],
      'F',
    )
    expect(result.canConfirm).toBe(false)
    expect(result.blockingCells).toEqual([])
    expect(result.duplicateMessage).toBe(
      'That looks like the white side again — now show me the side with the green center.',
    )
  })

  it('blocks with both reasons at once', () => {
    const confidences = [...FULL_CONFIDENCE]
    confidences[2] = 0.0
    const result = evaluateCapture({ classifications: CONFIDENT, confidences }, ['U'], 'R')
    expect(result.canConfirm).toBe(false)
    expect(result.blockingCells).toEqual([2])
    expect(result.duplicateMessage).not.toBeNull()
  })
})
