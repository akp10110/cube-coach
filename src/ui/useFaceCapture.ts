import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Face } from '../core/types'
import { FACE_ORDER } from '../core/facelets'
import type { ColorMatch, HSV, StickerSample } from '../scan/colorDetect'
import { DEFAULT_CENTROIDS, classifySticker, sampleGrid } from '../scan/colorDetect'
import { calibrateFromCenters, isFullyCalibrated, reclassifyAll } from '../scan/calibrate'
import { CAPTURE_ORDER } from './scanInstructions'

const SAMPLE_INTERVAL_MS = 200
const STABLE_DURATION_MS = 1000
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

/** Whether two per-sticker color readings are identical, face by face. */
export function colorsMatch(a: readonly Face[], b: readonly Face[] | null): boolean {
  return b !== null && b.length === a.length && a.every((color, i) => color === b[i])
}

/**
 * PR-14/15: drives the guided scan — the full 6-face sequence, or (per
 * `options.captureOrder`) a single-face rescan. Samples the live video
 * ~5x/second, classifies each of the 9 stickers, and auto-captures a face
 * once its classification holds steady for ~1s (or immediately via
 * `captureNow`). Once all six centers are in, recalibrates from them and
 * reclassifies every face captured so far (tasks.md PR-13's calibrate.ts
 * contract) — this only fires during a full scan, since a single-face
 * rescan never has all six centers in its own `stickerSamples`.
 */
export function useFaceCapture(active: boolean, options: FaceCaptureOptions = {}): FaceCaptureApi {
  const captureOrder = options.captureOrder ?? CAPTURE_ORDER

  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const stableSinceRef = useRef<number | null>(null)
  const lastColorsRef = useRef<Face[] | null>(null)
  const latestSamplesRef = useRef<StickerSample[] | null>(null)

  const [faceIndex, setFaceIndex] = useState(0)
  const [stickerSamples, setStickerSamples] = useState<Partial<Record<Face, StickerSample[]>>>({})
  const [centroids, setCentroids] = useState<Record<Face, HSV>>(
    options.seedCentroids ?? DEFAULT_CENTROIDS,
  )
  const [calibrated, setCalibrated] = useState(options.seedCalibrated ?? false)
  const [liveStickers, setLiveStickers] = useState<ColorMatch[] | null>(null)

  const isComplete = faceIndex >= captureOrder.length
  const currentFace = isComplete ? null : captureOrder[faceIndex]

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

      stableSinceRef.current = null
      lastColorsRef.current = null
      latestSamplesRef.current = null
      setLiveStickers(null)
      setFaceIndex((i) => i + 1)
    },
    [faceIndex, captureOrder],
  )

  const captureNow = useCallback(() => {
    if (latestSamplesRef.current) finalizeFace(latestSamplesRef.current)
  }, [finalizeFace])

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
      if (colorsMatch(colors, lastColorsRef.current)) {
        stableSinceRef.current ??= now
        if (now - stableSinceRef.current >= STABLE_DURATION_MS) {
          finalizeFace(samples)
          return
        }
      } else {
        stableSinceRef.current = now
      }
      lastColorsRef.current = colors
    }

    const interval = setInterval(tick, SAMPLE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [active, isComplete, centroids, calibrated, finalizeFace])

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
  }
}
