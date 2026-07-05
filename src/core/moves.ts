import type { FaceletString, Move } from './types'

/**
 * Permutation model: for a move's perm[54], `next[i] = prev[perm[i]]` — i.e.
 * perm[i] names the OLD position whose sticker ends up at NEW position i.
 *
 * Coordinate system used to derive the six base (quarter-turn) permutations
 * by hand: cube center at origin, x:-1=L/+1=R, y:-1=D/+1=U, z:-1=B/+1=F.
 * Each face's 9 facelets are indexed 0..8 row-major, top-left to
 * bottom-right, viewed head-on from outside the cube (D3). Working out each
 * face's own "up/right/bottom/left" in terms of the other four faces gives
 * the unfolded net below (this is the layout `faceOf`/`faceletAt` in
 * facelets.ts already assumes):
 *
 *                +--------------+
 *                | U0  U1  U2   |   (U's far edge, row 0, borders B)
 *                | U3  U4  U5   |
 *                | U6  U7  U8   |   (U's near edge, row 2, borders F)
 * +--------------+--------------+--------------+--------------+
 * | L0  L1  L2   | F0  F1  F2   | R0  R1  R2   | B0  B1  B2   |
 * | L3  L4  L5   | F3  F4  F5   | R3  R4  R5   | B3  B4  B5   |
 * | L6  L7  L8   | F6  F7  F8   | R6  R7  R8   | B6  B7  B8   |
 * +--------------+--------------+--------------+--------------+
 *                | D0  D1  D2   |   (D's edge bordering F)
 *                | D3  D4  D5   |
 *                | D6  D7  D8   |   (D's edge bordering B)
 *                +--------------+
 *
 * A clockwise turn (viewed from outside the turning face) always cycles
 * that face's four neighboring rows/columns in the order
 * top → right → bottom → left → top, where "up/right/bottom/left" is
 * specific to the turning face's own head-on view:
 *   U (up=B,right=R,bottom=F,left=L):  F → L → B → R → F
 *   D (up=F,right=R,bottom=B,left=L):  F → R → B → L → F
 *   F (up=U,right=R,bottom=D,left=L):  U → R → D → L → U
 *   B (up=U,right=L,bottom=D,left=R):  U → L → D → R → U
 *   R (up=U,right=B,bottom=D,left=F):  U → B → D → F → U
 *   L (up=U,right=F,bottom=D,left=B):  U → F → D → B → U
 * Each cycle was verified against the corresponding 3D rotation of the
 * turning layer (90° about its face axis) and checked both structurally
 * (bijection, 4th power = identity) and visually (resulting facelet string
 * on a solved cube matches the cycle above) before being hardcoded here.
 *
 * `'` (prime) is 3 applications of the base permutation, `2` is 2
 * applications — composed once at module load, not hand-derived separately.
 */

const QUARTER: Record<'U' | 'D' | 'L' | 'R' | 'F' | 'B', readonly number[]> = {
  U: [
    6, 3, 0, 7, 4, 1, 8, 5, 2, 45, 46, 47, 12, 13, 14, 15, 16, 17, 9, 10, 11, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 18, 19, 20, 39, 40, 41, 42, 43, 44, 36, 37, 38, 48, 49,
    50, 51, 52, 53,
  ],
  D: [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 24, 25, 26, 18, 19, 20, 21, 22, 23, 42, 43,
    44, 33, 30, 27, 34, 31, 28, 35, 32, 29, 36, 37, 38, 39, 40, 41, 51, 52, 53, 45, 46, 47, 48, 49,
    50, 15, 16, 17,
  ],
  L: [
    53, 1, 2, 50, 4, 5, 47, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 0, 19, 20, 3, 22, 23, 6, 25,
    26, 18, 28, 29, 21, 31, 32, 24, 34, 35, 42, 39, 36, 43, 40, 37, 44, 41, 38, 45, 46, 33, 48, 49,
    30, 51, 52, 27,
  ],
  R: [
    0, 1, 20, 3, 4, 23, 6, 7, 26, 15, 12, 9, 16, 13, 10, 17, 14, 11, 18, 19, 29, 21, 22, 32, 24, 25,
    35, 27, 28, 51, 30, 31, 48, 33, 34, 45, 36, 37, 38, 39, 40, 41, 42, 43, 44, 8, 46, 47, 5, 49,
    50, 2, 52, 53,
  ],
  F: [
    0, 1, 2, 3, 4, 5, 44, 41, 38, 6, 10, 11, 7, 13, 14, 8, 16, 17, 24, 21, 18, 25, 22, 19, 26, 23,
    20, 15, 12, 9, 30, 31, 32, 33, 34, 35, 36, 37, 27, 39, 40, 28, 42, 43, 29, 45, 46, 47, 48, 49,
    50, 51, 52, 53,
  ],
  B: [
    11, 14, 17, 3, 4, 5, 6, 7, 8, 9, 10, 35, 12, 13, 34, 15, 16, 33, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31, 32, 36, 39, 42, 2, 37, 38, 1, 40, 41, 0, 43, 44, 51, 48, 45, 52, 49, 46,
    53, 50, 47,
  ],
}

function power(perm: readonly number[], times: number): number[] {
  let result: number[] = [...perm.keys()]
  for (let t = 0; t < times; t++) {
    result = result.map((i) => perm[i])
  }
  return result
}

function buildMovePerms(): Record<Move, readonly number[]> {
  const perms = {} as Record<Move, readonly number[]>
  for (const face of ['U', 'D', 'L', 'R', 'F', 'B'] as const) {
    const base = QUARTER[face]
    perms[face] = base
    perms[`${face}2`] = power(base, 2)
    perms[`${face}'`] = power(base, 3)
  }
  return perms
}

const MOVE_PERMS = buildMovePerms()

export function applyMove(s: FaceletString, m: Move): FaceletString {
  const perm = MOVE_PERMS[m]
  let result = ''
  for (let i = 0; i < 54; i++) {
    result += s[perm[i]]
  }
  return result
}

export function applyMoves(s: FaceletString, ms: Move[]): FaceletString {
  return ms.reduce(applyMove, s)
}

export function invertMove(m: Move): Move {
  if (m.endsWith('2')) return m
  if (m.endsWith("'")) return m.slice(0, -1) as Move
  return `${m}'` as Move
}

export function invertMoves(ms: Move[]): Move[] {
  return [...ms].reverse().map(invertMove)
}

const MOVE_PATTERN = /^[UDLRFB]('|2)?$/

export function parseMoves(notation: string): Move[] {
  const tokens = notation
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  return tokens.map((token) => {
    if (!MOVE_PATTERN.test(token)) {
      throw new Error(`invalid move: "${token}"`)
    }
    return token as Move
  })
}

export function formatMoves(ms: Move[]): string {
  return ms.join(' ')
}
