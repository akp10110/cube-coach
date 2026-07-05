import { beforeAll, describe, expect, it } from 'vitest'
import Cube from 'cubejs'
import { applyMoves, parseMoves } from '../../../src/core/moves'
import { randomScramble } from '../../../src/core/scramble'
import { isSolved } from '../../../src/core/validate'
import { SOLVED } from '../../../src/core/types'
import { KociembaSolver, ValidationError } from '../../../src/core/solvers/kociemba'

// PR-05 note: the worker itself isn't exercised here (no `Worker` global in
// Node) — this integration test calls cubejs directly, the same way
// workers/kociemba.worker.ts does, to prove our facelet convention and move
// notation are compatible with its solver.
describe('cubejs integration', () => {
  beforeAll(() => {
    Cube.initSolver()
  })

  it('solves 25 random scrambles back to SOLVED within 23 moves', () => {
    for (let i = 0; i < 25; i++) {
      const scramble = randomScramble()
      const scrambled = applyMoves(SOLVED, scramble)

      const solutionText = Cube.fromString(scrambled).solve()
      const solutionMoves = parseMoves(solutionText)

      expect(solutionMoves.length).toBeLessThanOrEqual(23)

      const result = applyMoves(scrambled, solutionMoves)
      expect(isSolved(result)).toBe(true)
    }
  })
})

describe('KociembaSolver.solve — validation gating', () => {
  it('rejects with ValidationError before touching the worker when the state is invalid', async () => {
    const solver = new KociembaSolver()
    const badLength = SOLVED.slice(0, -1)

    await expect(solver.solve(badLength)).rejects.toBeInstanceOf(ValidationError)
  })

  it('ValidationError carries the validate() issues', async () => {
    const solver = new KociembaSolver()
    const badLength = SOLVED.slice(0, -1)

    try {
      await solver.solve(badLength)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).issues).toEqual([{ kind: 'bad-length' }])
    }
  })
})
