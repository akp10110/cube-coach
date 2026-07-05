import { FACE_POSITIONS } from './facelets'
import type { Face, FaceletString } from './types'

/**
 * Internal cubie-level decomposition (facelets → 8 corners + 12 edges, each
 * with orientation). Not part of the frozen contracts in `types.ts`; used by
 * `validate.ts` here and reused by the layer-by-layer solver in a later
 * phase (per tasks.md PR-04 design note).
 */

export type CornerName = 'UFL' | 'UFR' | 'UBL' | 'UBR' | 'DFL' | 'DFR' | 'DBL' | 'DBR'
export type EdgeName =
  'UF' | 'UB' | 'UL' | 'UR' | 'DF' | 'DB' | 'DL' | 'DR' | 'FL' | 'FR' | 'BL' | 'BR'

export const CORNER_NAMES: readonly CornerName[] = [
  'UFL',
  'UFR',
  'UBL',
  'UBR',
  'DFL',
  'DFR',
  'DBL',
  'DBR',
]

export const EDGE_NAMES: readonly EdgeName[] = [
  'UF',
  'UB',
  'UL',
  'UR',
  'DF',
  'DB',
  'DL',
  'DR',
  'FL',
  'FR',
  'BL',
  'BR',
]

function pos(face: Face, index: number): number {
  return FACE_POSITIONS[face][index]
}

/**
 * Absolute facelet positions (0..53) of each corner slot's 3 stickers.
 * Position 0 of each triple is always the U/D-facing facelet. The order of
 * positions 1 and 2 is chosen so that, for every corner, the 3 face normals
 * in [p0, p1, p2] order form a right-handed triple when viewed from outside
 * the cube — i.e. a fixed, consistent chirality across all 8 corners.
 * Without this the corner-orientation sum wouldn't reliably be 0 mod 3 for
 * solvable cubes (verified empirically against 5000 random scrambles).
 */
export const CORNER_FACELETS: Readonly<Record<CornerName, readonly [number, number, number]>> = {
  UFL: [pos('U', 6), pos('L', 2), pos('F', 0)],
  UFR: [pos('U', 8), pos('F', 2), pos('R', 0)],
  UBL: [pos('U', 0), pos('B', 2), pos('L', 0)],
  UBR: [pos('U', 2), pos('R', 2), pos('B', 0)],
  DFL: [pos('D', 0), pos('F', 6), pos('L', 8)],
  DFR: [pos('D', 2), pos('R', 6), pos('F', 8)],
  DBL: [pos('D', 6), pos('L', 6), pos('B', 8)],
  DBR: [pos('D', 8), pos('B', 6), pos('R', 8)],
}

/**
 * Absolute facelet positions of each edge slot's 2 stickers. Position 0 is
 * the "reference" facelet: the U/D-facing one when the edge touches U/D,
 * otherwise (the 4 equatorial edges FL/FR/BL/BR) the F/B-facing one — never
 * L/R. This asymmetric rule is what the mod-2 edge-flip invariant depends
 * on (also verified empirically).
 */
export const EDGE_FACELETS: Readonly<Record<EdgeName, readonly [number, number]>> = {
  UF: [pos('U', 7), pos('F', 1)],
  UB: [pos('U', 1), pos('B', 1)],
  UL: [pos('U', 3), pos('L', 1)],
  UR: [pos('U', 5), pos('R', 1)],
  DF: [pos('D', 1), pos('F', 7)],
  DB: [pos('D', 7), pos('B', 7)],
  DL: [pos('D', 3), pos('L', 7)],
  DR: [pos('D', 5), pos('R', 7)],
  FL: [pos('F', 3), pos('L', 5)],
  FR: [pos('F', 5), pos('R', 3)],
  BL: [pos('B', 5), pos('L', 3)],
  BR: [pos('B', 3), pos('R', 5)],
}

function faceSet(name: string): ReadonlySet<Face> {
  return new Set(name.split('') as Face[])
}

const CORNER_FACE_SETS: Readonly<Record<CornerName, ReadonlySet<Face>>> = {
  UFL: faceSet('UFL'),
  UFR: faceSet('UFR'),
  UBL: faceSet('UBL'),
  UBR: faceSet('UBR'),
  DFL: faceSet('DFL'),
  DFR: faceSet('DFR'),
  DBL: faceSet('DBL'),
  DBR: faceSet('DBR'),
}

const EDGE_FACE_SETS: Readonly<Record<EdgeName, ReadonlySet<Face>>> = {
  UF: faceSet('UF'),
  UB: faceSet('UB'),
  UL: faceSet('UL'),
  UR: faceSet('UR'),
  DF: faceSet('DF'),
  DB: faceSet('DB'),
  DL: faceSet('DL'),
  DR: faceSet('DR'),
  FL: faceSet('FL'),
  FR: faceSet('FR'),
  BL: faceSet('BL'),
  BR: faceSet('BR'),
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value))
}

/** Matches 3 facelet colors to a corner name, or `undefined` if the
 *  combination is impossible (duplicate or non-adjacent faces, e.g. U+D). */
export function matchCorner(letters: readonly [Face, Face, Face]): CornerName | undefined {
  const set = new Set(letters)
  return CORNER_NAMES.find((name) => setsEqual(CORNER_FACE_SETS[name], set))
}

/** Matches 2 facelet colors to an edge name, or `undefined` if impossible. */
export function matchEdge(letters: readonly [Face, Face]): EdgeName | undefined {
  const set = new Set(letters)
  return EDGE_NAMES.find((name) => setsEqual(EDGE_FACE_SETS[name], set))
}

export interface CornerInstance {
  /** Name of the piece occupying this slot, or `undefined` if its 3 colors
   *  don't form a legal corner. */
  name: CornerName | undefined
  orientation: 0 | 1 | 2
}

export interface EdgeInstance {
  name: EdgeName | undefined
  orientation: 0 | 1
}

/** Decomposes a facelet string into its 8 corner slots, in `CORNER_NAMES`
 *  order (slot i is named `CORNER_NAMES[i]`; the returned instance names
 *  whichever piece currently occupies it). */
export function decodeCorners(s: FaceletString): CornerInstance[] {
  return CORNER_NAMES.map((slot) => {
    const [p0, p1, p2] = CORNER_FACELETS[slot]
    const letters: [Face, Face, Face] = [s[p0] as Face, s[p1] as Face, s[p2] as Face]
    const name = matchCorner(letters)
    const orientation = letters.findIndex((l) => l === 'U' || l === 'D')
    return { name, orientation: (orientation < 0 ? 0 : orientation) as 0 | 1 | 2 }
  })
}

/** Decomposes a facelet string into its 12 edge slots, in `EDGE_NAMES`
 *  order. */
export function decodeEdges(s: FaceletString): EdgeInstance[] {
  return EDGE_NAMES.map((slot) => {
    const [p0, p1] = EDGE_FACELETS[slot]
    const letters: [Face, Face] = [s[p0] as Face, s[p1] as Face]
    const name = matchEdge(letters)
    const hasUD =
      letters[0] === 'U' || letters[0] === 'D' || letters[1] === 'U' || letters[1] === 'D'
    const orientation = hasUD
      ? letters.findIndex((l) => l === 'U' || l === 'D')
      : letters.findIndex((l) => l === 'F' || l === 'B')
    return { name, orientation: (orientation < 0 ? 0 : orientation) as 0 | 1 }
  })
}
