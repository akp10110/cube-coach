import { FACE_ORDER, faceOf, faceletAt } from './facelets'
import { CORNER_NAMES, EDGE_NAMES, decodeCorners, decodeEdges } from './cubies'
import type { Face, FaceletString, ValidationIssue, ValidationResult } from './types'

/** A face is solved when all 9 of its stickers match its own identity
 *  (a facelet's letter = the face whose center shares its color, D3), so a
 *  cube is solved iff every face satisfies this. */
export function isSolved(s: FaceletString): boolean {
  return FACE_ORDER.every((face) => faceOf(s, face).every((sticker) => sticker === face))
}

function countLetter(s: FaceletString, letter: Face): number {
  let count = 0
  for (const char of s) {
    if (char === letter) count++
  }
  return count
}

function isPermutationOfFaces(letters: readonly Face[]): boolean {
  const set = new Set(letters)
  return set.size === FACE_ORDER.length && FACE_ORDER.every((face) => set.has(face))
}

/** Counts transpositions in the permutation mapping slot -> occupant name
 *  (both drawn from `canonicalOrder`) via cycle decomposition, mod 2. */
function permutationParity(
  occupantNames: readonly string[],
  canonicalOrder: readonly string[],
): number {
  const indices = occupantNames.map((name) => canonicalOrder.indexOf(name))
  const visited = new Array(indices.length).fill(false)
  let transpositions = 0
  for (let i = 0; i < indices.length; i++) {
    if (visited[i]) continue
    let cycleLength = 0
    let j = i
    while (!visited[j]) {
      visited[j] = true
      j = indices[j]
      cycleLength++
    }
    transpositions += cycleLength - 1
  }
  return transpositions % 2
}

export function validate(s: FaceletString): ValidationResult {
  if (s.length !== 54) {
    return { ok: false, issues: [{ kind: 'bad-length' }] }
  }

  const issues: ValidationIssue[] = []

  for (const face of FACE_ORDER) {
    const count = countLetter(s, face)
    if (count !== 9) issues.push({ kind: 'bad-color-count', face, count })
  }

  const centers = FACE_ORDER.map((face) => faceletAt(s, face, 4))
  if (!isPermutationOfFaces(centers)) {
    issues.push({ kind: 'bad-centers' })
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  const corners = decodeCorners(s)
  const edges = decodeEdges(s)

  const seenCorners = new Set<string>()
  corners.forEach((instance, i) => {
    if (instance.name === undefined) {
      issues.push({
        kind: 'invalid-piece',
        detail: `corner slot ${CORNER_NAMES[i]} has an impossible color combination`,
      })
    } else if (seenCorners.has(instance.name)) {
      issues.push({
        kind: 'invalid-piece',
        detail: `corner slot ${CORNER_NAMES[i]} duplicates another ${instance.name} corner`,
      })
    } else {
      seenCorners.add(instance.name)
    }
  })

  const seenEdges = new Set<string>()
  edges.forEach((instance, i) => {
    if (instance.name === undefined) {
      issues.push({
        kind: 'invalid-piece',
        detail: `edge slot ${EDGE_NAMES[i]} has an impossible color combination`,
      })
    } else if (seenEdges.has(instance.name)) {
      issues.push({
        kind: 'invalid-piece',
        detail: `edge slot ${EDGE_NAMES[i]} duplicates another ${instance.name} edge`,
      })
    } else {
      seenEdges.add(instance.name)
    }
  })

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  const cornerOrientationSum = corners.reduce((sum, c) => sum + c.orientation, 0)
  if (cornerOrientationSum % 3 !== 0) {
    issues.push({ kind: 'corner-orientation' })
  }

  const edgeOrientationSum = edges.reduce((sum, e) => sum + e.orientation, 0)
  if (edgeOrientationSum % 2 !== 0) {
    issues.push({ kind: 'edge-orientation' })
  }

  const cornerParity = permutationParity(
    corners.map((c) => c.name as string),
    CORNER_NAMES,
  )
  const edgeParity = permutationParity(
    edges.map((e) => e.name as string),
    EDGE_NAMES,
  )
  if (cornerParity !== edgeParity) {
    issues.push({ kind: 'permutation-parity' })
  }

  return { ok: issues.length === 0, issues }
}
