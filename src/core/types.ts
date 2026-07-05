/** The six faces, in canonical URFDLB order. Also used as color identity:
 *  a facelet's letter = the face whose CENTER shares its color. */
export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B'

/** 54-char string, faces in URFDLB order, stickers in row-major order per
 *  face (1..9 reading top-left → bottom-right when the face is viewed
 *  head-on with standard orientation). Matches cubejs. */
export type FaceletString = string

export const SOLVED: FaceletString = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB'

export type Move =
  | 'U'
  | "U'"
  | 'U2'
  | 'D'
  | "D'"
  | 'D2'
  | 'L'
  | "L'"
  | 'L2'
  | 'R'
  | "R'"
  | 'R2'
  | 'F'
  | "F'"
  | 'F2'
  | 'B'
  | "B'"
  | 'B2'

export interface Solution {
  moves: Move[]
  /** Present for LBL; absent/empty for Kociemba. Phases partition `moves`
   *  in order: concat(phases[i].moves) === moves. */
  phases?: SolutionPhase[]
}

export interface SolutionPhase {
  id:
    | 'white-cross'
    | 'white-corners'
    | 'middle-edges'
    | 'yellow-cross'
    | 'yellow-edges'
    | 'corner-position'
    | 'corner-orient'
  title: string // e.g. "Build the white cross"
  teaching: string // one or two sentences, plain language
  moves: Move[]
}

export interface Solver {
  readonly id: 'kociemba' | 'lbl'
  /** Must be called once before solve(); may take seconds (table init). */
  init(): Promise<void>
  /** Rejects with ValidationError if state is unsolvable. */
  solve(state: FaceletString): Promise<Solution>
}

export type ValidationIssue =
  | { kind: 'bad-length' }
  | { kind: 'bad-color-count'; face: Face; count: number } // must be 9
  | { kind: 'bad-centers' } // centers not a permutation of URFDLB
  | { kind: 'invalid-piece'; detail: string } // impossible sticker combo on a piece
  | { kind: 'edge-orientation' } // flipped edge
  | { kind: 'corner-orientation' } // twisted corner
  | { kind: 'permutation-parity' } // two pieces swapped

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

/** One scanned face. `colors[4]` is the center and defines which Face this is. */
export interface FaceScan {
  colors: Face[] // length 9, row-major, in camera orientation
  confidence: number[] // length 9, 0..1 per sticker
}

export interface ScanSession {
  faces: Partial<Record<Face, FaceScan>>
  /** HSV centroids measured from the six centers; set once all centers seen. */
  calibration?: Record<Face, { h: number; s: number; v: number }>
}

/** App-level solve session used by the guided flow + checkpoint loop. */
export interface SolveSession {
  initial: FaceletString
  solverId: Solver['id']
  solution: Solution
  /** Index into solution.moves of the next move the USER has not yet done. */
  cursor: number
  /** expectedState = initial with moves[0..cursor) applied. Recompute, don't store. */
}
