import { describe, expect, it } from 'vitest'
import { CAPTURE_ORDER, holdInstruction } from '../../src/ui/scanInstructions'

describe('CAPTURE_ORDER', () => {
  it('is the fixed U, R, F, D, L, B sequence', () => {
    expect(CAPTURE_ORDER).toEqual(['U', 'R', 'F', 'D', 'L', 'B'])
  })
})

describe('holdInstruction', () => {
  it('matches the architect-specified example for U', () => {
    expect(holdInstruction('U')).toBe(
      'Hold the white center facing the camera, green center on top.',
    )
  })

  it('gives a hold instruction for every face in the capture order', () => {
    expect(holdInstruction('R')).toBe(
      'Hold the red center facing the camera, green center on top.',
    )
    expect(holdInstruction('F')).toBe(
      'Hold the green center facing the camera, white center on top.',
    )
    expect(holdInstruction('D')).toBe(
      'Hold the yellow center facing the camera, green center on top.',
    )
    expect(holdInstruction('L')).toBe(
      'Hold the orange center facing the camera, green center on top.',
    )
    expect(holdInstruction('B')).toBe(
      'Hold the blue center facing the camera, white center on top.',
    )
  })

  it('never names the same color twice (a face can never be its own top reference)', () => {
    for (const face of CAPTURE_ORDER) {
      const instruction = holdInstruction(face)
      const [facingClause, topClause] = instruction.split(', ')
      const facingColor = facingClause.replace('Hold the ', '').replace(' center facing the camera', '')
      const topColor = topClause.replace(' center on top.', '')
      expect(topColor).not.toBe(facingColor)
    }
  })
})
