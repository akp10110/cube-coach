import { useEffect, useRef } from 'react'
import { applyMoves, parseMoves } from '../core/moves'
import { SOLVED } from '../core/types'
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

/** Dev-only route (import.meta.env.DEV) for manually verifying the facelet -> 3D
 * mapping against a real cube photo. Not part of the shipped app. */
export function DevCubeView() {
  const scrambled = applyMoves(SOLVED, SCRAMBLE)

  return (
    <main style={{ display: 'flex', gap: 32, padding: 32, flexWrap: 'wrap' }}>
      <CubeCanvas label="SOLVED" state={SOLVED} />
      <CubeCanvas label={`Scrambled: ${SCRAMBLE.join(' ')}`} state={scrambled} />
    </main>
  )
}
