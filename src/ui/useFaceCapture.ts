import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Face } from '../core/types'
import { FACE_ORDER } from '../core/facelets'
import type { ColorMatch, HSV, StickerSample } from '../scan/colorDetect'
import { DEFAULT_CENTROIDS, classifySticker, sampleGrid } from '../scan/colorDetect'
import { calibrateFromCenters, isFullyCalibrated, reclassifyAll } from '../scan/calibrate'
import type { GateState } from '../scan/captureGate'
import { INITIAL_GATE_STATE, tickGate } from '../scan/captureGate'
import { duplicateCenterMessage, isDuplicateCenter } from '../scan/duplicateGuard'
import { CAPTURE_ORDER } from './scanInstructions'

const SAMPLE_INTERVAL_MS = 200
/** Sampling resolution for the hidden crop canvas — independent of the
 *  visible guide's on-screen (CSS) size. */
const SAMPLE_SIZE = 180

export interface CapturedFace {
  colors: Face[]
  confidence: number[]
}

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
  /** Face currently being captured; `null` once the capture order is done. */
  currentFace: Face | null
  isComplete: boolean
  /** Finalized captures so far, in the shape of core's `FaceScan`. */
  faces: Partial<Record<Face, CapturedFace>>
  /** Live per-sticker classification of the current frame, for the overlay;
   *  `null` before the first frame has been sampled. */
  liveStickers: ColorMatch[] | null
  /** Finalizes the current face right now instead of waiting for stability. */
  captureNow: () => void
  /** Current classification centroids — DEFAULT_CENTROIDS (or `seedCentroids`)
   *  until all six centers are in, then the recalibrated set. */
  centroids: Readonly<Record<Face, HSV>>
  /** Whether `centroids` are trustworthy calibrated centroids. */
  calibrated: boolean
  /** Capture-gate phase, for the `/dev` overlay (ARMED/STABLE/CAPTURED/COOLDOWN). */
  gateState: GateState
  /** Timestamp `gateState` was last computed at (from inside the sample
   *  tick, not render) — pass to `describeGateState` instead of calling
   *  `Date.now()` during render. */
  gateStateAt: number
  /** Set when the last capture attempt was rejected as a duplicate center;
   *  the scan screen should show this instead of the normal hold
   *  instruction until a genuinely new face is captured. */
  duplicateMessage: string | null
}

/** Maps a video's native resolution to the centered square crop that
 *  matches the on-screen guide's `object-fit: cover` (PR-14). Pure so it's
 *  unit-testable without a real `HTMLVideoElement`. */
export function computeCoverCrop(
  videoWidth: number,
  videoHeight: number,
): { sx: number; sy: number; side: number } {
  const side = Math.min(videoWidth, videoHeight)
  return { sx: (videoWidth - side) / 2, sy: (videoHeight - side) / 2, side }
}

/**
 * PR-14/15: drives the guided scan — the full 6-face sequence, or (per
 * `options.captureOrder`) a single-face rescan. Samples the live video
 * ~5x/second, classifies each of the 9 stickers, and feeds the reading
 * through the pure `captureGate` state machine (`src/scan/captureGate.ts`),
 * which decides when a steady reading has held long enough to auto-capture
 * — and, critically, refuses to re-arm immediately after a capture until
 * the classification has actually changed, so a held (not yet rotated)
 * cube can't be captured over and over. A capture whose center color
 * duplicates an already-captured face (`src/scan/duplicateGuard.ts`) is
 * never stored — most often the flip side of the same bug (the gate
 * fired again before the user moved the cube), but also a plain mis-scan.
 * Once all six centers are in, recalibrates from them and reclassifies
 * every face captured so far (tasks.md PR-13's calibrate.ts contract) —
 * this only fires during a full scan, since a single-face rescan never has
 * all six centers in its own `stickerSamples`.
 */
export function useFaceCapture(active: boolean, options: FaceCaptureOptions = {}): FaceCaptureApi {
  const captureOrder = options.captureOrder ?? CAPTURE_ORDER

  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const latestSamplesRef = useRef<StickerSample[] | null>(null)
  const gateStateRef = useRef<GateState>(INITIAL_GATE_STATE)
  const duplicateMessageRef = useRef<string | null>(null)

  const [faceIndex, setFaceIndex] = useState(0)
  const [stickerSamples, setStickerSamples] = useState<Partial<Record<Face, StickerSample[]>>>({})
  const [centroids, setCentroids] = useState<Record<Face, HSV>>(
    options.seedCentroids ?? DEFAULT_CENTROIDS,
  )
  const [calibrated, setCalibrated] = useState(options.seedCalibrated ?? false)
  const [liveStickers, setLiveStickers] = useState<ColorMatch[] | null>(null)
  const [gateState, setGateState] = useState<GateState>(INITIAL_GATE_STATE)
  const [gateStateAt, setGateStateAt] = useState(0)
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null)

  const isComplete = faceIndex >= captureOrder.length
  const currentFace = isComplete ? null : captureOrder[faceIndex]

  /** Center colors already spoken for — this instance's own captures plus
   *  any carried in from a wider scan session (PR-15 rescan flow). */
  const existingCenters = useMemo(() => {
    const own = FACE_ORDER.flatMap((face) => {
      const samples = stickerSamples[face]
      return samples ? [classifySticker(samples[4], centroids, calibrated).color] : []
    })
    const prior = options.priorFaces
      ? FACE_ORDER.flatMap((face) => {
          const captured = options.priorFaces?.[face]
          return captured ? [captured.colors[4]] : []
        })
      : []
    return [...own, ...prior]
  }, [stickerSamples, centroids, calibrated, options.priorFaces])

  const finalizeFace = useCallback(
    (samples: StickerSample[]) => {
      setStickerSamples((prev) => {
        const face = captureOrder[faceIndex]
        if (!face) return prev
        const next = { ...prev, [face]: samples }

        const centers: Partial<Record<Face, HSV>> = {}
        for (const f of FACE_ORDER) {
          const s = next[f]
          if (s) centers[f] = s[4].hsv
        }
        if (isFullyCalibrated(centers)) {
          setCentroids(calibrateFromCenters(centers))
          setCalibrated(true)
        }
        return next
      })

      latestSamplesRef.current = null
      setFaceIndex((i) => i + 1)
    },
    [faceIndex, captureOrder],
  )

  /** Shared by both the auto-capture gate and the manual button: never
   *  stores a duplicate center, surfacing the "show me a different side"
   *  message instead. */
  const attemptCapture = useCallback(
    (samples: StickerSample[], colors: readonly Face[]) => {
      const center = colors[4]
      if (currentFace && isDuplicateCenter(center, existingCenters)) {
        duplicateMessageRef.current = duplicateCenterMessage(center, currentFace)
        setDuplicateMessage(duplicateMessageRef.current)
        return
      }
      duplicateMessageRef.current = null
      setDuplicateMessage(null)
      finalizeFace(samples)
    },
    [currentFace, existingCenters, finalizeFace],
  )

  const captureNow = useCallback(() => {
    const samples = latestSamplesRef.current
    if (!samples) return
    const now = Date.now()
    const colors = samples.map((s) => classifySticker(s, centroids, calibrated).color)
    gateStateRef.current = { phase: 'captured', at: now, colors }
    setGateState(gateStateRef.current)
    setGateStateAt(now)
    attemptCapture(samples, colors)
  }, [centroids, calibrated, attemptCapture])

  useEffect(() => {
    if (!active || isComplete) return undefined

    hiddenCanvasRef.current ??= document.createElement('canvas')
    const canvas = hiddenCanvasRef.current

    const tick = () => {
      const video = videoElRef.current
      if (!video || video.readyState < 2 || !video.videoWidth) return

      const { sx, sy, side } = computeCoverCrop(video.videoWidth, video.videoHeight)
      canvas.width = SAMPLE_SIZE
      canvas.height = SAMPLE_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, sx, sy, side, side, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      const image = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

      const samples = sampleGrid(image)
      latestSamplesRef.current = samples
      const classified = samples.map((s) => classifySticker(s, centroids, calibrated))
      setLiveStickers(classified.map((c) => ({ color: c.color, confidence: c.confidence })))

      const colors = classified.map((c) => c.color)
      const now = Date.now()
      const result = tickGate(gateStateRef.current, colors, now)
      gateStateRef.current = result.state
      setGateState(result.state)
      setGateStateAt(now)

      if (result.state.phase === 'armed' && duplicateMessageRef.current !== null) {
        // Classification moved on from the duplicate reading — drop the
        // stale message while the fresh stability window builds.
        duplicateMessageRef.current = null
        setDuplicateMessage(null)
      }

      if (result.didCapture && result.state.phase === 'captured') {
        attemptCapture(samples, result.state.colors)
      }
    }

    const interval = setInterval(tick, SAMPLE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [active, isComplete, centroids, calibrated, attemptCapture])

  const faces = useMemo(() => {
    const result: Partial<Record<Face, CapturedFace>> = {}
    for (const face of FACE_ORDER) {
      const samples = stickerSamples[face]
      if (!samples) continue
      const classified = calibrated
        ? reclassifyAll(samples, centroids)
        : samples.map((s) => classifySticker(s, centroids, false))
      result[face] = {
        colors: classified.map((c) => c.color),
        confidence: classified.map((c) => c.confidence),
      }
    }
    return result
  }, [stickerSamples, centroids, calibrated])

  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el
  }, [])

  return {
    attachVideo,
    currentFace,
    isComplete,
    faces,
    liveStickers,
    captureNow,
    centroids,
    calibrated,
    gateState,
    gateStateAt,
    duplicateMessage,
  }
}
