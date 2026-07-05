import { useCallback, useEffect, useState } from 'react'
import type { Face, FaceScan, ScanSession } from '../core/types'

const STORAGE_KEY = 'cubecoach.scanSession'

/** Parses a persisted session, falling back to empty for missing or
 *  corrupt data. Pure, so it's unit-testable without `sessionStorage`. */
export function parseScanSession(raw: string | null): ScanSession {
  if (!raw) return { faces: {} }
  try {
    return JSON.parse(raw) as ScanSession
  } catch {
    return { faces: {} }
  }
}

function loadSession(): ScanSession {
  if (typeof sessionStorage === 'undefined') return { faces: {} }
  return parseScanSession(sessionStorage.getItem(STORAGE_KEY))
}

export interface ScanSessionApi {
  session: ScanSession
  /** Merges finalized faces (and, once available, calibration) into the
   *  persisted session. */
  recordFaces: (
    faces: Partial<Record<Face, FaceScan>>,
    calibration?: ScanSession['calibration'],
  ) => void
  /** Drops one face's scan — the other half of "Rescan face X". */
  clearFace: (face: Face) => void
  /** Drops the whole session, e.g. once its cube has been handed off to solve. */
  clearSession: () => void
}

/** PR-15: persists the in-progress scan to `sessionStorage` (D8: scan-only,
 *  no other app state) so an accidental refresh doesn't lose already-scanned
 *  faces. */
export function useScanSession(): ScanSessionApi {
  const [session, setSession] = useState<ScanSession>(loadSession)

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  }, [session])

  const recordFaces = useCallback(
    (faces: Partial<Record<Face, FaceScan>>, calibration?: ScanSession['calibration']) => {
      setSession((prev) => ({
        faces: { ...prev.faces, ...faces },
        calibration: calibration ?? prev.calibration,
      }))
    },
    [],
  )

  const clearFace = useCallback((face: Face) => {
    setSession((prev) => {
      const faces = { ...prev.faces }
      delete faces[face]
      return { ...prev, faces }
    })
  }, [])

  const clearSession = useCallback(() => setSession({ faces: {} }), [])

  return { session, recordFaces, clearFace, clearSession }
}
