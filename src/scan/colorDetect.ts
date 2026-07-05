import type { Face } from '../core/types'
import { FACE_ORDER } from '../core/facelets'
import { STICKER_COLORS } from '../render/colors'

/**
 * PR-13: color sampling + classification. Pure — takes `ImageData` in,
 * returns plain data out; no video/canvas/DOM manipulation (that belongs to
 * whatever crops a video frame into the `ImageData` this module consumes, a
 * later PR). Used by the guided scan flow (PR-14/15) and by `calibrate.ts`.
 */

export interface RGB {
  r: number
  g: number
  b: number
}

export interface HSV {
  h: number
  s: number
  v: number
}

export interface StickerSample {
  rgb: RGB
  hsv: HSV
  /** Average per-channel variance of the sampled patch (0..~65025). High
   *  values mean the patch wasn't uniform — most often a specular glare
   *  highlight bleeding into part of it. */
  variance: number
}

export interface ColorMatch {
  color: Face
  confidence: number
}

export type ClassifiedSticker = StickerSample & ColorMatch

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2)
    else h = 60 * ((rn - gn) / delta + 4)
  }
  if (h < 0) h += 360

  const s = max === 0 ? 0 : delta / max
  const v = max
  return { h, s, v }
}

/** Circular hue distance in degrees (0..180) — hue 358 and hue 2 are 4
 *  degrees apart, not 356. */
export function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

/** Fixed default centroids, derived from the same sticker-color hex map the
 *  3D renderer and 2D editor use (`render/colors.ts`, D7/section 9) — used
 *  before any per-cube calibration exists. */
export const DEFAULT_CENTROIDS: Readonly<Record<Face, HSV>> = Object.fromEntries(
  FACE_ORDER.map((face) => [face, rgbToHsv(hexToRgb(STICKER_COLORS[face]))]),
) as Record<Face, HSV>

// Weighted so saturation dominates hue — the white/yellow pair sits only
// ~10 degrees apart in hue even at the reference colors, and warm lighting
// can shift a white sticker's hue further toward yellow's. Saturation stays
// wide apart (near 0 for white, 1.0 for yellow) regardless of hue drift, so
// weighting it more heavily than hue is what "separate on saturation before
// hue" (tasks.md PR-13) actually means in this distance function.
const HUE_WEIGHT = 1.0
const SATURATION_WEIGHT = 2.0
const VALUE_WEIGHT = 0.4

function colorDistance(a: HSV, b: HSV): number {
  const dh = hueDistance(a.h, b.h) / 180
  const ds = Math.abs(a.s - b.s)
  const dv = Math.abs(a.v - b.v)
  return HUE_WEIGHT * dh + SATURATION_WEIGHT * ds + VALUE_WEIGHT * dv
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

// A margin of 0.25 or more between the best and second-best centroid reads
// as fully confident; below that, confidence scales down linearly.
const MARGIN_NORMALIZER = 0.25
// Even a perfect-looking match against the *fixed* defaults is provisional
// until calibration confirms it against this cube's own stickers — capped
// well under 1 so low-confidence review (PR-15) still catches these.
const UNCALIBRATED_CONFIDENCE_CAP = 0.7

/**
 * Nearest-centroid classification: weighted circular-hue + saturation +
 * value distance. Confidence comes from the *margin* between the best and
 * second-best centroid, not the raw distance to the winner — an ambiguous
 * sample where two centroids are nearly tied should read as low-confidence
 * regardless of how close either one is in absolute terms.
 *
 * `calibrated` must be `false` while classifying against `DEFAULT_CENTROIDS`
 * (before all six centers are captured) and `true` once classifying against
 * centroids from `calibrateFromCenters` — see calibrate.ts.
 */
export function classifyColor(
  hsv: HSV,
  centroids: Readonly<Record<Face, HSV>>,
  calibrated: boolean,
): ColorMatch {
  const ranked = FACE_ORDER.map(
    (color) => [color, colorDistance(hsv, centroids[color])] as const,
  ).sort((a, b) => a[1] - b[1])
  const [color, best] = ranked[0]
  const [, secondBest] = ranked[1]

  let confidence = clamp01((secondBest - best) / MARGIN_NORMALIZER)
  if (!calibrated) confidence = Math.min(confidence, UNCALIBRATED_CONFIDENCE_CAP)

  return { color, confidence }
}

// Beyond this average per-channel variance, a patch is treated as fully
// glare-affected for confidence purposes.
const VARIANCE_CAP = 1500
// A fully glare-affected patch can cost at most this much confidence — the
// median RGB (see samplePatch) already rejects most of the damage.
const GLARE_PENALTY_WEIGHT = 0.7

/** Below this confidence, a sticker is treated as "unsure" — the live scan
 *  overlay (PR-14) and the review screen's highlighting (PR-15) both use
 *  this same cutoff so the two stay visually consistent. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5

/** `classifyColor` plus the glare penalty from a sample's patch variance
 *  (PR-13's third hard case: median rejects glare pixels from the color
 *  itself, but a high-variance patch still deserves less trust). */
export function classifySticker(
  sample: StickerSample,
  centroids: Readonly<Record<Face, HSV>>,
  calibrated: boolean,
): ClassifiedSticker {
  const match = classifyColor(sample.hsv, centroids, calibrated)
  const glarePenalty = clamp01(sample.variance / VARIANCE_CAP) * GLARE_PENALTY_WEIGHT
  const confidence = clamp01(match.confidence * (1 - glarePenalty))
  return { ...sample, color: match.color, confidence }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function variance(values: readonly number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
}

function readPixel(image: ImageData, x: number, y: number): RGB {
  const clampedX = Math.min(image.width - 1, Math.max(0, x))
  const clampedY = Math.min(image.height - 1, Math.max(0, y))
  const offset = (clampedY * image.width + clampedX) * 4
  return { r: image.data[offset], g: image.data[offset + 1], b: image.data[offset + 2] }
}

/** Median RGB (glare-resistant — not mean) over a small patch centered at
 *  (centerX, centerY), plus the patch's average per-channel variance. */
export function samplePatch(
  image: ImageData,
  centerX: number,
  centerY: number,
  patchWidth: number,
  patchHeight: number,
): StickerSample {
  const startX = Math.round(centerX - patchWidth / 2)
  const startY = Math.round(centerY - patchHeight / 2)
  const endX = startX + Math.max(1, Math.round(patchWidth))
  const endY = startY + Math.max(1, Math.round(patchHeight))

  const reds: number[] = []
  const greens: number[] = []
  const blues: number[] = []
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const pixel = readPixel(image, x, y)
      reds.push(pixel.r)
      greens.push(pixel.g)
      blues.push(pixel.b)
    }
  }

  const rgb: RGB = { r: median(reds), g: median(greens), b: median(blues) }
  const patchVariance = (variance(reds) + variance(greens) + variance(blues)) / 3
  return { rgb, hsv: rgbToHsv(rgb), variance: patchVariance }
}

/** Fraction of a grid cell's side length used as the sampling patch. */
const PATCH_FRACTION = 0.15

/**
 * Samples all 9 stickers of an already-cropped square guide image (PR-14
 * crops the video frame to the guide bounds before calling this) — one
 * median patch per cell, row-major (top-left to bottom-right) to match
 * `FaceScan.colors`' order.
 */
export function sampleGrid(image: ImageData): StickerSample[] {
  const cellWidth = image.width / 3
  const cellHeight = image.height / 3
  const patchWidth = cellWidth * PATCH_FRACTION
  const patchHeight = cellHeight * PATCH_FRACTION

  const samples: StickerSample[] = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const centerX = (col + 0.5) * cellWidth
      const centerY = (row + 0.5) * cellHeight
      samples.push(samplePatch(image, centerX, centerY, patchWidth, patchHeight))
    }
  }
  return samples
}
