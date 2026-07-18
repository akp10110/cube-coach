import { describe, expect, it } from 'vitest'
import { computeCoverCrop, nextFaceColor } from '../../src/ui/useFaceCapture'

describe('computeCoverCrop', () => {
  it('crops a landscape video to a centered square using its height', () => {
    expect(computeCoverCrop(1280, 720)).toEqual({ sx: 280, sy: 0, side: 720 })
  })

  it('crops a portrait video to a centered square using its width', () => {
    expect(computeCoverCrop(720, 1280)).toEqual({ sx: 0, sy: 280, side: 720 })
  })

  it('has no crop for an already-square video', () => {
    expect(computeCoverCrop(500, 500)).toEqual({ sx: 0, sy: 0, side: 500 })
  })
})

describe('nextFaceColor', () => {
  it('cycles through FACE_ORDER (U, R, F, D, L, B)', () => {
    expect(nextFaceColor('U')).toBe('R')
    expect(nextFaceColor('R')).toBe('F')
    expect(nextFaceColor('F')).toBe('D')
    expect(nextFaceColor('D')).toBe('L')
    expect(nextFaceColor('L')).toBe('B')
  })

  it('wraps from the last color back to the first', () => {
    expect(nextFaceColor('B')).toBe('U')
  })
})
