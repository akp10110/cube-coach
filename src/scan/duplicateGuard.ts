import type { Face } from '../core/types'
import { FACE_COLOR_NAMES } from '../render/colors'

/**
 * Duplicate-center guard (tasks.md bug fix): centers are unique on a real
 * cube, so a capture whose center color already belongs to another face in
 * this scan session means the same physical side was presented again —
 * usually a plain user mistake (forgot to rotate the cube). Either way the
 * capture must never be stored under a second face key. Used by
 * `captureEligibility.ts` to gate Confirm on the tap-to-capture freeze-frame.
 */

/** True if `centerColor` already belongs to another already-captured face. */
export function isDuplicateCenter(centerColor: Face, existingCenters: readonly Face[]): boolean {
  return existingCenters.includes(centerColor)
}

/** "That looks like the orange side again — now show me the side with the
 *  red center." */
export function duplicateCenterMessage(detectedColor: Face, expectedFace: Face): string {
  const detected = FACE_COLOR_NAMES[detectedColor]
  const expected = FACE_COLOR_NAMES[expectedFace]
  return `That looks like the ${detected} side again — now show me the side with the ${expected} center.`
}
