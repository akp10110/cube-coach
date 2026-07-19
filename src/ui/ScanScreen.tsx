import { useEffect, useRef, useState } from 'react'
import type { Face } from '../core/types'
import { FACE_ORDER } from '../core/facelets'
import type { ColorMatch, HSV } from '../scan/colorDetect'
import { LOW_CONFIDENCE_THRESHOLD } from '../scan/colorDetect'
import { FACE_COLOR_NAMES, STICKER_COLORS } from '../render/colors'
import { holdInstruction } from './scanInstructions'
import { useCamera } from './useCamera'
import { useFaceCapture } from './useFaceCapture'
import type { CapturedFace, CaptureMode } from './useFaceCapture'
import { useScanCubePreview } from './useScanCubePreview'

/** Square viewfinder side length in CSS pixels (design-mocks.html screen 3). */
const GUIDE_SIZE = 260
/** Inset of the corner brackets / live-dots grid from the viewport edge. */
const TARGET_INSET = 36
const BRACKET_ARM = 26

/** L-shaped corner brackets framing the target face — deliberately NOT a
 *  grid over the live cube (PR-26: stickers stay fully visible so the user
 *  can judge their own alignment). The camera feed is always live — there's
 *  no freeze-frame step — so these are drawn continuously. */
function drawBrackets(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  const a = TARGET_INSET
  const b = size - TARGET_INSET

  const corners: readonly [number, number, number, number][] = [
    [a, a, 1, 1],
    [b, a, -1, 1],
    [a, b, 1, -1],
    [b, b, -1, -1],
  ]
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath()
    ctx.moveTo(x + BRACKET_ARM * dx, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + BRACKET_ARM * dy)
    ctx.stroke()
  }
}

/** Small per-cell dots showing the live classification, behind a
 *  default-off toggle (PR-26) — a lighter-weight hint than a full grid. */
function drawLiveDots(ctx: CanvasRenderingContext2D, size: number, stickers: readonly ColorMatch[]): void {
  const cell = (size - TARGET_INSET * 2) / 3
  stickers.forEach((sticker, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const cx = TARGET_INSET + cell * (col + 0.5)
    const cy = TARGET_INSET + cell * (row + 0.5)

    ctx.beginPath()
    ctx.arc(cx, cy, 5, 0, Math.PI * 2)
    ctx.globalAlpha = sticker.confidence < LOW_CONFIDENCE_THRESHOLD ? 0.45 : 0.95
    ctx.fillStyle = STICKER_COLORS[sticker.color]
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.stroke()
  })
}

export interface ScanCompleteResult {
  faces: Partial<Record<Face, CapturedFace>>
  centroids: Readonly<Record<Face, HSV>>
  calibrated: boolean
}

export interface ScanScreenProps {
  /** Escape hatch for the permission-denied / no-camera states (PR-12 scope). */
  onEnterColorsManually: () => void
  /** Fires once `captureOrder` finishes. */
  onScanComplete: (result: ScanCompleteResult) => void
  /** Faces this instance should still capture, in order. Defaults to the
   *  full U,R,F,D,L,B sequence. Pass the faces not yet done to resume a
   *  scan interrupted by a refresh, or a single face for "Rescan face X". */
  captureOrder?: readonly Face[]
  /** Faces already captured in a previous scan/instance — e.g. the other 5
   *  when resuming or rescanning. Merged into the 3D preview and "Face X of
   *  6" count; this instance still only classifies and reports the faces in
   *  `captureOrder`. */
  priorFaces?: Partial<Record<Face, CapturedFace>>
  /** Seed centroids so a resume/rescan benefits from a prior calibration
   *  instead of restarting from `DEFAULT_CENTROIDS`. */
  seedCentroids?: Readonly<Record<Face, HSV>>
  seedCalibrated?: boolean
}

function instructionFor(mode: CaptureMode, face: Face, duplicateMessage: string | null): string {
  if (mode === 'live') return duplicateMessage ?? holdInstruction(face)
  return 'Tap any sticker on the cube to fix it, or retake this face.'
}

/**
 * Tap-to-capture scan flow with a live 3D cube standing in for the old
 * freeze-frame confirm step: a live camera feed on top, and directly below
 * it a `CubeRenderer` (PR-06) whose current face fills in live with the
 * detected colors as the user points at their cube. Tap Capture to lock
 * that face onto the model, Previous/Next to move between faces. Any
 * already-captured sticker on the 3D model is tappable to open a 6-color
 * picker and fix it by hand — the classifier's read is a suggestion, the
 * user is ground truth. Fixed U,R,F,D,L,B capture order (or a
 * resumed/single-face subset).
 */
export function ScanScreen({
  onEnterColorsManually,
  onScanComplete,
  captureOrder,
  priorFaces,
  seedCentroids,
  seedCalibrated,
}: ScanScreenProps) {
  const { videoRef, status, errorKind, mirrored } = useCamera()
  const {
    attachVideo,
    currentFace,
    mode,
    isComplete,
    faces,
    liveStickers,
    liveDebug,
    duplicateMessage,
    captureNow,
    retake,
    setCellColor,
    goPrevious,
    goNext,
    canGoPrevious,
    canGoNext,
    centroids,
    calibrated,
  } = useFaceCapture(status === 'ready', { captureOrder, seedCentroids, seedCalibrated, priorFaces })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [showLiveDots, setShowLiveDots] = useState(false)
  const [editingTarget, setEditingTarget] = useState<{ face: Face; index: number } | null>(null)

  const allFaces = { ...priorFaces, ...faces }

  const { attachCanvas: attachCubeCanvas } = useScanCubePreview({
    currentFace,
    isLive: mode === 'live',
    liveStickers,
    faces: allFaces,
    onStickerTap: (face, index) => {
      if (!allFaces[face]) return
      setEditingTarget((prev) => (prev?.face === face && prev.index === index ? null : { face, index }))
    },
  })

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
    ctx.clearRect(0, 0, GUIDE_SIZE, GUIDE_SIZE)
    drawBrackets(ctx, GUIDE_SIZE)
    if (showLiveDots && liveStickers) drawLiveDots(ctx, GUIDE_SIZE, liveStickers)
  }, [status, liveStickers, showLiveDots])

  useEffect(() => {
    if (isComplete) onScanComplete({ faces, centroids, calibrated })
    // Fires exactly once per scan: `isComplete` flips false -> true and stays
    // true, so this effect body only runs on that single transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete])

  const attachVideoAndCamera = (el: HTMLVideoElement | null) => {
    videoRef(el)
    attachVideo(el)
  }

  const handlePrevious = () => {
    setEditingTarget(null)
    goPrevious()
  }
  const handleNext = () => {
    setEditingTarget(null)
    goNext()
  }
  const handleCapture = () => {
    setEditingTarget(null)
    captureNow()
  }
  const handleRetake = () => {
    setEditingTarget(null)
    retake()
  }

  const facesDone = FACE_ORDER.filter((face) => allFaces[face]).length
  const progressPill = isComplete ? 'All 6 faces scanned' : `Face ${facesDone + 1} of 6`
  const editingColor = editingTarget ? allFaces[editingTarget.face]?.colors[editingTarget.index] : null

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
          </div>
        ) : (
          currentFace && (
            <>
              <p className={'scan-instruction' + (duplicateMessage ? ' is-notice' : '')}>
                {instructionFor(mode, currentFace, duplicateMessage)}
              </p>
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
                <button
                  type="button"
                  className={'scan-dots-toggle' + (showLiveDots ? ' is-on' : '')}
                  aria-pressed={showLiveDots}
                  onClick={() => setShowLiveDots((v) => !v)}
                >
                  {showLiveDots ? 'Hide colors' : 'Show colors'}
                </button>
              </div>

              <div className="scan-cube-stage">
                <canvas ref={attachCubeCanvas} className="scan-cube-canvas" />
              </div>

              {editingTarget && (
                <div
                  className="palette"
                  role="group"
                  aria-label={`Pick a color for ${FACE_COLOR_NAMES[editingTarget.face]} face, sticker ${editingTarget.index + 1}`}
                >
                  {FACE_ORDER.map((face) => (
                    <button
                      key={face}
                      type="button"
                      className={'palette-swatch' + (editingColor === face ? ' is-selected' : '')}
                      style={{ background: STICKER_COLORS[face] }}
                      aria-label={FACE_COLOR_NAMES[face]}
                      aria-pressed={editingColor === face}
                      onClick={() => {
                        setCellColor(editingTarget.face, editingTarget.index, face)
                        setEditingTarget(null)
                      }}
                    />
                  ))}
                </div>
              )}

              <div className="scan-controls-row">
                <button
                  type="button"
                  className="scan-nav-btn"
                  disabled={!canGoPrevious}
                  onClick={handlePrevious}
                >
                  Previous
                </button>
                {mode === 'live' ? (
                  <button
                    type="button"
                    className="scan-capture-btn"
                    aria-label="Capture this face"
                    disabled={!liveStickers || !!duplicateMessage}
                    onClick={handleCapture}
                  >
                    <span />
                  </button>
                ) : (
                  <button type="button" className="btn-secondary" onClick={handleRetake}>
                    Retake
                  </button>
                )}
                <button type="button" className="scan-nav-btn" disabled={!canGoNext} onClick={handleNext}>
                  Next
                </button>
              </div>

              {import.meta.env.DEV && liveDebug && (
                <div className="scan-dev-overlay" aria-hidden="true">
                  {liveDebug.map((d, i) => (
                    <div key={i}>
                      [{i}] h{d.hsv.h.toFixed(0)}° s{d.hsv.s.toFixed(2)} v{d.hsv.v.toFixed(2)} →{' '}
                      {d.bestFace}(Δ{d.bestDistance.toFixed(2)}) next {d.runnerUpFace}(Δ
                      {d.runnerUpDistance.toFixed(2)}) margin {d.margin.toFixed(2)}
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        )}
      </div>
    </main>
  )
}
