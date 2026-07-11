import type { FaceletString, Move, SolutionPhase } from '../../types'

/**
 * Phase-6 stage architecture (tasks.md): one module per stage, each
 * exporting its own `solveStage`/`isStageComplete` pair (the pure-function
 * surface a stage PR is judged against), plus a `Stage` descriptor bundling
 * them with the copy the orchestrator threads into `Solution.phases`.
 */

export interface StageResult {
  moves: Move[]
}

export interface Stage {
  id: SolutionPhase['id']
  title: string
  teaching: string
  isStageComplete(state: FaceletString): boolean
  solveStage(state: FaceletString): StageResult
}
