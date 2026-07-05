import { Vector3 } from 'three'
import type { Face, Move } from '../core/types'

/**
 * Pure geometry for the move-guidance cue (tasks.md section 9 rules 2/3/8):
 * the curved in-plane arrow drawn on the turning face, swept by exactly the
 * turn's angle. `MOVE_AXIS`/`angleForMove` are the single source of truth
 * for a move's rotation axis/direction — CubeRenderer's pivot tween and this
 * arc both read from here so they can never silently drift apart.
 */

export type MoveAxis = 'x' | 'y' | 'z'

const HALF_PI = Math.PI / 2

/**
 * Which grid layer each face's turn affects and the signed radians of a
 * clockwise-viewed-from-outside quarter turn. See CubeRenderer's coordinate
 * system: x:-1=L/+1=R, y:-1=D/+1=U, z:-1=B/+1=F. Faces whose outward normal
 * is the POSITIVE axis direction (U/R/F) turn -90 deg for a clockwise
 * quarter; NEGATIVE-normal faces (D/L/B) turn +90 deg — mirror images of
 * the same physical turn.
 */
export const MOVE_AXIS: Readonly<
  Record<Face, { axis: MoveAxis; layer: -1 | 1; quarterAngle: number }>
> = {
  U: { axis: 'y', layer: 1, quarterAngle: -HALF_PI },
  D: { axis: 'y', layer: -1, quarterAngle: HALF_PI },
  R: { axis: 'x', layer: 1, quarterAngle: -HALF_PI },
  L: { axis: 'x', layer: -1, quarterAngle: HALF_PI },
  F: { axis: 'z', layer: 1, quarterAngle: -HALF_PI },
  B: { axis: 'z', layer: -1, quarterAngle: HALF_PI },
}

export const AXIS_INDEX: Readonly<Record<MoveAxis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 }

const AXIS_VECTOR: Readonly<Record<MoveAxis, Vector3>> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
}

/** Reference "up" direction within each face's plane (perpendicular to its
 *  axis), used as the arc's zero-angle position so the sweep is centered on
 *  the face rather than starting from an arbitrary edge. */
const REFERENCE_RADIAL: Readonly<Record<MoveAxis, Vector3>> = {
  x: new Vector3(0, 1, 0),
  y: new Vector3(0, 0, 1),
  z: new Vector3(0, 1, 0),
}

export function angleForMove(move: Move): { axis: MoveAxis; layer: -1 | 1; angle: number } {
  const face = move[0] as Face
  const modifier = move.slice(1)
  const spec = MOVE_AXIS[face]
  const angle =
    modifier === '2'
      ? spec.quarterAngle * 2
      : modifier === "'"
        ? -spec.quarterAngle
        : spec.quarterAngle
  return { axis: spec.axis, layer: spec.layer, angle }
}

export interface ArcPoint {
  x: number
  y: number
  z: number
}

/**
 * Points along the guidance arc for `move`: lies in the plane of its turning
 * face, centered on the face, swept by exactly the turn's angle (90 deg for
 * quarter turns, 180 deg for double turns — "arrow sweep must match the
 * turn amount") in the same rotational sense as the real turn. `faceDistance`
 * is how far outward along the axis the arc plane sits (outer sticker
 * surface plus a small offset so it doesn't z-fight the stickers).
 */
export function guidanceArcPoints(
  move: Move,
  radius: number,
  faceDistance: number,
  segments = 24,
): ArcPoint[] {
  const { axis, layer, angle } = angleForMove(move)
  const axisVector = AXIS_VECTOR[axis]
  const center = axisVector.clone().multiplyScalar(layer * faceDistance)
  const reference = REFERENCE_RADIAL[axis].clone().multiplyScalar(radius)

  const points: ArcPoint[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const theta = -angle / 2 + angle * t
    const point = reference.clone().applyAxisAngle(axisVector, theta).add(center)
    points.push({ x: point.x, y: point.y, z: point.z })
  }
  return points
}
