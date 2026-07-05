import { describe, expect, it } from 'vitest'
import {
  CORNER_FACELETS,
  CORNER_NAMES,
  EDGE_FACELETS,
  EDGE_NAMES,
  decodeCorners,
  decodeEdges,
  flippedEdgeSlots,
  invalidCornerSlots,
  invalidEdgeSlots,
  twistedCornerSlots,
} from '../../src/core/cubies'
import { SOLVED } from '../../src/core/types'
import type { FaceletString } from '../../src/core/types'

describe('cubie facelet tables', () => {
  it('cover all 54 positions exactly once across corners, edges, and centers', () => {
    const used = new Set<number>()
    for (const name of CORNER_NAMES) {
      for (const p of CORNER_FACELETS[name]) used.add(p)
    }
    for (const name of EDGE_NAMES) {
      for (const p of EDGE_FACELETS[name]) used.add(p)
    }
    const centers = [4, 13, 22, 31, 40, 49]
    for (const c of centers) used.add(c)
    expect(used.size).toBe(54)
  })
})

describe('decodeCorners / decodeEdges on SOLVED', () => {
  it('every slot is occupied by its own-named piece at orientation 0', () => {
    for (const instance of decodeCorners(SOLVED)) {
      expect(instance.orientation).toBe(0)
    }
    for (const instance of decodeEdges(SOLVED)) {
      expect(instance.orientation).toBe(0)
    }
  })

  it('slot names match occupant names 1:1 (identity permutation)', () => {
    const corners = decodeCorners(SOLVED)
    corners.forEach((instance, i) => expect(instance.name).toBe(CORNER_NAMES[i]))
    const edges = decodeEdges(SOLVED)
    edges.forEach((instance, i) => expect(instance.name).toBe(EDGE_NAMES[i]))
  })
})

function withFacelet(s: FaceletString, position: number, letter: string): FaceletString {
  return s.slice(0, position) + letter + s.slice(position + 1)
}

function twistCorner(s: FaceletString, name: keyof typeof CORNER_FACELETS): FaceletString {
  const [p0, p1, p2] = CORNER_FACELETS[name]
  const arr = s.split('')
  const tmp = arr[p0]
  arr[p0] = arr[p2]
  arr[p2] = arr[p1]
  arr[p1] = tmp
  return arr.join('')
}

function flipEdge(s: FaceletString, name: keyof typeof EDGE_FACELETS): FaceletString {
  const [p0, p1] = EDGE_FACELETS[name]
  const arr = s.split('')
  ;[arr[p0], arr[p1]] = [arr[p1], arr[p0]]
  return arr.join('')
}

describe('invalidCornerSlots / invalidEdgeSlots', () => {
  it('are empty on SOLVED', () => {
    expect(invalidCornerSlots(decodeCorners(SOLVED))).toEqual([])
    expect(invalidEdgeSlots(decodeEdges(SOLVED))).toEqual([])
  })

  it('flags exactly the corner slot with an impossible color combo', () => {
    // Corner UFR's F-sticker (pos 20) forced to 'R' produces {U,R,R}.
    const state = withFacelet(SOLVED, 20, 'R')
    const bad = invalidCornerSlots(decodeCorners(state))
    expect(bad).toEqual([CORNER_NAMES.indexOf('UFR')])
    expect(invalidEdgeSlots(decodeEdges(state))).toEqual([])
  })
})

describe('twistedCornerSlots / flippedEdgeSlots', () => {
  it('are empty on SOLVED', () => {
    expect(twistedCornerSlots(decodeCorners(SOLVED))).toEqual([])
    expect(flippedEdgeSlots(decodeEdges(SOLVED))).toEqual([])
  })

  it('flags exactly the one twisted corner', () => {
    const state = twistCorner(SOLVED, 'UFR')
    expect(twistedCornerSlots(decodeCorners(state))).toEqual([CORNER_NAMES.indexOf('UFR')])
  })

  it('flags exactly the one flipped edge', () => {
    const state = flipEdge(SOLVED, 'UF')
    expect(flippedEdgeSlots(decodeEdges(state))).toEqual([EDGE_NAMES.indexOf('UF')])
  })
})
