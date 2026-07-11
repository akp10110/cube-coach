import type { Face } from '../core/types'

/**
 * Pure capture-gate state machine (tasks.md bug fix: auto-capture was
 * over-firing — a single held face got captured six times over because the
 * only condition for firing was "classification held steady for ~1s," with
 * nothing stopping that same steady reading from re-triggering the instant
 * it was captured). Cycle: ARMED -> STABLE(t) -> CAPTURED -> COOLDOWN ->
 * ARMED. Re-arming out of COOLDOWN requires BOTH a minimum elapsed time AND
 * a substantially different reading — the second condition is what actually
 * fixes the bug: without it, a user who hasn't moved the cube yet still has
 * a stable, unchanged reading the moment cooldown's timer expires, and would
 * immediately re-capture the same physical face again.
 *
 * Kept free of React/DOM so it's a plain reducer: `tickGate` takes the
 * previous state, the latest classification (or `null` if none yet this
 * frame), and a timestamp, and returns the next state plus whether this
 * tick should finalize a capture. The caller (`useFaceCapture`) owns
 * storage, duplicate-center checks, and instruction copy — this module only
 * decides *when*.
 */

export interface GateConfig {
  /** How long classification must hold steady before auto-capturing. */
  stableMs: number
  /** How long CAPTURED is held (the grid-freeze feedback beat) before COOLDOWN. */
  freezeMs: number
  /** Minimum time after capture before the gate may re-arm. */
  cooldownMs: number
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  stableMs: 1000,
  freezeMs: 400,
  cooldownMs: 1500,
}

export type GateState =
  | { phase: 'armed'; lastColors: readonly Face[] | null }
  | { phase: 'stable'; since: number; lastColors: readonly Face[] }
  | { phase: 'captured'; at: number; colors: readonly Face[] }
  | { phase: 'cooldown'; capturedAt: number; colors: readonly Face[] }

export const INITIAL_GATE_STATE: GateState = { phase: 'armed', lastColors: null }

/** Whether two per-sticker color readings are identical, sticker by sticker. */
export function colorsMatch(a: readonly Face[], b: readonly Face[] | null): boolean {
  return b !== null && b.length === a.length && a.every((color, i) => color === b[i])
}

/** Count of stickers that differ between two readings (same length assumed). */
export function stickerDiffCount(a: readonly Face[], b: readonly Face[]): number {
  return a.reduce((count, color, i) => count + (color === b[i] ? 0 : 1), 0)
}

/** Whether `next` counts as a genuinely different face from `captured` —
 *  a different center color (index 4), or 5+ of the 9 stickers different. */
export function hasChangedSubstantially(captured: readonly Face[], next: readonly Face[]): boolean {
  return captured[4] !== next[4] || stickerDiffCount(captured, next) >= 5
}

export interface GateResult {
  state: GateState
  /** True on exactly the tick a stable reading crosses the capture
   *  threshold — the caller should finalize `state.colors` (only present
   *  on a 'captured' state) right then. */
  didCapture: boolean
}

export function tickGate(
  state: GateState,
  colors: readonly Face[] | null,
  now: number,
  config: GateConfig = DEFAULT_GATE_CONFIG,
): GateResult {
  if (state.phase === 'captured') {
    if (now - state.at < config.freezeMs) return { state, didCapture: false }
    return {
      state: { phase: 'cooldown', capturedAt: state.at, colors: state.colors },
      didCapture: false,
    }
  }

  if (state.phase === 'cooldown') {
    if (now - state.capturedAt < config.cooldownMs) return { state, didCapture: false }
    if (colors === null || !hasChangedSubstantially(state.colors, colors)) {
      return { state, didCapture: false }
    }
    // Re-armed: land in ARMED with this reading as the new baseline, not
    // straight into STABLE — a fresh ~1s stability window must still elapse
    // (tasks.md: "Only then does a fresh ~1s stability window begin").
    return { state: { phase: 'armed', lastColors: colors }, didCapture: false }
  }

  if (colors === null) {
    return { state: { phase: 'armed', lastColors: null }, didCapture: false }
  }

  if (state.phase === 'armed') {
    if (colorsMatch(colors, state.lastColors)) {
      return { state: { phase: 'stable', since: now, lastColors: colors }, didCapture: false }
    }
    return { state: { phase: 'armed', lastColors: colors }, didCapture: false }
  }

  // state.phase === 'stable'
  if (!colorsMatch(colors, state.lastColors)) {
    return { state: { phase: 'armed', lastColors: colors }, didCapture: false }
  }
  if (now - state.since >= config.stableMs) {
    return { state: { phase: 'captured', at: now, colors }, didCapture: true }
  }
  return { state: { phase: 'stable', since: state.since, lastColors: colors }, didCapture: false }
}

/** Plain-text label for the `/dev` capture-gate overlay: "ARMED",
 *  "STABLE 0.6s", "CAPTURED", "COOLDOWN". */
export function describeGateState(state: GateState, now: number): string {
  switch (state.phase) {
    case 'armed':
      return 'ARMED'
    case 'stable':
      return `STABLE ${((now - state.since) / 1000).toFixed(1)}s`
    case 'captured':
      return 'CAPTURED'
    case 'cooldown':
      return 'COOLDOWN'
  }
}
