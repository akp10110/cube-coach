import type { Face } from '../core/types'
import { FACE_COLOR_NAMES } from '../render/colors'

/** Fixed capture order (PR-14 scope): U, R, F, D, L, B. */
export const CAPTURE_ORDER: readonly Face[] = ['U', 'R', 'F', 'D', 'L', 'B']

/**
 * Orientation convention (documented here AND surfaced verbatim in the scan
 * screen's instruction line, per PR-14 scope): keep the GREEN center on top
 * for every face, except when green or blue itself is the face facing the
 * camera — then keep WHITE on top instead. Every pairing here is a pair of
 * *adjacent* faces (never a face and its own opposite, which can't both be
 * visible at once), so each instruction is physically satisfiable and
 * unambiguous.
 */
const TOP_REFERENCE: Readonly<Record<Face, Face>> = {
  U: 'F',
  R: 'F',
  F: 'U',
  D: 'F',
  L: 'F',
  B: 'U',
}

/** "Hold the WHITE center facing the camera, GREEN center on top." */
export function holdInstruction(face: Face): string {
  const facingName = FACE_COLOR_NAMES[face]
  const topName = FACE_COLOR_NAMES[TOP_REFERENCE[face]]
  return `Hold the ${facingName} center facing the camera, ${topName} center on top.`
}
