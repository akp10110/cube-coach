import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Face } from '../core/types'
import { FACE_ORDER } from '../core/facelets'
import type { ClassificationDebugInfo, ColorMatch, HSV, StickerSample } from '../scan/colorDetect'
import { DEFAULT_CENTROIDS, classifyColorDebug, classifySticker, sampleGrid } from '../scan/colorDetect'
import { calibrateFromCenters, isFullyCalibrated } from '../scan/calibrate'
import type { CaptureEligibility } from '../scan/captureEligibility'
import { evaluateCapture } from '../scan/captureEligibility'
import { CAPTURE_ORDER } from './scanInstructions'

const SAMPLE_INTERVAL_MS = 200
/** Sampling resolution for the hidden crop canvas — independent of the
 *  visible guide's on-screen (CSS) size. */
const SAMPLE_SIZE = 180

export interface CapturedFace {
  colors: Face[]
  confidence: number[]
}

/** A face whose 9 stickers have been captured and (for `pending`) not yet
 *  confirmed. `overrides` records manual tap-to-fix corrections by sticker
 *  index — always trusted over the classifier, and re-applied on top of
 *  every reclassification so a fix survives recalibration. */
interface StoredReading {
  samples: StickerSample[]
  overrides: Partial<Record<number, Face>>
  /** JPEG data URL snapshot of the frame the shutter froze, for display. */
  imageDataUrl: string
}

interface PendingReading extends StoredReading {
  face: Face
}

export type CaptureMode = 'live' | 'pending' | 'captured'

export interface FaceCaptureOptions {
  /** Faces to capture, in order — defaults to the full 6-face `CAPTURE_ORDER`.
   *  PR-15 passes a single-face list here for "rescan face X". */
  captureOrder?: readonly Face[]
  /** Seed centroids to classify against from the start (PR-15: a rescan
   *  should benefit from the original scan's calibration instead of
   *  restarting from `DEFAULT_CENTROIDS`). */
  seedCentroids?: Readonly<Record<Face, HSV>>
  /** Whether `seedCentroids` are trustworthy calibrated centroids (vs the
   *  provisional defaults) — see `classifyColor`'s `calibrated` param. */
  seedCalibrated?: boolean
  /** Faces already captured elsewhere in this scan session (e.g. the other
   *  5 during a single-face rescan) — the duplicate-center guard checks
   *  against these too, not just faces captured by this hook instance. */
  priorFaces?: Partial<Record<Face, CapturedFace>>
}

export interface FaceCaptureApi {
  /** Attach to the same `<video>` element `useCamera` is streaming into. */
  attachVideo: (el: HTMLVideoElement | null) => void
  /** Face the cursor is currently on; `null` once `captureOrder` is done. */
  currentFace: Face | null
  /** 'live': camera feed, awaiting a shutter tap. 'pending': a just-shot
   *  frame awaiting Confirm/Retake. 'captured': `currentFace` already has a
   *  confirmed capture (reached via Previous/Next), shown for review/fix. */
  mode: CaptureMode
  isComplete: boolean
  /** Finalized (confirmed) captures so far, in the shape of core's `FaceScan`. */
  faces: Partial<Record<Face, CapturedFace>>
  /** Live per-sticker classification of the current frame, for the optional
   *  live-dots overlay — only meaningful in 'live' mode. */
  liveStickers: ColorMatch[] | null
  /** Frozen still for 'pending'/'captured' modes; `null` in 'live' mode. */
  frameImage: string | null
  /** The 9-cell classification (overrides applied) for 'pending'/'captured'
   *  modes, for the tap-to-fix grid; `null` in 'live' mode. */
  grid: ColorMatch[] | null
  /** Per-cell HSV + nearest/runner-up centroid breakdown behind `grid`, for
   *  the `/dev` overlay only — `null` in 'live' mode, same as `grid`. Not
   *  override-adjusted (there's nothing to debug about a manual fix). */
  gridDebug: ClassificationDebugInfo[] | null
  /** Whether `grid` can be confirmed right now, and why not if not —
   *  `null` outside 'pending' mode. */
  eligibility: CaptureEligibility | null
  /** Shutter: freezes the current live frame — 'live' mode only. */
  captureNow: () => void
  /** Commits the frozen frame as `currentFace`'s capture — 'pending' only. */
  confirmPending: () => void
  /** Discards a pending frame (back to live) or clears an already-captured
   *  face (back to live) so it can be reshot. */
  retake: () => void
  /** Manual tap-to-fix: sets sticker `index` to `color` on whichever
   *  reading is currently showing (pending or captured). */
  setCellColor: (index: number, color: Face) => void
  goPrevious: () => void
  goNext: () => void
  canGoPrevious: boolean
  canGoNext: boolean
  /** Current classification centroids — DEFAULT_CENTROIDS (or `seedCentroids`)
   *  until all six centers are in, then the recalibrated set. */
  centroids: Readonly<Record<Face, HSV>>
  /** Whether `centroids` are trustworthy calibrated centroids. */
  calibrated: boolean
}

/** Maps a video's native resolution to the centered square crop that
 *  matches the on-screen guide's `object-fit: cover`. Pure so it's
 *  unit-testable without a real `HTMLVideoElement`. */
export function computeCoverCrop(
  videoWidth: number,
  videoHeight: number,
): { sx: number; sy: number; side: number } {
  const side = Math.min(videoWidth, videoHeight)
  return { sx: (videoWidth - side) / 2, sy: (videoHeight - side) / 2, side }
}

/**
 * Draws the current video frame's centered-square crop onto `canvas` at
 * `SAMPLE_SIZE` and returns the resulting `ImageData` — the single frame
 * source for both the live-dots preview and the shutter capture. Bug fix:
 * previously the shutter read a `samples` ref last written by the ~200ms
 * background polling tick, so a tap could freeze a frame up to one tick
 * stale relative to what the live preview last showed. Calling this
 * function directly at tap time instead makes the capture synchronous with
 * the tap — same draw call, same canvas, same moment, no polling lag.
 */
function drawVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null {
  if (video.readyState < 2 || !video.videoWidth) return null
  const { sx, sy, side } = computeCoverCrop(video.videoWidth, video.videoHeight)
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, sx, sy, side, side, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
}

/** The one classification path — used for the live-dots preview, the
 *  freeze-frame grid, and every reclassification (e.g. after
 *  recalibration). Previously the freeze-frame path used `calibrate.ts`'s
 *  `reclassifyAll` once calibrated, which skips `classifySticker`'s glare
 *  penalty — a second, subtly different pipeline from the live preview's
 *  `classifySticker` calls. Routing everything through this one function
 *  makes that kind of drift impossible instead of just unlikely. */
export function classifyFrame(
  samples: readonly StickerSample[],
  centroids: Readonly<Record<Face, HSV>>,
  calibrated: boolean,
): ColorMatch[] {
  return samples.map((s) => classifySticker(s, centroids, calibrated))
}

/**
 * PR-26: drives the tap-to-capture scan flow — the full 6-face sequence, or
 * (per `options.captureOrder`) a single-face rescan. The app never decides
 * on its own that a cube is present and steady (that guesswork is what
 * PR-14's auto-capture got wrong); instead it continuously classifies the
 * live frame for the optional live-dots overlay, and only freezes a
 * reading when the user taps the shutter. A frozen reading always needs an
 * explicit Confirm — blocked while any sticker is low-confidence or the
 * center duplicates an already-captured face (`captureEligibility.ts`) —
 * or Retake. Manual per-sticker fixes are always available and always
 * unblock Confirm, so this is never a dead end. Previous/Next let the user
 * revisit any face in `captureOrder`, live or already captured, without
 * losing prior captures.
 */
export function useFaceCapture(active: boolean, options: FaceCaptureOptions = {}): FaceCaptureApi {
  const captureOrder = options.captureOrder ?? CAPTURE_ORDER

  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [cursorIndex, setCursorIndex] = useState(0)
  const [storedFaces, setStoredFaces] = useState<Partial<Record<Face, StoredReading>>>({})
  const [pending, setPending] = useState<PendingReading | null>(null)
  const [rawLiveStickers, setRawLiveStickers] = useState<ColorMatch[] | null>(null)

  const currentFace = captureOrder[cursorIndex] ?? null
  const isComplete = captureOrder.every((face) => storedFaces[face] !== undefined)
  const mode: CaptureMode = pending ? 'pending' : currentFace && storedFaces[currentFace] ? 'captured' : 'live'
  // The sampling effect below only ever writes `rawLiveStickers` while
  // `mode === 'live'`, but React state can't be cleared synchronously the
  // instant `mode` changes without an effect (which lint rightly flags as
  // cascading-render-prone) — so mask the possibly-stale value here instead.
  const liveStickers = mode === 'live' ? rawLiveStickers : null

  /** Derived, not stored: recomputed from `storedFaces`' six center samples
   *  whenever they change, so there's a single source of truth instead of
   *  state that has to be kept in sync via an effect. */
  const { centroids, calibrated } = useMemo(() => {
    const centers: Partial<Record<Face, HSV>> = {}
    for (const face of FACE_ORDER) {
      const stored = storedFaces[face]
      if (stored) centers[face] = stored.samples[4].hsv
    }
    if (isFullyCalibrated(centers)) {
      return { centroids: calibrateFromCenters(centers), calibrated: true }
    }
    return {
      centroids: options.seedCentroids ?? DEFAULT_CENTROIDS,
      calibrated: options.seedCalibrated ?? false,
    }
  }, [storedFaces, options.seedCentroids, options.seedCalibrated])

  /** Classifies a stored/pending reading's 9 samples against the current
   *  centroids, with manual overrides (always confidence 1) applied on top.
   *  Always routes through `classifyFrame` — see its doc comment for why
   *  that matters. */
  const classifyReading = useCallback(
    (reading: StoredReading): ColorMatch[] => {
      const classified = classifyFrame(reading.samples, centroids, calibrated)
      return classified.map((c, i) => {
        const override = reading.overrides[i]
        return override !== undefined ? { color: override, confidence: 1 } : c
      })
    },
    [centroids, calibrated],
  )

  const grid = useMemo(() => {
    if (pending) return classifyReading(pending)
    if (currentFace && storedFaces[currentFace]) return classifyReading(storedFaces[currentFace]!)
    return null
  }, [pending, currentFace, storedFaces, classifyReading])

  const gridDebug = useMemo(() => {
    const reading = pending ?? (currentFace ? storedFaces[currentFace] : undefined)
    if (!reading) return null
    return reading.samples.map((s) => classifyColorDebug(s.hsv, centroids))
  }, [pending, currentFace, storedFaces, centroids])

  /** Center colors already spoken for — this instance's own confirmed
   *  captures plus any carried in from a wider scan session (PR-15 rescan). */
  const existingCenters = useMemo(() => {
    const own = FACE_ORDER.flatMap((face) => {
      const stored = storedFaces[face]
      return stored ? [classifyReading(stored)[4].color] : []
    })
    const prior = options.priorFaces
      ? FACE_ORDER.flatMap((face) => {
          const captured = options.priorFaces?.[face]
          return captured ? [captured.colors[4]] : []
        })
      : []
    return [...own, ...prior]
  }, [storedFaces, classifyReading, options.priorFaces])

  const eligibility = useMemo(() => {
    if (!pending || !currentFace) return null
    const classified = classifyReading(pending)
    return evaluateCapture(
      { classifications: classified.map((c) => c.color), confidences: classified.map((c) => c.confidence) },
      existingCenters,
      currentFace,
    )
  }, [pending, currentFace, classifyReading, existingCenters])

  useEffect(() => {
    if (!active || mode !== 'live') return undefined

    hiddenCanvasRef.current ??= document.createElement('canvas')
    const canvas = hiddenCanvasRef.current

    const tick = () => {
      const video = videoElRef.current
      if (!video) return
      const image = drawVideoFrame(video, canvas)
      if (!image) return

      const samples = sampleGrid(image)
      const classified = classifyFrame(samples, centroids, calibrated)
      setRawLiveStickers(classified)
    }

    const interval = setInterval(tick, SAMPLE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [active, mode, centroids, calibrated])

  const captureNow = useCallback(() => {
    if (mode !== 'live' || !currentFace) return
    const video = videoElRef.current
    hiddenCanvasRef.current ??= document.createElement('canvas')
    const canvas = hiddenCanvasRef.current
    if (!video) return
    // Draw + sample synchronously, right now, on the same canvas the
    // toDataURL snapshot below reads from — see `drawVideoFrame`'s doc
    // comment. This is what makes the frozen frame match what the live
    // preview was just showing: no dependency on the last ~200ms tick.
    const image = drawVideoFrame(video, canvas)
    if (!image) return
    const samples = sampleGrid(image)
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85)

    if (import.meta.env.DEV) {
      const fresh = classifyFrame(samples, centroids, calibrated)
      const describe = (c: ColorMatch) => `${c.color}:${c.confidence.toFixed(2)}`
      console.log(
        `[scan] capture ${currentFace} — live vs frozen classification:`,
        '\n  live   ',
        rawLiveStickers?.map(describe).join(' ') ?? '(no live sample yet)',
        '\n  frozen ',
        fresh.map(describe).join(' '),
      )
    }

    setPending({ face: currentFace, samples, overrides: {}, imageDataUrl })
  }, [mode, currentFace, centroids, calibrated, rawLiveStickers])

  const confirmPending = useCallback(() => {
    if (!pending || !eligibility?.canConfirm) return
    const { face, ...reading } = pending
    setStoredFaces((prev) => ({ ...prev, [face]: reading }))
    setPending(null)
    setCursorIndex((i) => Math.min(i + 1, captureOrder.length - 1))
  }, [pending, eligibility, captureOrder.length])

  const retake = useCallback(() => {
    if (pending) {
      setPending(null)
      return
    }
    if (currentFace && storedFaces[currentFace]) {
      setStoredFaces((prev) => {
        const next = { ...prev }
        delete next[currentFace]
        return next
      })
    }
  }, [pending, currentFace, storedFaces])

  const setCellColor = useCallback(
    (index: number, color: Face) => {
      if (pending) {
        setPending((prev) => (prev ? { ...prev, overrides: { ...prev.overrides, [index]: color } } : prev))
        return
      }
      if (currentFace && storedFaces[currentFace]) {
        setStoredFaces((prev) => {
          const stored = prev[currentFace]
          if (!stored) return prev
          return {
            ...prev,
            [currentFace]: { ...stored, overrides: { ...stored.overrides, [index]: color } },
          }
        })
      }
    },
    [pending, currentFace, storedFaces],
  )

  const goPrevious = useCallback(() => {
    setPending(null)
    setCursorIndex((i) => Math.max(0, i - 1))
  }, [])

  const goNext = useCallback(() => {
    setPending(null)
    setCursorIndex((i) => Math.min(captureOrder.length - 1, i + 1))
  }, [captureOrder.length])

  const faces = useMemo(() => {
    const result: Partial<Record<Face, CapturedFace>> = {}
    for (const face of FACE_ORDER) {
      const stored = storedFaces[face]
      if (!stored) continue
      const classified = classifyReading(stored)
      result[face] = { colors: classified.map((c) => c.color), confidence: classified.map((c) => c.confidence) }
    }
    return result
  }, [storedFaces, classifyReading])

  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el
  }, [])

  const frameImage = pending
    ? pending.imageDataUrl
    : currentFace && storedFaces[currentFace]
      ? storedFaces[currentFace]!.imageDataUrl
      : null

  return {
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
    canGoPrevious: cursorIndex > 0,
    canGoNext: cursorIndex < captureOrder.length - 1,
    centroids,
    calibrated,
  }
}
