import { describe, expect, it } from 'vitest'
import {
  CORNER_FACELETS,
  CORNER_NAMES,
  EDGE_FACELETS,
  EDGE_NAMES,
  decodeCorners,
  decodeEdges,
} from '../../src/core/cubies'
import { SOLVED } from '../../src/core/types'

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
