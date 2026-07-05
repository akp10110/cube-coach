/**
 * PR-12: `getUserMedia` wrapper + device selection. Not under `src/core`
 * (D2) — this module is allowed to touch browser APIs; `ui/useCamera.ts` is
 * the thin hook that wires it to a component's lifecycle (same split as
 * `render/CubeRenderer.ts` + its hook, D6).
 */

export type CameraFacing = 'user' | 'environment'

export type CameraErrorKind = 'permission-denied' | 'no-camera' | 'unknown'

export interface CameraProfile {
  /** Rear camera on mobile, default (front-facing) camera on desktop. */
  facing: CameraFacing
  /** Desktop's front-facing webcam is mirrored to match what the user sees
   *  in a mirror; the rear camera on mobile never is (D7/PR-12 scope). */
  mirrored: boolean
}

/** Feature-detects a touch-primary (mobile) device via a coarse-pointer
 *  media query rather than user-agent sniffing. */
function isTouchPrimaryDevice(): boolean {
  return (
    typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false)
  )
}

export function cameraProfile(): CameraProfile {
  const isMobile = isTouchPrimaryDevice()
  return { facing: isMobile ? 'environment' : 'user', mirrored: !isMobile }
}

export async function requestCameraStream(facing: CameraFacing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing },
    audio: false,
  })
}

export function stopCameraStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop())
}

/** Classifies a `getUserMedia` rejection into the two states PR-12 must
 *  handle explicitly, or `'unknown'` for anything else. */
export function classifyCameraError(error: unknown): CameraErrorKind {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'permission-denied'
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'no-camera'
    }
  }
  return 'unknown'
}
