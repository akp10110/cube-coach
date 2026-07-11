import { useEffect, useRef, useState } from 'react'
import { applyMoves, parseMoves } from '../core/moves'
import { randomScramble } from '../core/scramble'
import { solveLbl } from '../core/solvers/lbl/orchestrator'
import { SOLVED } from '../core/types'
import { Animator } from '../render/animator'
import { CubeRenderer } from '../render/CubeRenderer'

// Fixed, not random: the point of /dev is a stable state to check by eye
// against a real cube photo (PR-06 acceptance), a random scramble would
// re-roll on every reload.
const SCRAMBLE = parseMoves("R U2 F' L D2 R' B U' L2 F R2 D F2 U R' F' D L2 U2")

function CubeCanvas({ label, state }: { label: string; state: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new CubeRenderer(canvas)
    renderer.setState(state)
    return () => renderer.dispose()
  }, [state])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span>{label}</span>
      <canvas ref={canvasRef} style={{ width: 360, height: 360 }} />
    </div>
  )
}

/** Visual check for PR-07: a demo button that scrambles the cube slowly, one
 * move at a time, via the real Animator + CubeRenderer.animateMove path —
 * the same path follow/watch playback will use from PR-08 onward. */
function AnimatedCubeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animatorRef = useRef<Animator | null>(null)
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new CubeRenderer(canvas)
    const animator = new Animator(renderer, SOLVED)
    animator.setSpeed(0.2) // slow: 300ms base / 0.2 = 1.5s per move
    animator.onMoveComplete((move, cursor) => setStatus(`played ${move} (move ${cursor})`))
    animator.onQueueEmpty(() => setStatus('done'))
    animatorRef.current = animator
    return () => {
      animatorRef.current = null
      renderer.dispose()
    }
  }, [])

  const scrambleSlowly = (): void => {
    const animator = animatorRef.current
    if (!animator) return
    animator.enqueue(randomScramble(5))
    setStatus('playing')
    animator.play()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span>Animated (PR-07)</span>
      <canvas ref={canvasRef} style={{ width: 360, height: 360 }} />
      <button onClick={scrambleSlowly}>Scramble 5 moves slowly</button>
      <span>{status}</span>
    </div>
  )
}

/** Visual check for PR-16 (tasks.md Phase 6): "Scramble, then solve through
 * <stage>" demo button — scrambles the cube, then animates every
 * implemented LBL stage in sequence so the delivery manager can watch the
 * white cross visibly form. Extend (don't replace) as PR-17..20 land more
 * stages; `solveLbl` already runs the full registry. */
function LblCubeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<CubeRenderer | null>(null)
  const animatorRef = useRef<Animator | null>(null)
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new CubeRenderer(canvas)
    renderer.setState(SOLVED)
    rendererRef.current = renderer
    return () => {
      rendererRef.current = null
      animatorRef.current = null
      renderer.dispose()
    }
  }, [])

  const scrambleThenSolve = (): void => {
    const renderer = rendererRef.current
    if (!renderer) return

    const scramble = randomScramble()
    const scrambled = applyMoves(SOLVED, scramble)
    const { moves: solveMoves } = solveLbl(scrambled)

    // Fresh Animator each click, always starting from SOLVED, so repeat
    // clicks scramble+solve relative to a known state rather than whatever
    // the cube was left showing after the previous run.
    const animator = new Animator(renderer, SOLVED)
    animator.setSpeed(0.5)
    animator.onMoveComplete((move, cursor) => setStatus(`played ${move} (move ${cursor})`))
    animator.onQueueEmpty(() => setStatus('done'))
    animatorRef.current = animator

    animator.enqueue([...scramble, ...solveMoves])
    setStatus('playing')
    animator.play()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span>LBL: white cross (PR-16)</span>
      <canvas ref={canvasRef} style={{ width: 360, height: 360 }} />
      <button onClick={scrambleThenSolve}>Scramble, then solve through white cross</button>
      <span>{status}</span>
    </div>
  )
}

/** Dev-only route (import.meta.env.DEV) for manually verifying the facelet -> 3D
 * mapping against a real cube photo. Not part of the shipped app. */
export function DevCubeView() {
  const scrambled = applyMoves(SOLVED, SCRAMBLE)

  return (
    <main style={{ display: 'flex', gap: 32, padding: 32, flexWrap: 'wrap' }}>
      <CubeCanvas label="SOLVED" state={SOLVED} />
      <CubeCanvas label={`Scrambled: ${SCRAMBLE.join(' ')}`} state={scrambled} />
      <AnimatedCubeCanvas />
      <LblCubeCanvas />
    </main>
  )
}
