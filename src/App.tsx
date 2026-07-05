import { useState } from 'react'
import type { FaceletString } from './core/types'
import { SOLVED } from './core/types'
import { EditScreen } from './ui/EditScreen'
import { ScanScreen } from './ui/ScanScreen'
import { SolveScreen } from './ui/SolveScreen'

type Screen = 'solve' | 'edit' | 'scan'

function App() {
  const [screen, setScreen] = useState<Screen>('solve')
  const [solveState, setSolveState] = useState<FaceletString>(SOLVED)

  if (screen === 'scan') {
    return <ScanScreen onEnterColorsManually={() => setScreen('edit')} />
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
