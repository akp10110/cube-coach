import type { Face, FaceletString } from './types'

/** Canonical URFDLB face order (D3) — index of a face within the 54-char string. */
export const FACE_ORDER: readonly Face[] = ['U', 'R', 'F', 'D', 'L', 'B']

/** Position 0..53 of each face's first (top-left) sticker in the facelet string. */
const FACE_START: Readonly<Record<Face, number>> = {
  U: 0,
  R: 9,
  F: 18,
  D: 27,
  L: 36,
  B: 45,
}

function positionsFrom(start: number): readonly number[] {
  return Array.from({ length: 9 }, (_, index) => start + index)
}

/** (face, index 0..8) → absolute position 0..53 in the facelet string. */
export const FACE_POSITIONS: Readonly<Record<Face, readonly number[]>> = {
  U: positionsFrom(FACE_START.U),
  R: positionsFrom(FACE_START.R),
  F: positionsFrom(FACE_START.F),
  D: positionsFrom(FACE_START.D),
  L: positionsFrom(FACE_START.L),
  B: positionsFrom(FACE_START.B),
}

export function faceletAt(s: FaceletString, face: Face, index: number): Face {
  return s[FACE_POSITIONS[face][index]] as Face
}

export function faceOf(s: FaceletString, face: Face): Face[] {
  return FACE_POSITIONS[face].map((position) => s[position] as Face)
}
