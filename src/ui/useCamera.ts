import { useEffect, useRef, useState } from 'react'
import type { CameraErrorKind } from '../scan/camera'
import {
  cameraProfile,
  classifyCameraError,
  requestCameraStream,
  stopCameraStream,
} from '../scan/camera'

export type CameraStatus = 'starting' | 'ready' | 'error'

export interface CameraApi {
  /** Attach to the `<video>` element showing the live preview. */
  videoRef: (el: HTMLVideoElement | null) => void
  status: CameraStatus
  errorKind: CameraErrorKind | null
  mirrored: boolean
}

/** Starts the camera on mount and stops it on unmount (PR-12). */
export function useCamera(): CameraApi {
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<CameraStatus>('starting')
  const [errorKind, setErrorKind] = useState<CameraErrorKind | null>(null)
  const { facing, mirrored } = cameraProfile()

  useEffect(() => {
    let cancelled = false

    requestCameraStream(facing)
      .then((stream) => {
        if (cancelled) {
          stopCameraStream(stream)
          return
        }
        streamRef.current = stream
        if (videoElRef.current) videoElRef.current.srcObject = stream
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setErrorKind(classifyCameraError(err))
        setStatus('error')
      })

    return () => {
      cancelled = true
      if (streamRef.current) {
        stopCameraStream(streamRef.current)
        streamRef.current = null
      }
    }
  }, [facing])

  const videoRef = (el: HTMLVideoElement | null) => {
    videoElRef.current = el
    if (el && streamRef.current) el.srcObject = streamRef.current
  }

  return { videoRef, status, errorKind, mirrored }
}
