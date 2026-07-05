import type { FaceletString } from '../core/types'
import { formatMoves } from '../core/moves'
import { STICKER_COLORS } from '../render/colors'
import { describeLayer } from './describeLayer'
import { useSolveSession } from './useSolveSession'

export interface SolveScreenProps {
  /** Cube state to start the session from (PR-10 hand-off from the manual
   *  editor); defaults to SOLVED inside `useSolveSession`. */
  initialState?: FaceletString
  /** Present when the app can navigate to the manual editor (PR-10). */
  onEditColors?: () => void
  /** Present when the app can navigate to the camera scan screen (PR-12). */
  onScanCube?: () => void
}

/** PR-08: real app layout (design-mocks.html screen 2) — header, cube stage,
 *  control panel with follow-mode move card + "I did it", and the secondary
 *  watch-mode transport (prev/play-pause/next/speed). */
export function SolveScreen({ initialState, onEditColors, onScanCube }: SolveScreenProps) {
  const {
    attachCanvas,
    solverReady,
    isScrambling,
    isSolving,
    solveError,
    solverMoveCount,
    solutionMoves,
    cursorInSolution,
    currentMove,
    isSolved,
    isPlaying,
    speed,
    canScramble,
    canSolve,
    onScramble,
    onSolve,
    onIDidIt,
    onPrev,
    onNext,
    onPlayPause,
    onSpeedChange,
  } = useSolveSession(initialState)

  const description = currentMove ? describeLayer(currentMove) : null
  const total = solutionMoves.length
  const progressPct = total > 0 ? ((cursorInSolution + 1) / total) * 100 : 0

  const pillText = isScrambling
    ? 'Scrambling…'
    : isSolving
      ? 'Solving…'
      : solverMoveCount !== null
        ? `Quick solve · ${solverMoveCount} moves`
        : solverReady
          ? 'Ready'
          : 'Preparing solver…'

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ◆
          </span>
          <span>CubeCoach</span>
        </div>
        <span className="pill">{pillText}</span>
      </header>

      <div className="solve-body">
        <div className="cube-stage">
          <canvas ref={attachCanvas} />
        </div>

        <div className="control-panel">
          {description && currentMove ? (
            <div className="move-card">
              <div className="move-card-top">
                <p className="move-headline">
                  <span
                    className="swatch"
                    style={{ background: STICKER_COLORS[description.colorFace] }}
                    aria-hidden="true"
                  />
                  {description.headline}
                </p>
                <span className="notation-chip">{currentMove}</span>
              </div>
              <p className="move-detail">{description.detail}</p>
            </div>
          ) : (
            <div className={'move-card move-card-empty' + (isSolved ? ' is-celebrating' : '')}>
              {isSolved && (
                <span className="confetti" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              )}
              <p>
                {isSolved
                  ? 'Solved!'
                  : total > 0
                    ? 'Getting the next move ready…'
                    : 'Scramble your cube, then hit Solve.'}
              </p>
            </div>
          )}

          <button className="btn-primary" onClick={onIDidIt} disabled={!currentMove}>
            I did it
          </button>

          <div className="progress-row">
            <span>
              {total > 0 ? `Move ${Math.min(cursorInSolution + 1, total)} of ${total}` : ''}
            </span>
            <span>{isPlaying ? 'Watch mode' : 'Follow mode'}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>

          {total > 0 && (
            <div className="chip-row">
              {solutionMoves.map((move, index) => (
                <span
                  key={index}
                  className={
                    'chip' +
                    (index === cursorInSolution
                      ? ' is-current'
                      : index < cursorInSolution
                        ? ' is-done'
                        : '')
                  }
                >
                  {formatMoves([move])}
                </span>
              ))}
            </div>
          )}

          <div className="transport">
            <button
              className="transport-btn"
              onClick={onPrev}
              disabled={cursorInSolution <= 0}
              aria-label="Previous move"
            >
              ‹
            </button>
            <button
              className="transport-btn"
              onClick={onPlayPause}
              disabled={!currentMove && !isPlaying}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <button
              className="transport-btn"
              onClick={onNext}
              disabled={!currentMove}
              aria-label="Next move"
            >
              ›
            </button>
            <div className="speed-control">
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={speed}
                onChange={(event) => onSpeedChange(Number(event.target.value))}
                aria-label="Playback speed"
              />
              <span className="speed-pill">Speed {speed.toFixed(1)}×</span>
            </div>
          </div>

          <div className="actions">
            <button className="btn-secondary" onClick={onScramble} disabled={!canScramble}>
              Scramble
            </button>
            <button className="btn-primary" onClick={onSolve} disabled={!canSolve}>
              Solve
            </button>
          </div>

          {!solverReady && !solveError && <p className="hint">Preparing solver…</p>}
          {solveError && <p className="solve-error">{solveError}</p>}

          {onScanCube && (
            <button className="btn-link" onClick={onScanCube}>
              Scan my cube
            </button>
          )}
          {onEditColors && (
            <button className="btn-link" onClick={onEditColors}>
              Enter colors manually
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
