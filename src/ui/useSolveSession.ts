import { useCallback, useEffect, useRef, useState } from 'react'
import type { FaceletString, Move } from '../core/types'
import { SOLVED } from '../core/types'
import { randomScramble } from '../core/scramble'
import { KociembaSolver } from '../core/solvers/kociemba'
import { isSolved as isCubeStateSolved } from '../core/validate'
import { Animator } from '../render/animator'
import { CubeRenderer } from '../render/CubeRenderer'

/** Quarter-turn tween duration Animator uses at 1x speed (render/animator.ts). */
const BASE_DURATION_MS = 300
/** Per-move duration during the fast scramble demo (PR-08: "80ms/move"). */
const SCRAMBLE_MOVE_MS = 80

export interface SolveSessionApi {
  attachCanvas: (canvas: HTMLCanvasElement | null) => void
  solverReady: boolean
  isScrambling: boolean
  isSolving: boolean
  solveError: string | null
  solverMoveCount: number | null
  solutionMoves: readonly Move[]
  /** Index into solutionMoves of the next move not yet done; -1 before a solve. */
  cursorInSolution: number
  currentMove: Move | null
  isSolved: boolean
  isPlaying: boolean
  speed: number
  canScramble: boolean
  canSolve: boolean
  onScramble: () => void
  onSolve: () => void
  onIDidIt: () => void
  onPrev: () => void
  onNext: () => void
  onPlayPause: () => void
  onSpeedChange: (speed: number) => void
}

/**
 * Wires the pure engine (PR-01..05) to the 3D renderer + animator (PR-06/07)
 * behind one React hook, per PR-08. A single Animator/CubeRenderer pair lives
 * for the app's session: Scramble and Solve both just enqueue more moves
 * onto it (Animator's queue is designed to grow after playback starts), and
 * `solutionStartCursor` marks where the solve's moves begin in that queue so
 * progress/chips/the move-guidance cue only ever reflect the solve, not the
 * scramble shuffle that preceded it.
 *
 * `initialState` (PR-10) lets the manual editor hand off a validated cube
 * straight into this screen instead of always starting from SOLVED.
 */
export function useSolveSession(initialState: FaceletString = SOLVED): SolveSessionApi {
  const animatorRef = useRef<Animator | null>(null)
  const rendererRef = useRef<CubeRenderer | null>(null)
  const solverRef = useRef<KociembaSolver | null>(null)
  const solutionStartCursorRef = useRef<number | null>(null)
  const solutionMovesRef = useRef<readonly Move[]>([])

  const [solverReady, setSolverReady] = useState(false)
  const [isScrambling, setIsScrambling] = useState(false)
  const [isSolving, setIsSolving] = useState(false)
  const [solveError, setSolveError] = useState<string | null>(null)
  const [solutionMoves, setSolutionMoves] = useState<readonly Move[]>([])
  const [cursorInSolution, setCursorInSolution] = useState(-1)
  // The Animator starts life on `initialState` (SOLVED by default, D3).
  const [isCubeSolved, setIsCubeSolved] = useState(() => isCubeStateSolved(initialState))
  // Gates the celebration: without it, a fresh page load (solved, but the
  // user hasn't touched anything) would celebrate before they've done a thing.
  const [hasInteracted, setHasInteracted] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  // Mirrors `speed` for the onQueueEmpty callback below, which is registered
  // once when the canvas attaches — reading state directly there would close
  // over a stale value instead of picking up later speed-slider changes.
  const speedRef = useRef(1)
  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  const updateCueForIndex = useCallback((index: number) => {
    rendererRef.current?.setCue(solutionMovesRef.current[index] ?? null)
  }, [])

  const attachCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      rendererRef.current?.dispose()
      animatorRef.current = null
      rendererRef.current = null
      if (!canvas) return

      const renderer = new CubeRenderer(canvas)
      const animator = new Animator(renderer, initialState)
      rendererRef.current = renderer
      animatorRef.current = animator

      animator.onMoveComplete((_move, cursor) => {
        setIsCubeSolved(isCubeStateSolved(animator.state))
        setHasInteracted(true)

        const start = solutionStartCursorRef.current
        if (start === null) return
        const index = cursor - start
        setCursorInSolution(index)
        updateCueForIndex(index)
      })
      animator.onQueueEmpty(() => {
        setIsPlaying(false)
        if (solutionStartCursorRef.current === null) {
          // A scramble batch just finished, not a solve.
          setIsScrambling(false)
          animator.setSpeed(speedRef.current)
          animator.setAutoOrbit(true)
        }
      })
    },
    [initialState, updateCueForIndex],
  )

  useEffect(() => {
    const solver = new KociembaSolver()
    solverRef.current = solver
    let cancelled = false
    solver
      .init()
      .then(() => {
        if (!cancelled) setSolverReady(true)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSolveError(err instanceof Error ? err.message : 'Solver failed to start.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onScramble = useCallback(() => {
    const animator = animatorRef.current
    if (!animator || isScrambling || isSolving) return

    setSolveError(null)
    setIsScrambling(true)
    // Scrambling mid-playback must cancel it, not append after it (PR-09).
    animator.stop()
    setIsPlaying(false)
    solutionStartCursorRef.current = null
    solutionMovesRef.current = []
    setSolutionMoves([])
    setCursorInSolution(-1)
    rendererRef.current?.setCue(null)

    animator.setAutoOrbit(false)
    animator.setSpeed(BASE_DURATION_MS / SCRAMBLE_MOVE_MS)
    animator.enqueue(randomScramble())
    animator.play()
  }, [isScrambling, isSolving])

  const onSolve = useCallback(() => {
    const animator = animatorRef.current
    const solver = solverRef.current
    if (!animator || !solver || isScrambling || isSolving || !solverReady) return

    setIsSolving(true)
    setSolveError(null)
    solver
      .solve(animator.state)
      .then((solution) => {
        solutionStartCursorRef.current = animator.cursor
        solutionMovesRef.current = solution.moves
        setSolutionMoves(solution.moves)
        setCursorInSolution(0)
        updateCueForIndex(0)
        animator.enqueue(solution.moves)
      })
      .catch((err: unknown) => {
        setSolveError(err instanceof Error ? err.message : 'Could not solve this cube.')
      })
      .finally(() => setIsSolving(false))
  }, [isScrambling, isSolving, solverReady, updateCueForIndex])

  const onIDidIt = useCallback(() => {
    void animatorRef.current?.stepForward()
  }, [])

  const onNext = onIDidIt

  const onPrev = useCallback(() => {
    void animatorRef.current?.stepBack()
  }, [])

  const onPlayPause = useCallback(() => {
    const animator = animatorRef.current
    if (!animator) return
    if (isPlaying) {
      animator.pause()
      setIsPlaying(false)
    } else {
      animator.play()
      setIsPlaying(true)
    }
  }, [isPlaying])

  const onSpeedChange = useCallback((next: number) => {
    setSpeed(next)
    animatorRef.current?.setSpeed(next)
  }, [])

  // PR-09: space = play/pause, arrows = step. Ignore keystrokes aimed at a
  // form control (e.g. the speed slider) so its own native arrow-key/space
  // behavior isn't hijacked.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      ) {
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        onPlayPause()
      } else if (event.code === 'ArrowRight') {
        event.preventDefault()
        onNext()
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault()
        onPrev()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onPlayPause, onNext, onPrev])

  const currentMove = solutionMoves[cursorInSolution] ?? null
  // Celebration-worthy "solved" requires the user to have done something —
  // otherwise the untouched cube on first load would celebrate immediately.
  const isSolved = isCubeSolved && hasInteracted

  return {
    attachCanvas,
    solverReady,
    isScrambling,
    isSolving,
    solveError,
    solverMoveCount: solutionMoves.length > 0 ? solutionMoves.length : null,
    solutionMoves,
    cursorInSolution,
    currentMove,
    isSolved,
    isPlaying,
    speed,
    canScramble: !isScrambling && !isSolving,
    canSolve: solverReady && !isScrambling && !isSolving && !isCubeSolved,
    onScramble,
    onSolve,
    onIDidIt,
    onPrev,
    onNext,
    onPlayPause,
    onSpeedChange,
  }
}
