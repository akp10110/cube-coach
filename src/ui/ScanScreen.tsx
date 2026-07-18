import { useEffect, useRef, useState } from 'react'
import type { Face } from '../core/types'
import { FACE_ORDER } from '../core/facelets'
import type { ColorMatch, HSV } from '../scan/colorDetect'
import { LOW_CONFIDENCE_THRESHOLD } from '../scan/colorDetect'
import { FACE_COLOR_NAMES, STICKER_COLORS } from '../render/colors'
import { CROSS_LAYOUT } from './crossLayout'
import { holdInstruction } from './scanInstructions'
import { useCamera } from './useCamera'
import { useFaceCapture } from './useFaceCapture'
import type { CapturedFace } from './useFaceCapture'

/** Square viewfinder side length in CSS pixels (design-mocks.html screen 3). */
const GUIDE_SIZE = 260
/** Inset of the corner brackets / live-dots / tap-to-fix grid from the
 *  viewport edge — shared so all three line up visually. */
const TARGET_INSET = 36
const BRACKET_ARM = 26

/** L-shaped corner brackets framing the target face — deliberately NOT a
 *  grid over the live cube (PR-26: stickers stay fully visible so the user
 *  can judge their own alignment; the app never overlays a false-precision
 *  3x3 lattice on a cube it hasn't confirmed is even there). */
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

/** Mini unfolded-cube progress indicator: each face fills in with its
 *  captured colors as it lands; not-yet-captured faces stay blank. Kept
 *  from PR-14 rather than the spec's small 3D `CubeRenderer` widget — a
 *  second live WebGL context for a corner widget is real cost on mobile,
 *  and "unscanned face" has no representable value in the locked 54-char
 *  facelet contract (D3) a `CubeRenderer.setState` could show. */
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
   *  when resuming or rescanning. Merged into the progress mini-map and
   *  "Face X of 6" count; this instance still only classifies and reports
   *  the faces in `captureOrder`. */
  priorFaces?: Partial<Record<Face, CapturedFace>>
  /** Seed centroids so a resume/rescan benefits from a prior calibration
   *  instead of restarting from `DEFAULT_CENTROIDS`. */
  seedCentroids?: Readonly<Record<Face, HSV>>
  seedCalibrated?: boolean
}

function instructionFor(
  mode: 'live' | 'pending' | 'captured',
  face: Face,
  duplicateMessage: string | null,
  blockingCount: number,
): string {
  if (mode === 'pending') {
    if (duplicateMessage) return duplicateMessage
    if (blockingCount > 0) {
      return blockingCount === 1
        ? '1 sticker looks unsure — tap it to fix, or retake.'
        : `${blockingCount} stickers look unsure — tap to fix, or retake.`
    }
    return 'Looks good — tap any sticker to fix it, or Confirm.'
  }
  if (mode === 'captured') return 'Tap any sticker to fix it, or retake this face.'
  return holdInstruction(face)
}

/** PR-26: tap-to-capture scan flow, on top of the PR-12 camera plumbing and
 *  PR-13 color classification — fixed U,R,F,D,L,B capture order (or a
 *  resumed/single-face subset), corner-bracket viewfinder, shutter-freeze +
 *  Confirm/Retake with tap-to-fix, and Previous/Next navigation. Supersedes
 *  PR-14's auto-capture flow (see tasks.md for why). */
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
    frameImage,
    grid,
    gridDebug,
    eligibility,
    captureNow,
    confirmPending,
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
  /** Which cell's color picker is open — any cell, not just low-confidence
   *  ones (PR-26 follow-up: the classifier's read is a suggestion, the user
   *  is ground truth). Tagged with the mode/face it was opened on so a
   *  stale picker from a face just left behind (Confirm, Retake, Previous/
   *  Next) reads as closed without needing an effect to clear it. */
  const [rawEditing, setRawEditing] = useState<{ mode: string; face: Face | null; index: number } | null>(
    null,
  )
  const editingIndex =
    rawEditing && rawEditing.mode === mode && rawEditing.face === currentFace ? rawEditing.index : null
  const setEditingIndex = (index: number | null) =>
    setRawEditing(index === null ? null : { mode, face: currentFace, index })

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
    if (mode === 'live') {
      drawBrackets(ctx, GUIDE_SIZE)
      if (showLiveDots && liveStickers) drawLiveDots(ctx, GUIDE_SIZE, liveStickers)
    }
  }, [status, mode, liveStickers, showLiveDots])

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

  const allFaces = { ...priorFaces, ...faces }
  const facesDone = FACE_ORDER.filter((face) => allFaces[face]).length
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
            <ScanProgressMini faces={allFaces} />
          </div>
        ) : (
          currentFace && (
            <>
              <p className={'scan-instruction' + (eligibility?.duplicateMessage ? ' is-notice' : '')}>
                {instructionFor(mode, currentFace, eligibility?.duplicateMessage ?? null, eligibility?.blockingCells.length ?? 0)}
              </p>
              <div
                className={'scan-viewport' + (mode !== 'live' ? ' is-frozen' : '')}
                style={{ width: GUIDE_SIZE, height: GUIDE_SIZE }}
              >
                {mode === 'live' ? (
                  <video
                    ref={attachVideoAndCamera}
                    className={'scan-video' + (mirrored ? ' is-mirrored' : '')}
                    autoPlay
                    playsInline
                    muted
                  />
                ) : (
                  frameImage && (
                    <img
                      src={frameImage}
                      alt=""
                      className={'scan-video' + (mirrored ? ' is-mirrored' : '')}
                    />
                  )
                )}
                <canvas
                  ref={canvasRef}
                  className="scan-guide-canvas"
                  width={GUIDE_SIZE}
                  height={GUIDE_SIZE}
                />
                {mode !== 'live' && grid && (
                  <div className="scan-fix-grid">
                    {grid.map((cell, i) => (
                      <button
                        key={i}
                        type="button"
                        className={
                          'scan-fix-cell' +
                          (eligibility?.blockingCells.includes(i) ? ' is-blocking' : '') +
                          (editingIndex === i ? ' is-editing' : '')
                        }
                        style={{ background: STICKER_COLORS[cell.color] }}
                        aria-label={
                          `Sticker ${i + 1}: ${FACE_COLOR_NAMES[cell.color]}` +
                          (eligibility?.blockingCells.includes(i) ? ' (unsure — tap to fix)' : ' (tap to fix)')
                        }
                        aria-expanded={editingIndex === i}
                        onClick={() => setEditingIndex(editingIndex === i ? null : i)}
                      />
                    ))}
                  </div>
                )}
                {status === 'starting' && <p className="scan-starting">Starting camera…</p>}
                {mode === 'live' && (
                  <button
                    type="button"
                    className={'scan-dots-toggle' + (showLiveDots ? ' is-on' : '')}
                    aria-pressed={showLiveDots}
                    onClick={() => setShowLiveDots((v) => !v)}
                  >
                    {showLiveDots ? 'Hide colors' : 'Show colors'}
                  </button>
                )}
              </div>

              {editingIndex !== null && grid && (
                <div
                  className="palette"
                  role="group"
                  aria-label={`Pick a color for sticker ${editingIndex + 1}`}
                >
                  {FACE_ORDER.map((face) => (
                    <button
                      key={face}
                      type="button"
                      className={
                        'palette-swatch' + (grid[editingIndex].color === face ? ' is-selected' : '')
                      }
                      style={{ background: STICKER_COLORS[face] }}
                      aria-label={FACE_COLOR_NAMES[face]}
                      aria-pressed={grid[editingIndex].color === face}
                      onClick={() => {
                        setCellColor(editingIndex, face)
                        setEditingIndex(null)
                      }}
                    />
                  ))}
                </div>
              )}

              <ScanProgressMini faces={allFaces} />

              <div className="scan-controls-row">
                {mode === 'live' && (
                  <>
                    <button
                      type="button"
                      className="scan-nav-btn"
                      disabled={!canGoPrevious}
                      onClick={goPrevious}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="scan-capture-btn"
                      aria-label="Capture this face"
                      disabled={!liveStickers}
                      onClick={captureNow}
                    >
                      <span />
                    </button>
                    <button type="button" className="scan-nav-btn" disabled={!canGoNext} onClick={goNext}>
                      Next
                    </button>
                  </>
                )}
                {mode === 'pending' && (
                  <>
                    <button type="button" className="btn-secondary" onClick={retake}>
                      Retake
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!eligibility?.canConfirm}
                      onClick={confirmPending}
                    >
                      Confirm
                    </button>
                  </>
                )}
                {mode === 'captured' && (
                  <>
                    <button
                      type="button"
                      className="scan-nav-btn"
                      disabled={!canGoPrevious}
                      onClick={goPrevious}
                    >
                      Previous
                    </button>
                    <button type="button" className="btn-secondary" onClick={retake}>
                      Retake this face
                    </button>
                    <button type="button" className="scan-nav-btn" disabled={!canGoNext} onClick={goNext}>
                      Next
                    </button>
                  </>
                )}
              </div>

              {import.meta.env.DEV && mode !== 'live' && gridDebug && (
                <div className="scan-dev-overlay" aria-hidden="true">
                  {gridDebug.map((d, i) => (
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
