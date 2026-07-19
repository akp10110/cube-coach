import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Face } from '../core/types'
import { FACE_ORDER } from '../core/facelets'
import type { ClassificationDebugInfo, ColorMatch, HSV, StickerSample } from '../scan/colorDetect'
import { DEFAULT_CENTROIDS, classifyColorDebug, classifySticker, sampleGrid } from '../scan/colorDetect'
import { calibrateFromCenters, isFullyCalibrated } from '../scan/calibrate'
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

/** A face whose 9 stickers have been captured and locked onto the 3D model.
 *  `overrides` records manual tap-to-fix corrections by sticker index —
 *  always trusted over the classifier, and re-applied on top of every
 *  reclassification so a fix survives recalibration. */
interface StoredReading {
  samples: StickerSample[]
  overrides: Partial<Record<number, Face>>
}

export type CaptureMode = 'live' | 'captured'

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
  /** 'live': `currentFace` has no locked capture yet — the camera feed is
   *  what's being shown/classified. 'captured': `currentFace` is already
   *  locked onto the 3D model; the camera keeps streaming but no longer
   *  drives that face's colors. */
  mode: CaptureMode
  isComplete: boolean
  /** Finalized (captured) faces so far, in the shape of core's `FaceScan`. */
  faces: Partial<Record<Face, CapturedFace>>
  /** Live per-sticker classification of the current camera frame — always
   *  running while active, regardless of `mode`. */
  liveStickers: ColorMatch[] | null
  /** Per-cell HSV + nearest/runner-up centroid breakdown behind the live
   *  frame's classification, for the `/dev` overlay only. */
  liveDebug: ClassificationDebugInfo[] | null
  /** Set (with a friendly message) when the live frame's center already
   *  belongs to another captured face — captureNow refuses to lock a
   *  duplicate, matching this notice. `null` outside 'live' mode. */
  duplicateMessage: string | null
  /** Shutter: classifies the current live frame and locks it as
   *  `currentFace`'s capture — 'live' mode only, no-ops on a duplicate
   *  center. Does not advance the cursor; the user taps Next. */
  captureNow: () => void
  /** Clears `currentFace`'s capture so it can be reshot live. */
  retake: () => void
  /** Manual tap-to-fix: sets sticker `index` of `face`'s capture to `color`.
   *  Works on any already-captured face, not just `currentFace` — the 3D
   *  model is tappable everywhere it shows locked colors. No-op if `face`
   *  isn't captured. */
  setCellColor: (face: Face, index: number, color: Face) => void
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
 * source for both the live classification tick and the shutter capture.
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

/** The one classification path — used for the live tick and the shutter
 *  capture, so the two can never quietly disagree (see PR history: a prior
 *  freeze-frame bug came from routing through two different pipelines). */
export function classifyFrame(
  samples: readonly StickerSample[],
  centroids: Readonly<Record<Face, HSV>>,
  calibrated: boolean,
): ColorMatch[] {
  return samples.map((s) => classifySticker(s, centroids, calibrated))
}

/**
 * Drives the live-3D-cube scan flow — the full 6-face sequence, or (per
 * `options.captureOrder`) a single-face rescan. The camera feed is always
 * live; there is no freeze-frame step. Every ~200ms the current frame is
 * classified for the live preview (painted onto the current face of the 3D
 * model by the caller) and to watch for a duplicate center. Tapping the
 * shutter locks that reading onto `currentFace` — refused, with a friendly
 * message, if its center already belongs to another captured face; a
 * low-confidence sticker no longer blocks the capture, it's just marked (by
 * the caller, via each `CapturedFace`'s `confidence`) so it can be tapped
 * and fixed on the model afterward. Previous/Next revisit any face in
 * `captureOrder` without losing prior captures; manual per-sticker fixes
 * (`setCellColor`) work on any captured face at any time.
 */
export function useFaceCapture(active: boolean, options: FaceCaptureOptions = {}): FaceCaptureApi {
  const captureOrder = options.captureOrder ?? CAPTURE_ORDER

  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [cursorIndex, setCursorIndex] = useState(0)
  const [storedFaces, setStoredFaces] = useState<Partial<Record<Face, StoredReading>>>({})
  const [liveStickers, setLiveStickers] = useState<ColorMatch[] | null>(null)
  const [liveDebug, setLiveDebug] = useState<ClassificationDebugInfo[] | null>(null)

  const currentFace = captureOrder[cursorIndex] ?? null
  const isComplete = captureOrder.every((face) => storedFaces[face] !== undefined)
  const mode: CaptureMode = currentFace && storedFaces[currentFace] ? 'captured' : 'live'

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

  /** Classifies a stored reading's 9 samples against the current centroids,
   *  with manual overrides (always confidence 1) applied on top. Always
   *  routes through `classifyFrame` — see its doc comment for why that
   *  matters. */
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

  /** Center colors already spoken for — this instance's own captures plus
   *  any carried in from a wider scan session (PR-15 rescan). */
  const existingCenters = useMemo(() => {
    const own = FACE_ORDER.flatMap((face) => (faces[face] ? [faces[face]!.colors[4]] : []))
    const prior = options.priorFaces
      ? FACE_ORDER.flatMap((face) => {
          const captured = options.priorFaces?.[face]
          return captured ? [captured.colors[4]] : []
        })
      : []
    return [...own, ...prior]
  }, [faces, options.priorFaces])

  const duplicateMessage = useMemo(() => {
    if (!currentFace || mode !== 'live' || !liveStickers) return null
    return evaluateCapture(
      { classifications: liveStickers.map((s) => s.color), confidences: liveStickers.map((s) => s.confidence) },
      existingCenters,
      currentFace,
    ).duplicateMessage
  }, [currentFace, mode, liveStickers, existingCenters])

  useEffect(() => {
    if (!active) return undefined

    hiddenCanvasRef.current ??= document.createElement('canvas')
    const canvas = hiddenCanvasRef.current

    const tick = () => {
      const video = videoElRef.current
      if (!video) return
      const image = drawVideoFrame(video, canvas)
      if (!image) return

      const samples = sampleGrid(image)
      setLiveStickers(classifyFrame(samples, centroids, calibrated))
      if (import.meta.env.DEV) {
        setLiveDebug(samples.map((s) => classifyColorDebug(s.hsv, centroids)))
      }
    }

    const interval = setInterval(tick, SAMPLE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [active, centroids, calibrated])

  const captureNow = useCallback(() => {
    if (mode !== 'live' || !currentFace) return
    const video = videoElRef.current
    hiddenCanvasRef.current ??= document.createElement('canvas')
    const canvas = hiddenCanvasRef.current
    if (!video) return
    const image = drawVideoFrame(video, canvas)
    if (!image) return
    const samples = sampleGrid(image)
    const classified = classifyFrame(samples, centroids, calibrated)
    const { duplicateMessage: blockedBy } = evaluateCapture(
      { classifications: classified.map((c) => c.color), confidences: classified.map((c) => c.confidence) },
      existingCenters,
      currentFace,
    )
    if (blockedBy) return

    setStoredFaces((prev) => ({ ...prev, [currentFace]: { samples, overrides: {} } }))
  }, [mode, currentFace, centroids, calibrated, existingCenters])

  const retake = useCallback(() => {
    if (!currentFace || !storedFaces[currentFace]) return
    setStoredFaces((prev) => {
      const next = { ...prev }
      delete next[currentFace]
      return next
    })
  }, [currentFace, storedFaces])

  const setCellColor = useCallback((face: Face, index: number, color: Face) => {
    setStoredFaces((prev) => {
      const stored = prev[face]
      if (!stored) return prev
      return { ...prev, [face]: { ...stored, overrides: { ...stored.overrides, [index]: color } } }
    })
  }, [])

  const goPrevious = useCallback(() => {
    setCursorIndex((i) => Math.max(0, i - 1))
  }, [])

  const goNext = useCallback(() => {
    setCursorIndex((i) => Math.min(captureOrder.length - 1, i + 1))
  }, [captureOrder.length])

  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el
  }, [])

  return {
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
    canGoPrevious: cursorIndex > 0,
    canGoNext: cursorIndex < captureOrder.length - 1,
    centroids,
    calibrated,
  }
}
