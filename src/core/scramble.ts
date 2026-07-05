import type { Move } from './types'

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'] as const
type BaseFace = (typeof FACES)[number]

const SUFFIXES = ['', "'", '2'] as const

/** Opposite-face pairs share an axis; three consecutive moves on the same
 *  axis (e.g. `L R L`) commute into a shorter equivalent sequence, so they're
 *  excluded from generation even though no single pair repeats a face. */
const AXIS: Readonly<Record<BaseFace, 'UD' | 'LR' | 'FB'>> = {
  U: 'UD',
  D: 'UD',
  L: 'LR',
  R: 'LR',
  F: 'FB',
  B: 'FB',
}

function faceOfMove(m: Move): BaseFace {
  return m[0] as BaseFace
}

/** Random scramble: no move repeats the previous move's face (this also
 *  rules out trivial `A A'` pairs, since those share a face), and no three
 *  consecutive moves share an axis (e.g. `L R L`). */
export function randomScramble(length = 25): Move[] {
  const moves: Move[] = []

  while (moves.length < length) {
    const face = FACES[Math.floor(Math.random() * FACES.length)]
    const prev = moves[moves.length - 1]
    if (prev !== undefined && faceOfMove(prev) === face) continue

    const prev2 = moves[moves.length - 2]
    if (
      prev !== undefined &&
      prev2 !== undefined &&
      AXIS[face] === AXIS[faceOfMove(prev)] &&
      AXIS[face] === AXIS[faceOfMove(prev2)]
    ) {
      continue
    }

    const suffix = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)]
    moves.push(`${face}${suffix}` as Move)
  }

  return moves
}
