/// <reference lib="webworker" />

import Cube from 'cubejs'

/** Message protocol with `solvers/kociemba.ts` (the two sides can't share
 *  type imports across the DOM/WebWorker lib boundary — see tsconfig.worker.json
 *  — so the shapes are mirrored, not imported). */
type Request = { id: number; type: 'init' } | { id: number; type: 'solve'; state: string }

type Response =
  | { id: number; type: 'ready' }
  | { id: number; type: 'solved'; moves: string }
  | { id: number; type: 'error'; message: string }

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    if (request.type === 'init') {
      Cube.initSolver()
      const response: Response = { id: request.id, type: 'ready' }
      self.postMessage(response)
    } else {
      const moves = Cube.fromString(request.state).solve()
      const response: Response = { id: request.id, type: 'solved', moves }
      self.postMessage(response)
    }
  } catch (err) {
    const response: Response = {
      id: request.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(response)
  }
}
