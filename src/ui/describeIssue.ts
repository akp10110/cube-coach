import type { ValidationIssue } from '../core/types'
import { FACE_COLOR_NAMES } from '../render/colors'

/** Friendly, plain-language copy for each `ValidationIssue` kind (PR-10
 *  scope) — shown in the manual editor's validation banner instead of the
 *  raw internal `kind`/`detail`. The `corner-orientation` text names
 *  "highlighted corners" ahead of PR-11, which adds the actual highlighting. */
export function describeIssue(issue: ValidationIssue): string {
  switch (issue.kind) {
    case 'bad-length':
      return "That doesn't look like a full cube yet — every sticker needs a color."
    case 'bad-color-count':
      return `You've used ${FACE_COLOR_NAMES[issue.face]} ${issue.count} times — every color should appear exactly 9 times.`
    case 'bad-centers':
      return 'The center stickers should show all six colors, one per side.'
    case 'invalid-piece':
      return "One piece has a color combination that doesn't exist on a real cube."
    case 'edge-orientation':
      return 'One edge looks flipped — a piece is turned the wrong way.'
    case 'corner-orientation':
      return 'One corner appears twisted. Check the highlighted corners.'
    case 'permutation-parity':
      return "Two pieces look swapped — that combination isn't possible on a real cube."
  }
}
