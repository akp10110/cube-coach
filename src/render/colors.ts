import type { Face } from '../core/types'

/**
 * Single source of truth for sticker colors (D7/section 9 design tokens).
 * Reused by the 3D renderer, the 2D unfolded editor (PR-10), and the scan
 * preview overlay (PR-12+) so all three views agree on what "red" means.
 */
export const STICKER_COLORS: Readonly<Record<Face, string>> = {
  U: '#F5F5F0',
  D: '#FFD500',
  F: '#009B48',
  B: '#0046AD',
  R: '#B71234',
  L: '#FF5800',
}

/** Plain-language name for each face's fixed center color — centers never
 *  move, so these reliably name a side on the user's physical cube. Read
 *  by `describeLayer` (PR-08) for the solve screen's move card copy. */
export const FACE_COLOR_NAMES: Readonly<Record<Face, string>> = {
  U: 'white',
  D: 'yellow',
  F: 'green',
  B: 'blue',
  R: 'red',
  L: 'orange',
}

/** Body color for the plastic faces not covered by a sticker. */
export const CUBE_BODY_COLOR = '#0A0A0A'

/** The one interface accent (section 9 design tokens) — never a sticker
 *  color, so a rotation cue can never be mistaken for cube state. */
export const ACCENT_COLOR = '#8B7CF6'

/** Opacity non-moving stickers dim to while a move cue is shown (section 9,
 *  rule under "Follow mode"). */
export const CUE_DIM_OPACITY = 0.22

/** Amber outline color for a low-confidence scan sticker (section 9 rule 1's
 *  sole exception to "never use a sticker color for UI meaning") — matches
 *  the 2D editor's `.sticker-flagged`/`.scan-fix-cell.is-blocking` amber
 *  exactly, so the 3D scan preview (PR: live 3D cube scan) agrees with it. */
export const LOW_CONFIDENCE_COLOR = '#ef9f27'
