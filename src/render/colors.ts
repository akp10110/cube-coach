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

/** Body color for the plastic faces not covered by a sticker. */
export const CUBE_BODY_COLOR = '#0A0A0A'
