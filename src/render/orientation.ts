import { Euler, Quaternion, Vector3 } from 'three'
import type { Face } from '../core/types'

/**
 * Pure yaw/pitch orientation math for CubeRenderer's view (D6). Kept free of
 * WebGL/canvas so it's unit-testable: given the same (pitch, yaw, 0) Euler
 * CubeRenderer applies to its cube group, and a camera looking down -z from
 * +z, which faces are actually facing the camera right now, and — for the
 * hidden-face auto-orbit rule (tasks.md section 9 rule 7) — what's the
 * nearest three-quarter-view orientation that brings a given hidden face
 * into view.
 */

const FACE_NORMALS: Readonly<Record<Face, Vector3>> = {
  U: new Vector3(0, 1, 0),
  D: new Vector3(0, -1, 0),
  F: new Vector3(0, 0, 1),
  B: new Vector3(0, 0, -1),
  R: new Vector3(1, 0, 0),
  L: new Vector3(-1, 0, 0),
}

const CAMERA_DIR = new Vector3(0, 0, 1)

/** Dot-product margin above 0 before a face counts as "visible" — keeps
 *  near-edge-on faces (dot close to 0) from being treated as viewable. */
const VISIBILITY_EPSILON = 0.15

function worldNormal(face: Face, yaw: number, pitch: number): Vector3 {
  const quaternion = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'XYZ'))
  return FACE_NORMALS[face].clone().applyQuaternion(quaternion)
}

export function isFaceVisible(face: Face, yaw: number, pitch: number): boolean {
  return worldNormal(face, yaw, pitch).dot(CAMERA_DIR) > VISIBILITY_EPSILON
}

export function visibleFaces(yaw: number, pitch: number): Set<Face> {
  const faces = new Set<Face>()
  for (const face of Object.keys(FACE_NORMALS) as Face[]) {
    if (isFaceVisible(face, yaw, pitch)) faces.add(face)
  }
  return faces
}

/** The default three-quarter view (section 9 rule 6): Up + Front + Right. */
export const DEFAULT_YAW = -0.5
export const DEFAULT_PITCH = 0.45

/** Four yaw presets 90 deg apart, each pairing two side faces into view
 *  alongside U or D depending on pitch sign — 8 "corner" orientations total,
 *  matching the natural three-quarter cube view (never exploded/unfolded). */
const YAW_PRESETS = [0, 1, 2, 3].map((n) => DEFAULT_YAW + (n * Math.PI) / 2)
const PITCH_PRESETS = [DEFAULT_PITCH, -DEFAULT_PITCH]

/** Shortest signed angular distance from `b` to `a`, wrapped to (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  const raw = ((a - b + Math.PI) % (2 * Math.PI)) - Math.PI
  return raw < -Math.PI ? raw + 2 * Math.PI : raw
}

/**
 * Nearest three-quarter preset (yaw, pitch) that brings `face` into view,
 * measured from the current orientation so orbiting there disturbs the view
 * as little as possible (tasks.md section 9 rule 7: auto-orbit to reveal a
 * hidden move's face, then ease back afterwards).
 */
export function orientationShowingFace(
  face: Face,
  currentYaw: number,
  currentPitch: number,
): { yaw: number; pitch: number } {
  let best: { yaw: number; pitch: number } | undefined
  let bestDistance = Infinity

  for (const yaw of YAW_PRESETS) {
    for (const pitch of PITCH_PRESETS) {
      if (!isFaceVisible(face, yaw, pitch)) continue
      const distance = Math.abs(angleDelta(yaw, currentYaw)) + Math.abs(pitch - currentPitch)
      if (distance < bestDistance) {
        bestDistance = distance
        best = { yaw, pitch }
      }
    }
  }

  // Every face is visible from at least two of the 8 presets, so `best` is
  // always set; the fallback only guards the type.
  return best ?? { yaw: currentYaw, pitch: currentPitch }
}
