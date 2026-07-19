import { useCallback, useEffect, useRef } from 'react'
import type { Face } from '../core/types'
import { FACE_ORDER } from '../core/facelets'
import type { ColorMatch } from '../scan/colorDetect'
import { LOW_CONFIDENCE_THRESHOLD } from '../scan/colorDetect'
import { CUBE_BODY_COLOR, STICKER_COLORS } from '../render/colors'
import { CubeRenderer } from '../render/CubeRenderer'
import type { CapturedFace } from './useFaceCapture'

const NEUTRAL_FACE: readonly string[] = Array.from({ length: 9 }, () => CUBE_BODY_COLOR)

export interface ScanCubePreviewOptions {
  /** Face the capture cursor is on; the model orbits to face it. */
  currentFace: Face | null
  /** Whether `currentFace` is still awaiting capture (its stickers should
   *  track `liveStickers`) as opposed to already locked (shows `faces`). */
  isLive: boolean
  /** Live classification of the current camera frame, painted onto
   *  `currentFace` while `isLive` — the LOCKED palette (STICKER_COLORS), not
   *  raw sample color, so the model reads as a believable cube. */
  liveStickers: ColorMatch[] | null
  /** Every captured face (this instance's own plus any carried in from a
   *  wider scan session) — painted with locked colors; low-confidence
   *  stickers get the amber model outline. */
  faces: Partial<Record<Face, CapturedFace>>
  /** Fired when a plain tap lands on a stickered cubelet face. */
  onStickerTap: (face: Face, index: number) => void
}

/**
 * Bridges the tap-to-capture scan flow to a live `CubeRenderer` (D6): as the
 * user points at a face, that face of the 3D model fills in with the live
 * detected colors; once captured, a face shows its locked colors and stays
 * tappable for manual fixes. Every other face — not yet reached — stays
 * plain plastic, since D3's `Face` alphabet has no "unscanned" value to
 * paint it with (see `CubeRenderer.paintSticker`'s doc comment).
 */
export function useScanCubePreview({
  currentFace,
  isLive,
  liveStickers,
  faces,
  onStickerTap,
}: ScanCubePreviewOptions): { attachCanvas: (canvas: HTMLCanvasElement | null) => void } {
  const rendererRef = useRef<CubeRenderer | null>(null)
  // Ref so `attachCanvas` (identity-stable, wired once per mount) always
  // calls the latest `onStickerTap` without needing to reattach the renderer.
  const onStickerTapRef = useRef(onStickerTap)
  useEffect(() => {
    onStickerTapRef.current = onStickerTap
  })

  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    rendererRef.current?.dispose()
    rendererRef.current = null
    if (!canvas) return
    const renderer = new CubeRenderer(canvas)
    renderer.onStickerTap((sticker) => onStickerTapRef.current(sticker.face, sticker.index))
    rendererRef.current = renderer
  }, [])

  // Repaints every render: the cheapest correct way to stay in sync with
  // `faces`/`currentFace`/`liveStickers` across every navigation path
  // (capture, retake, Previous/Next) without hand-rolling a reset for each.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    for (const face of FACE_ORDER) {
      const captured = faces[face]
      if (captured) {
        renderer.paintFace(face, captured.colors.map((color) => STICKER_COLORS[color]))
        captured.confidence.forEach((confidence, index) =>
          renderer.setStickerFlag(face, index, confidence < LOW_CONFIDENCE_THRESHOLD),
        )
      } else if (face === currentFace && isLive && liveStickers) {
        renderer.paintFace(face, liveStickers.map((s) => STICKER_COLORS[s.color]))
        liveStickers.forEach((_, index) => renderer.setStickerFlag(face, index, false))
      } else {
        renderer.paintFace(face, NEUTRAL_FACE)
        NEUTRAL_FACE.forEach((_, index) => renderer.setStickerFlag(face, index, false))
      }
    }
  })

  useEffect(() => {
    if (currentFace) void rendererRef.current?.showFace(currentFace)
  }, [currentFace])

  return { attachCanvas }
}
