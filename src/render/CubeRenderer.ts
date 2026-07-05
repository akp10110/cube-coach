import * as THREE from 'three'
import type { Face, FaceletString } from '../core/types'
import { faceletAt } from '../core/facelets'
import { CUBE_BODY_COLOR, STICKER_COLORS } from './colors'
import { CUBELET_COORDS, MAPPINGS_BY_CUBELET, cubeletKey, type LocalFace } from './cubeletMap'

const CUBELET_SIZE = 0.95
const SPACING = 1.02

// BoxGeometry's material group order is [+x, -x, +y, -y, +z, -z], which is
// exactly the px/nx/py/ny/pz/nz order cubeletMap.ts uses for LocalFace.
const LOCAL_FACE_ORDER: readonly LocalFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz']

interface Cubelet {
  mesh: THREE.Mesh
  materials: THREE.MeshBasicMaterial[]
  /** localFace -> (face, index) into the facelet string, only for outer faces. */
  stickers: Partial<Record<LocalFace, { face: Face; index: number }>>
}

/** Renders a static 3D cube for a given facelet state (D6). No move animation — see PR-07. */
export class CubeRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly cubeGroup: THREE.Group
  private readonly cubelets: readonly Cubelet[]
  private readonly resizeObserver: ResizeObserver
  private animationFrame = 0
  private disposed = false

  // Pointer-drag rotation of the whole cube view (no OrbitControls, D6).
  private dragging = false
  private lastX = 0
  private lastY = 0
  private yaw = -0.5
  private pitch = 0.45

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
    this.camera.position.set(0, 0, 9)

    this.cubeGroup = new THREE.Group()
    this.scene.add(this.cubeGroup)
    this.cubelets = CUBELET_COORDS.map((coord) => this.buildCubelet(coord))
    this.applyOrientation()

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(canvas)
    this.handleResize()

    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)

    this.animationFrame = requestAnimationFrame(this.renderFrame)
  }

  setState(facelets: FaceletString): void {
    for (const cubelet of this.cubelets) {
      for (const [localFace, sticker] of Object.entries(cubelet.stickers) as [
        LocalFace,
        { face: Face; index: number },
      ][]) {
        const materialIndex = LOCAL_FACE_ORDER.indexOf(localFace)
        const color = STICKER_COLORS[faceletAt(facelets, sticker.face, sticker.index)]
        cubelet.materials[materialIndex].color.set(color)
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    for (const cubelet of this.cubelets) {
      cubelet.mesh.geometry.dispose()
      for (const material of cubelet.materials) material.dispose()
    }
    this.renderer.dispose()
  }

  private buildCubelet(coord: (typeof CUBELET_COORDS)[number]): Cubelet {
    const mappings = MAPPINGS_BY_CUBELET.get(cubeletKey(coord)) ?? []
    const stickers: Cubelet['stickers'] = {}
    for (const mapping of mappings) {
      stickers[mapping.localFace] = { face: mapping.face, index: mapping.index }
    }

    // Sticker colors are filled in by the first setState() call; until then
    // every face (including stickered ones) shows the plastic body color.
    const materials = LOCAL_FACE_ORDER.map(
      () => new THREE.MeshBasicMaterial({ color: CUBE_BODY_COLOR }),
    )

    const geometry = new THREE.BoxGeometry(CUBELET_SIZE, CUBELET_SIZE, CUBELET_SIZE)
    const mesh = new THREE.Mesh(geometry, materials)
    mesh.position.set(coord[0] * SPACING, coord[1] * SPACING, coord[2] * SPACING)
    this.cubeGroup.add(mesh)

    return { mesh, materials, stickers }
  }

  private applyOrientation(): void {
    this.cubeGroup.rotation.set(this.pitch, this.yaw, 0)
  }

  private handleResize(): void {
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = true
    this.lastX = event.clientX
    this.lastY = event.clientY
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return
    const deltaX = event.clientX - this.lastX
    const deltaY = event.clientY - this.lastY
    this.lastX = event.clientX
    this.lastY = event.clientY
    const ROTATE_SPEED = 0.008
    this.yaw += deltaX * ROTATE_SPEED
    this.pitch += deltaY * ROTATE_SPEED
    this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch))
    this.applyOrientation()
  }

  private readonly onPointerUp = (): void => {
    this.dragging = false
  }

  private readonly renderFrame = (): void => {
    this.renderer.render(this.scene, this.camera)
    this.animationFrame = requestAnimationFrame(this.renderFrame)
  }
}
