import { describe, expect, it } from 'vitest'
import {
  backStep,
  canStepBack,
  canStepForward,
  enqueueMoves,
  forwardStep,
  initialQueueState,
  type QueueState,
} from '../../src/render/animator'
import type { Move } from '../../src/core/types'

describe('QueueState (pure queue/cursor logic)', () => {
  it('starts empty with cursor 0', () => {
    const state = initialQueueState()
    expect(state.moves).toEqual([])
    expect(state.cursor).toBe(0)
    expect(canStepForward(state)).toBe(false)
    expect(canStepBack(state)).toBe(false)
  })

  it('enqueue appends without disturbing the cursor', () => {
    let state = initialQueueState()
    state = enqueueMoves(state, ['U', 'R'])
    expect(state.moves).toEqual(['U', 'R'])
    expect(state.cursor).toBe(0)
    state = enqueueMoves(state, ["F'"])
    expect(state.moves).toEqual(['U', 'R', "F'"])
    expect(state.cursor).toBe(0)
  })

  it('forwardStep plays moves in order and advances the cursor', () => {
    let state = enqueueMoves(initialQueueState(), ['U', 'R', "F'"] as Move[])

    const step1 = forwardStep(state)
    expect(step1.move).toBe('U')
    expect(step1.state.cursor).toBe(1)
    state = step1.state

    const step2 = forwardStep(state)
    expect(step2.move).toBe('R')
    expect(step2.state.cursor).toBe(2)
    state = step2.state

    const step3 = forwardStep(state)
    expect(step3.move).toBe("F'")
    expect(step3.state.cursor).toBe(3)
    state = step3.state

    expect(canStepForward(state)).toBe(false)
    expect(() => forwardStep(state)).toThrow()
  })

  it('backStep plays the inverse of the previous forward move and retreats the cursor', () => {
    let state: QueueState = { moves: ['U', 'R', "F'"] as Move[], cursor: 3 }

    const step1 = backStep(state)
    expect(step1.move).toBe('F')
    expect(step1.state.cursor).toBe(2)
    state = step1.state

    const step2 = backStep(state)
    expect(step2.move).toBe("R'")
    expect(step2.state.cursor).toBe(1)
    state = step2.state

    const step3 = backStep(state)
    expect(step3.move).toBe("U'")
    expect(step3.state.cursor).toBe(0)
    state = step3.state

    expect(canStepBack(state)).toBe(false)
    expect(() => backStep(state)).toThrow()
  })

  it('supports arbitrary interleaved forward/back sequences', () => {
    let state = enqueueMoves(initialQueueState(), ['U', 'D2', "L'", 'R'] as Move[])

    state = forwardStep(state).state // played U, cursor 1
    state = forwardStep(state).state // played D2, cursor 2
    const back = backStep(state) // undo D2
    expect(back.move).toBe('D2')
    state = back.state // cursor 1
    expect(state.cursor).toBe(1)

    const replay = forwardStep(state) // re-play D2 (cursor was at 1, moves[1] = D2)
    expect(replay.move).toBe('D2')
    state = replay.state // cursor 2

    state = forwardStep(state).state // played L', cursor 3
    state = forwardStep(state).state // played R, cursor 4
    expect(canStepForward(state)).toBe(false)

    const undoR = backStep(state)
    expect(undoR.move).toBe("R'")
    state = undoR.state
    const undoL = backStep(state)
    expect(undoL.move).toBe('L')
    state = undoL.state
    expect(state.cursor).toBe(2)
  })

  it('enqueue mid-sequence makes newly appended moves steppable from the current cursor', () => {
    let state = enqueueMoves(initialQueueState(), ['U'] as Move[])
    state = forwardStep(state).state
    expect(canStepForward(state)).toBe(false)

    state = enqueueMoves(state, ['R2', 'B'] as Move[])
    expect(canStepForward(state)).toBe(true)
    const next = forwardStep(state)
    expect(next.move).toBe('R2')
  })
})
