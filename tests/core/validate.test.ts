import { describe, expect, it } from 'vitest'
import { isSolved } from '../../src/core/validate'
import { applyMove, applyMoves } from '../../src/core/moves'
import { randomScramble } from '../../src/core/scramble'
import { SOLVED } from '../../src/core/types'

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
