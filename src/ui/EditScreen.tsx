import { useState } from 'react'
import type { Face, FaceletString } from '../core/types'
import { SOLVED } from '../core/types'
import { FACE_ORDER, faceOf, setFaceletAt } from '../core/facelets'
import { validate } from '../core/validate'
import { FACE_COLOR_NAMES, STICKER_COLORS } from '../render/colors'
import { describeIssue } from './describeIssue'

/** Cross-shaped grid position for each face (design-mocks.html screen 5):
 *  U above F, D below F, L/B/R in a row either side of F. */
const CROSS_LAYOUT: Readonly<Record<Face, { column: number; row: number }>> = {
  U: { column: 2, row: 1 },
  L: { column: 1, row: 2 },
  F: { column: 2, row: 2 },
  R: { column: 3, row: 2 },
  B: { column: 4, row: 2 },
  D: { column: 2, row: 3 },
}

export interface EditScreenProps {
  /** Called with the validated cube state once the user confirms it. */
  onSolveThisCube: (state: FaceletString) => void
}

/** PR-10: the unfolded cube editor — manual color entry, the permanent
 *  fallback to camera scanning (D7/Phase 5). Centers stay fixed since they
 *  define the color scheme (D3); every other sticker is paintable from the
 *  6-color palette. A live `validate()` banner gates "Solve this cube". */
export function EditScreen({ onSolveThisCube }: EditScreenProps) {
  const [state, setState] = useState<FaceletString>(SOLVED)
  const [selectedColor, setSelectedColor] = useState<Face>('U')

  const result = validate(state)
  const firstIssue = result.issues[0] ?? null

  function paintSticker(face: Face, index: number) {
    if (index === 4) return // centers are fixed
    setState((prev) => setFaceletAt(prev, face, index, selectedColor))
  }

  return (
    <main className="app-shell edit-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ◆
          </span>
          <span>CubeCoach</span>
        </div>
        <span className="sub">Tap a sticker to paint it</span>
      </header>

      <div className="edit-body">
        <div className="edit-cross">
          {FACE_ORDER.map((face) => (
            <div
              key={face}
              className="face-block"
              style={{ gridColumn: CROSS_LAYOUT[face].column, gridRow: CROSS_LAYOUT[face].row }}
            >
              {faceOf(state, face).map((color, index) => (
                <button
                  key={index}
                  type="button"
                  className={'sticker' + (index === 4 ? ' sticker-center' : '')}
                  style={{ background: STICKER_COLORS[color] }}
                  aria-label={`${face} face, sticker ${index + 1}: ${FACE_COLOR_NAMES[color]}`}
                  disabled={index === 4}
                  onClick={() => paintSticker(face, index)}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="palette" role="group" aria-label="Sticker color">
          {FACE_ORDER.map((face) => (
            <button
              key={face}
              type="button"
              className={'palette-swatch' + (face === selectedColor ? ' is-selected' : '')}
              style={{ background: STICKER_COLORS[face] }}
              aria-label={FACE_COLOR_NAMES[face]}
              aria-pressed={face === selectedColor}
              onClick={() => setSelectedColor(face)}
            />
          ))}
        </div>

        {firstIssue && (
          <div className="validation-banner">
            <p>{describeIssue(firstIssue)}</p>
          </div>
        )}

        <button
          className="btn-primary"
          disabled={!result.ok}
          onClick={() => onSolveThisCube(state)}
        >
          Solve this cube
        </button>
      </div>
    </main>
  )
}
