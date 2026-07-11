import { applyMoves } from '../../moves'
import type { FaceletString, Move, Solution, SolutionPhase } from '../../types'
import type { Stage } from './stage'
import { whiteCrossStage } from './whiteCross'

/** Ordered registry of implemented LBL stages (tasks.md Phase 6). Grows as
 *  PR-17..20 land; the orchestrator and the property-test harness both
 *  iterate this list rather than hardcoding a stage count. */
export const LBL_STAGES: readonly Stage[] = [whiteCrossStage]

/** Runs every implemented stage in order, concatenating moves into one
 *  `Solution` with one `SolutionPhase` per stage. Each stage's `solveStage`
 *  receives the state left behind by the previous stage. */
export function solveLbl(state: FaceletString): Solution {
  let current = state
  const phases: SolutionPhase[] = []
  const moves: Move[] = []

  for (const stage of LBL_STAGES) {
    const { moves: stageMoves } = stage.solveStage(current)
    current = applyMoves(current, stageMoves)
    phases.push({ id: stage.id, title: stage.title, teaching: stage.teaching, moves: stageMoves })
    moves.push(...stageMoves)
  }

  return { moves, phases }
}
