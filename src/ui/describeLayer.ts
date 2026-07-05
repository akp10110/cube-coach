import type { Face, Move } from '../core/types'
import { FACE_COLOR_NAMES } from '../render/colors'

/** Solve-screen move card copy for a single move (PR-08 contract): plain
 *  language over notation, matching section 9's "color-anchored copy" rule —
 *  centers never move, so the moving face's center color reliably names the
 *  side on the user's physical cube. */
export interface LayerDescription {
  colorFace: Face
  headline: string
  detail: string
}

export function describeLayer(move: Move): LayerDescription {
  const colorFace = move[0] as Face
  const turnAmount = move.endsWith('2') ? 'half turn' : 'quarter turn'

  return {
    colorFace,
    headline: `Turn the ${FACE_COLOR_NAMES[colorFace]} side`,
    detail: `Follow the arrow — just one ${turnAmount}`,
  }
}
