import { useState } from 'react'
import type { Face, FaceletString } from '../core/types'
import { SOLVED } from '../core/types'
import { FACE_ORDER, FACE_POSITIONS, faceOf, setFaceletAt } from '../core/facelets'
import { localizeIssue, validate } from '../core/validate'
import { FACE_COLOR_NAMES, STICKER_COLORS } from '../render/colors'
import { CROSS_LAYOUT } from './crossLayout'
import { describeIssue } from './describeIssue'

export interface EditScreenProps {
  /** Called with the validated cube state once the user confirms it. */
  onSolveThisCube: (state: FaceletString) => void
  /** PR-15: seed the editor from a scanned cube instead of SOLVED. */
  initialState?: FaceletString
  /** PR-15: additional flagged stickers from scan confidence, independent of
   *  validate()'s issue-driven flagging (PR-11) — both render identically. */
  lowConfidencePositions?: ReadonlySet<number>
  /** PR-15: present when arriving from a scan review; offers picking a face
   *  to rescan instead of correcting it by hand. */
  onRescanFace?: (face: Face) => void
}

/** PR-10/15: the unfolded cube editor — manual color entry (the permanent
 *  fallback to camera scanning, D7/Phase 5) and, reusing this same
 *  component, the post-scan review screen. Centers stay fixed since they
 *  define the color scheme (D3); every other sticker is paintable from the
 *  6-color palette. A live `validate()` banner gates "Solve this cube". */
export function EditScreen({
  onSolveThisCube,
  initialState,
  lowConfidencePositions,
  onRescanFace,
}: EditScreenProps) {
  const [state, setState] = useState<FaceletString>(initialState ?? SOLVED)
  const [selectedColor, setSelectedColor] = useState<Face>('U')
  const [pickingRescanFace, setPickingRescanFace] = useState(false)

  const result = validate(state)
  const firstIssue = result.issues[0] ?? null

  // PR-11: the offending stickers for the banner's issue, where it can be
  // localized to specific pieces (bad piece, twisted corner, flipped edge).
  const issuePositions = firstIssue ? localizeIssue(state, firstIssue) : []
  const flaggedPositions = new Set([...issuePositions, ...(lowConfidencePositions ?? [])])
  const unsureCount = lowConfidencePositions?.size ?? 0

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
        <span className="sub">{onRescanFace ? 'Check the scan' : 'Tap a sticker to paint it'}</span>
      </header>

      <div className="edit-body">
        <div className="edit-cross">
          {FACE_ORDER.map((face) => (
            <div
              key={face}
              className="face-block"
              style={{ gridColumn: CROSS_LAYOUT[face].column, gridRow: CROSS_LAYOUT[face].row }}
            >
              {faceOf(state, face).map((color, index) => {
                const isFlagged = flaggedPositions.has(FACE_POSITIONS[face][index])
                return (
                  <button
                    key={index}
                    type="button"
                    className={
                      'sticker' +
                      (index === 4 ? ' sticker-center' : '') +
                      (isFlagged ? ' sticker-flagged' : '')
                    }
                    style={{ background: STICKER_COLORS[color] }}
                    aria-label={
                      `${face} face, sticker ${index + 1}: ${FACE_COLOR_NAMES[color]}` +
                      (isFlagged ? ' (flagged)' : '')
                    }
                    disabled={index === 4}
                    onClick={() => paintSticker(face, index)}
                  />
                )
              })}
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

        {unsureCount > 0 && !firstIssue && (
          <p className="scan-unsure-note">
            {unsureCount === 1 ? '1 sticker looks unsure' : `${unsureCount} stickers look unsure`} —
            tap to fix, or rescan the face.
          </p>
        )}

        {firstIssue && (
          <div className="validation-banner">
            <p>{describeIssue(firstIssue)}</p>
          </div>
        )}

        {onRescanFace &&
          (pickingRescanFace ? (
            <div className="palette" role="group" aria-label="Face to rescan">
              {FACE_ORDER.map((face) => (
                <button
                  key={face}
                  type="button"
                  className="palette-swatch"
                  style={{ background: STICKER_COLORS[face] }}
                  aria-label={`Rescan ${FACE_COLOR_NAMES[face]}`}
                  onClick={() => onRescanFace(face)}
                />
              ))}
            </div>
          ) : (
            <button className="btn-link" onClick={() => setPickingRescanFace(true)}>
              Rescan a face
            </button>
          ))}

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
