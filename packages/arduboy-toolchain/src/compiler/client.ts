import type { CompileRequest, CompileResult } from './build.ts'
import type { WorkerRequest, WorkerResponse } from './worker.ts'

export interface ArduboyCompilerOptions {
  /**
   * URL of the directory serving `dist/toolchain/` (worker, manifest, packs and tools). Must be same-origin, since
   * it hosts the worker script. Relative URLs resolve against the document.
   */
  assetsBase: string | URL
}

/** `Omit` applied to each member of a union. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Compiles sketches in a dedicated Web Worker. The worker caches downloaded assets and compiled WebAssembly, so
 * keep one instance around for repeated builds.
 */
export class ArduboyCompiler {
  private readonly worker: Worker
  private readonly pending = new Map<number, Pending>()
  private nextId = 1

  constructor(options: ArduboyCompilerOptions) {
    const base = new URL(options.assetsBase, document.baseURI)
    if (!base.pathname.endsWith('/')) base.pathname += '/'
    this.worker = new Worker(new URL('worker.js', base), { type: 'module' })
    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if (response.ok) pending.resolve(response.value)
      else pending.reject(new Error(response.error))
    })
    this.worker.addEventListener('error', (event) => {
      const error = new Error(`Arduboy compiler worker failed: ${event.message || 'could not load worker.js'}`)
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    })
  }

  private send(message: WithoutId<WorkerRequest>): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...message, id })
    })
  }

  /**
   * Download all assets and compile the toolchain ahead of the first build.
   * @returns Resolves once everything is cached.
   */
  async warmUp(): Promise<void> {
    await this.send({ type: 'warm-up' })
  }

  /**
   * Compile and link a sketch.
   * @param request - The sketch and target.
   * @returns The result; compile errors are reported in `diagnostics`.
   */
  compile(request: CompileRequest): Promise<CompileResult> {
    return this.send({ type: 'compile', request }) as Promise<CompileResult>
  }

  /** Stop the worker. Pending builds are rejected. */
  terminate(): void {
    this.worker.terminate()
    for (const pending of this.pending.values()) pending.reject(new Error('Arduboy compiler was terminated'))
    this.pending.clear()
  }
}
