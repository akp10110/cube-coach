import type { Face } from '../core/types'

/** Cross-shaped grid position for each face (design-mocks.html screens 3/5):
 *  U above F, D below F, L/B/R in a row either side of F. Shared by the
 *  manual editor (PR-10) and the scan progress mini-map (PR-14). */
export const CROSS_LAYOUT: Readonly<Record<Face, { column: number; row: number }>> = {
  U: { column: 2, row: 1 },
  L: { column: 1, row: 2 },
  F: { column: 2, row: 2 },
  R: { column: 3, row: 2 },
  B: { column: 4, row: 2 },
  D: { column: 2, row: 3 },
}
