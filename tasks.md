# CubeCoach — Rubik's Cube Scan & Solve Web App

**Document owner:** Senior Architect (Claude Fable 5)
**Executors:** Claude Code sessions (Opus / Sonnet)
**Delivery manager:** Ani — approves checkpoints, merges PRs
**Status convention:** Update the checkbox on each PR as it lands. Never start a PR whose dependencies are unmerged.

---

## 1. Product summary

A browser-based web app that:

1. **Scans** a real 3×3 Rubik's cube via the device camera (6 faces, guided flow), with manual color entry as a fallback.
2. **Validates** the scanned state (color counts, centers, physical solvability).
3. **Solves** it two ways, user's choice:
   - **Quick Solve** — Kociemba two-phase (~20 moves) via the `cubejs` npm library.
   - **Learn Mode** — beginner layer-by-layer method (~100+ moves) via a custom solver, with named stages and one-line teaching explanations.
4. **Guides** the user through the solution on an animated 3D cube (Three.js): one move at a time, play/pause/next/prev, rotation cues on the turning face.
5. **Re-checks** periodically: after each batch of moves (Quick Solve: every ~12 moves; Learn Mode: at stage boundaries), the user re-scans their cube. If it matches the expected state, continue; if it drifted, silently re-solve from the actual state and resume.

Target devices: mobile (rear camera) and desktop (webcam), equally. Deployment: static hosting over HTTPS (camera APIs require it).

---

## 2. Architect's decisions — DO NOT RELITIGATE

These were made deliberately. A Claude Code session may not change them. If one appears genuinely broken during implementation, stop and write up the problem for the delivery manager instead of working around it.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Vite + React 18 + TypeScript (strict)** | TS contracts keep multi-session work consistent; Vite for fast dev + static build. |
| D2 | **All cube logic lives in `src/core/` as pure TS — zero DOM, zero React, zero Three.js imports** | Makes solvers/validation unit-testable and reusable. CI enforces via lint rule. |
| D3 | **Canonical state = 54-char facelet string, URFDLB face order** (cubejs convention: solved = `UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB`) | One representation everywhere. Renderer and scanners convert at the edges. |
| D4 | **Quick Solve = `cubejs` npm package, wrapped in an adapter and run in a Web Worker** | Battle-tested Kociemba impl; table init takes seconds, must not block UI. |
| D5 | **Learn Mode = custom layer-by-layer solver in `src/core/solvers/lbl/`** | No good off-the-shelf JS beginner-method solver; we need named stages for teaching. |
| D6 | **Three.js (plain, no react-three-fiber) encapsulated in a `CubeRenderer` class; React talks to it through a thin hook** | Imperative animation queue is simpler and testable without React render cycles. |
| D7 | **Color detection = canvas pixel sampling → HSV → nearest-centroid classification anchored on the 6 scanned center stickers. No OpenCV/ML.** | 3×3 grid at a known screen position doesn't need CV; centers give per-cube/per-lighting calibration for free. |
| D8 | **No backend. No accounts. No analytics. State in memory (+ `sessionStorage` for scan-in-progress only).** | Static deploy, zero credentials — project constraint. |
| D9 | **Testing: Vitest for `src/core/` (mandatory, CI-gated). Playwright smoke test added in Phase 8 only.** | Logic bugs are the real risk; e2e early would slow every PR. |
| D10 | **Deploy: GitHub Pages via Actions on every merge to `main`** | Free HTTPS (needed for camera), demo always current for checkpoints. |
| D11 | **Move notation: standard Singmaster, outer turns only: `U D L R F B`, each with `'` and `2` variants (18 moves). No slice/wide/rotation moves in v1.** | Keeps the move engine, LBL solver, and animation cues simple. |

---

## 3. Repository layout

```
cubecoach/
├── tasks.md                  # this file — source of truth
├── CLAUDE.md                 # working conventions for Claude Code (created in PR-00)
├── .github/workflows/ci.yml  # lint + typecheck + test on PRs; deploy on main
├── index.html
├── src/
│   ├── core/                 # PURE TS ONLY (see D2)
│   │   ├── types.ts          # shared contracts (section 4) — the ONE file every PR respects
│   │   ├── facelets.ts       # facelet string helpers, face/sticker indexing
│   │   ├── moves.ts          # move engine: apply/invert/parse/format
│   │   ├── scramble.ts       # random scramble generation
│   │   ├── validate.ts       # color counts, centers, piece + parity checks
│   │   └── solvers/
│   │       ├── kociemba.ts   # cubejs adapter (worker messaging on the UI side)
│   │       └── lbl/          # layer-by-layer: one file per stage + orchestrator
│   ├── workers/
│   │   └── kociemba.worker.ts
│   ├── render/
│   │   ├── CubeRenderer.ts   # three.js scene, 27 cubelets, sticker materials
│   │   └── animator.ts       # move queue, tweened quarter-turns, callbacks
│   ├── scan/
│   │   ├── camera.ts         # getUserMedia wrapper, device selection
│   │   ├── colorDetect.ts    # sampling + HSV + classification
│   │   └── calibrate.ts      # center-anchored centroid calibration
│   ├── ui/                   # React components, routing, app state
│   └── main.tsx
└── tests/                    # mirrors src/core structure
```

---

## 4. Contracts (copy into `src/core/types.ts` in PR-01, then treat as frozen)

Changing anything here requires delivery-manager sign-off. Extending (new types) is fine; mutating existing shapes is not.

```ts
/** The six faces, in canonical URFDLB order. Also used as color identity:
 *  a facelet's letter = the face whose CENTER shares its color. */
export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';

/** 54-char string, faces in URFDLB order, stickers in row-major order per
 *  face (1..9 reading top-left → bottom-right when the face is viewed
 *  head-on with standard orientation). Matches cubejs. */
export type FaceletString = string;

export const SOLVED: FaceletString =
  'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

export type Move =
  | 'U' | "U'" | 'U2' | 'D' | "D'" | 'D2'
  | 'L' | "L'" | 'L2' | 'R' | "R'" | 'R2'
  | 'F' | "F'" | 'F2' | 'B' | "B'" | 'B2';

export interface Solution {
  moves: Move[];
  /** Present for LBL; absent/empty for Kociemba. Phases partition `moves`
   *  in order: concat(phases[i].moves) === moves. */
  phases?: SolutionPhase[];
}

export interface SolutionPhase {
  id: 'white-cross' | 'white-corners' | 'middle-edges'
    | 'yellow-cross' | 'yellow-edges' | 'corner-position' | 'corner-orient';
  title: string;        // e.g. "Build the white cross"
  teaching: string;     // one or two sentences, plain language
  moves: Move[];
}

export interface Solver {
  readonly id: 'kociemba' | 'lbl';
  /** Must be called once before solve(); may take seconds (table init). */
  init(): Promise<void>;
  /** Rejects with ValidationError if state is unsolvable. */
  solve(state: FaceletString): Promise<Solution>;
}

export type ValidationIssue =
  | { kind: 'bad-length' }
  | { kind: 'bad-color-count'; face: Face; count: number }   // must be 9
  | { kind: 'bad-centers' }                                   // centers not a permutation of URFDLB
  | { kind: 'invalid-piece'; detail: string }                 // impossible sticker combo on a piece
  | { kind: 'edge-orientation' }                              // flipped edge
  | { kind: 'corner-orientation' }                            // twisted corner
  | { kind: 'permutation-parity' };                           // two pieces swapped

export interface ValidationResult { ok: boolean; issues: ValidationIssue[]; }

/** One scanned face. `colors[4]` is the center and defines which Face this is. */
export interface FaceScan {
  colors: Face[];        // length 9, row-major, in camera orientation
  confidence: number[];  // length 9, 0..1 per sticker
}

export interface ScanSession {
  faces: Partial<Record<Face, FaceScan>>;
  /** HSV centroids measured from the six centers; set once all centers seen. */
  calibration?: Record<Face, { h: number; s: number; v: number }>;
}

/** App-level solve session used by the guided flow + checkpoint loop. */
export interface SolveSession {
  initial: FaceletString;
  solverId: Solver['id'];
  solution: Solution;
  /** Index into solution.moves of the next move the USER has not yet done. */
  cursor: number;
  /** expectedState = initial with moves[0..cursor) applied. Recompute, don't store. */
}
```

**Pure-function surface of `src/core/` (signatures fixed):**

```ts
// facelets.ts
export function faceletAt(s: FaceletString, face: Face, index: number): Face;
export function faceOf(s: FaceletString, face: Face): Face[];        // 9 stickers

// moves.ts
export function applyMove(s: FaceletString, m: Move): FaceletString;
export function applyMoves(s: FaceletString, ms: Move[]): FaceletString;
export function invertMove(m: Move): Move;
export function invertMoves(ms: Move[]): Move[];                     // reversed + inverted
export function parseMoves(notation: string): Move[];                // throws on garbage
export function formatMoves(ms: Move[]): string;

// scramble.ts
export function randomScramble(length?: number): Move[];  // default 25; no move on same
                                                          // face twice in a row, no
                                                          // trivial A A' pairs

// validate.ts
export function validate(s: FaceletString): ValidationResult;
export function isSolved(s: FaceletString): boolean;
```

---

## 5. Working conventions (mirrored in CLAUDE.md)

- **Branches:** `feat/pr-NN-short-name` (e.g. `feat/pr-03-move-engine`). One PR per task below.
- **PR size:** target < 400 lines of diff (excluding lockfiles/snapshots). If a task grows past that, stop and split — tell the delivery manager.
- **Commits:** conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- **Every PR must:** pass CI (lint, typecheck, tests), include tests for any `src/core/` change, update the checkbox for its task in this file, and note any deviation from spec in the PR description.
- **Scope discipline:** each task lists *Out of scope* items. Do not implement them early, even if convenient. Half-built future features make later PRs ambiguous.
- **When stuck or when the spec seems wrong:** do NOT improvise around a locked decision (section 2) or a contract (section 4). Write a short `BLOCKED:` note in the PR and stop.
- **Suggested model per task:** `[S]` = Sonnet is fine (well-specified, mechanical). `[O]` = prefer Opus (algorithmic subtlety, easy to get quietly wrong). The delivery manager decides; these are the architect's recommendations.

---

## 6. Task breakdown

### Phase 0 — Repository scaffold

#### ☑ PR-00 `[S]` Project scaffold, CI, CLAUDE.md
- **Scope:** Vite + React + TS strict scaffold named `cubecoach`. ESLint + Prettier. Vitest wired. GitHub Actions: on PR → lint, typecheck, test; on merge to `main` → build + deploy to GitHub Pages (set Vite `base` correctly for Pages). `CLAUDE.md` containing: the conventions from section 5, the locked decisions table from section 2, and the sentence "src/core must never import from react, three, or the DOM."
- **Also:** ESLint `no-restricted-imports` rule scoped to `src/core/**` banning `react`, `three`, and DOM-touching modules.
- **Acceptance:** empty app deploys to Pages over HTTPS; CI green; `npm test` runs one placeholder test.
- **Out of scope:** any cube logic, any UI beyond a placeholder page.

### Phase 1 — Core cube engine (pure TS)

#### ☑ PR-01 `[S]` Contracts + facelet helpers
- **Scope:** `src/core/types.ts` copied verbatim from section 4. `facelets.ts` with the two helpers. Constant tables mapping (face, index) → position 0..53.
- **Tests:** solved-state lookups; round-trip face extraction.
- **Depends:** PR-00.

#### ☑ PR-02 `[O]` Move engine
- **Scope:** `moves.ts`. Implement `applyMove` as permutation tables: for each of the 18 moves, a precomputed array `perm[54]` where `next[i] = prev[perm[i]]`. Derive the 6 quarter-turn base permutations by hand ONCE (documented with an ASCII diagram of the affected stickers in a code comment); build `'` as 3× and `2` as 2× application. `invertMove/s`, `parseMoves`, `formatMoves`.
- **Tests (mandatory, this is the foundation everything trusts):**
  - `applyMove(SOLVED, m)` then inverse returns SOLVED, for all 18 moves.
  - Any move applied 4× (quarter) / 2× (half) returns input, for random states.
  - Known sequence check: the superflip `U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2` applied to SOLVED yields a state where every center matches its face and every edge is flipped (assert at least: state ≠ SOLVED, all centers correct, applying the sequence's inverse restores SOLVED).
  - `parseMoves(formatMoves(x))` round-trips.
- **Depends:** PR-01.

#### ☑ PR-03 `[S]` Scramble generator + isSolved
- **Scope:** `scramble.ts`, `isSolved`. Constraints per the contract comment (no same-face repeats, no immediate inverse; also forbid same-axis triples like `L R L`).
- **Tests:** 500 random scrambles satisfy constraints; scrambled ≠ solved; applying `invertMoves(scramble)` restores SOLVED.
- **Depends:** PR-02.

#### ☑ PR-04 `[O]` Validation
- **Scope:** `validate.ts` implementing every `ValidationIssue` kind: length, per-color counts, center permutation, piece validity (each of the 12 edge cubies and 8 corner cubies must carry a legal, distinct color combination — e.g. no edge with two opposite colors, no duplicate pieces), edge-orientation sum even, corner-orientation sum ≡ 0 (mod 3), permutation parity (edge permutation parity must equal corner permutation parity).
- **Design note:** build an internal cubie-level decomposition (facelets → 12 edges + 8 corners with orientation). Export it from an internal module — the LBL solver (Phase 6) will reuse it. Keep it out of `types.ts`.
- **Tests:** SOLVED validates ok; each issue kind has a constructed fixture that triggers it and ONLY it where possible; every random scramble of SOLVED validates ok (1,000 cases); single twisted corner / flipped edge / swapped pair fixtures fail with the right issue.
- **Depends:** PR-02.

#### ☑ PR-05 `[S]` Kociemba adapter + worker
- **Scope:** `npm i cubejs`. `src/workers/kociemba.worker.ts` hosting init + solve; `solvers/kociemba.ts` implementing the `Solver` interface over `postMessage`. Read the cubejs README first and adapt to its actual API (`Cube.initSolver()`, `Cube.fromString(...)`, `.solve()` — verify names, do not guess). Solver output string → `parseMoves`. Reject before solving if `validate()` fails.
- **Tests:** (node worker not required — test the adapter's pure parts + an integration test calling cubejs directly, not through the worker) — for 25 random scrambles: solve, apply solution, assert `isSolved`. Assert solution length ≤ 23.
- **Depends:** PR-03, PR-04.

**— At this point the engine is provably correct. Everything visual builds on top. —**

### Phase 2 — 3D cube rendering & animation

#### ☑ PR-06 `[S]` Static 3D cube from state
- **Scope:** `render/CubeRenderer.ts` — Three.js scene: 27 cubelets (rounded-ish box geometry fine), sticker colors as materials per facelet. Public API: `constructor(canvas)`, `setState(facelets: FaceletString)`, `dispose()`. Orbit-style drag to rotate the whole cube view (implement simple pointer-drag rotation of a group; do NOT depend on `OrbitControls` — implement ~30 lines of drag math instead, mobile-friendly). Colors: U white, D yellow, F green, B blue, R red, L orange; make this a single exported color map so the scan UI reuses it.
- **Acceptance:** a `/dev` route (dev-only) renders SOLVED and a hardcoded scrambled state correctly. Manually verify sticker orientation against a real cube photo: this is the #1 place a silent mapping bug enters. Add a unit test for the (face,index) → cubelet/face mapping table itself.
- **Out of scope:** animation.
- **Depends:** PR-05 (state utilities only), PR-00.

#### ☑ PR-07 `[O]` Move animation queue
- **Scope:** `render/animator.ts`. API: `enqueue(moves: Move[])`, `play()`, `pause()`, `stepForward()`, `stepBack()`, `setSpeed(multiplier)`, `onMoveComplete(cb)`, `onQueueEmpty(cb)`. Implementation: to animate a move, attach the 9 affected cubelets to a temporary pivot group, tween pivot rotation ±90°/180° (ease-in-out, 300ms base), then bake: detach, snap cubelet positions/rotations to the grid, and call `setState` with the post-move facelets (from `applyMove`) to eliminate float drift. `stepBack` animates the inverse move and moves the cursor back.
- **Hard requirement:** after ANY sequence of play/pause/step operations, the rendered cube must exactly equal `applyMoves(initial, movesDone)`. The bake-to-facelets step guarantees this — do not skip it.
- **Tests:** animator's queue/cursor logic extracted pure and unit-tested (which move plays next after arbitrary step/pause sequences). Visual correctness verified on the `/dev` route with a scripted demo button ("scramble 5 moves slowly").
- **Depends:** PR-06, PR-02.

### Phase 3 — Milestone 1: scramble → solve → guided playback

#### ☑ PR-08 `[S]` App shell + solve screen UI (follow mode + watch mode)
- **Scope:** Real app layout per `design-mocks.html` screen 2. Header, cube stage, control panel. "Scramble" button (animates a random 25-move scramble fast, 80ms/move). "Solve" → Kociemba solution → two playback modes:
  - **Follow mode (DEFAULT):** one move at a time, self-paced. The moving layer is highlighted with the accent band — the ENTIRE physical slab: the turning face's 9 stickers PLUS the adjacent 3-sticker strips on neighboring faces. All non-moving stickers dim to ~22% opacity. A curved arrow is drawn IN THE PLANE of the turning face, around its center, animated (flowing dashes). **Arrow sweep must match the turn amount: ~90° arc for quarter turns, ~180° for double turns.** Move card: big plain-language headline "Turn the ⬤ red side" with an inline center-color swatch (centers never move, so the moving face's center color reliably names the side on the user's physical cube); secondary line "Follow the arrow — just one quarter turn" (or "half turn"); notation (`R'`) demoted to a small muted mono chip. A large "I did it" button advances the cursor.
  - **Watch mode (secondary):** play/pause autoplay, prev/next, speed slider (0.5×–2×).
  - Progress "Move 7 of 21", move-chip list with current highlighted. Solver init on app load (worker) with a "preparing solver…" note until ready.
- **Copy map:** pure function `describeLayer(m: Move): { colorFace: Face; headline: string; detail: string }` in `ui/` with tests; color names derive from the fixed center-color map exported in PR-06.
- **Depends:** PR-05, PR-07.

#### ☑ PR-09 `[S]` Milestone-1 polish + empty/edge states
- **Scope:** Solved-state detection with a small celebration (confetti or pulse — CSS only), disable Solve when already solved, handle "user scrambles during playback" (scramble cancels playback and clears queue), responsive layout pass for phone-width, keyboard: space = play/pause, arrows = step.
- **Depends:** PR-08.

> ### ✅ CHECKPOINT 1 (delivery manager, on the deployed Pages URL)
> 1. Scramble → Solve → autoplay to the end: cube visibly ends solved.
> 2. Step backward/forward repeatedly mid-solution — no drift, progress counter consistent.
> 3. Works on your phone (touch-rotate the cube, controls usable).
> 4. Refresh mid-anything — app recovers cleanly.
> Do not start Phase 4 until this passes. This checkpoint proves engine + renderer + animator, which every later phase trusts blindly.

### Phase 4 — Manual color input (permanent scan fallback)

#### ☑ PR-10 `[S]` Unfolded cube editor
- **Scope:** `/edit` screen: unfolded (cross-shaped) 2D cube, tap a sticker → cycle or pick from a 6-color palette. Centers fixed (they define the color scheme). Live validation banner driven by `validate()`: friendly message per `ValidationIssue` kind (write a `describeIssue()` map with tests — e.g. `corner-orientation` → "One corner appears twisted. Check the highlighted corners."). "Solve this cube" button enabled only when valid; routes into the Phase-3 solve screen with this state.
- **Depends:** PR-09, PR-04.

#### ☑ PR-11 `[S]` Issue highlighting
- **Scope:** where a `ValidationIssue` can be localized (bad piece, twisted corner), highlight the offending stickers on the 2D editor. Extend `validate()`'s internal cubie module to report positions — additive change only; contract in section 4 unchanged (`invalid-piece.detail` already carries text; add a parallel internal API for positions rather than changing the public type).
- **Depends:** PR-10.

### Phase 5 — Camera scanning

#### ☑ PR-12 `[S]` Camera plumbing
- **Scope:** `scan/camera.ts`: `getUserMedia` wrapper — request rear camera on mobile (`facingMode: 'environment'`), default cam on desktop, mirrored preview on desktop only. Permission-denied and no-camera states with instructions + "enter colors manually instead" escape hatch to `/edit`. Scan screen skeleton: live video, centered square guide with 3×3 grid overlay (canvas on top).
- **Depends:** PR-09.

#### ☑ PR-13 `[O]` Color sampling + classification
- **Scope:** `scan/colorDetect.ts` (pure — takes `ImageData`, returns samples; NO video/DOM types) + `scan/calibrate.ts`.
  - Sampling: for each of the 9 grid cells, take the median RGB over a small central patch (~15% of cell size) — median, not mean, to reject glare pixels.
  - Convert to HSV.
  - Classification: nearest centroid among the six calibration centroids, distance = weighted hue (circular!), saturation, value. Until calibration exists (first faces), fall back to fixed default centroids; mark low-confidence.
  - Calibration: after all six centers have been captured, recompute centroids from the actual center-sticker samples and reclassify all stored faces.
  - Known hard cases to handle explicitly, with fixture tests: white vs yellow under warm light (separate on saturation before hue), red vs orange (tightest hue margin — widen the patch and trust calibration), glare (median + confidence penalty when patch variance is high).
- **Tests:** fixture `ImageData` patches (generate synthetic patches in tests + at least a handful of hardcoded real-world RGB triples per color, including warm-light white and dim orange) classify correctly; circular hue distance unit-tested (hue 358 vs 2 must be "close").
- **Depends:** PR-12 (types only; the module itself is pure and testable without it).

#### ☐ PR-14 `[S]` Guided 6-face scan flow
- **Scope:** fixed capture order U, R, F, D, L, B with on-screen instructions ("Hold the WHITE center facing the camera, GREEN center on top" — write the exact hold instruction per face so orientation is unambiguous; document the chosen convention in a comment AND in the UI). Live per-sticker classification preview on the grid overlay; auto-capture when all 9 stickers hold stable classification for ~1s, plus a manual capture button. Progress: mini unfolded cube filling in as faces land.
- **Depends:** PR-13.

#### ☐ PR-15 `[S]` Review & correct + handoff to solve
- **Scope:** after 6 faces: full unfolded cube with confidence-based highlighting (low-confidence stickers outlined), tap-to-fix reusing the PR-10 editor component, `validate()` gate, then into the solve flow. "Rescan face X" action. Persist `ScanSession` to `sessionStorage` so an accidental refresh doesn't lose 5 scanned faces.
- **Depends:** PR-14, PR-10.

> ### ✅ CHECKPOINT 2 (delivery manager, real cube in hand)
> 1. Scan your actual cube on your phone in normal room lighting — end to end into a correct solve.
> 2. Deliberately mis-scan (bad angle/lighting) — review screen lets you fix it; validation catches impossible states with a readable message.
> 3. Deny camera permission — manual entry path works fully.
> Expect to iterate on PR-13 thresholds here. File follow-up issues rather than expanding PR-15.

### Phase 6 — Learn Mode (custom LBL solver)

**Architecture for all Phase-6 PRs:** solver lives in `core/solvers/lbl/`, one module per stage, each exporting `solveStage(state): { moves: Move[] }` that brings the cube from "previous stages complete" to "this stage complete", plus a predicate `isStageComplete(state): boolean`. An orchestrator runs stages in order, concatenates, and wraps in `Solution.phases` with `teaching` text. Reuse the cubie decomposition from PR-04. Technique per stage: locate target piece via cubie decomposition → case analysis → apply known algorithm/setup moves. NO search/BFS beyond trivial setup-move enumeration; this keeps solutions human-followable and the code debuggable.

**Property test (added in PR-16, must pass with every stage PR, grows as stages land):** for 1,000 random scrambles, run all implemented stages; assert each stage's completion predicate afterward, assert total move count < 300, and (once all stages land) assert `isSolved`.

**Visual verification (mandatory in every stage PR, for delivery-manager progress checks):** each stage PR adds/extends a `/dev` demo button — "Scramble, then solve through <stage>" — which scrambles the 3D cube and animates all implemented stages in sequence. The delivery manager must be able to watch, e.g., the white cross visibly form (PR-16), the full white layer complete (PR-17), and so on, on the deployed URL after each merge.

#### ☐ PR-16 `[O]` LBL scaffolding + white cross
- Orchestrator, stage interface, property-test harness, `white-cross` stage + its completion predicate.
#### ☐ PR-17 `[O]` White corners
#### ☐ PR-18 `[O]` Middle-layer edges
#### ☐ PR-19 `[O]` Yellow cross + yellow edges (two stages, one PR — they share case tables)
#### ☐ PR-20 `[O]` Corner position + corner orientation → full solve
- PR-20 additionally: register LBL in the solver registry; assert the full 1,000-scramble property test.
- **Each of PR-16..20 depends on the previous.** These are the hardest PRs in the project. If any stage fights back, reduce scope to landing that single stage correctly — never merge a stage whose property test is flaky.

#### ☐ PR-21 `[S]` Learn Mode UI
- **Scope:** mode picker after validation ("Quick solve — about 20 moves" / "Learn as you go — more moves, you'll understand them"). In Learn playback: stage banner (title + teaching text), per-stage progress ("Stage 2 of 7 · move 4 of 12"), stage-complete beat (brief pause + highlight) before the next stage starts.
- **Depends:** PR-20, PR-09.

### Phase 7 — Checkpoint re-scan loop (the product's signature feature)

#### ☐ PR-22 `[O]` Session engine + drift recovery
- **Scope:** implement `SolveSession` logic as pure core code (`core/session.ts`): batching (Kociemba: checkpoint every 12 moves; LBL: at phase boundaries), `expectedState()` derivation, and `reconcile(scanned: FaceletString)` returning `'match' | 'resolve-needed' | 'already-solved'`. On drift: re-solve from the scanned state with the same solver and splice into a fresh session (LBL re-solve naturally restarts at the right stage since earlier predicates already pass). UI: after each batch, "Now try these N moves on your cube" screen → "Check my cube" → condensed re-scan (reuse Phase-5 flow) → on match, encouraging continue; on drift, a NON-judgmental message ("Looks like the cube took a different path — no problem, here's the way from where you are") and the new solution resumes. Never show the user an error for drifting; recovery is the feature.
- **Tests:** session/batching/reconcile logic fully unit-tested including drift mid-LBL-stage.
- **Depends:** PR-15, PR-21.

> ### ✅ CHECKPOINT 3 (delivery manager)
> 1. Full journey on your phone with your real cube, Learn Mode, following moves physically, re-scanning at each stage boundary — reach a solved cube.
> 2. Deliberately make a wrong turn mid-batch, re-scan — app recovers gracefully and you still reach solved.
> This is the product promise. Budget real time with a real cube.

### Phase 8 — Polish

#### ☐ PR-23 `[S]` Ghost preview loop + visual polish
- **Ghost preview loop:** in follow mode, the highlighted layer performs the upcoming turn as a slow ghost preview on repeat (turn ~90°, ease back, brief pause, loop) until "I did it" is pressed — watch-then-copy is the primary teaching mechanism on top of the PR-08 arrow. Must respect `prefers-reduced-motion` (fall back to the animated arrow only).
- Also: easing polish on the hidden-face auto-orbit (section 9 rule 7), subtle idle rotation on the home screen cube, solved celebration per `design-mocks.html` screen 7.
#### ☐ PR-24 `[S]` Quality floor
- Playwright smoke test (scramble → solve → autoplay → solved) in CI; accessibility pass (focus states, labels, reduced-motion respects animation off); Lighthouse mobile pass; README with screenshots.

---

## 7. Risk register (architect's notes to implementers)

| Risk | Mitigation already designed in |
|------|-------------------------------|
| Facelet↔3D mapping bug renders plausibly-wrong cubes for weeks | PR-06 mandates manual photo verification + a unit test on the mapping table itself |
| Animation drift after many step/undo operations | PR-07 bake-to-facelets requirement |
| Red/orange + white/yellow misclassification | PR-13 center calibration, median sampling, saturation-first split, confidence surfacing in PR-15 |
| LBL solver silently wrong on rare states | 1,000-scramble property test gated in CI from PR-16 onward |
| cubejs API guessed wrong | PR-05 explicitly requires reading its README before wiring |
| Scope creep in any session | Out-of-scope lists + `BLOCKED:` convention + PR size cap |

## 8. How to run this with Claude Code

1. Create the GitHub repo, commit this file as `tasks.md` at root.
2. Per task, start a session with: *"Read tasks.md and CLAUDE.md. Implement PR-NN only. Follow section 4 contracts exactly. Open a PR against main."*
3. Use the `[S]`/`[O]` tags to pick the model; Opus for PR-02, 04, 07, 13, 16–20, 22.
4. Review PRs yourself at minimum for: contract changes (reject), out-of-scope code (reject), missing tests on core (reject).
5. At each ✅ CHECKPOINT, test on the deployed URL before authorizing the next phase.

---

## 9. Visual design direction (architect-approved, applies from PR-08 onward)

**STATUS: LOCKED** — approved by the delivery manager. Visual source of truth: **`design-mocks.html` at repo root** (all seven screens: home, solve/follow mode, camera scan, scan review, manual editor, learn checkpoint, celebration). This section plus the mocks define "done" for UI PRs; palette, cue design, card hierarchy, and copy tone are binding, exact pixel spacing is not.

Principle: **a dark, quiet stage — the cube is the only colorful thing on screen.** Implementers match this spec, not personal taste.

**Design tokens (put in CSS variables in PR-08; all UI derives from these):**

| Token | Value | Use |
|---|---|---|
| `--cc-bg` | `#14161B` | App background |
| `--cc-surface` | `#1D2026` | Cards, panels |
| `--cc-border` | `#2A2E36` (`#232730` for section dividers) | Hairlines |
| `--cc-text` | `#E8EAED` | Primary text |
| `--cc-text-2` | `#9AA0AB` | Secondary text |
| `--cc-accent` | `#8B7CF6` (tint bg: `rgba(139,124,246,.14)`, tint text: `#B7ACFA`) | THE one interface accent |
| Sticker colors | W `#F5F5F0` · Y `#FFD500` · G `#009B48` · B `#0046AD` · R `#B71234` · O `#FF5800` | Single exported map (PR-06), reused by 3D renderer, 2D editor, scan preview |

**Rules:**
1. The accent is violet BECAUSE no Rubik's cube contains violet — an interface highlight can never be mistaken for a sticker. Never use any of the six sticker colors to convey UI meaning (progress, buttons, states). Amber dashed outline is the sole exception, reserved for low-confidence scan cells.
2. Move notation is ALWAYS monospace. The current-move card (large notation + plain-language sentence + rotation-direction icon) is the app's signature element — present in every solve view.
3. Rotation cues (PR-23 halos) render in the accent violet, never in face colors.
4. Microcopy is encouraging and never blames the user. Drift recovery language: "Looks like the cube took a different path — no problem, here's the way from where you are." No error styling for drift; it is a normal, supported flow.
5. Layout: desktop = cube stage left, control panel right; mobile = cube top, controls bottom sheet-style. Scan screen: instruction above camera, 3×3 guide centered, mini unfolded-cube progress + capture control below.
6. **Natural cube view (PR-06):** the solve view always shows one solid cube in three-quarter view — exactly three faces visible (Up + Front + Right by default), all faces sharing edges, matching how a person actually holds a cube. Never an exploded, detached, or unfolded rendering in any solve/playback view. The flat unfolded layout is reserved strictly for the manual editor (PR-10) and scan progress mini-map (PR-14).
7. **Hidden-face moves (PR-07/PR-08):** when the next move is on a face not currently visible (e.g. B, D, or L from the default angle), the camera smoothly auto-orbits (~400ms) to bring that face into view BEFORE the turn animates, then eases back after. The user must never be asked to perform a move they cannot see happening.
8. **Move guidance stack (LOCKED, per PR-08/PR-23):** dim everything static → violet band around the ENTIRE moving slab (face + adjacent strips) → in-plane arrow whose sweep honestly matches the turn amount (90°/180°) → ghost preview of the actual motion on loop → color-anchored copy ("Turn the ⬤ red side"; centers never move, so center colors are permanent names) → notation as a small optional chip. Each layer must work alone; never add hand illustrations, voice prompts, or longer explanations — simplicity here comes from removing, not adding.
9. **Follow mode is the default** everywhere a solution plays. The app never advances a move without "I did it" in follow mode; autoplay exists only as explicit watch mode. Target comprehension level: a 7-year-old following along with a real cube.
