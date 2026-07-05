import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cameraProfile,
  classifyCameraError,
  requestCameraStream,
  stopCameraStream,
} from '../../src/scan/camera'

function mockWindow(matches: boolean) {
  Object.defineProperty(globalThis, 'window', {
    value: { matchMedia: () => ({ matches }) },
    configurable: true,
    writable: true,
  })
}

function mockNavigator(getUserMedia: (...args: unknown[]) => unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia } },
    configurable: true,
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'navigator')
  vi.restoreAllMocks()
})

describe('cameraProfile', () => {
  it('picks the rear camera, unmirrored, on a touch-primary (mobile) device', () => {
    mockWindow(true)
    expect(cameraProfile()).toEqual({ facing: 'environment', mirrored: false })
  })

  it('picks the front camera, mirrored, on a pointer-primary (desktop) device', () => {
    mockWindow(false)
    expect(cameraProfile()).toEqual({ facing: 'user', mirrored: true })
  })

  it('defaults to desktop when window/matchMedia is unavailable', () => {
    expect(cameraProfile()).toEqual({ facing: 'user', mirrored: true })
  })
})

describe('requestCameraStream', () => {
  it('requests the given facing mode with no audio', async () => {
    const getUserMedia = vi.fn().mockResolvedValue('fake-stream')
    mockNavigator(getUserMedia)

    const stream = await requestCameraStream('environment')

    expect(stream).toBe('fake-stream')
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    })
  })
})

describe('stopCameraStream', () => {
  it('stops every track on the stream', () => {
    const trackA = { stop: vi.fn() }
    const trackB = { stop: vi.fn() }
    const stream = { getTracks: () => [trackA, trackB] } as unknown as MediaStream

    stopCameraStream(stream)

    expect(trackA.stop).toHaveBeenCalledOnce()
    expect(trackB.stop).toHaveBeenCalledOnce()
  })
})

describe('classifyCameraError', () => {
  it('classifies NotAllowedError / SecurityError as permission-denied', () => {
    expect(classifyCameraError(new DOMException('nope', 'NotAllowedError'))).toBe(
      'permission-denied',
    )
    expect(classifyCameraError(new DOMException('nope', 'SecurityError'))).toBe('permission-denied')
  })

  it('classifies NotFoundError / DevicesNotFoundError as no-camera', () => {
    expect(classifyCameraError(new DOMException('nope', 'NotFoundError'))).toBe('no-camera')
    expect(classifyCameraError(new DOMException('nope', 'DevicesNotFoundError'))).toBe('no-camera')
  })

  it('classifies anything else as unknown', () => {
    expect(classifyCameraError(new DOMException('nope', 'AbortError'))).toBe('unknown')
    expect(classifyCameraError(new Error('boom'))).toBe('unknown')
    expect(classifyCameraError('not even an error')).toBe('unknown')
  })
})
