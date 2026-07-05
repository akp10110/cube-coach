import { FACE_ORDER, faceOf } from './facelets'
import type { FaceletString } from './types'

/** A face is solved when all 9 of its stickers match its own identity
 *  (a facelet's letter = the face whose center shares its color, D3), so a
 *  cube is solved iff every face satisfies this. */
export function isSolved(s: FaceletString): boolean {
  return FACE_ORDER.every((face) => faceOf(s, face).every((sticker) => sticker === face))
}
