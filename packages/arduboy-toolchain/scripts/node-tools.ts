/**
 * Node.js helpers for running the WebAssembly toolchain outside the browser (asset preparation and tests).
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AssetLoader, Toolchain } from '../src/compiler/build.ts'
import type { LoadedTool, ToolLoader, ToolName } from '../src/compiler/tools.ts'
import type { Manifest } from '../src/manifest.ts'

export const wasmPackageDir = path.dirname(
  createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json'),
)

/**
 * Load toolchain programs from a directory of `<tool>.mjs` / `<tool>.wasm` files, caching compiled modules.
 * @param toolsDir - Directory holding the tools.
 * @returns A tool loader.
 */
export function createNodeToolLoader(toolsDir: string): ToolLoader {
  const cache = new Map<ToolName, Promise<LoadedTool>>()
  return (name) => {
    let loaded = cache.get(name)
    if (!loaded) {
      loaded = (async () => {
        const glue = (await import(pathToFileURL(path.join(toolsDir, `${name}.mjs`)).href)) as {
          default: LoadedTool['factory']
        }
        const wasm = await WebAssembly.compile(fs.readFileSync(path.join(toolsDir, `${name}.wasm`)))
        return { factory: glue.default, wasm }
      })()
      cache.set(name, loaded)
    }
    return loaded
  }
}

/**
 * A toolchain backed by prepared assets on disk (the output of `prepare-assets.ts`).
 * @param assetsDir - Directory containing `manifest.json`, the packs and `tools/`.
 * @returns Tool and asset loaders reading from `assetsDir`.
 */
export function createNodeToolchain(assetsDir: string): Toolchain {
  const packs = new Map<string, Uint8Array>()
  const assets: AssetLoader = {
    manifest: () =>
      Promise.resolve(JSON.parse(fs.readFileSync(path.join(assetsDir, 'manifest.json'), 'utf8')) as Manifest),
    pack: (name) => {
      let bytes = packs.get(name)
      if (!bytes) {
        bytes = new Uint8Array(fs.readFileSync(path.join(assetsDir, name)))
        packs.set(name, bytes)
      }
      return Promise.resolve(bytes)
    },
  }
  return { tools: createNodeToolLoader(path.join(assetsDir, 'tools')), assets }
}
