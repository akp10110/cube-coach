import { describe, expect, it } from 'vitest'
import { describeLayer } from '../../src/ui/describeLayer'
import type { Move } from '../../src/core/types'

describe('describeLayer', () => {
  it('names the face by its fixed center color', () => {
    expect(describeLayer('R').colorFace).toBe('R')
    expect(describeLayer('R').headline).toBe('Turn the red side')
    expect(describeLayer('U').headline).toBe('Turn the white side')
    expect(describeLayer('D').headline).toBe('Turn the yellow side')
    expect(describeLayer('F').headline).toBe('Turn the green side')
    expect(describeLayer('B').headline).toBe('Turn the blue side')
    expect(describeLayer('L').headline).toBe('Turn the orange side')
  })

  it('calls out a quarter turn for plain and prime moves', () => {
    expect(describeLayer('R').detail).toBe('Follow the arrow — just one quarter turn')
    expect(describeLayer("R'").detail).toBe('Follow the arrow — just one quarter turn')
  })

  it('calls out a half turn for double moves', () => {
    expect(describeLayer('R2').detail).toBe('Follow the arrow — just one half turn')
  })

  it('colorFace is unaffected by the modifier', () => {
    for (const move of ['R', "R'", 'R2'] as Move[]) {
      expect(describeLayer(move).colorFace).toBe('R')
    }
  })
})
