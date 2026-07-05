import { useState } from 'react'
import type { Face, FaceletString, FaceScan, ScanSession } from './core/types'
import { SOLVED } from './core/types'
import { FACE_ORDER, facesToFaceletString, lowConfidencePositions } from './core/facelets'
import { LOW_CONFIDENCE_THRESHOLD } from './scan/colorDetect'
import { CAPTURE_ORDER } from './ui/scanInstructions'
import { EditScreen } from './ui/EditScreen'
import { ScanScreen } from './ui/ScanScreen'
import { SolveScreen } from './ui/SolveScreen'
import { useScanSession } from './ui/useScanSession'

type Screen = 'solve' | 'edit' | 'scan' | 'review'

/** Resumes wherever a persisted scan left off (PR-15): mid-scan faces send
 *  the user back to scanning the rest; a full 6-face session goes straight
 *  to review. */
function initialScreen(session: ScanSession): Screen {
  const done = FACE_ORDER.filter((face) => session.faces[face]).length
  if (done === 0) return 'solve'
  return done < 6 ? 'scan' : 'review'
}

function App() {
  const scanSession = useScanSession()
  const [screen, setScreen] = useState<Screen>(() => initialScreen(scanSession.session))
  const [solveState, setSolveState] = useState<FaceletString>(SOLVED)

  if (screen === 'scan') {
    const remaining = CAPTURE_ORDER.filter((face) => !scanSession.session.faces[face])
    return (
      <ScanScreen
        onEnterColorsManually={() => setScreen('edit')}
        captureOrder={remaining.length > 0 ? remaining : undefined}
        priorFaces={scanSession.session.faces}
        seedCentroids={scanSession.session.calibration}
        seedCalibrated={!!scanSession.session.calibration}
        onScanComplete={({ faces, centroids, calibrated }) => {
          scanSession.recordFaces(faces, calibrated ? centroids : undefined)
          setScreen('review')
        }}
      />
    )
  }

  if (screen === 'review') {
    const faces = scanSession.session.faces as Record<Face, FaceScan>
    return (
      <EditScreen
        initialState={facesToFaceletString(faces)}
        lowConfidencePositions={new Set(lowConfidencePositions(faces, LOW_CONFIDENCE_THRESHOLD))}
        onRescanFace={(face) => {
          scanSession.clearFace(face)
          setScreen('scan')
        }}
        onSolveThisCube={(state) => {
          scanSession.clearSession()
          setSolveState(state)
          setScreen('solve')
        }}
      />
    )
  }

  if (screen === 'edit') {
    return (
      <EditScreen
        onSolveThisCube={(state) => {
          setSolveState(state)
          setScreen('solve')
        }}
      />
    )
  }

  return (
    <SolveScreen
      initialState={solveState}
      onEditColors={() => setScreen('edit')}
      onScanCube={() => setScreen('scan')}
    />
  )
}

export default App
