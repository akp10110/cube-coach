import { useEffect, useRef } from 'react'
import { useCamera } from './useCamera'

/** Square guide side length in CSS pixels (design-mocks.html screen 3). */
const GUIDE_SIZE = 260

function drawScanGuide(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(4, 4, size - 8, size - 8, 14)
  ctx.stroke()

  const inset = 12
  const cell = (size - inset * 2) / 3
  ctx.lineWidth = 1
  for (let i = 1; i < 3; i++) {
    const x = inset + cell * i
    ctx.beginPath()
    ctx.moveTo(x, inset)
    ctx.lineTo(x, size - inset)
    ctx.stroke()

    const y = inset + cell * i
    ctx.beginPath()
    ctx.moveTo(inset, y)
    ctx.lineTo(size - inset, y)
    ctx.stroke()
  }
}

export interface ScanScreenProps {
  /** Escape hatch for the permission-denied / no-camera states (PR-12 scope). */
  onEnterColorsManually: () => void
}

/** PR-12: camera scan screen skeleton — live video, centered square guide
 *  with a 3x3 grid overlay (canvas on top). Per-sticker color sampling and
 *  the guided face-by-face flow are later PRs (13/14); this just proves the
 *  camera plumbing and lays out the frame it'll draw into. */
export function ScanScreen({ onEnterColorsManually }: ScanScreenProps) {
  const { videoRef, status, errorKind, mirrored } = useCamera()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (status !== 'ready') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = GUIDE_SIZE * dpr
    canvas.height = GUIDE_SIZE * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawScanGuide(ctx, GUIDE_SIZE)
  }, [status])

  return (
    <main className="app-shell scan-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ◆
          </span>
          <span>CubeCoach</span>
        </div>
        <span className="sub">Scan your cube</span>
      </header>

      <div className="scan-body">
        {status === 'error' ? (
          <div className="scan-error">
            <p className="scan-error-title">
              {errorKind === 'no-camera' ? 'No camera found' : 'Camera access needed'}
            </p>
            <p className="scan-error-detail">
              {errorKind === 'no-camera'
                ? "We couldn't find a camera on this device."
                : "Allow camera access for this site in your browser's settings, then reload the page."}
            </p>
            <button className="btn-primary" onClick={onEnterColorsManually}>
              Enter colors manually instead
            </button>
          </div>
        ) : (
          <div className="scan-viewport" style={{ width: GUIDE_SIZE, height: GUIDE_SIZE }}>
            <video
              ref={videoRef}
              className={'scan-video' + (mirrored ? ' is-mirrored' : '')}
              autoPlay
              playsInline
              muted
            />
            <canvas
              ref={canvasRef}
              className="scan-guide-canvas"
              width={GUIDE_SIZE}
              height={GUIDE_SIZE}
            />
            {status === 'starting' && <p className="scan-starting">Starting camera…</p>}
          </div>
        )}
      </div>
    </main>
  )
}
