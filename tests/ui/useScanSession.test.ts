import { describe, expect, it } from 'vitest'
import { parseScanSession } from '../../src/ui/useScanSession'

describe('parseScanSession', () => {
  it('is empty for null (nothing persisted yet)', () => {
    expect(parseScanSession(null)).toEqual({ faces: {} })
  })

  it('is empty for corrupt JSON rather than throwing', () => {
    expect(parseScanSession('{not json')).toEqual({ faces: {} })
  })

  it('round-trips a real session', () => {
    const session = {
      faces: { U: { colors: Array(9).fill('U'), confidence: Array(9).fill(1) } },
      calibration: { U: { h: 60, s: 0.02, v: 0.96 } },
    }
    expect(parseScanSession(JSON.stringify(session))).toEqual(session)
  })
})
