import * as THREE from 'three'
import type { Face, FaceletString, Move } from '../core/types'
import { faceletAt } from '../core/facelets'
import { ACCENT_COLOR, CUBE_BODY_COLOR, CUE_DIM_OPACITY, STICKER_COLORS } from './colors'
import { AXIS_INDEX, angleForMove, guidanceArcPoints } from './cue'
import {
  angleDelta,
  DEFAULT_PITCH,
  DEFAULT_YAW,
  isFaceVisible,
  orientationShowingFace,
} from './orientation'
import {
  CUBELET_COORDS,
  MAPPINGS_BY_CUBELET,
  cubeletKey,
  type CubeletCoord,
  type LocalFace,
} from './cubeletMap'

const CUBELET_SIZE = 0.95
const SPACING = 1.02

// BoxGeometry's material group order is [+x, -x, +y, -y, +z, -z], which is
// exactly the px/nx/py/ny/pz/nz order cubeletMap.ts uses for LocalFace.
const LOCAL_FACE_ORDER: readonly LocalFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz']

/** Local-face outward normal + the two in-plane axes, used to build each
 *  cubelet's cue outline (a square line loop just outside the sticker). */
const LOCAL_FACE_NORMAL: Readonly<Record<LocalFace, THREE.Vector3>> = {
  px: new THREE.Vector3(1, 0, 0),
  nx: new THREE.Vector3(-1, 0, 0),
  py: new THREE.Vector3(0, 1, 0),
  ny: new THREE.Vector3(0, -1, 0),
  pz: new THREE.Vector3(0, 0, 1),
  nz: new THREE.Vector3(0, 0, -1),
}

const OUTLINE_EPSILON = 0.02
const ORBIT_DURATION_MS = 400
const ARC_RADIUS = SPACING * 0.85
const ARC_FACE_DISTANCE = SPACING + CUBELET_SIZE / 2 + 0.05
const ARROWHEAD_SIZE = 0.12

interface Cubelet {
  mesh: THREE.Mesh
  materials: THREE.MeshBasicMaterial[]
  /** localFace -> (face, index) into the facelet string, only for outer faces. */
  stickers: Partial<Record<LocalFace, { face: Face; index: number }>>
  /** Accent outline shown around a sticker while it's part of the active move cue. */
  outlines: Partial<Record<LocalFace, THREE.LineLoop>>
  /** Fixed grid coordinate this cubelet's mesh always rests at between moves. */
  coord: CubeletCoord
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/** A square line loop matching one face of a CUBELET_SIZE box, offset
 *  outward by OUTLINE_EPSILON along its normal so it doesn't z-fight the
 *  sticker material underneath. */
function buildOutlineGeometry(localFace: LocalFace): THREE.BufferGeometry {
  const half = CUBELET_SIZE / 2
  const normal = LOCAL_FACE_NORMAL[localFace]
  const axis = normal.x !== 0 ? 'x' : normal.y !== 0 ? 'y' : 'z'
  const offset = half + OUTLINE_EPSILON
  const sign = normal.x + normal.y + normal.z

  const corners: [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ]

  const points = corners.map(([a, b]) => {
    if (axis === 'x') return new THREE.Vector3(sign * offset, a, b)
    if (axis === 'y') return new THREE.Vector3(a, sign * offset, b)
    return new THREE.Vector3(a, b, sign * offset)
  })

  return new THREE.BufferGeometry().setFromPoints(points)
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
  private yaw = DEFAULT_YAW
  private pitch = DEFAULT_PITCH

  // Move-guidance cue (section 9 rules 2/3/8): the dashed accent arc drawn
  // in the turning face's plane, with a small arrowhead at its end. The
  // "flowing dashes" look is done by hand: classic LineDashedMaterial has no
  // offset uniform, so each frame we re-write the lineDistance attribute
  // from a fixed base plus a growing (wrapped) offset.
  private readonly cueArc: THREE.Line
  private readonly cueArrowhead: THREE.Mesh
  private cueBaseDistances: Float32Array | null = null
  private cueFlowOffset = 0
  private lastFrameTime = performance.now()

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

    this.cueArc = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: ACCENT_COLOR, dashSize: 0.12, gapSize: 0.08 }),
    )
    this.cueArc.visible = false
    this.cubeGroup.add(this.cueArc)

    this.cueArrowhead = new THREE.Mesh(
      new THREE.ConeGeometry(ARROWHEAD_SIZE * 0.6, ARROWHEAD_SIZE, 10),
      new THREE.MeshBasicMaterial({ color: ACCENT_COLOR }),
    )
    this.cueArrowhead.visible = false
    this.cubeGroup.add(this.cueArrowhead)

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
   *
   * Also implements the section 9 rule 7 hidden-face auto-orbit: if the
   * move's face isn't currently visible, the camera eases to a three-quarter
   * view that shows it before the turn animates, then eases back to the
   * orientation it started from — the user must never be asked to perform a
   * move they can't see happening.
   */
  async animateMove(
    move: Move,
    nextState: FaceletString,
    durationMs: number,
    options?: { autoOrbit?: boolean },
  ): Promise<void> {
    if (this.disposed) return

    this.setCue(null)

    const face = move[0] as Face
    const priorOrientation = { yaw: this.yaw, pitch: this.pitch }
    const autoOrbit = options?.autoOrbit ?? true
    const needsOrbit = autoOrbit && !isFaceVisible(face, this.yaw, this.pitch)
    if (needsOrbit) {
      const target = orientationShowingFace(face, this.yaw, this.pitch)
      await this.orbitTo(target.yaw, target.pitch, ORBIT_DURATION_MS)
    }

    await this.turnLayer(move, nextState, durationMs)

    if (needsOrbit) {
      await this.orbitTo(priorOrientation.yaw, priorOrientation.pitch, ORBIT_DURATION_MS)
    }
  }

  /**
   * Shows (or clears, when `move` is null) the follow-mode guidance cue for
   * an upcoming move: the whole physical slab (turning face + adjacent
   * strips) stays at full opacity with an accent outline band, everything
   * else dims to CUE_DIM_OPACITY, and a dashed accent arrow sweeps the
   * turning face's plane by exactly the turn amount.
   */
  setCue(move: Move | null): void {
    if (move === null) {
      for (const cubelet of this.cubelets) {
        for (const localFace of Object.keys(cubelet.stickers) as LocalFace[]) {
          const material = cubelet.materials[LOCAL_FACE_ORDER.indexOf(localFace)]
          material.opacity = 1
          const outline = cubelet.outlines[localFace]
          if (outline) outline.visible = false
        }
      }
      this.cueArc.visible = false
      this.cueArrowhead.visible = false
      return
    }

    const { axis, layer } = angleForMove(move)
    const axisIndex = AXIS_INDEX[axis]
    const layerCoords = new Set(this.cubelets.filter((c) => c.coord[axisIndex] === layer))

    for (const cubelet of this.cubelets) {
      const inLayer = layerCoords.has(cubelet)
      for (const localFace of Object.keys(cubelet.stickers) as LocalFace[]) {
        const material = cubelet.materials[LOCAL_FACE_ORDER.indexOf(localFace)]
        material.opacity = inLayer ? 1 : CUE_DIM_OPACITY
        const outline = cubelet.outlines[localFace]
        if (outline) outline.visible = inLayer
      }
    }

    const arcPoints = guidanceArcPoints(move, ARC_RADIUS, ARC_FACE_DISTANCE).map(
      (p) => new THREE.Vector3(p.x, p.y, p.z),
    )
    this.cueArc.geometry.dispose()
    this.cueArc.geometry = new THREE.BufferGeometry().setFromPoints(arcPoints)
    this.cueArc.computeLineDistances()
    this.cueBaseDistances = (
      this.cueArc.geometry.getAttribute('lineDistance') as THREE.BufferAttribute
    ).array.slice() as Float32Array
    this.cueFlowOffset = 0
    this.cueArc.visible = true

    const end = arcPoints[arcPoints.length - 1]
    const beforeEnd = arcPoints[arcPoints.length - 2]
    const tangent = end.clone().sub(beforeEnd).normalize()
    this.cueArrowhead.position.copy(end)
    this.cueArrowhead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent)
    this.cueArrowhead.visible = true
  }

  /** Eases the camera view to a new (yaw, pitch), taking the shorter way
   *  around on yaw. Used by the hidden-face auto-orbit in animateMove. */
  private orbitTo(targetYaw: number, targetPitch: number, durationMs: number): Promise<void> {
    const startYaw = this.yaw
    const startPitch = this.pitch
    const yawDelta = angleDelta(targetYaw, startYaw)
    const pitchDelta = targetPitch - startPitch

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
        this.yaw = startYaw + yawDelta * eased
        this.pitch = startPitch + pitchDelta * eased
        this.applyOrientation()

        if (t >= 1) {
          resolve()
          return
        }
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
  }

  /** The actual layer-turn tween + bake, factored out of animateMove so the
   *  hidden-face orbit legs can wrap around it. */
  private turnLayer(move: Move, nextState: FaceletString, durationMs: number): Promise<void> {
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
      for (const outline of Object.values(cubelet.outlines)) {
        outline.geometry.dispose()
        ;(outline.material as THREE.Material).dispose()
      }
    }
    this.cueArc.geometry.dispose()
    ;(this.cueArc.material as THREE.Material).dispose()
    this.cueArrowhead.geometry.dispose()
    ;(this.cueArrowhead.material as THREE.Material).dispose()
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
      () => new THREE.MeshBasicMaterial({ color: CUBE_BODY_COLOR, transparent: true }),
    )

    const geometry = new THREE.BoxGeometry(CUBELET_SIZE, CUBELET_SIZE, CUBELET_SIZE)
    const mesh = new THREE.Mesh(geometry, materials)
    mesh.position.set(coord[0] * SPACING, coord[1] * SPACING, coord[2] * SPACING)
    this.cubeGroup.add(mesh)

    const outlines: Cubelet['outlines'] = {}
    for (const localFace of Object.keys(stickers) as LocalFace[]) {
      const outline = new THREE.LineLoop(
        buildOutlineGeometry(localFace),
        new THREE.LineBasicMaterial({ color: ACCENT_COLOR }),
      )
      outline.visible = false
      mesh.add(outline)
      outlines[localFace] = outline
    }

    return { mesh, materials, stickers, outlines, coord }
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
    const now = performance.now()
    const deltaMs = now - this.lastFrameTime
    this.lastFrameTime = now

    if (this.cueArc.visible && this.cueBaseDistances) {
      const material = this.cueArc.material as THREE.LineDashedMaterial
      const period = material.dashSize + material.gapSize
      const DASH_FLOW_SPEED = 0.0015
      this.cueFlowOffset = (this.cueFlowOffset - deltaMs * DASH_FLOW_SPEED) % period

      const attribute = this.cueArc.geometry.getAttribute('lineDistance') as THREE.BufferAttribute
      for (let i = 0; i < this.cueBaseDistances.length; i++) {
        attribute.array[i] = this.cueBaseDistances[i] + this.cueFlowOffset
      }
      attribute.needsUpdate = true
    }

    this.renderer.render(this.scene, this.camera)
    this.animationFrame = requestAnimationFrame(this.renderFrame)
  }
}
