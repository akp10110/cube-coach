import { parseMoves } from '../moves'
import { validate } from '../validate'
import type { FaceletString, Solution, Solver, ValidationIssue } from '../types'

/** Thrown by `solve()` when the given state fails `validate()` (D4: reject
 *  before ever asking cubejs to solve an unsolvable state). */
export class ValidationError extends Error {
  readonly issues: ValidationIssue[]

  constructor(issues: ValidationIssue[]) {
    super('cube state failed validation')
    this.name = 'ValidationError'
    this.issues = issues
  }
}

/** Mirrors the request/response shapes in `workers/kociemba.worker.ts` (kept
 *  independent rather than imported — see tsconfig.worker.json). */
type Request = { id: number; type: 'init' } | { id: number; type: 'solve'; state: FaceletString }

type Response =
  | { id: number; type: 'ready' }
  | { id: number; type: 'solved'; moves: string }
  | { id: number; type: 'error'; message: string }

interface PendingEntry {
  resolve: (response: Response) => void
  reject: (error: unknown) => void
}

/** D4: cubejs adapter, table init + solving run off the main thread. */
export class KociembaSolver implements Solver {
  readonly id = 'kociemba' as const

  private worker: Worker | undefined
  private nextId = 0
  private readonly pending = new Map<number, PendingEntry>()

  private ensureWorker(): Worker {
    if (this.worker) return this.worker

    const worker = new Worker(new URL('../../workers/kociemba.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<Response>) => {
      const entry = this.pending.get(event.data.id)
      if (!entry) return
      this.pending.delete(event.data.id)
      entry.resolve(event.data)
    }
    worker.onerror = (event: ErrorEvent) => {
      for (const [id, entry] of this.pending) {
        entry.reject(new Error(event.message))
        this.pending.delete(id)
      }
    }
    this.worker = worker
    return worker
  }

  private send(request: Request): Promise<Response> {
    const worker = this.ensureWorker()
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject })
      worker.postMessage(request)
    })
  }

  async init(): Promise<void> {
    const response = await this.send({ id: this.nextId++, type: 'init' })
    if (response.type === 'error') throw new Error(response.message)
  }

  async solve(state: FaceletString): Promise<Solution> {
    const result = validate(state)
    if (!result.ok) {
      throw new ValidationError(result.issues)
    }

    const response = await this.send({ id: this.nextId++, type: 'solve', state })
    if (response.type === 'error') throw new Error(response.message)
    if (response.type !== 'solved') {
      throw new Error(`unexpected worker response: ${response.type}`)
    }

    return { moves: parseMoves(response.moves) }
  }
}
