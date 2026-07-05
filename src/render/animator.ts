import { applyMove, invertMove } from '../core/moves'
import type { FaceletString, Move } from '../core/types'
import type { CubeRenderer } from './CubeRenderer'

const BASE_DURATION_MS = 300

/**
 * Pure queue/cursor model, kept free of Three.js so it's unit-testable on its
 * own: `cursor` is the index into `moves` of the next move not yet played
 * forward. `Animator` below is a thin imperative shell around this plus the
 * actual visual tween (delegated to `CubeRenderer.animateMove`).
 */
export interface QueueState {
  readonly moves: readonly Move[]
  readonly cursor: number
}

export function initialQueueState(): QueueState {
  return { moves: [], cursor: 0 }
}

export function enqueueMoves(state: QueueState, moves: readonly Move[]): QueueState {
  return { moves: [...state.moves, ...moves], cursor: state.cursor }
}

export function canStepForward(state: QueueState): boolean {
  return state.cursor < state.moves.length
}

export function canStepBack(state: QueueState): boolean {
  return state.cursor > 0
}

/** The move that plays if stepping forward from `state`, and the resulting state. */
export function forwardStep(state: QueueState): { move: Move; state: QueueState } {
  if (!canStepForward(state)) throw new Error('Animator: no move to step forward to')
  return { move: state.moves[state.cursor], state: { ...state, cursor: state.cursor + 1 } }
}

/** The (inverted) move that plays if stepping back from `state`, and the resulting state. */
export function backStep(state: QueueState): { move: Move; state: QueueState } {
  if (!canStepBack(state)) throw new Error('Animator: no move to step back to')
  const cursor = state.cursor - 1
  return { move: invertMove(state.moves[cursor]), state: { ...state, cursor } }
}

/** Discards any queued moves beyond `cursor` (e.g. an abandoned solve
 *  playback), keeping everything already played. */
export function clearPendingMoves(state: QueueState): QueueState {
  return { moves: state.moves.slice(0, state.cursor), cursor: state.cursor }
}

/**
 * Drives `CubeRenderer.animateMove` through a queue of moves (PR-07). Follow
 * mode uses `stepForward`/`stepBack` one at a time; watch mode uses
 * `play`/`pause` for autoplay. `enqueue` lets the queue grow after playback
 * has started (e.g. a solver streaming in more moves).
 */
export class Animator {
  private readonly renderer: CubeRenderer
  private queue: QueueState = initialQueueState()
  private currentState: FaceletString
  private playing = false
  private animating = false
  private speed = 1
  /** Disabled while fast-forwarding a scramble (PR-08): the hidden-face
   *  auto-orbit is meant to guide the user through a solve, not to
   *  choreograph the camera during a rapid, no-action-required shuffle. */
  private autoOrbit = true
  /** Set by `stop()` when a move is mid-tween, so the in-flight `playMove`
   *  truncates the queue itself once it finishes instead of clobbering the
   *  truncation done by `stop()` with its stale pre-await queue snapshot. */
  private pendingClear = false
  private moveCompleteCb?: (move: Move, cursor: number) => void
  private queueEmptyCb?: () => void

  constructor(renderer: CubeRenderer, initialState: FaceletString) {
    this.renderer = renderer
    this.currentState = initialState
    this.renderer.setState(initialState)
  }

  get cursor(): number {
    return this.queue.cursor
  }

  get length(): number {
    return this.queue.moves.length
  }

  get moves(): readonly Move[] {
    return this.queue.moves
  }

  /** The facelet state as of the last completed move (i.e. with `cursor`
   *  moves applied to the state the Animator was constructed with). */
  get state(): FaceletString {
    return this.currentState
  }

  enqueue(moves: Move[]): void {
    this.queue = enqueueMoves(this.queue, moves)
  }

  onMoveComplete(cb: (move: Move, cursor: number) => void): void {
    this.moveCompleteCb = cb
  }

  onQueueEmpty(cb: () => void): void {
    this.queueEmptyCb = cb
  }

  setSpeed(multiplier: number): void {
    this.speed = multiplier
  }

  setAutoOrbit(enabled: boolean): void {
    this.autoOrbit = enabled
  }

  play(): void {
    if (this.playing) return
    this.playing = true
    void this.runPlayLoop()
  }

  pause(): void {
    this.playing = false
  }

  /** Stops autoplay and discards the unplayed tail of the queue (PR-09: a
   *  scramble mid-playback must cancel it, not append after it). */
  stop(): void {
    this.playing = false
    if (this.animating) {
      this.pendingClear = true
    } else {
      this.queue = clearPendingMoves(this.queue)
    }
  }

  async stepForward(): Promise<void> {
    if (this.animating || !canStepForward(this.queue)) return
    await this.playMove(forwardStep(this.queue))
  }

  async stepBack(): Promise<void> {
    if (this.animating || !canStepBack(this.queue)) return
    await this.playMove(backStep(this.queue))
  }

  private async runPlayLoop(): Promise<void> {
    while (this.playing && canStepForward(this.queue)) {
      await this.playMove(forwardStep(this.queue))
    }
    if (this.playing) {
      this.playing = false
      this.queueEmptyCb?.()
    }
  }

  private async playMove({ move, state }: { move: Move; state: QueueState }): Promise<void> {
    this.animating = true
    const nextState = applyMove(this.currentState, move)
    await this.renderer.animateMove(move, nextState, BASE_DURATION_MS / this.speed, {
      autoOrbit: this.autoOrbit,
    })
    this.currentState = nextState
    this.queue = this.pendingClear ? clearPendingMoves(state) : state
    this.pendingClear = false
    this.animating = false
    this.moveCompleteCb?.(move, this.queue.cursor)
  }
}
