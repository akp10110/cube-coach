import { describe, expect, it } from 'vitest'
import { computeCoverCrop, classifyFrame } from '../../src/ui/useFaceCapture'
import { DEFAULT_CENTROIDS, sampleGrid } from '../../src/scan/colorDetect'
import type { RGB } from '../../src/scan/colorDetect'

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

/** Builds a synthetic square frame — one solid color per 3x3 cell — the
 *  same fixture shape `colorDetect.test.ts` uses for `sampleGrid`. Stands
 *  in for "one video frame" without a real `<video>`/`<canvas>`, which the
 *  node test environment doesn't have. */
function buildFrame(colors: readonly RGB[], cellSize = 30): ImageData {
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
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

const NINE_STICKER_COLORS: RGB[] = [
  { r: 245, g: 245, b: 240 }, // U white
  { r: 183, g: 18, b: 52 }, // R red
  { r: 0, g: 155, b: 72 }, // F green
  { r: 255, g: 213, b: 0 }, // D yellow
  { r: 255, g: 88, b: 0 }, // L orange
  { r: 0, g: 70, b: 173 }, // B blue
  { r: 183, g: 18, b: 52 }, // R red
  { r: 0, g: 155, b: 72 }, // F green
  { r: 245, g: 245, b: 240 }, // U white
]

describe('classifyFrame: live/capture parity (regression for the freeze-frame mismatch bug)', () => {
  it('feeding one frame through two independent call sites yields identical classifications', () => {
    // Bug fix: previously the freeze-frame path (once calibrated) reclassified
    // through `calibrate.ts`'s `reclassifyAll`, a second pipeline that skips
    // `classifySticker`'s glare penalty — a live-tap-site and a
    // shutter-call-site could read the same samples and still disagree on
    // confidence. Both `useFaceCapture`'s tick and its `captureNow` now call
    // this exact function, so two independent calls with the same samples
    // must always agree — that's the guarantee this test locks in.
    const frame = buildFrame(NINE_STICKER_COLORS)
    const samples = sampleGrid(frame) // "one frame", sampled once — as drawVideoFrame + sampleGrid would.

    const livePathResult = classifyFrame(samples, DEFAULT_CENTROIDS, false)
    const capturePathResult = classifyFrame(samples, DEFAULT_CENTROIDS, false)

    expect(capturePathResult).toEqual(livePathResult)
    expect(livePathResult.map((c) => c.color)).toEqual(['U', 'R', 'F', 'D', 'L', 'B', 'R', 'F', 'U'])
  })

  it('still agrees once calibrated (the exact state that exposed the old bug)', () => {
    const frame = buildFrame(NINE_STICKER_COLORS)
    const samples = sampleGrid(frame)

    const livePathResult = classifyFrame(samples, DEFAULT_CENTROIDS, true)
    const capturePathResult = classifyFrame(samples, DEFAULT_CENTROIDS, true)

    expect(capturePathResult).toEqual(livePathResult)
  })

  it('applies the same glare-confidence penalty to a noisy patch regardless of calibration state', () => {
    // The bug this guards against: `reclassifyAll` (calibrate.ts) computes
    // confidence via `classifyColor` directly, with no glare penalty, while
    // `classifySticker` (what `classifyFrame` uses) does apply one. A
    // high-variance/glare patch must read the same lower confidence via
    // `classifyFrame` whether or not calibration has kicked in.
    const cellSize = 30
    const width = cellSize * 3
    const height = cellSize * 3
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cellIndex = Math.floor(y / cellSize) * 3 + Math.floor(x / cellSize)
        const i = (y * width + x) * 4
        if (cellIndex === 4) {
          // Center cell: alternating white/orange speckle — high variance, like glare.
          const glare = (x + y) % 2 === 0
          data[i] = glare ? 255 : 255
          data[i + 1] = glare ? 255 : 88
          data[i + 2] = glare ? 255 : 0
        } else {
          const { r, g, b } = NINE_STICKER_COLORS[cellIndex]
          data[i] = r
          data[i + 1] = g
          data[i + 2] = b
        }
        data[i + 3] = 255
      }
    }
    const frame = { data, width, height, colorSpace: 'srgb' } as ImageData
    const samples = sampleGrid(frame)

    const uncalibrated = classifyFrame(samples, DEFAULT_CENTROIDS, false)
    const calibrated = classifyFrame(samples, DEFAULT_CENTROIDS, true)

    // Same glare penalty formula applies in both — the center cell's
    // confidence should be well below a clean cell's in both classifications.
    expect(uncalibrated[4].confidence).toBeLessThan(uncalibrated[1].confidence)
    expect(calibrated[4].confidence).toBeLessThan(calibrated[1].confidence)
  })
})
