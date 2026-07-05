/** Minimal ambient types for the untyped `cubejs` package — only the surface
 *  PR-05 actually calls. See node_modules/cubejs/README.md for the full API. */
declare module 'cubejs' {
  export default class Cube {
    /** Precomputes the Kociemba lookup tables. Must run once before `solve()`. */
    static initSolver(): void
    /** Parses a 54-char URFDLB facelet string (same convention as D3) into a cube. */
    static fromString(state: string): Cube

    /** Space-separated Singmaster algorithm that solves this cube, e.g. "R2 U' F ...". */
    solve(maxDepth?: number): string
  }
}
