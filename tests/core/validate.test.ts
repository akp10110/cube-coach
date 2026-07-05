import { describe, expect, it } from 'vitest'
import { isSolved, localizeIssue, validate } from '../../src/core/validate'
import { applyMove, applyMoves } from '../../src/core/moves'
import { randomScramble } from '../../src/core/scramble'
import { CORNER_FACELETS, EDGE_FACELETS } from '../../src/core/cubies'
import { SOLVED } from '../../src/core/types'
import type { FaceletString } from '../../src/core/types'

describe('isSolved', () => {
  it('is true for SOLVED', () => {
    expect(isSolved(SOLVED)).toBe(true)
  })

  it('is false after a single move', () => {
    expect(isSolved(applyMove(SOLVED, 'U'))).toBe(false)
  })

  it('is false for a random scramble', () => {
    const scrambled = applyMoves(SOLVED, randomScramble())
    expect(isSolved(scrambled)).toBe(false)
  })
})

function withFacelet(s: FaceletString, position: number, letter: string): FaceletString {
  return s.slice(0, position) + letter + s.slice(position + 1)
}

describe('validate — SOLVED and random scrambles', () => {
  it('SOLVED validates ok with no issues', () => {
    expect(validate(SOLVED)).toEqual({ ok: true, issues: [] })
  })

  it('every random scramble of SOLVED validates ok (1,000 cases)', () => {
    for (let i = 0; i < 1000; i++) {
      const scrambled = applyMoves(SOLVED, randomScramble())
      const result = validate(scrambled)
      expect(result.ok).toBe(true)
      expect(result.issues).toEqual([])
    }
  })
})

describe('validate — bad-length', () => {
  it('fires alone for a truncated string', () => {
    expect(validate(SOLVED.slice(0, 53))).toEqual({
      ok: false,
      issues: [{ kind: 'bad-length' }],
    })
  })
})

describe('validate — bad-color-count', () => {
  it('fires for both the under- and over-represented colors, and only that', () => {
    // U0 (corner slot UBL's U-facelet) forced to 'R': U drops to 8, R rises to 10.
    const state = withFacelet(SOLVED, 0, 'R')
    const result = validate(state)
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { kind: 'bad-color-count', face: 'U', count: 8 },
        { kind: 'bad-color-count', face: 'R', count: 10 },
      ]),
    )
    expect(result.issues).toHaveLength(2)
  })
})

describe('validate — bad-centers', () => {
  it('fires alone when a center is duplicated (counts kept balanced elsewhere)', () => {
    // D-center (pos 31) forced to show 'U' (duplicating U-center) while a
    // harmless non-center U sticker (U0, pos 0) is forced to 'D' to keep
    // overall color counts at 9 each.
    let state = withFacelet(SOLVED, 31, 'U')
    state = withFacelet(state, 0, 'D')
    const result = validate(state)
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([{ kind: 'bad-centers' }])
  })
})

describe('validate — invalid-piece', () => {
  it('fires alone when a corner ends up with two same-axis stickers', () => {
    // Corner UFR's F-sticker (pos 20) forced to 'R', producing {U,R,R}.
    // Compensated at edge UR's R-sticker (pos 10) forced to 'F' — that edge
    // stays legal (U pairs validly with any side color), so only the corner
    // is broken and color counts stay balanced.
    let state = withFacelet(SOLVED, 20, 'R')
    state = withFacelet(state, 10, 'F')
    const result = validate(state)
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues.every((issue) => issue.kind === 'invalid-piece')).toBe(true)
  })
})

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

function swapEdges(
  s: FaceletString,
  a: keyof typeof EDGE_FACELETS,
  b: keyof typeof EDGE_FACELETS,
): FaceletString {
  const [a0, a1] = EDGE_FACELETS[a]
  const [b0, b1] = EDGE_FACELETS[b]
  const arr = s.split('')
  ;[arr[a0], arr[b0]] = [arr[b0], arr[a0]]
  ;[arr[a1], arr[b1]] = [arr[b1], arr[a1]]
  return arr.join('')
}

describe('validate — corner-orientation', () => {
  it('fires alone for a single twisted corner', () => {
    const result = validate(twistCorner(SOLVED, 'UFR'))
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([{ kind: 'corner-orientation' }])
  })
})

describe('validate — edge-orientation', () => {
  it('fires alone for a single flipped edge', () => {
    const result = validate(flipEdge(SOLVED, 'UF'))
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([{ kind: 'edge-orientation' }])
  })
})

describe('validate — permutation-parity', () => {
  it('fires alone for a single swapped pair of edges', () => {
    const result = validate(swapEdges(SOLVED, 'UF', 'UB'))
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([{ kind: 'permutation-parity' }])
  })
})

describe('localizeIssue — PR-11 sticker highlighting', () => {
  it("localizes a twisted corner to that corner's 3 facelets", () => {
    const state = twistCorner(SOLVED, 'UFR')
    const [issue] = validate(state).issues
    expect(localizeIssue(state, issue).sort((a, b) => a - b)).toEqual(
      [...CORNER_FACELETS.UFR].sort((a, b) => a - b),
    )
  })

  it("localizes a flipped edge to that edge's 2 facelets", () => {
    const state = flipEdge(SOLVED, 'UF')
    const [issue] = validate(state).issues
    expect(localizeIssue(state, issue).sort((a, b) => a - b)).toEqual(
      [...EDGE_FACELETS.UF].sort((a, b) => a - b),
    )
  })

  it('localizes an invalid-piece issue to every broken piece', () => {
    // Same fixture as the invalid-piece describe block above: corner UFR
    // becomes an impossible {U,R,R} combo, and edge UR's compensating edit
    // (its R-facelet forced to 'F') incidentally duplicates edge UF's color
    // set — both pieces come back as `invalid-piece`, and (since the issue
    // itself carries no slot info) localizing either one surfaces both.
    let state = withFacelet(SOLVED, 20, 'R')
    state = withFacelet(state, 10, 'F')
    const expected = [...CORNER_FACELETS.UFR, ...EDGE_FACELETS.UR].sort((a, b) => a - b)
    for (const issue of validate(state).issues) {
      expect(localizeIssue(state, issue).sort((a, b) => a - b)).toEqual(expected)
    }
  })

  it('returns nothing for issues that cannot be pinned to specific pieces', () => {
    expect(localizeIssue(SOLVED.slice(0, 53), { kind: 'bad-length' })).toEqual([])
    expect(localizeIssue(SOLVED, { kind: 'bad-color-count', face: 'U', count: 8 })).toEqual([])
    expect(localizeIssue(SOLVED, { kind: 'bad-centers' })).toEqual([])

    const swapped = swapEdges(SOLVED, 'UF', 'UB')
    const [parityIssue] = validate(swapped).issues
    expect(localizeIssue(swapped, parityIssue)).toEqual([])
  })
})
