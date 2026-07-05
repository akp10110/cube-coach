import { describe, expect, it } from 'vitest'
import { calibrateFromCenters, isFullyCalibrated, reclassifyAll } from '../../src/scan/calibrate'
import { DEFAULT_CENTROIDS, classifyColor, rgbToHsv } from '../../src/scan/colorDetect'
import type { HSV } from '../../src/scan/colorDetect'
import type { Face } from '../../src/core/types'

describe('isFullyCalibrated', () => {
  it('is false until all six centers are present', () => {
    expect(isFullyCalibrated({})).toBe(false)
    expect(isFullyCalibrated({ U: DEFAULT_CENTROIDS.U, R: DEFAULT_CENTROIDS.R })).toBe(false)
  })

  it('is true once all six faces have a center sample', () => {
    expect(isFullyCalibrated(DEFAULT_CENTROIDS)).toBe(true)
  })
})

describe('calibrateFromCenters', () => {
  it("uses each face's own center sample as that face's centroid", () => {
    const centers: Record<Face, HSV> = { ...DEFAULT_CENTROIDS, R: { h: 10, s: 0.5, v: 0.5 } }
    const centroids = calibrateFromCenters(centers)
    expect(centroids).toEqual(centers)
    expect(centroids).not.toBe(centers) // defensive copy, not the same reference
  })
})

describe('reclassifyAll', () => {
  it('classifies against the given centroids with calibrated=true (no confidence cap)', () => {
    const samples = [{ hsv: DEFAULT_CENTROIDS.R, id: 'sticker-1' }]
    const [result] = reclassifyAll(samples, calibrateFromCenters(DEFAULT_CENTROIDS))
    expect(result.id).toBe('sticker-1') // other fields on the sample survive
    expect(result.color).toBe('R')
    expect(result.confidence).toBe(1) // would be capped at 0.7 if calibrated=false
  })
})

describe('calibration fixes the red/orange hard case (tasks.md PR-13)', () => {
  // Simulate a cube photographed under a uniform ~30deg warm-light hue
  // shift. DEFAULT_CENTROIDS (built from the reference sticker colors)
  // then misclassifies an orange sticker as red — but recalibrating from
  // this same cube's own (equally shifted) center stickers fixes it.
  function hsvToRgb({ h, s, v }: HSV) {
    const c = v * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = v - c
    let r: number
    let g: number
    let b: number
    if (h < 60) [r, g, b] = [c, x, 0]
    else if (h < 120) [r, g, b] = [x, c, 0]
    else if (h < 180) [r, g, b] = [0, c, x]
    else if (h < 240) [r, g, b] = [0, x, c]
    else if (h < 300) [r, g, b] = [x, 0, c]
    else [r, g, b] = [c, 0, x]
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    }
  }

  const SHIFT = -30
  const shiftHue = (h: number, delta: number) => (h + delta + 360) % 360

  const orangeStickerHsv = rgbToHsv(hsvToRgb({ h: shiftHue(19, SHIFT), s: 0.97, v: 0.95 }))

  it('DEFAULT_CENTROIDS gets it wrong', () => {
    const match = classifyColor(orangeStickerHsv, DEFAULT_CENTROIDS, false)
    expect(match.color).toBe('R')
    expect(match.confidence).toBeLessThan(0.2) // still flagged as unreliable
  })

  it("centroids calibrated from this cube's own shifted centers get it right", () => {
    const shiftedOrangeCenter = rgbToHsv(hsvToRgb({ h: shiftHue(21, SHIFT), s: 1.0, v: 1.0 }))
    const shiftedRedCenter = rgbToHsv(hsvToRgb({ h: shiftHue(348, SHIFT), s: 0.9, v: 0.72 }))
    const centers: Record<Face, HSV> = {
      ...DEFAULT_CENTROIDS,
      L: shiftedOrangeCenter,
      R: shiftedRedCenter,
    }

    const centroids = calibrateFromCenters(centers)
    const match = classifyColor(orangeStickerHsv, centroids, true)

    expect(match.color).toBe('L')
    expect(match.confidence).toBeGreaterThan(0.9)
  })
})
