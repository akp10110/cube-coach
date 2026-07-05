import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CENTROIDS,
  classifyColor,
  classifySticker,
  hueDistance,
  rgbToHsv,
  sampleGrid,
  samplePatch,
} from '../../src/scan/colorDetect'
import type { RGB } from '../../src/scan/colorDetect'
import type { Face } from '../../src/core/types'

describe('rgbToHsv', () => {
  it('converts pure white, black, and gray', () => {
    expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, v: 1 })
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 })
    expect(rgbToHsv({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, v: 128 / 255 })
  })

  it('converts saturated primaries to the expected hue', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 })
    expect(rgbToHsv({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 1, v: 1 })
    expect(rgbToHsv({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 1, v: 1 })
  })
})

describe('hueDistance', () => {
  it('wraps around 0/360 — hue 358 and hue 2 are close', () => {
    expect(hueDistance(358, 2)).toBe(4)
  })

  it('is symmetric', () => {
    expect(hueDistance(2, 358)).toBe(4)
  })

  it('is the plain difference when there is no wraparound', () => {
    expect(hueDistance(10, 40)).toBe(30)
  })

  it('maxes out at 180 for opposite hues', () => {
    expect(hueDistance(0, 180)).toBe(180)
  })
})

describe('classifyColor — fixture RGB triples per sticker color', () => {
  // A handful of hardcoded real-world-ish triples per color: a near-exact
  // reference shade, a slightly-off daylight capture, and a lighting-variant
  // hard case (warm-light white, dim faces, dim orange) — tasks.md PR-13.
  const FIXTURES: Record<Face, RGB[]> = {
    U: [
      { r: 245, g: 245, b: 240 },
      { r: 230, g: 232, b: 225 },
      { r: 250, g: 225, b: 180 }, // warm-light white — hard case
    ],
    D: [
      { r: 255, g: 213, b: 0 },
      { r: 250, g: 205, b: 10 },
      { r: 200, g: 165, b: 20 }, // dim yellow
    ],
    F: [
      { r: 0, g: 155, b: 72 },
      { r: 10, g: 150, b: 70 },
      { r: 5, g: 90, b: 50 }, // dim green
    ],
    B: [
      { r: 0, g: 70, b: 173 },
      { r: 10, g: 60, b: 160 },
      { r: 5, g: 40, b: 110 }, // dim blue
    ],
    R: [
      { r: 183, g: 18, b: 52 },
      { r: 175, g: 25, b: 45 },
      { r: 190, g: 40, b: 55 }, // slightly warm-shifted red
    ],
    L: [
      { r: 255, g: 88, b: 0 },
      { r: 250, g: 95, b: 10 },
      { r: 140, g: 55, b: 5 }, // dim orange — hard case
    ],
  }

  for (const [face, fixtures] of Object.entries(FIXTURES) as [Face, RGB[]][]) {
    fixtures.forEach((rgb, i) => {
      it(`classifies ${face} fixture #${i + 1} (${JSON.stringify(rgb)})`, () => {
        const match = classifyColor(rgbToHsv(rgb), DEFAULT_CENTROIDS, false)
        expect(match.color).toBe(face)
      })
    })
  }

  it('the warm-light white fixture is separated from yellow by saturation, not hue', () => {
    // Its hue (~39deg) actually sits closer to yellow's default hue (~50deg)
    // than to white's (~60deg) — only the wide saturation gap (white's ~0.02
    // vs yellow's ~1.0) keeps this classified as white.
    const warmWhite = rgbToHsv({ r: 250, g: 225, b: 180 })
    expect(hueDistance(warmWhite.h, DEFAULT_CENTROIDS.D.h)).toBeLessThan(
      hueDistance(warmWhite.h, DEFAULT_CENTROIDS.U.h),
    )
    expect(classifyColor(warmWhite, DEFAULT_CENTROIDS, false).color).toBe('U')
  })
})

describe('classifyColor — confidence', () => {
  it('is capped below full confidence when not yet calibrated, even for an exact centroid match', () => {
    const exact = DEFAULT_CENTROIDS.R
    const uncalibrated = classifyColor(exact, DEFAULT_CENTROIDS, false)
    const calibrated = classifyColor(exact, DEFAULT_CENTROIDS, true)
    expect(uncalibrated.color).toBe('R')
    expect(calibrated.color).toBe('R')
    expect(uncalibrated.confidence).toBeLessThan(calibrated.confidence)
    expect(uncalibrated.confidence).toBeLessThanOrEqual(0.7)
    expect(calibrated.confidence).toBe(1)
  })

  it('is low when the best and second-best centroids are nearly tied', () => {
    // Exactly halfway (in every channel) between the U and D centroids.
    const midpoint = {
      h: (DEFAULT_CENTROIDS.U.h + DEFAULT_CENTROIDS.D.h) / 2,
      s: (DEFAULT_CENTROIDS.U.s + DEFAULT_CENTROIDS.D.s) / 2,
      v: (DEFAULT_CENTROIDS.U.v + DEFAULT_CENTROIDS.D.v) / 2,
    }
    const match = classifyColor(midpoint, DEFAULT_CENTROIDS, true)
    expect(match.confidence).toBeLessThan(0.1)
  })
})

describe('samplePatch — median rejects glare', () => {
  function makeImageData(width: number, height: number, pixelAt: (x: number, y: number) => RGB) {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const { r, g, b } = pixelAt(x, y)
        const i = (y * width + x) * 4
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = 255
      }
    }
    return { data, width, height, colorSpace: 'srgb' } as ImageData
  }

  const TRUE_RED: RGB = { r: 183, g: 18, b: 52 }
  const GLARE: RGB = { r: 255, g: 255, b: 255 }

  it('returns the true color and near-zero variance for a uniform patch', () => {
    const image = makeImageData(10, 10, () => TRUE_RED)
    const sample = samplePatch(image, 5, 5, 10, 10)
    expect(sample.rgb).toEqual(TRUE_RED)
    expect(sample.variance).toBe(0)
  })

  it('rejects a glare highlight covering the top 30% of the patch', () => {
    const image = makeImageData(10, 10, (_x, y) => (y < 3 ? GLARE : TRUE_RED))
    const sample = samplePatch(image, 5, 5, 10, 10)
    // Median stays exactly on the majority (true) color despite the glare.
    expect(sample.rgb).toEqual(TRUE_RED)
    // But the patch is clearly non-uniform.
    expect(sample.variance).toBeGreaterThan(1000)
  })
})

describe('sampleGrid', () => {
  it('samples all 9 cells in row-major order', () => {
    const colors: RGB[] = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 255, g: 255, b: 0 },
      { r: 255, g: 0, b: 255 },
      { r: 0, g: 255, b: 255 },
      { r: 128, g: 128, b: 128 },
      { r: 255, g: 255, b: 255 },
      { r: 0, g: 0, b: 0 },
    ]
    const cellSize = 30
    const width = cellSize * 3
    const height = cellSize * 3
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cellIndex = Math.floor(y / cellSize) * 3 + Math.floor(x / cellSize)
        const { r, g, b } = colors[cellIndex]
        const i = (y * width + x) * 4
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = 255
      }
    }
    const image = { data, width, height, colorSpace: 'srgb' } as ImageData

    const samples = sampleGrid(image)
    expect(samples).toHaveLength(9)
    samples.forEach((sample, i) => {
      expect(sample.rgb).toEqual(colors[i])
    })
  })
})

describe('classifySticker', () => {
  it('penalizes confidence for a high-variance (glare) patch, same color either way', () => {
    const centroids = DEFAULT_CENTROIDS
    const rgb = { r: 183, g: 18, b: 52 }
    const hsv = rgbToHsv(rgb)
    const clean = classifySticker({ rgb, hsv, variance: 0 }, centroids, true)
    const glared = classifySticker({ rgb, hsv, variance: 5000 }, centroids, true)
    expect(clean.color).toBe('R')
    expect(glared.color).toBe('R')
    expect(glared.confidence).toBeLessThan(clean.confidence)
  })
})
