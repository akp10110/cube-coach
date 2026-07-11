import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GATE_CONFIG,
  INITIAL_GATE_STATE,
  colorsMatch,
  describeGateState,
  hasChangedSubstantially,
  stickerDiffCount,
  tickGate,
} from '../../src/scan/captureGate'
import type { GateState } from '../../src/scan/captureGate'
import type { Face } from '../../src/core/types'

const WHITE_FACE: Face[] = ['U', 'U', 'U', 'U', 'U', 'U', 'U', 'U', 'U']
const RED_FACE: Face[] = ['R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R']
// Differs from WHITE_FACE in only 2 stickers (not a "substantial" change).
const WHITE_FACE_NOISY: Face[] = ['U', 'U', 'R', 'U', 'U', 'U', 'U', 'R', 'U']

describe('colorsMatch', () => {
  it('is false against null', () => {
    expect(colorsMatch(WHITE_FACE, null)).toBe(false)
  })
  it('is true for identical readings', () => {
    expect(colorsMatch(WHITE_FACE, [...WHITE_FACE])).toBe(true)
  })
  it('is false when even one sticker differs', () => {
    expect(colorsMatch(WHITE_FACE, WHITE_FACE_NOISY)).toBe(false)
  })
})

describe('stickerDiffCount / hasChangedSubstantially', () => {
  it('counts zero for identical readings', () => {
    expect(stickerDiffCount(WHITE_FACE, [...WHITE_FACE])).toBe(0)
  })
  it('counts differing stickers', () => {
    expect(stickerDiffCount(WHITE_FACE, WHITE_FACE_NOISY)).toBe(2)
  })
  it('is substantial when the center differs, even with few other diffs', () => {
    const centerFlipped = [...WHITE_FACE] as Face[]
    centerFlipped[4] = 'R'
    expect(hasChangedSubstantially(WHITE_FACE, centerFlipped)).toBe(true)
  })
  it('is not substantial for a same-center minor noise diff (< 5 stickers)', () => {
    expect(hasChangedSubstantially(WHITE_FACE, WHITE_FACE_NOISY)).toBe(false)
  })
  it('is substantial when 5+ stickers differ even with the same center', () => {
    const mostlyDifferent = ['R', 'R', 'R', 'R', 'U', 'R', 'R', 'R', 'R'] as Face[]
    expect(hasChangedSubstantially(WHITE_FACE, mostlyDifferent)).toBe(true)
  })
  it('is exactly the boundary at 5 differing stickers (>=5 counts)', () => {
    const fiveDiff = ['R', 'R', 'R', 'R', 'U', 'U', 'U', 'U', 'U'] as Face[]
    expect(stickerDiffCount(WHITE_FACE, fiveDiff)).toBe(4)
    // bump one more to reach exactly 5
    const exactlyFive = ['R', 'R', 'R', 'R', 'U', 'R', 'U', 'U', 'U'] as Face[]
    expect(stickerDiffCount(WHITE_FACE, exactlyFive)).toBe(5)
    expect(hasChangedSubstantially(WHITE_FACE, exactlyFive)).toBe(true)
  })
})

/** Drives the gate through N ticks spaced `stepMs` apart, all reporting the
 *  same `colors`, returning the final result. */
function holdSteady(
  state: GateState,
  colors: readonly Face[],
  startAt: number,
  ticks: number,
  stepMs = 200,
): { state: GateState; now: number; results: ReturnType<typeof tickGate>[] } {
  let s = state
  let now = startAt
  const results: ReturnType<typeof tickGate>[] = []
  for (let i = 0; i < ticks; i++) {
    const result = tickGate(s, colors, now, DEFAULT_GATE_CONFIG)
    results.push(result)
    s = result.state
    now += stepMs
  }
  return { state: s, now, results }
}

describe('tickGate: ARMED -> STABLE -> CAPTURED', () => {
  it('stays ARMED while classification is still shifting', () => {
    let state: GateState = INITIAL_GATE_STATE
    let result = tickGate(state, WHITE_FACE, 0)
    expect(result.state.phase).toBe('armed')
    state = result.state
    result = tickGate(state, RED_FACE, 200)
    expect(result.state.phase).toBe('armed')
  })

  it('enters STABLE once the same reading repeats on consecutive ticks', () => {
    let result = tickGate(INITIAL_GATE_STATE, WHITE_FACE, 0)
    result = tickGate(result.state, WHITE_FACE, 200)
    expect(result.state.phase).toBe('stable')
  })

  it('resets to ARMED if the reading changes mid-stability-window', () => {
    let result = tickGate(INITIAL_GATE_STATE, WHITE_FACE, 0)
    result = tickGate(result.state, WHITE_FACE, 200) // -> stable
    expect(result.state.phase).toBe('stable')
    result = tickGate(result.state, RED_FACE, 400) // changed -> armed again
    expect(result.state.phase).toBe('armed')
  })

  it('captures once STABLE has held for stableMs, with didCapture true on that tick', () => {
    let result = tickGate(INITIAL_GATE_STATE, WHITE_FACE, 0)
    result = tickGate(result.state, WHITE_FACE, 200) // stable since 200
    expect(result.didCapture).toBe(false)
    result = tickGate(result.state, WHITE_FACE, 900) // 700ms of stability — not yet
    expect(result.didCapture).toBe(false)
    expect(result.state.phase).toBe('stable')
    result = tickGate(result.state, WHITE_FACE, 1200) // 1000ms — threshold crossed
    expect(result.didCapture).toBe(true)
    expect(result.state).toEqual({ phase: 'captured', at: 1200, colors: WHITE_FACE })
  })
})

describe('tickGate: CAPTURED -> COOLDOWN -> ARMED (the bug fix)', () => {
  it('holds CAPTURED for freezeMs before moving to COOLDOWN', () => {
    const captured: GateState = { phase: 'captured', at: 1000, colors: WHITE_FACE }
    let result = tickGate(captured, WHITE_FACE, 1000 + DEFAULT_GATE_CONFIG.freezeMs - 1)
    expect(result.state.phase).toBe('captured')
    result = tickGate(captured, WHITE_FACE, 1000 + DEFAULT_GATE_CONFIG.freezeMs)
    expect(result.state.phase).toBe('cooldown')
  })

  it('same face held after capture must NOT recapture — no re-arm before cooldownMs elapses, even if unchanged', () => {
    let state: GateState = { phase: 'captured', at: 0, colors: WHITE_FACE }
    let now = 0
    // Advance in small steps, holding the SAME face the whole time, well
    // past the old ~1s stability window that used to re-trigger a capture.
    for (let i = 0; i < 20; i++) {
      now += 200
      const result = tickGate(state, WHITE_FACE, now, DEFAULT_GATE_CONFIG)
      state = result.state
      expect(result.didCapture).toBe(false)
    }
    expect(now).toBeGreaterThan(DEFAULT_GATE_CONFIG.cooldownMs)
    expect(state.phase).toBe('cooldown')
  })

  it('does NOT re-arm after cooldownMs if the face is still unchanged', () => {
    const cooldown: GateState = { phase: 'cooldown', capturedAt: 0, colors: WHITE_FACE }
    const result = tickGate(cooldown, WHITE_FACE, DEFAULT_GATE_CONFIG.cooldownMs + 500)
    expect(result.state.phase).toBe('cooldown')
    expect(result.didCapture).toBe(false)
  })

  it('does NOT re-arm on a substantially different face before cooldownMs elapses', () => {
    const cooldown: GateState = { phase: 'cooldown', capturedAt: 0, colors: WHITE_FACE }
    const result = tickGate(cooldown, RED_FACE, DEFAULT_GATE_CONFIG.cooldownMs - 1)
    expect(result.state.phase).toBe('cooldown')
  })

  it('re-arms to ARMED once BOTH cooldownMs has elapsed AND the reading changed substantially', () => {
    const cooldown: GateState = { phase: 'cooldown', capturedAt: 0, colors: WHITE_FACE }
    const result = tickGate(cooldown, RED_FACE, DEFAULT_GATE_CONFIG.cooldownMs)
    expect(result.state).toEqual({ phase: 'armed', lastColors: RED_FACE })
  })

  it('re-arming lands in ARMED, not straight into STABLE — a fresh stability window is required', () => {
    const cooldown: GateState = { phase: 'cooldown', capturedAt: 0, colors: WHITE_FACE }
    const rearmed = tickGate(cooldown, RED_FACE, DEFAULT_GATE_CONFIG.cooldownMs)
    expect(rearmed.state.phase).toBe('armed')
    // Full end-to-end: after re-arming it still takes a fresh ~1s hold to recapture.
    const after = holdSteady(rearmed.state, RED_FACE, DEFAULT_GATE_CONFIG.cooldownMs + 200, 6)
    const captured = after.results.some((r) => r.didCapture)
    expect(captured).toBe(true)
  })
})

describe('describeGateState', () => {
  it('labels ARMED', () => {
    expect(describeGateState({ phase: 'armed', lastColors: null }, 0)).toBe('ARMED')
  })
  it('labels STABLE with elapsed seconds', () => {
    expect(describeGateState({ phase: 'stable', since: 400, lastColors: WHITE_FACE }, 1000)).toBe(
      'STABLE 0.6s',
    )
  })
  it('labels CAPTURED', () => {
    expect(describeGateState({ phase: 'captured', at: 0, colors: WHITE_FACE }, 0)).toBe('CAPTURED')
  })
  it('labels COOLDOWN', () => {
    expect(describeGateState({ phase: 'cooldown', capturedAt: 0, colors: WHITE_FACE }, 500)).toBe(
      'COOLDOWN',
    )
  })
})
