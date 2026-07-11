import { applyMoves } from '../../moves'
import { EDGE_NAMES, decodeEdges } from '../../cubies'
import type { EdgeName } from '../../cubies'
import type { Face, FaceletString, Move } from '../../types'
import type { Stage, StageResult } from './stage'

/**
 * White cross (tasks.md PR-16): bring the four white edges — colors
 * {U,F}/{U,R}/{U,B}/{U,L}, named `UF`/`UR`/`UB`/`UL` per `cubies.ts` — home
 * with white facing up (orientation 0), aligned to their side centers.
 *
 * Case analysis + setup moves, no BFS (Phase-6 architecture note). Each
 * target piece is repositioned by locating its current slot (U layer / D
 * layer / equatorial) and trying a small, fixed set of candidate move
 * sequences for that slot kind, picking whichever one — simulated via the
 * already-tested `applyMove` rather than hand-derived turn directions —
 * actually seats the piece. Candidates that would knock an already-placed
 * cross edge out of position are filtered out first; the outer round loop
 * simply retries anything that slips through, so correctness of the final
 * result never depends on getting every candidate's safety analysis right
 * by hand (the `[O]` risk tasks.md flags for this task).
 */

const TARGET_SLOTS: readonly EdgeName[] = ['UF', 'UR', 'UB', 'UL']
const U_SLOTS: ReadonlySet<EdgeName> = new Set(['UF', 'UR', 'UB', 'UL'])
const D_SLOTS: ReadonlySet<EdgeName> = new Set(['DF', 'DR', 'DB', 'DL'])
const EQ_SLOTS: ReadonlySet<EdgeName> = new Set(['FL', 'FR', 'BL', 'BR'])

function targetFaceOf(slot: EdgeName): Face {
  return slot[1] as Face
}

function locate(state: FaceletString, piece: EdgeName): { slot: EdgeName; orientation: 0 | 1 } {
  const edges = decodeEdges(state)
  const index = edges.findIndex((e) => e.name === piece)
  return { slot: EDGE_NAMES[index], orientation: edges[index].orientation }
}

function isPlaced(state: FaceletString, piece: EdgeName): boolean {
  const { slot, orientation } = locate(state, piece)
  return slot === piece && orientation === 0
}

export function isStageComplete(state: FaceletString): boolean {
  return TARGET_SLOTS.every((slot) => isPlaced(state, slot))
}

function doubleTurn(face: Face): Move {
  return `${face}2` as Move
}

/** Picks the first candidate that reaches `goal` while keeping every piece
 *  in `mustStayPlaced` correctly placed; falls back to the first candidate
 *  reaching `goal` at all if none also satisfy the safety filter. */
function pickCandidate(
  state: FaceletString,
  candidates: readonly Move[][],
  goal: (state: FaceletString) => boolean,
  mustStayPlaced: readonly EdgeName[],
): Move[] {
  let fallback: Move[] | undefined
  for (const candidate of candidates) {
    const next = applyMoves(state, candidate)
    if (!goal(next)) continue
    if (fallback === undefined) fallback = candidate
    if (mustStayPlaced.every((p) => isPlaced(next, p))) return candidate
  }
  return fallback ?? []
}

function stepFor(
  state: FaceletString,
  piece: EdgeName,
  alreadyPlaced: readonly EdgeName[],
): Move[] {
  const { slot } = locate(state, piece)

  if (U_SLOTS.has(slot)) {
    // Any U-layer slot's bordering-face double turn swaps it with its D
    // counterpart only — it never touches a *different* U slot — so this
    // can never disturb an already-placed cross edge sitting elsewhere.
    return [doubleTurn(targetFaceOf(slot))]
  }

  if (D_SLOTS.has(slot)) {
    // A double turn of a D-slot's own bordering face swaps it with its U
    // counterpart directly (only correct when the white sticker already
    // faces down there). When white instead faces out to the side, no turn
    // of a single face can insert it in one step (a quarter turn only
    // cycles a D-slot into an *equatorial* slot, never straight to U — see
    // whiteCross design note); route it there first via the D-slot's own
    // bordering face, then insert with the target face's turn. Trying both
    // directions of each and letting `pickCandidate` simulate/verify avoids
    // hand-deriving which one is correct.
    const targetFace = targetFaceOf(piece)
    const dAligns: Move[][] = [[], ['D'], ['D2'], ["D'"]]
    const candidates: Move[][] = []
    for (const align of dAligns) {
      const aligned = applyMoves(state, align)
      const alignedSlot = locate(aligned, piece).slot
      if (!D_SLOTS.has(alignedSlot)) continue
      const bordering = targetFaceOf(alignedSlot)
      if (bordering === targetFace) {
        candidates.push([...align, doubleTurn(targetFace)])
        candidates.push([...align, targetFace])
        candidates.push([...align, `${targetFace}'` as Move])
      } else {
        candidates.push([...align, bordering, `${targetFace}'` as Move])
        candidates.push([...align, `${bordering}'` as Move, targetFace])
      }
    }
    return pickCandidate(state, candidates, (s) => isPlaced(s, piece), alreadyPlaced)
  }

  // Equatorial (FL/FR/BL/BR): bordered by exactly two faces; a single
  // quarter turn of either always moves the piece to a U or D slot,
  // depending on direction. Prefer landing in D specifically (the D-layer
  // branch above always finishes it from there); landing in some U slot
  // other than home is possible but unstable — it can round-trip back to
  // equatorial via a *different* piece's own fix, cycling forever within
  // the round budget (empirically hit during property testing).
  const faceA = slot[0] as Face
  const faceB = slot[1] as Face
  const candidates: Move[][] = [[faceA], [`${faceA}'` as Move], [faceB], [`${faceB}'` as Move]]
  const toDLayer = pickCandidate(
    state,
    candidates,
    (s) => D_SLOTS.has(locate(s, piece).slot),
    alreadyPlaced,
  )
  if (toDLayer.length > 0) return toDLayer
  return pickCandidate(
    state,
    candidates,
    (s) => !EQ_SLOTS.has(locate(s, piece).slot),
    alreadyPlaced,
  )
}

/** Generous but finite caps: each not-yet-placed piece makes real progress
 *  every step (ejects, aligns, or seats), so these are never expected to
 *  bind — they only guard against an unforeseen candidate-selection gap.
 *  Pieces are fully resolved one at a time (not round-robin): interleaving
 *  single steps across multiple still-unplaced pieces let two of them
 *  repeatedly re-displace each other through a shared bottleneck slot (e.g.
 *  both routing through DF to reach the D layer) — a stable cycle no
 *  round budget breaks, hit empirically during property testing. Resolving
 *  one piece to completion before starting the next avoids that; the outer
 *  pass loop remains only as a safety net for the rare case where a later
 *  piece's fallback candidate (no safe option existed) nudges an earlier,
 *  already-placed one. */
const MAX_PASSES = 4
const MAX_STEPS_PER_PIECE = 6

export function solveStage(state: FaceletString): StageResult {
  let current = state
  const moves: Move[] = []

  for (let pass = 0; pass < MAX_PASSES && !isStageComplete(current); pass++) {
    for (const piece of TARGET_SLOTS) {
      for (let step = 0; step < MAX_STEPS_PER_PIECE && !isPlaced(current, piece); step++) {
        const alreadyPlaced = TARGET_SLOTS.filter((p) => p !== piece && isPlaced(current, p))
        const nextMoves = stepFor(current, piece, alreadyPlaced)
        if (nextMoves.length === 0) break
        current = applyMoves(current, nextMoves)
        moves.push(...nextMoves)
      }
    }
  }

  return { moves }
}

export const whiteCrossStage: Stage = {
  id: 'white-cross',
  title: 'Build the white cross',
  teaching: 'Get all four white edges on top, lined up with their matching side colors.',
  isStageComplete,
  solveStage,
}
