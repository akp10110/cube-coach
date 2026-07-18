import type { Face } from '../core/types'
import { LOW_CONFIDENCE_THRESHOLD } from './colorDetect'
import { duplicateCenterMessage, isDuplicateCenter } from './duplicateGuard'

/**
 * PR-26: pure capture-eligibility check for the tap-to-capture freeze-frame.
 * The app never guesses whether a cube is present or steady — the user taps
 * the shutter, then this function decides whether the frozen 9-sticker
 * reading is trustworthy enough to let them tap Confirm. Two independent
 * reasons can block it: any sticker still reads low-confidence (amber
 * dashed, tap to fix), or the reading's center color already belongs to an
 * already-captured face (the same physical side shown twice). Both are
 * cleared the same way — fix the offending sticker(s) — so this is never a
 * dead end.
 */

export interface CaptureReading {
  /** Classified color per sticker, row-major, length 9. */
  classifications: readonly Face[]
  /** Confidence per sticker, 0..1, same order as `classifications`. */
  confidences: readonly number[]
}

export interface CaptureEligibility {
  canConfirm: boolean
  /** Indices (0..8) of stickers below the confidence threshold. */
  blockingCells: number[]
  /** Set when the reading's center duplicates an already-captured face. */
  duplicateMessage: string | null
}

export function evaluateCapture(
  reading: CaptureReading,
  existingCenters: readonly Face[],
  expectedFace: Face,
  threshold: number = LOW_CONFIDENCE_THRESHOLD,
): CaptureEligibility {
  const blockingCells: number[] = []
  reading.confidences.forEach((confidence, index) => {
    if (confidence < threshold) blockingCells.push(index)
  })

  const center = reading.classifications[4]
  const duplicateMessage = isDuplicateCenter(center, existingCenters)
    ? duplicateCenterMessage(center, expectedFace)
    : null

  return {
    canConfirm: blockingCells.length === 0 && duplicateMessage === null,
    blockingCells,
    duplicateMessage,
  }
}
