import { useEffect, useRef } from 'react'
import type { Face } from '../core/types'
import { FACE_ORDER } from '../core/facelets'
import type { ColorMatch } from '../scan/colorDetect'
import { STICKER_COLORS } from '../render/colors'
import { CROSS_LAYOUT } from './crossLayout'
import { holdInstruction } from './scanInstructions'
import { useCamera } from './useCamera'
import { useFaceCapture } from './useFaceCapture'
import type { CapturedFace } from './useFaceCapture'

/** Square guide side length in CSS pixels (design-mocks.html screen 3). */
const GUIDE_SIZE = 260
/** Live-preview stickers below this confidence get a dashed outline. */
const LOW_CONFIDENCE_THRESHOLD = 0.5

function drawScanGuide(
  ctx: CanvasRenderingContext2D,
  size: number,
  liveStickers: readonly ColorMatch[] | null,
): void {
  ctx.clearRect(0, 0, size, size)

  const inset = 12
  const cell = (size - inset * 2) / 3

  if (liveStickers) {
    liveStickers.forEach((sticker, i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      const x = inset + col * cell
      const y = inset + row * cell

      ctx.globalAlpha = 0.85
      ctx.fillStyle = STICKER_COLORS[sticker.color]
      ctx.beginPath()
      ctx.roundRect(x + 2, y + 2, cell - 4, cell - 4, 4)
      ctx.fill()
      ctx.globalAlpha = 1

      if (sticker.confidence < LOW_CONFIDENCE_THRESHOLD) {
        ctx.save()
        ctx.setLineDash([4, 3])
        ctx.strokeStyle = '#ef9f27'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4)
        ctx.restore()
      }
    })
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(4, 4, size - 8, size - 8, 14)
  ctx.stroke()

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

/** Mini unfolded-cube progress indicator (PR-14): each face fills in with
 *  its captured colors as it lands; not-yet-captured faces stay blank. */
function ScanProgressMini({ faces }: { faces: Partial<Record<Face, CapturedFace>> }) {
  return (
    <div className="scan-mini">
      {FACE_ORDER.map((face) => {
        const captured = faces[face]
        return (
          <div
            key={face}
            className="scan-mini-face"
            style={{ gridColumn: CROSS_LAYOUT[face].column, gridRow: CROSS_LAYOUT[face].row }}
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className={'scan-mini-sticker' + (captured ? '' : ' is-empty')}
                style={captured ? { background: STICKER_COLORS[captured.colors[i]] } : undefined}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

export interface ScanScreenProps {
  /** Escape hatch for the permission-denied / no-camera states (PR-12 scope). */
  onEnterColorsManually: () => void
}

/** PR-14: guided 6-face scan flow on top of the PR-12 camera plumbing and
 *  PR-13 color classification — fixed U,R,F,D,L,B capture order with a hold
 *  instruction per face, a live per-sticker classification preview drawn on
 *  the guide overlay, auto-capture after ~1s of stable classification (or a
 *  manual capture button), and a mini unfolded-cube progress indicator. */
export function ScanScreen({ onEnterColorsManually }: ScanScreenProps) {
  const { videoRef, status, errorKind, mirrored } = useCamera()
  const { attachVideo, currentFace, isComplete, faces, liveStickers, captureNow } =
    useFaceCapture(status === 'ready')
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
    drawScanGuide(ctx, GUIDE_SIZE, liveStickers)
  }, [status, liveStickers])

  const attachVideoAndCamera = (el: HTMLVideoElement | null) => {
    videoRef(el)
    attachVideo(el)
  }

  const facesDone = FACE_ORDER.filter((face) => faces[face]).length
  const progressPill = isComplete ? 'All 6 faces scanned' : `Face ${facesDone + 1} of 6`

  return (
    <main className="app-shell scan-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ◆
          </span>
          <span>CubeCoach</span>
        </div>
        <span className="pill">{progressPill}</span>
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
        ) : isComplete ? (
          <div className="scan-complete">
            <p className="scan-complete-title">All 6 faces scanned!</p>
            <ScanProgressMini faces={faces} />
          </div>
        ) : (
          <>
            {currentFace && <p className="scan-instruction">{holdInstruction(currentFace)}</p>}
            <div className="scan-viewport" style={{ width: GUIDE_SIZE, height: GUIDE_SIZE }}>
              <video
                ref={attachVideoAndCamera}
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
            <div className="scan-controls-row">
              <ScanProgressMini faces={faces} />
              <p className="scan-auto-hint">Auto-captures when steady</p>
              <button
                type="button"
                className="scan-capture-btn"
                aria-label="Capture this face now"
                disabled={!liveStickers}
                onClick={captureNow}
              >
                <span />
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
