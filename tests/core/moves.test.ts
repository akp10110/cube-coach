import { describe, expect, it } from 'vitest'
import {
  applyMove,
  applyMoves,
  formatMoves,
  invertMove,
  invertMoves,
  parseMoves,
} from '../../src/core/moves'
import { FACE_ORDER, faceletAt } from '../../src/core/facelets'
import { SOLVED } from '../../src/core/types'
import type { FaceletString, Move } from '../../src/core/types'

const ALL_MOVES: Move[] = [
  'U',
  "U'",
  'U2',
  'D',
  "D'",
  'D2',
  'L',
  "L'",
  'L2',
  'R',
  "R'",
  'R2',
  'F',
  "F'",
  'F2',
  'B',
  "B'",
  'B2',
]

// 54 distinct characters so a move's effect on the underlying PERMUTATION is
// verified, not just its effect on repeated same-face colors.
const MARKER: FaceletString = Array.from(
  { length: 54 },
  (_, i) => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[i],
).join('')

function randomState(seed: number): FaceletString {
  // deterministic pseudo-random sequence of moves from a fixed seed
  let s = seed
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  let state = MARKER
  for (let i = 0; i < 20; i++) {
    state = applyMove(state, ALL_MOVES[Math.floor(rand() * ALL_MOVES.length)])
  }
  return state
}

describe('applyMove — inverse round trip', () => {
  it.each(ALL_MOVES)('applyMove(SOLVED, %s) then its inverse returns SOLVED', (m) => {
    const turned = applyMove(SOLVED, m)
    const restored = applyMove(turned, invertMove(m))
    expect(restored).toBe(SOLVED)
  })
})

describe('applyMove — quarter/half turn periodicity', () => {
  const randomStates = [1, 2, 3, 4, 5].map(randomState)

  it.each(['U', 'D', 'L', 'R', 'F', 'B'] as const)(
    '%s applied 4 times returns the input, for random states',
    (face) => {
      for (const state of randomStates) {
        let s = state
        for (let i = 0; i < 4; i++) s = applyMove(s, face)
        expect(s).toBe(state)
      }
    },
  )

  it.each(['U2', 'D2', 'L2', 'R2', 'F2', 'B2'] as const)(
    '%s applied 2 times returns the input, for random states',
    (move) => {
      for (const state of randomStates) {
        let s = state
        for (let i = 0; i < 2; i++) s = applyMove(s, move)
        expect(s).toBe(state)
      }
    },
  )
})

describe('superflip sequence', () => {
  const SUPERFLIP = "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"

  it('produces a state with correct centers, edges all flipped, and inverts back to SOLVED', () => {
    const moves = parseMoves(SUPERFLIP)
    const superflipped = applyMoves(SOLVED, moves)

    expect(superflipped).not.toBe(SOLVED)
    for (const face of FACE_ORDER) {
      expect(faceletAt(superflipped, face, 4)).toBe(face)
    }

    const restored = applyMoves(superflipped, invertMoves(moves))
    expect(restored).toBe(SOLVED)
  })
})

describe('parseMoves / formatMoves', () => {
  it('round trips for every legal move', () => {
    expect(parseMoves(formatMoves(ALL_MOVES))).toEqual(ALL_MOVES)
  })

  it('round trips for the superflip notation', () => {
    const notation = "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"
    expect(formatMoves(parseMoves(notation))).toBe(notation)
  })

  it('throws on garbage input', () => {
    expect(() => parseMoves('X')).toThrow()
    expect(() => parseMoves('R3')).toThrow()
    expect(() => parseMoves('u')).toThrow()
    expect(() => parseMoves('RR')).toThrow()
  })
})

describe('invertMove / invertMoves', () => {
  it('U inverts to U-prime and back', () => {
    expect(invertMove('U')).toBe("U'")
    expect(invertMove("U'")).toBe('U')
  })

  it('a double move is its own inverse', () => {
    expect(invertMove('R2')).toBe('R2')
  })

  it('invertMoves reverses order and inverts each move', () => {
    expect(invertMoves(['U', 'R', "F'"])).toEqual(['F', "R'", "U'"])
  })
})
