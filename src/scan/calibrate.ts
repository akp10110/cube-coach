import type { Face } from '../core/types'
import { FACE_ORDER } from '../core/facelets'
import type { ColorMatch, HSV } from './colorDetect'
import { classifyColor } from './colorDetect'

/**
 * PR-13: center-anchored centroid calibration. A face's own center sticker
 * never moves and always shows that face's true color (D3), so once all six
 * have been sampled they're the ground truth for this specific cube under
 * this specific lighting — a better source of centroids than
 * `DEFAULT_CENTROIDS`.
 */

/** True once every face's center has been sampled — the point at which
 *  `DEFAULT_CENTROIDS` can be replaced by this cube's own measured colors. */
export function isFullyCalibrated(
  centerSamples: Partial<Record<Face, HSV>>,
): centerSamples is Record<Face, HSV> {
  return FACE_ORDER.every((face) => centerSamples[face] !== undefined)
}

/** Recomputes the six calibration centroids directly from each face's own
 *  center-sticker HSV. */
export function calibrateFromCenters(centerSamples: Record<Face, HSV>): Record<Face, HSV> {
  return { ...centerSamples }
}

/** Reclassifies previously-sampled stickers against fresh centroids — run
 *  right after `calibrateFromCenters` so faces classified against the
 *  (less trustworthy) defaults get corrected once calibration lands. */
export function reclassifyAll<T extends { hsv: HSV }>(
  samples: readonly T[],
  centroids: Record<Face, HSV>,
): (T & ColorMatch)[] {
  return samples.map((sample) => ({ ...sample, ...classifyColor(sample.hsv, centroids, true) }))
}
