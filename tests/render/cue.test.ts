import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { angleForMove, guidanceArcPoints, MOVE_AXIS } from '../../src/render/cue'
import type { Move } from '../../src/core/types'

const AXIS_VECTOR = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) }

describe('angleForMove', () => {
  it('quarter turns sweep 90 deg, doubles sweep 180 deg', () => {
    expect(Math.abs(angleForMove('U').angle)).toBeCloseTo(Math.PI / 2)
    expect(Math.abs(angleForMove('U2').angle)).toBeCloseTo(Math.PI)
  })

  it('a move and its prime are equal and opposite', () => {
    expect(angleForMove("R'").angle).toBeCloseTo(-angleForMove('R').angle)
  })

  it('covers all 18 moves without throwing', () => {
    const faces = ['U', 'D', 'L', 'R', 'F', 'B'] as const
    const suffixes = ['', "'", '2'] as const
    for (const face of faces) {
      for (const suffix of suffixes) {
        const move = `${face}${suffix}` as Move
        expect(() => angleForMove(move)).not.toThrow()
      }
    }
  })
})

describe('guidanceArcPoints', () => {
  it('lies entirely in the turning face plane, at faceDistance along its axis', () => {
    for (const move of ['U', "R'", 'F2', "D'"] as Move[]) {
      const { axis, layer } = MOVE_AXIS[move[0] as keyof typeof MOVE_AXIS]
      const faceDistance = 1.5
      const points = guidanceArcPoints(move, 1, faceDistance)
      const axisVector = AXIS_VECTOR[axis]
      for (const p of points) {
        const v = new Vector3(p.x, p.y, p.z)
        expect(v.dot(axisVector)).toBeCloseTo(layer * faceDistance, 5)
      }
    }
  })

  it('sweeps an angle whose magnitude matches the turn amount', () => {
    const radius = 1
    const faceDistance = 1.5

    const quarter = guidanceArcPoints('U', radius, faceDistance, 2)
    const start = new Vector3(quarter[0].x, quarter[0].y, quarter[0].z)
    const end = new Vector3(quarter[2].x, quarter[2].y, quarter[2].z)
    const center = new Vector3(0, faceDistance, 0)
    const angleBetween = start.clone().sub(center).angleTo(end.clone().sub(center))
    expect(angleBetween).toBeCloseTo(Math.PI / 2, 5)

    const double = guidanceArcPoints('U2', radius, faceDistance, 2)
    const dStart = new Vector3(double[0].x, double[0].y, double[0].z)
    const dEnd = new Vector3(double[2].x, double[2].y, double[2].z)
    const dAngle = dStart.clone().sub(center).angleTo(dEnd.clone().sub(center))
    expect(dAngle).toBeCloseTo(Math.PI, 5)
  })

  it('R and R-prime sweep in opposite directions', () => {
    const r = guidanceArcPoints('R', 1, 1.5, 4)
    const rPrime = guidanceArcPoints("R'", 1, 1.5, 4)
    // Same endpoints set, traversed in reverse order.
    expect(r[0]).toEqual(rPrime[rPrime.length - 1])
    expect(r[r.length - 1]).toEqual(rPrime[0])
  })

  it('returns segments + 1 points', () => {
    expect(guidanceArcPoints('U', 1, 1.5, 10)).toHaveLength(11)
  })
})
