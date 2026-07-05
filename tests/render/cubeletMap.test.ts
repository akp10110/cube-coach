import { describe, expect, it } from 'vitest'
import { FACE_ORDER } from '../../src/core/facelets'
import {
  CUBELET_COORDS,
  FACELET_MAPPINGS,
  MAPPINGS_BY_CUBELET,
  cubeletKey,
  type Axis,
  type LocalFace,
} from '../../src/render/cubeletMap'

const OUTWARD_LOCAL_FACE: Readonly<Record<'U' | 'D' | 'F' | 'B' | 'R' | 'L', LocalFace>> = {
  U: 'py',
  D: 'ny',
  F: 'pz',
  B: 'nz',
  R: 'px',
  L: 'nx',
}

describe('FACELET_MAPPINGS', () => {
  it('covers exactly the 54 facelet positions, one mapping each', () => {
    expect(FACELET_MAPPINGS).toHaveLength(54)
    const seen = new Set<string>()
    for (const face of FACE_ORDER) {
      for (let index = 0; index < 9; index++) {
        seen.add(`${face}:${index}`)
      }
    }
    for (const mapping of FACELET_MAPPINGS) {
      const id = `${mapping.face}:${mapping.index}`
      expect(seen.has(id)).toBe(true)
      seen.delete(id)
    }
    expect(seen.size).toBe(0)
  })

  it('lands each face entirely on its own outward local face', () => {
    for (const face of FACE_ORDER) {
      const mappings = FACELET_MAPPINGS.filter((m) => m.face === face)
      expect(mappings).toHaveLength(9)
      for (const mapping of mappings) {
        expect(mapping.localFace).toBe(OUTWARD_LOCAL_FACE[face])
      }
    }
  })

  it('places every face on the correct fixed-axis outer layer', () => {
    const axisFor: Record<string, (coord: readonly [Axis, Axis, Axis]) => Axis> = {
      U: (c) => c[1],
      D: (c) => c[1],
      F: (c) => c[2],
      B: (c) => c[2],
      R: (c) => c[0],
      L: (c) => c[0],
    }
    const expectedValue: Record<string, Axis> = { U: 1, D: -1, F: 1, B: -1, R: 1, L: -1 }
    for (const mapping of FACELET_MAPPINGS) {
      expect(axisFor[mapping.face](mapping.coord)).toBe(expectedValue[mapping.face])
    }
  })

  it('maps each face center (index 4) to that face-center cubelet', () => {
    const centerCoord: Record<string, readonly [Axis, Axis, Axis]> = {
      U: [0, 1, 0],
      D: [0, -1, 0],
      F: [0, 0, 1],
      B: [0, 0, -1],
      R: [1, 0, 0],
      L: [-1, 0, 0],
    }
    for (const face of FACE_ORDER) {
      const center = FACELET_MAPPINGS.find((m) => m.face === face && m.index === 4)!
      expect(center.coord).toEqual(centerCoord[face])
    }
  })

  it('agrees with a manually worked corner: U0/L0/B2 all sit on cubelet (-1,1,-1)', () => {
    // U's top-left sticker (near B, near L) shares its corner cubelet with
    // L's top-left sticker (near U, near B) and B's top-right sticker
    // (near U, near L) — cross-checked against the net diagram in moves.ts.
    const u0 = FACELET_MAPPINGS.find((m) => m.face === 'U' && m.index === 0)!
    const l0 = FACELET_MAPPINGS.find((m) => m.face === 'L' && m.index === 0)!
    const b2 = FACELET_MAPPINGS.find((m) => m.face === 'B' && m.index === 2)!
    expect(u0.coord).toEqual([-1, 1, -1])
    expect(l0.coord).toEqual([-1, 1, -1])
    expect(b2.coord).toEqual([-1, 1, -1])
    expect(new Set([u0.localFace, l0.localFace, b2.localFace])).toEqual(new Set(['py', 'nx', 'nz']))
  })
})

describe('CUBELET_COORDS', () => {
  it('lists all 27 distinct coordinates', () => {
    expect(CUBELET_COORDS).toHaveLength(27)
    expect(new Set(CUBELET_COORDS.map(cubeletKey)).size).toBe(27)
  })
})

describe('MAPPINGS_BY_CUBELET', () => {
  it('gives corners 3 stickers, edges 2, centers 1, and the core 0', () => {
    for (const coord of CUBELET_COORDS) {
      const nonZeroAxes = coord.filter((v) => v !== 0).length
      const mappings = MAPPINGS_BY_CUBELET.get(cubeletKey(coord)) ?? []
      expect(mappings).toHaveLength(nonZeroAxes)
    }
  })

  it('gives every corner cubelet 3 mappings with 3 distinct local faces', () => {
    const corners = CUBELET_COORDS.filter((c) => c.every((v) => v !== 0))
    expect(corners).toHaveLength(8)
    for (const coord of corners) {
      const mappings = MAPPINGS_BY_CUBELET.get(cubeletKey(coord))!
      expect(new Set(mappings.map((m) => m.localFace)).size).toBe(3)
    }
  })
})
