import type { Face, FaceletString, FaceScan } from './types'

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

/** Returns a copy of `s` with one sticker repainted — the manual editor's
 *  (PR-10) only way to mutate a facelet string, since the type itself is
 *  immutable. */
export function setFaceletAt(
  s: FaceletString,
  face: Face,
  index: number,
  color: Face,
): FaceletString {
  const position = FACE_POSITIONS[face][index]
  return s.slice(0, position) + color + s.slice(position + 1)
}

/** Builds a facelet string from a completed scan's per-face classifications
 *  (PR-15) — the inverse of `faceOf`, one `FaceScan` per face, each already
 *  in row-major order (D3/`FaceScan`'s own contract). */
export function facesToFaceletString(faces: Readonly<Record<Face, FaceScan>>): FaceletString {
  const chars = new Array<string>(54)
  for (const face of FACE_ORDER) {
    FACE_POSITIONS[face].forEach((position, index) => {
      chars[position] = faces[face].colors[index]
    })
  }
  return chars.join('')
}

/** Absolute facelet positions (0..53) whose classification confidence is
 *  below `threshold` — PR-15's confidence-based highlighting on the scan
 *  review screen. Faces not yet present in `faces` contribute nothing. */
export function lowConfidencePositions(
  faces: Partial<Readonly<Record<Face, FaceScan>>>,
  threshold: number,
): number[] {
  const positions: number[] = []
  for (const face of FACE_ORDER) {
    const scan = faces[face]
    if (!scan) continue
    scan.confidence.forEach((confidence, index) => {
      if (confidence < threshold) positions.push(FACE_POSITIONS[face][index])
    })
  }
  return positions
}
