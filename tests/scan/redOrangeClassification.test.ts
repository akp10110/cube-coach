import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CENTROIDS,
  LOW_CONFIDENCE_THRESHOLD,
  classifyColor,
  classifyColorDebug,
  rgbToHsv,
} from '../../src/scan/colorDetect'
import { calibrateFromCenters } from '../../src/scan/calibrate'
import type { HSV, RGB } from '../../src/scan/colorDetect'
import type { Face } from '../../src/core/types'

/**
 * PART 1 of the red/orange fix: center-anchored calibration (PR-13) is
 * already wired end-to-end in `useFaceCapture.ts` — all classification
 * (live tick, freeze-frame grid, every reclassification) routes through
 * `classifyFrame`/`classifySticker` against whichever `centroids` the hook
 * currently holds, which becomes `calibrateFromCenters(...)` the moment all
 * six center samples are in. These tests exercise that same
 * `calibrateFromCenters` -> `classifyColor` pipeline directly against
 * red/orange — the hardest pair on a phone camera, since they sit only
 * ~20-30 degrees apart in hue even at the reference swatches, and warm
 * (tungsten/incandescent) lighting pushes both further toward each other.
 *
 * There's no real phone captures available in this environment, so "warm
 * light" is simulated with a documented, reasoned approximation: a
 * per-channel multiplicative gain (boost red and green, cut blue) applied
 * identically to both a face's calibration center and its other stickers —
 * modeling a tungsten-lit room where every sticker (and the center used to
 * calibrate against) picks up the same warm cast. This is what makes
 * calibration able to "absorb" the shift: the boundary that matters is
 * between this cube's own (also-shifted) red and orange centroids, not
 * against the fixed defaults.
 */

function warmLight(rgb: RGB, rGain = 1.15, gGain = 1.05, bGain = 0.75): RGB {
  return {
    r: Math.min(255, Math.round(rgb.r * rGain)),
    g: Math.min(255, Math.round(rgb.g * gGain)),
    b: Math.min(255, Math.round(rgb.b * bGain)),
  }
}

const REFERENCE_RGB: Record<Face, RGB> = {
  U: { r: 245, g: 245, b: 240 },
  D: { r: 255, g: 213, b: 0 },
  F: { r: 0, g: 155, b: 72 },
  B: { r: 0, g: 70, b: 173 },
  R: { r: 183, g: 18, b: 52 },
  L: { r: 255, g: 88, b: 0 },
}

/** All six centers under the same warm cast, then calibrated — the fixture
 *  every test in this file classifies against. */
function warmCalibratedCentroids(): Record<Face, HSV> {
  const centers = Object.fromEntries(
    (Object.keys(REFERENCE_RGB) as Face[]).map((face) => [
      face,
      rgbToHsv(warmLight(REFERENCE_RGB[face])),
    ]),
  ) as Record<Face, HSV>
  return calibrateFromCenters(centers)
}

/** The exact hue midway between two (possibly wraparound) hues, on the
 *  short arc — plain arithmetic averaging breaks near the 0/360 seam,
 *  which is exactly where red and orange sit. */
function circularMidHue(a: number, b: number): number {
  let diff = b - a
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  return (a + diff / 2 + 360) % 360
}

describe('red/orange classification under warm light, once calibrated', () => {
  const calibrated = warmCalibratedCentroids()

  const RED_FIXTURES: RGB[] = [
    warmLight({ r: 190, g: 25, b: 45 }), // typical capture, slight sensor noise
    warmLight({ r: 140, g: 15, b: 40 }), // dim / shadowed
    warmLight({ r: 210, g: 35, b: 30 }), // bright, near-overexposed
  ]
  const ORANGE_FIXTURES: RGB[] = [
    warmLight({ r: 250, g: 95, b: 5 }), // typical capture, slight sensor noise
    warmLight({ r: 180, g: 65, b: 5 }), // dim / shadowed
    warmLight({ r: 255, g: 100, b: 15 }), // bright
  ]

  RED_FIXTURES.forEach((rgb, i) => {
    it(`classifies warm-light red fixture #${i + 1} (${JSON.stringify(rgb)}) as R with usable confidence`, () => {
      const match = classifyColor(rgbToHsv(rgb), calibrated, true)
      expect(match.color).toBe('R')
      expect(match.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE_THRESHOLD)
    })
  })

  ORANGE_FIXTURES.forEach((rgb, i) => {
    it(`classifies warm-light orange fixture #${i + 1} (${JSON.stringify(rgb)}) as L with usable confidence`, () => {
      const match = classifyColor(rgbToHsv(rgb), calibrated, true)
      expect(match.color).toBe('L')
      expect(match.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE_THRESHOLD)
    })
  })
})

describe('calibration corrects a real default-centroid red/orange misread', () => {
  // A warm, bright red sample that the FIXED defaults genuinely get wrong
  // (misread as orange) — demonstrating why center-anchored calibration
  // matters here, not just that the machinery exists.
  const trueRedUnderWarmLight: RGB = { r: 250, g: 52, b: 20 }

  it('DEFAULT_CENTROIDS (uncalibrated) misreads it as orange', () => {
    const match = classifyColor(rgbToHsv(trueRedUnderWarmLight), DEFAULT_CENTROIDS, false)
    expect(match.color).toBe('L')
  })

  it('the calibrated (warm-shifted) centroids correctly read it as red', () => {
    const calibrated = warmCalibratedCentroids()
    const match = classifyColor(rgbToHsv(trueRedUnderWarmLight), calibrated, true)
    expect(match.color).toBe('R')
  })
})

describe('an exactly-ambiguous red/orange reading reads as low-confidence, never a silent guess', () => {
  it('the point equidistant from the calibrated R and L centroids has ~zero confidence', () => {
    const calibrated = warmCalibratedCentroids()
    const midpoint: HSV = {
      h: circularMidHue(calibrated.R.h, calibrated.L.h),
      s: (calibrated.R.s + calibrated.L.s) / 2,
      v: (calibrated.R.v + calibrated.L.v) / 2,
    }
    const match = classifyColor(midpoint, calibrated, true)
    expect(['R', 'L']).toContain(match.color) // still picks a side (nearest-centroid always does) —
    expect(match.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD) // but confidence must flag it.
  })
})

describe('classifyColorDebug — the /dev overlay data', () => {
  const calibrated = warmCalibratedCentroids()

  it('reports the calibrated centroid itself as a zero-distance exact match', () => {
    const debug = classifyColorDebug(calibrated.R, calibrated)
    expect(debug.bestFace).toBe('R')
    expect(debug.bestDistance).toBe(0)
    expect(debug.margin).toBeGreaterThan(0)
  })

  it('margin is exactly the gap between the best and runner-up distances', () => {
    const sample = rgbToHsv(warmLight({ r: 210, g: 35, b: 30 }))
    const debug = classifyColorDebug(sample, calibrated)
    expect(debug.margin).toBeCloseTo(debug.runnerUpDistance - debug.bestDistance, 10)
    expect(debug.bestDistance).toBeLessThanOrEqual(debug.runnerUpDistance)
  })

  it('at the exact R/L midpoint, best and runner-up are R and L with ~zero margin', () => {
    const midpoint: HSV = {
      h: circularMidHue(calibrated.R.h, calibrated.L.h),
      s: (calibrated.R.s + calibrated.L.s) / 2,
      v: (calibrated.R.v + calibrated.L.v) / 2,
    }
    const debug = classifyColorDebug(midpoint, calibrated)
    expect([debug.bestFace, debug.runnerUpFace].sort()).toEqual(['L', 'R'])
    expect(debug.margin).toBeCloseTo(0, 6)
  })
})
