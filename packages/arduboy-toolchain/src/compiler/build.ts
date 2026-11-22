import { memoryUsage } from '../elf.ts'
import { unpack } from '../fs-pack.ts'
import { CORE_DIR, MANIFEST_VERSION, variantDir, type Manifest } from '../manifest.ts'
import { getTarget } from '../targets.ts'
import { asArgs, cWrapperSource, cc1plusArgs, ldArgs, objcopyArgs } from './flags.ts'
import { outputOf, runTool, type FileSet, type ToolLoader } from './tools.ts'

/** Where sketch files are placed in the virtual filesystem. */
export const SKETCH_DIR = '/sketch'
const BUILD_DIR = '/build'

export interface SketchFile {
  /** Path relative to the sketch folder, using `/` separators, e.g. `project.ino` or `Sprite1/Sprite1.cpp`. */
  path: string
  contents: string | Uint8Array
}

export interface CompileRequest {
  /** Target id from {@link TARGETS}. */
  target: string
  files: SketchFile[]
  /** The primary `.ino` file. Defaults to the first `.ino` file at the sketch root. */
  main?: string
}

export interface CompileResult {
  ok: boolean
  /** Intel HEX firmware, when `ok`. */
  hex?: string
  flashBytes?: number
  ramBytes?: number
  maxFlashBytes: number
  maxRamBytes: number
  /** Compiler and linker messages. */
  diagnostics: string
  timings: Record<string, number>
}

/** Supplies prepared assets (see `scripts/prepare-assets.ts`). */
export interface AssetLoader {
  manifest(): Promise<Manifest>
  /** Fetch a pack file by its name in the manifest. Implementations should cache. */
  pack(name: string): Promise<Uint8Array>
}

export interface Toolchain {
  tools: ToolLoader
  assets: AssetLoader
}

interface Unit {
  /** File cc1plus compiles. */
  source: string
  /** Name shown in diagnostics. */
  displayName: string
  language: 'c' | 'c++'
}

const unpacked = new WeakMap<Uint8Array, FileSet>()
async function loadPack(assets: AssetLoader, name: string): Promise<FileSet> {
  const bytes = await assets.pack(name)
  let files = unpacked.get(bytes)
  if (!files) {
    files = unpack(bytes)
    unpacked.set(bytes, files)
  }
  return files
}

/**
 * Arrange the sketch's sources into translation units following Arduino IDE conventions: all root-level `.ino`
 * files are concatenated (primary first) and compiled as one C++ unit; `.c`/`.cpp` files in the sketch root and
 * under `src/` are compiled separately. Sources elsewhere are only reachable through `#include`.
 * @param files - Sketch files.
 * @param main - Primary `.ino` path, if given.
 * @returns Generated files to add to the virtual filesystem, and the units to compile.
 */
export function planUnits(files: SketchFile[], main?: string): { generated: FileSet; units: Unit[] } {
  const isRoot = (p: string) => !p.includes('/')
  const inos = files.filter((f) => isRoot(f.path) && f.path.endsWith('.ino')).map((f) => f.path)
  const primary = main ?? inos[0]
  if (!primary || !inos.includes(primary)) {
    throw new Error(`planUnits: sketch has no primary .ino file (main=${main}, root .ino files: ${inos.join(', ')})`)
  }
  const ordered = [primary, ...inos.filter((p) => p !== primary).sort()]

  const generated: FileSet = new Map()
  const inoUnit = `${BUILD_DIR}/sketch/${primary}.cpp`
  generated.set(
    inoUnit,
    ['#include <Arduino.h>', ...ordered.map((p) => `#include "${SKETCH_DIR}/${p}"`), ''].join('\n'),
  )
  const units: Unit[] = [{ source: inoUnit, displayName: primary, language: 'c++' }]

  for (const { path } of files) {
    const compiled = isRoot(path) || path.startsWith('src/')
    if (!compiled) continue
    if (/\.(cpp|cc)$/.test(path)) {
      units.push({ source: `${SKETCH_DIR}/${path}`, displayName: path, language: 'c++' })
    } else if (path.endsWith('.c')) {
      const wrapper = `${BUILD_DIR}/sketch/${path}.wrapper.cpp`
      generated.set(wrapper, cWrapperSource(`${SKETCH_DIR}/${path}`))
      units.push({ source: wrapper, displayName: path, language: 'c' })
    }
  }
  return { generated, units }
}

/**
 * Compile and link a sketch to Intel HEX.
 * @param toolchain - Tool and asset loaders.
 * @param request - The sketch and target.
 * @returns The build result; compile errors are reported in `diagnostics` rather than thrown.
 */
export async function compileSketch(toolchain: Toolchain, request: CompileRequest): Promise<CompileResult> {
  const target = getTarget(request.target)
  const timings: Record<string, number> = {}
  const diagnostics: string[] = []
  const started = performance.now()
  const result = (fields: Partial<CompileResult> = {}): CompileResult => {
    timings.total = performance.now() - started
    return {
      ok: false,
      maxFlashBytes: target.maxFlashBytes,
      maxRamBytes: target.maxRamBytes,
      diagnostics: diagnostics.join('\n'),
      timings,
      ...fields,
    }
  }

  const manifest = await toolchain.assets.manifest()
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(`compileSketch: toolchain assets are version ${manifest.version}, expected ${MANIFEST_VERSION}`)
  }
  const targetAssets = manifest.targets[target.id]
  if (!targetAssets) throw new Error(`compileSketch: toolchain assets were not prepared for target "${target.id}"`)

  const [sysroot, headers, libs, archives] = await Promise.all([
    loadPack(toolchain.assets, manifest.packs.sysroot),
    loadPack(toolchain.assets, manifest.packs.headers),
    loadPack(toolchain.assets, manifest.packs.libs),
    loadPack(toolchain.assets, targetAssets.pack),
  ])
  timings.assets = performance.now() - started

  const sketch: FileSet = new Map(request.files.map((f) => [`${SKETCH_DIR}/${f.path}`, f.contents]))
  const { generated, units } = planUnits(request.files, request.main)
  const includeDirs = [SKETCH_DIR, CORE_DIR, variantDir(target.variant), ...manifest.libraryIncludeDirs]

  const objects: FileSet = new Map()
  for (const [i, unit] of units.entries()) {
    const asm = `${BUILD_DIR}/${i}.s`
    const obj = `${BUILD_DIR}/${i}.o`
    const t0 = performance.now()
    const cc = await runTool(
      toolchain.tools,
      'cc1plus',
      cc1plusArgs(target, includeDirs, {
        source: unit.source,
        output: asm,
        displayName: unit.displayName,
        language: unit.language,
      }),
      [sysroot, headers, sketch, generated],
      [asm],
    )
    diagnostics.push(...cc.stderr)
    timings[`compile:${unit.displayName}`] = performance.now() - t0
    if (cc.status !== 0) return result()

    const as = await runTool(toolchain.tools, 'avr-as', asArgs(asm, obj), [cc.outputs], [obj])
    diagnostics.push(...as.stderr)
    if (as.status !== 0) return result()
    objects.set(obj, outputOf(as, obj))
  }

  const elf = `${BUILD_DIR}/sketch.elf`
  const t1 = performance.now()
  const ld = await runTool(
    toolchain.tools,
    'avr-ld',
    ldArgs([...objects.keys()], targetAssets.archives, elf),
    [libs, archives, objects],
    [elf],
  )
  diagnostics.push(...ld.stderr)
  timings.link = performance.now() - t1
  if (ld.status !== 0) return result()

  const elfBytes = outputOf(ld, elf)
  const { flash, ram } = memoryUsage(elfBytes)
  if (flash > target.maxFlashBytes) {
    diagnostics.push(
      `Sketch uses ${flash} bytes of flash; the maximum for ${target.name} is ${target.maxFlashBytes}.`,
    )
    return result({ flashBytes: flash, ramBytes: ram })
  }
  if (ram > target.maxRamBytes) {
    diagnostics.push(
      `Global variables use ${ram} bytes of RAM; the maximum for ${target.name} is ${target.maxRamBytes}.`,
    )
    return result({ flashBytes: flash, ramBytes: ram })
  }

  const hexPath = `${BUILD_DIR}/sketch.hex`
  const objcopy = await runTool(toolchain.tools, 'avr-objcopy', objcopyArgs(elf, hexPath), [ld.outputs], [hexPath])
  diagnostics.push(...objcopy.stderr)
  if (objcopy.status !== 0) return result({ flashBytes: flash, ramBytes: ram })

  return result({
    ok: true,
    hex: new TextDecoder().decode(outputOf(objcopy, hexPath)),
    flashBytes: flash,
    ramBytes: ram,
  })
}
