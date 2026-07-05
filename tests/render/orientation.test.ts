import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PITCH,
  DEFAULT_YAW,
  isFaceVisible,
  orientationShowingFace,
  visibleFaces,
} from '../../src/render/orientation'
import type { Face } from '../../src/core/types'

describe('visibleFaces', () => {
  it('shows exactly Up + Front + Right from the default orientation (section 9 rule 6)', () => {
    const faces = visibleFaces(DEFAULT_YAW, DEFAULT_PITCH)
    expect(faces).toEqual(new Set<Face>(['U', 'F', 'R']))
  })

  it('shows the opposite trio when yawed and pitched by half a turn', () => {
    const faces = visibleFaces(DEFAULT_YAW + Math.PI, -DEFAULT_PITCH)
    expect(faces).toEqual(new Set<Face>(['D', 'B', 'L']))
  })

  it('always reports exactly 3 visible faces from any of the 8 corner presets', () => {
    for (let n = 0; n < 4; n++) {
      for (const pitch of [DEFAULT_PITCH, -DEFAULT_PITCH]) {
        const faces = visibleFaces(DEFAULT_YAW + (n * Math.PI) / 2, pitch)
        expect(faces.size).toBe(3)
      }
    }
  })
})

describe('isFaceVisible', () => {
  it('agrees with visibleFaces for every face', () => {
    const faces = visibleFaces(DEFAULT_YAW, DEFAULT_PITCH)
    for (const face of ['U', 'D', 'F', 'B', 'R', 'L'] as Face[]) {
      expect(isFaceVisible(face, DEFAULT_YAW, DEFAULT_PITCH)).toBe(faces.has(face))
    }
  })
})

describe('orientationShowingFace', () => {
  it('is a no-op when the face is already visible', () => {
    const result = orientationShowingFace('F', DEFAULT_YAW, DEFAULT_PITCH)
    expect(isFaceVisible('F', result.yaw, result.pitch)).toBe(true)
  })

  it('finds an orientation that reveals a hidden face', () => {
    for (const face of ['U', 'D', 'F', 'B', 'R', 'L'] as Face[]) {
      const result = orientationShowingFace(face, DEFAULT_YAW, DEFAULT_PITCH)
      expect(isFaceVisible(face, result.yaw, result.pitch)).toBe(true)
    }
  })

  it('picks the nearer of two presets containing a hidden back-row face', () => {
    // From the default (U,F,R) view, B is visible from two presets 90 deg
    // apart in yaw (paired with L or with R); either counts as "nearest".
    const result = orientationShowingFace('B', DEFAULT_YAW, DEFAULT_PITCH)
    const wrapped = Math.atan2(
      Math.sin(result.yaw - DEFAULT_YAW),
      Math.cos(result.yaw - DEFAULT_YAW),
    )
    expect(Math.abs(wrapped)).toBeCloseTo(Math.PI / 2, 5)
  })
})
