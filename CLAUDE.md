# CLAUDE.md — working conventions for Claude Code

Source of truth for product scope and task breakdown: `tasks.md` at repo root.
This file mirrors its section 2 (locked decisions) and section 5 (working
conventions) so they're visible without opening `tasks.md`.

## Locked decisions — DO NOT RELITIGATE

These were made deliberately by the architect. A Claude Code session may not
change them. If one appears genuinely broken during implementation, stop and
write up the problem for the delivery manager instead of working around it.

| #   | Decision                                                                                                                                                | Rationale                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| D1  | **Vite + React 18 + TypeScript (strict)**                                                                                                               | TS contracts keep multi-session work consistent; Vite for fast dev + static build.                            |
| D2  | **All cube logic lives in `src/core/` as pure TS — zero DOM, zero React, zero Three.js imports**                                                        | Makes solvers/validation unit-testable and reusable. CI enforces via lint rule.                               |
| D3  | **Canonical state = 54-char facelet string, URFDLB face order** (cubejs convention: solved = `UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB`)  | One representation everywhere. Renderer and scanners convert at the edges.                                    |
| D4  | **Quick Solve = `cubejs` npm package, wrapped in an adapter and run in a Web Worker**                                                                   | Battle-tested Kociemba impl; table init takes seconds, must not block UI.                                     |
| D5  | **Learn Mode = custom layer-by-layer solver in `src/core/solvers/lbl/`**                                                                                | No good off-the-shelf JS beginner-method solver; we need named stages for teaching.                           |
| D6  | **Three.js (plain, no react-three-fiber) encapsulated in a `CubeRenderer` class; React talks to it through a thin hook**                                | Imperative animation queue is simpler and testable without React render cycles.                               |
| D7  | **Color detection = canvas pixel sampling → HSV → nearest-centroid classification anchored on the 6 scanned center stickers. No OpenCV/ML.**            | 3×3 grid at a known screen position doesn't need CV; centers give per-cube/per-lighting calibration for free. |
| D8  | **No backend. No accounts. No analytics. State in memory (+ `sessionStorage` for scan-in-progress only).**                                              | Static deploy, zero credentials — project constraint.                                                         |
| D9  | **Testing: Vitest for `src/core/` (mandatory, CI-gated). Playwright smoke test added in Phase 8 only.**                                                 | Logic bugs are the real risk; e2e early would slow every PR.                                                  |
| D10 | **Deploy: GitHub Pages via Actions on every merge to `main`**                                                                                           | Free HTTPS (needed for camera), demo always current for checkpoints.                                          |
| D11 | **Move notation: standard Singmaster, outer turns only: `U D L R F B`, each with `'` and `2` variants (18 moves). No slice/wide/rotation moves in v1.** | Keeps the move engine, LBL solver, and animation cues simple.                                                 |

**`src/core` must never import from `react`, `three`, or the DOM.**

## Working conventions

- **Branches:** `feat/pr-NN-short-name` (e.g. `feat/pr-03-move-engine`). One PR per task in `tasks.md` section 6.
- **PR size:** target < 400 lines of diff (excluding lockfiles/snapshots). If a task grows past that, stop and split — tell the delivery manager.
- **Commits:** conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- **Every PR must:** pass CI (lint, typecheck, tests), include tests for any `src/core/` change, update the checkbox for its task in `tasks.md`, and note any deviation from spec in the PR description.
- **Scope discipline:** each task lists _Out of scope_ items. Do not implement them early, even if convenient. Half-built future features make later PRs ambiguous.
- **When stuck or when the spec seems wrong:** do NOT improvise around a locked decision (above) or a contract (`tasks.md` section 4). Write a short `BLOCKED:` note in the PR and stop.
- **Suggested model per task:** `[S]` = Sonnet is fine (well-specified, mechanical). `[O]` = prefer Opus (algorithmic subtlety, easy to get quietly wrong). The delivery manager decides; these are the architect's recommendations.
