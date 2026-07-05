import { describe, expect, it } from 'vitest'
import { colorsMatch, computeCoverCrop } from '../../src/ui/useFaceCapture'
import type { Face } from '../../src/core/types'

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

describe('colorsMatch', () => {
  const a: Face[] = ['U', 'U', 'U', 'U', 'U', 'U', 'U', 'U', 'U']
  const b: Face[] = ['U', 'U', 'U', 'U', 'U', 'U', 'U', 'U', 'U']
  const c: Face[] = ['U', 'U', 'U', 'U', 'R', 'U', 'U', 'U', 'U']

  it('is false against null (no previous reading yet)', () => {
    expect(colorsMatch(a, null)).toBe(false)
  })

  it('is true for two identical readings', () => {
    expect(colorsMatch(a, b)).toBe(true)
  })

  it('is false when even one sticker differs', () => {
    expect(colorsMatch(a, c)).toBe(false)
  })
})
