import * as THREE from 'three'
import type { Face, FaceletString, Move } from '../core/types'
import { faceletAt } from '../core/facelets'
import { CUBE_BODY_COLOR, STICKER_COLORS } from './colors'
import {
  CUBELET_COORDS,
  MAPPINGS_BY_CUBELET,
  cubeletKey,
  type Axis,
  type CubeletCoord,
  type LocalFace,
} from './cubeletMap'

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
  /** Fixed grid coordinate this cubelet's mesh always rests at between moves. */
  coord: CubeletCoord
}

type MoveAxis = 'x' | 'y' | 'z'

/**
 * Per-face quarter-turn spec: which grid layer the move affects and the
 * signed rotation (radians) of a CLOCKWISE-viewed-from-outside quarter turn.
 *
 * Derived from the coordinate system in cubeletMap.ts (x:-1=L/+1=R,
 * y:-1=D/+1=U, z:-1=B/+1=F) and cross-checked against the facelet cycles
 * documented in moves.ts: for each face, rotating the layer by the angle
 * below and applying the standard axis-rotation matrix moves stickers along
 * that exact cycle (e.g. U's `F -> L -> B -> R -> F` matches -90 deg about Y).
 * Faces whose outward normal is the POSITIVE axis direction (U/R/F) turn -90
 * deg for a clockwise quarter; faces whose normal is NEGATIVE (D/L/B) turn
 * +90 deg — the two are mirror images of the same physical turn.
 */
const MOVE_AXIS: Record<Face, { axis: MoveAxis; layer: Axis; quarterAngle: number }> = {
  U: { axis: 'y', layer: 1, quarterAngle: -Math.PI / 2 },
  D: { axis: 'y', layer: -1, quarterAngle: Math.PI / 2 },
  R: { axis: 'x', layer: 1, quarterAngle: -Math.PI / 2 },
  L: { axis: 'x', layer: -1, quarterAngle: Math.PI / 2 },
  F: { axis: 'z', layer: 1, quarterAngle: -Math.PI / 2 },
  B: { axis: 'z', layer: -1, quarterAngle: Math.PI / 2 },
}

const AXIS_INDEX: Record<MoveAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function angleForMove(move: Move): { axis: MoveAxis; layer: Axis; angle: number } {
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

/** Renders a 3D cube for a given facelet state (D6) and animates quarter/half
 *  turns of a single layer (PR-07). Colors are always keyed by fixed grid
 *  position (see setState), so a move's visual effect is: tween the 9
 *  affected cubelets through the physical turn, then snap them back to their
 *  resting grid transform and recolor via setState — this is what the PR-07
 *  "bake to facelets" requirement means here, and it is what eliminates any
 *  tween float drift regardless of how many moves have played. */
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

  /**
   * Animates one move: attaches the 9 affected cubelets to a temporary pivot,
   * tweens the pivot's rotation through the turn (ease-in-out), then bakes —
   * detaches the cubelets, snaps them back to their fixed resting transform,
   * and recolors via setState from `nextState` so the result is pixel-exact
   * regardless of prior tween drift (PR-07 hard requirement).
   */
  animateMove(move: Move, nextState: FaceletString, durationMs: number): Promise<void> {
    if (this.disposed) return Promise.resolve()

    const { axis, layer, angle } = angleForMove(move)
    const axisIndex = AXIS_INDEX[axis]
    const layerCubelets = this.cubelets.filter((c) => c.coord[axisIndex] === layer)

    const pivot = new THREE.Group()
    this.cubeGroup.add(pivot)
    for (const cubelet of layerCubelets) pivot.attach(cubelet.mesh)

    return new Promise((resolve) => {
      const start = performance.now()
      const step = (): void => {
        if (this.disposed) {
          resolve()
          return
        }
        const elapsed = performance.now() - start
        const t = Math.min(1, durationMs <= 0 ? 1 : elapsed / durationMs)
        const eased = easeInOutQuad(t)
        pivot.rotation[axis] = angle * eased

        if (t >= 1) {
          for (const cubelet of layerCubelets) {
            this.cubeGroup.attach(cubelet.mesh)
            cubelet.mesh.position.set(
              cubelet.coord[0] * SPACING,
              cubelet.coord[1] * SPACING,
              cubelet.coord[2] * SPACING,
            )
            cubelet.mesh.quaternion.identity()
          }
          this.cubeGroup.remove(pivot)
          this.setState(nextState)
          resolve()
          return
        }

        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
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

    return { mesh, materials, stickers, coord }
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
