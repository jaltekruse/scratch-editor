/// <reference lib="webworker" />
/**
 * Web Worker that compiles sketches. Built to `dist/toolchain/worker.js` and served next to the prepared assets
 * (`manifest.json`, packs and `tools/`), which it loads relative to its own URL.
 */
import type { Manifest } from '../manifest.ts'
import { compileSketch, type AssetLoader, type CompileRequest, type Toolchain } from './build.ts'
import { TOOL_NAMES, type LoadedTool, type ToolLoader, type ToolName } from './tools.ts'

export type WorkerRequest = { id: number; type: 'compile'; request: CompileRequest } | { id: number; type: 'warm-up' }

export type WorkerResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string }

const base = new URL('./', import.meta.url)

async function fetchOk(path: string): Promise<Response> {
  const response = await fetch(new URL(path, base))
  if (!response.ok) throw new Error(`Failed to fetch ${new URL(path, base).href}: HTTP ${response.status}`)
  return response
}

const toolCache = new Map<ToolName, Promise<LoadedTool>>()
const loadTool: ToolLoader = (name) => {
  let loaded = toolCache.get(name)
  if (!loaded) {
    loaded = (async () => {
      const [glue, wasm] = await Promise.all([
        import(/* @vite-ignore */ new URL(`tools/${name}.mjs`, base).href) as Promise<{
          default: LoadedTool['factory']
        }>,
        fetchOk(`tools/${name}.wasm`).then((r) => WebAssembly.compileStreaming(r)),
      ])
      return { factory: glue.default, wasm }
    })()
    // Allow a retry after a transient network failure.
    loaded.catch(() => toolCache.delete(name))
    toolCache.set(name, loaded)
  }
  return loaded
}

let manifestPromise: Promise<Manifest> | undefined
const packCache = new Map<string, Promise<Uint8Array>>()
const assets: AssetLoader = {
  manifest: () => {
    manifestPromise ??= fetchOk('manifest.json').then((r) => r.json() as Promise<Manifest>)
    return manifestPromise
  },
  pack: (name) => {
    let pack = packCache.get(name)
    if (!pack) {
      pack = fetchOk(name).then(async (r) => new Uint8Array(await r.arrayBuffer()))
      pack.catch(() => packCache.delete(name))
      packCache.set(name, pack)
    }
    return pack
  },
}

const toolchain: Toolchain = { tools: loadTool, assets }

async function warmUp(): Promise<void> {
  const manifest = await assets.manifest()
  await Promise.all([
    ...TOOL_NAMES.map(loadTool),
    ...Object.values(manifest.packs).map((name) => assets.pack(name)),
    ...Object.values(manifest.targets).flatMap((t) => (t ? [assets.pack(t.pack)] : [])),
  ])
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  const work = message.type === 'compile' ? compileSketch(toolchain, message.request) : warmUp()
  work.then(
    (value) => self.postMessage({ id: message.id, ok: true, value } satisfies WorkerResponse),
    (error: unknown) =>
      self.postMessage({
        id: message.id,
        ok: false,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      } satisfies WorkerResponse),
  )
})
