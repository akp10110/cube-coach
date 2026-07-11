import { describe, expect, it } from 'vitest'
import { duplicateCenterMessage, isDuplicateCenter } from '../../src/scan/duplicateGuard'

describe('isDuplicateCenter', () => {
  it('is false when the color has not been seen before', () => {
    expect(isDuplicateCenter('R', ['U', 'F'])).toBe(false)
  })
  it('is true when the color already belongs to another captured face', () => {
    expect(isDuplicateCenter('L', ['U', 'R', 'L'])).toBe(true)
  })
  it('is false against an empty scan session', () => {
    expect(isDuplicateCenter('U', [])).toBe(false)
  })
})

describe('duplicateCenterMessage', () => {
  it('names the detected color and the still-needed one', () => {
    expect(duplicateCenterMessage('L', 'R')).toBe(
      'That looks like the orange side again — now show me the side with the red center.',
    )
  })
})
