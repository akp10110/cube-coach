import { describe, expect, it } from 'vitest'
import { randomScramble } from '../../src/core/scramble'
import { applyMoves, invertMoves } from '../../src/core/moves'
import { isSolved } from '../../src/core/validate'
import { SOLVED } from '../../src/core/types'
import type { Move } from '../../src/core/types'

const AXIS: Record<string, 'UD' | 'LR' | 'FB'> = {
  U: 'UD',
  D: 'UD',
  L: 'LR',
  R: 'LR',
  F: 'FB',
  B: 'FB',
}

const SCRAMBLES = Array.from({ length: 500 }, () => randomScramble())

describe('randomScramble', () => {
  it('defaults to length 25', () => {
    expect(randomScramble().length).toBe(25)
  })

  it('honors a custom length', () => {
    expect(randomScramble(10).length).toBe(10)
    expect(randomScramble(0).length).toBe(0)
  })

  it('never repeats the same face twice in a row (also rules out trivial A A\' pairs)', () => {
    for (const scramble of SCRAMBLES) {
      for (let i = 1; i < scramble.length; i++) {
        expect(scramble[i][0]).not.toBe(scramble[i - 1][0])
      }
    }
  })

  it('never has three consecutive moves on the same axis (e.g. L R L)', () => {
    for (const scramble of SCRAMBLES) {
      for (let i = 2; i < scramble.length; i++) {
        const axes = [scramble[i - 2], scramble[i - 1], scramble[i]].map(
          (m: Move) => AXIS[m[0]],
        )
        expect(axes[0] === axes[1] && axes[1] === axes[2]).toBe(false)
      }
    }
  })

  it('scrambled state is not solved', () => {
    for (const scramble of SCRAMBLES) {
      const scrambled = applyMoves(SOLVED, scramble)
      expect(scrambled).not.toBe(SOLVED)
      expect(isSolved(scrambled)).toBe(false)
    }
  })

  it('applying the inverse of the scramble restores SOLVED', () => {
    for (const scramble of SCRAMBLES) {
      const scrambled = applyMoves(SOLVED, scramble)
      const restored = applyMoves(scrambled, invertMoves(scramble))
      expect(restored).toBe(SOLVED)
    }
  })
})
