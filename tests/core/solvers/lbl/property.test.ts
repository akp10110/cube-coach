import { describe, expect, it } from 'vitest'
import { applyMoves } from '../../../../src/core/moves'
import { randomScramble } from '../../../../src/core/scramble'
import { isSolved } from '../../../../src/core/validate'
import { SOLVED } from '../../../../src/core/types'
import { LBL_STAGES, solveLbl } from '../../../../src/core/solvers/lbl/orchestrator'

// tasks.md Phase 6: the full method has 7 stages (white-cross, white-corners,
// middle-edges, yellow-cross, yellow-edges, corner-position, corner-orient).
// Once LBL_STAGES reaches this length (PR-20), this test also asserts
// isSolved() on the final state.
const TOTAL_STAGES = 7

describe('LBL property test (tasks.md PR-16..20, grows as stages land)', () => {
  it('every implemented stage reaches its completion predicate within a 300-move budget, over 1000 random scrambles', () => {
    for (let i = 0; i < 1000; i++) {
      const scrambled = applyMoves(SOLVED, randomScramble())
      const solution = solveLbl(scrambled)

      expect(solution.moves.length).toBeLessThan(300)
      expect(solution.phases?.map((p) => p.id)).toEqual(LBL_STAGES.map((s) => s.id))

      let state = scrambled
      for (const stage of LBL_STAGES) {
        const phase = solution.phases?.find((p) => p.id === stage.id)
        state = applyMoves(state, phase?.moves ?? [])
        expect(stage.isStageComplete(state)).toBe(true)
      }

      if (LBL_STAGES.length === TOTAL_STAGES) {
        expect(isSolved(state)).toBe(true)
      }
    }
  })
})
