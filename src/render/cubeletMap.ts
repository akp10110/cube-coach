import { FACE_ORDER } from '../core/facelets'
import type { Face } from '../core/types'

/**
 * Maps each of the 54 facelet positions to a cubelet coordinate and the
 * local face of that cubelet the sticker sits on. This is the #1 place a
 * silent mapping bug can enter (PR-06 acceptance) so it is derived directly
 * from the coordinate system + net diagram already hand-verified and tested
 * in src/core/moves.ts (cube center at origin, x:-1=L/+1=R, y:-1=D/+1=U,
 * z:-1=B/+1=F; each face's 9 stickers row-major top-left..bottom-right
 * viewed head-on from outside), rather than re-derived from scratch — the
 * two must agree since the renderer displays exactly what the move engine
 * computes.
 *
 * Per-face row/col -> (x,y,z) derivation (r,c both 0..2, row-major):
 *   U (own view: up=B,right=R,bottom=F,left=L): x=c-1, y=+1,   z=r-1
 *   D (own view: up=F,right=R,bottom=B,left=L): x=c-1, y=-1,   z=1-r
 *   F (own view: up=U,right=R,bottom=D,left=L): x=c-1, y=1-r,  z=+1
 *   B (own view: up=U,right=L,bottom=D,left=R): x=1-c, y=1-r,  z=-1
 *   R (own view: up=U,right=B,bottom=D,left=F): x=+1,  y=1-r,  z=1-c
 *   L (own view: up=U,right=F,bottom=D,left=B): x=-1,  y=1-r,  z=c-1
 * matching each face's "up/right/bottom/left in terms of neighbors" from the
 * moves.ts comment.
 */

export type Axis = -1 | 0 | 1
export type CubeletCoord = readonly [Axis, Axis, Axis]
export type LocalFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'

export interface FaceletMapping {
  face: Face
  index: number
  coord: CubeletCoord
  localFace: LocalFace
}

function rowCol(index: number): { r: number; c: number } {
  return { r: Math.floor(index / 3), c: index % 3 }
}

function mappingFor(face: Face, index: number): FaceletMapping {
  const { r, c } = rowCol(index)
  switch (face) {
    case 'U':
      return { face, index, coord: [c - 1, 1, r - 1] as CubeletCoord, localFace: 'py' }
    case 'D':
      return { face, index, coord: [c - 1, -1, 1 - r] as CubeletCoord, localFace: 'ny' }
    case 'F':
      return { face, index, coord: [c - 1, 1 - r, 1] as CubeletCoord, localFace: 'pz' }
    case 'B':
      return { face, index, coord: [1 - c, 1 - r, -1] as CubeletCoord, localFace: 'nz' }
    case 'R':
      return { face, index, coord: [1, 1 - r, 1 - c] as CubeletCoord, localFace: 'px' }
    case 'L':
      return { face, index, coord: [-1, 1 - r, c - 1] as CubeletCoord, localFace: 'nx' }
  }
}

/** All 54 (face,index) -> (cubelet coord, local face) mappings, URFDLB order. */
export const FACELET_MAPPINGS: readonly FaceletMapping[] = FACE_ORDER.flatMap((face) =>
  Array.from({ length: 9 }, (_, index) => mappingFor(face, index)),
)

function coordKey(coord: CubeletCoord): string {
  return coord.join(',')
}

/** All 27 cubelet coordinates: each axis in {-1,0,1}. */
export const CUBELET_COORDS: readonly CubeletCoord[] = (() => {
  const axes: readonly Axis[] = [-1, 0, 1]
  const coords: CubeletCoord[] = []
  for (const x of axes) for (const y of axes) for (const z of axes) coords.push([x, y, z])
  return coords
})()

/** cubelet coord key -> the facelet mappings landing on its visible face(s). */
export const MAPPINGS_BY_CUBELET: ReadonlyMap<string, readonly FaceletMapping[]> = (() => {
  const map = new Map<string, FaceletMapping[]>()
  for (const mapping of FACELET_MAPPINGS) {
    const key = coordKey(mapping.coord)
    const existing = map.get(key)
    if (existing) existing.push(mapping)
    else map.set(key, [mapping])
  }
  return map
})()

export function cubeletKey(coord: CubeletCoord): string {
  return coordKey(coord)
}
