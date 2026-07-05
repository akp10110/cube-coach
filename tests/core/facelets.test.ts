import { describe, expect, it } from 'vitest'
import {
  FACE_ORDER,
  facesToFaceletString,
  faceOf,
  faceletAt,
  lowConfidencePositions,
  setFaceletAt,
} from '../../src/core/facelets'
import { SOLVED } from '../../src/core/types'
import type { Face, FaceletString, FaceScan } from '../../src/core/types'

describe('faceletAt / faceOf — solved state', () => {
  it('every sticker on the solved cube matches its own face', () => {
    for (const face of FACE_ORDER) {
      for (let index = 0; index < 9; index++) {
        expect(faceletAt(SOLVED, face, index)).toBe(face)
      }
    }
  })

  it('faceOf returns 9 stickers of the matching face for every face', () => {
    for (const face of FACE_ORDER) {
      expect(faceOf(SOLVED, face)).toEqual(Array(9).fill(face))
    }
  })
})

describe('faceletAt / faceOf — round trip', () => {
  // A non-solved 54-char string where every sticker is distinct so a mixed-up
  // mapping between the two helpers would show up as a mismatch.
  const DISTINCT: FaceletString = Array.from(
    { length: 54 },
    (_, i) => FACE_ORDER[Math.floor(i / 9)],
  ).join('')

  it('faceOf(face)[index] agrees with faceletAt(face, index) for every position', () => {
    for (const face of FACE_ORDER) {
      const stickers = faceOf(DISTINCT, face)
      expect(stickers).toHaveLength(9)
      for (let index = 0; index < 9; index++) {
        expect(stickers[index]).toBe(faceletAt(DISTINCT, face, index))
      }
    }
  })

  it('round trips through a full reconstruction of the facelet string', () => {
    const rebuilt = FACE_ORDER.flatMap((face) => faceOf(DISTINCT, face)).join('')
    expect(rebuilt).toBe(DISTINCT)
  })

  it('reflects the URFDLB face order (D3) in the string layout', () => {
    const order: Face[] = ['U', 'R', 'F', 'D', 'L', 'B']
    expect(FACE_ORDER).toEqual(order)
  })
})

describe('setFaceletAt', () => {
  it('repaints only the targeted sticker', () => {
    const repainted = setFaceletAt(SOLVED, 'F', 0, 'R')
    expect(faceletAt(repainted, 'F', 0)).toBe('R')
    for (const face of FACE_ORDER) {
      for (let index = 0; index < 9; index++) {
        if (face === 'F' && index === 0) continue
        expect(faceletAt(repainted, face, index)).toBe(faceletAt(SOLVED, face, index))
      }
    }
  })

  it('leaves the input string untouched', () => {
    setFaceletAt(SOLVED, 'U', 4, 'D')
    expect(SOLVED).toBe('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB')
  })

  it('round trips through faceOf after repainting every sticker of a face', () => {
    let s = SOLVED
    for (let index = 0; index < 9; index++) {
      s = setFaceletAt(s, 'L', index, 'B')
    }
    expect(faceOf(s, 'L')).toEqual(Array(9).fill('B'))
  })
})

function faceScansOf(s: FaceletString): Record<Face, FaceScan> {
  const result = {} as Record<Face, FaceScan>
  for (const face of FACE_ORDER) {
    result[face] = { colors: faceOf(s, face), confidence: Array(9).fill(1) }
  }
  return result
}

describe('facesToFaceletString', () => {
  it('reconstructs SOLVED from its own per-face scans', () => {
    expect(facesToFaceletString(faceScansOf(SOLVED))).toBe(SOLVED)
  })

  it('reconstructs an arbitrary scrambled state from its per-face scans', () => {
    const scrambled = setFaceletAt(SOLVED, 'F', 0, 'R')
    expect(facesToFaceletString(faceScansOf(scrambled))).toBe(scrambled)
  })
})

describe('lowConfidencePositions', () => {
  it('is empty when every sticker meets the threshold', () => {
    expect(lowConfidencePositions(faceScansOf(SOLVED), 0.5)).toEqual([])
  })

  it('finds exactly the stickers below threshold, across faces', () => {
    const faces = faceScansOf(SOLVED)
    faces.U = { ...faces.U, confidence: faces.U.confidence.map((c, i) => (i === 3 ? 0.2 : c)) }
    faces.R = { ...faces.R, confidence: faces.R.confidence.map((c, i) => (i === 8 ? 0.4 : c)) }

    const positions = lowConfidencePositions(faces, 0.5)
    expect(positions.sort((a, b) => a - b)).toEqual([3, 17])
  })

  it('skips faces that are not present yet', () => {
    const faces = faceScansOf(SOLVED)
    faces.U = { ...faces.U, confidence: faces.U.confidence.map(() => 0.1) }
    const partial: Partial<Record<Face, FaceScan>> = { U: faces.U }
    expect(lowConfidencePositions(partial, 0.5)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
})
