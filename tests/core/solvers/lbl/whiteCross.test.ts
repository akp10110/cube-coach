import { describe, expect, it } from 'vitest'
import { applyMoves, parseMoves } from '../../../../src/core/moves'
import { randomScramble } from '../../../../src/core/scramble'
import { EDGE_FACELETS } from '../../../../src/core/cubies'
import { SOLVED } from '../../../../src/core/types'
import { isStageComplete, solveStage } from '../../../../src/core/solvers/lbl/whiteCross'

describe('white-cross isStageComplete', () => {
  it('is true on SOLVED', () => {
    expect(isStageComplete(SOLVED)).toBe(true)
  })

  it('is false when a white edge is flipped in place', () => {
    const [p0, p1] = EDGE_FACELETS.UF
    const arr = SOLVED.split('')
    ;[arr[p0], arr[p1]] = [arr[p1], arr[p0]]
    expect(isStageComplete(arr.join(''))).toBe(false)
  })

  it('is false when a white edge is out of place', () => {
    const scrambled = applyMoves(SOLVED, parseMoves('F'))
    expect(isStageComplete(scrambled)).toBe(false)
  })

  it('is true after a scramble that only touches D/L/R/B layers below the cross', () => {
    // D turns never move the four U-layer cross edges.
    const scrambled = applyMoves(SOLVED, parseMoves("D D2 D'"))
    expect(isStageComplete(scrambled)).toBe(true)
  })
})

describe('white-cross solveStage', () => {
  it('returns no moves when already complete', () => {
    expect(solveStage(SOLVED).moves).toEqual([])
  })

  it('solves the cross from a single quarter turn', () => {
    const scrambled = applyMoves(SOLVED, parseMoves('F'))
    const { moves } = solveStage(scrambled)
    expect(isStageComplete(applyMoves(scrambled, moves))).toBe(true)
  })

  it('solves the cross from every single base move (each move breaks exactly one or more cross edges)', () => {
    for (const move of parseMoves("U U' U2 D D' D2 L L' L2 R R' R2 F F' F2 B B' B2")) {
      const scrambled = applyMoves(SOLVED, [move])
      const { moves } = solveStage(scrambled)
      expect(isStageComplete(applyMoves(scrambled, moves))).toBe(true)
    }
  })

  it('solves the cross for 200 random scrambles', () => {
    for (let i = 0; i < 200; i++) {
      const scrambled = applyMoves(SOLVED, randomScramble())
      const { moves } = solveStage(scrambled)
      expect(isStageComplete(applyMoves(scrambled, moves))).toBe(true)
    }
  })
})
