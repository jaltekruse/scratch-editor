/**
 * Builds the static assets the in-browser compiler needs, into `dist/toolchain/`:
 *
 * - `tools/`: the WebAssembly AVR toolchain from `@horang-corp/avr-gcc-wasm`
 * - `sysroot.pack`: GCC and avr-libc headers
 * - `libs.pack`: avr-libc/libgcc archives, ATmega32U4 startup code and the linker script
 * - `headers.pack`: Arduboy core, variant and library headers
 * - `target-<id>.pack`: the core and every library precompiled into archives for one hardware target
 * - `manifest.json`: describes the above
 *
 * Precompiling uses the same WebAssembly toolchain under Node.js, so objects match what the browser produces and
 * no native AVR toolchain is required.
 *
 * Usage: node scripts/prepare-assets.ts [--out <dir>] [--target <id>...]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createArchive } from '../src/ar.ts'
import { LIB_DIR, MCU, asArgs, cWrapperSource, cc1plusArgs } from '../src/compiler/flags.ts'
import { TOOL_NAMES, outputOf, runTool, type FileSet } from '../src/compiler/tools.ts'
import { pack } from '../src/fs-pack.ts'
import { CORE_DIR, MANIFEST_VERSION, libraryIncludeDir, variantDir, type Manifest } from '../src/manifest.ts'
import { TARGETS, getTarget, type Target } from '../src/targets.ts'
import { createNodeToolLoader, wasmPackageDir } from './node-tools.ts'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = path.resolve(packageDir, '../..')
const boardPackageDir = path.join(repoDir, 'vendor/Arduboy-homemade-package/board-package-source')

/** Libraries to precompile: name and the directory holding its sources and headers. */
const LIBRARIES: { name: string; dir: string }[] = [
  ...[
    'Arduboy2',
    'ArduboyTones',
    'ArduboyPlaytune',
    'Arduboy-TinyFont',
    'ArdBitmap',
    'ArduboyFX',
    'ATMlib',
    'ArdVoice',
    'EEPROM',
    'FixedPointsArduino',
    'SPI',
  ].map((name) => ({ name, dir: path.join(boardPackageDir, 'libraries', name, 'src') })),
  { name: 'AceCommon', dir: path.join(repoDir, 'vendor/AceCommon/src') },
  { name: 'AceRoutine', dir: path.join(repoDir, 'vendor/AceRoutine/src') },
]

/** Core sources that cannot be built without a C preprocessor for assembly; only `pulseIn()` needs them. */
const SKIPPED_CORE_SOURCES = new Set(['wiring_pulse.S', 'wiring_pulse.c'])

const { values: options } = parseArgs({
  options: {
    out: { type: 'string', default: path.join(packageDir, 'dist/toolchain') },
    target: { type: 'string', multiple: true },
  },
})

function walk(dir: string, filter: (file: string) => boolean): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Test helpers are not part of the library proper.
      if (entry.name !== 'testing') results.push(...walk(full, filter))
    } else if (filter(entry.name)) {
      results.push(full)
    }
  }
  return results.sort()
}

const isHeader = (name: string) => /\.(h|hpp)$/.test(name) || !name.includes('.')
const isSource = (name: string) => /\.(c|cpp)$/.test(name)

function readTree(srcDir: string, destDir: string, filter: (file: string) => boolean): FileSet {
  const files: FileSet = new Map()
  for (const file of walk(srcDir, filter)) {
    files.set(path.posix.join(destDir, path.relative(srcDir, file).split(path.sep).join('/')), fs.readFileSync(file))
  }
  return files
}

const loadTool = createNodeToolLoader(path.join(wasmPackageDir, 'tools'))

function copyTools(outDir: string): void {
  const toolsDir = path.join(outDir, 'tools')
  fs.mkdirSync(toolsDir, { recursive: true })
  for (const name of TOOL_NAMES) {
    for (const ext of ['mjs', 'wasm']) {
      fs.copyFileSync(path.join(wasmPackageDir, 'tools', `${name}.${ext}`), path.join(toolsDir, `${name}.${ext}`))
    }
  }
}

function sysrootFiles(): FileSet {
  const files = readTree(path.join(wasmPackageDir, 'assets/fs/sysroot'), '/sysroot', () => true)
  // Drop register definitions for every other AVR device; they make up most of the sysroot.
  for (const p of files.keys()) {
    const match = /^\/sysroot\/avr\/include\/avr\/(io.+\.h)$/.exec(p)
    if (match && match[1] !== 'io.h' && match[1] !== `io${MCU.replace('atmega', 'm')}.h`) files.delete(p)
  }
  // GCC's own <limits.h>, which the WebAssembly package does not ship.
  for (const [p, data] of readTree(
    path.join(packageDir, 'third_party/gcc-include-fixed'),
    '/sysroot/gcc/include-fixed',
    isHeader,
  )) {
    files.set(p, data)
  }
  return files
}

function libFiles(): FileSet {
  const files: FileSet = new Map()
  for (const name of ['libc.a', 'libm.a', 'libgcc.a']) {
    files.set(`${LIB_DIR}/${name}`, fs.readFileSync(path.join(wasmPackageDir, 'assets/libs', name)))
  }
  for (const name of [`crt${MCU}.o`, `lib${MCU}.a`]) {
    files.set(`${LIB_DIR}/${name}`, fs.readFileSync(path.join(packageDir, 'third_party/avr-libc', name)))
  }
  // avr-ld looks for its default linker script here.
  files.set('/ldscripts/avr5.xn', fs.readFileSync(path.join(wasmPackageDir, 'assets/ldscripts/avr5.xn')))
  return files
}

function headerFiles(): FileSet {
  // Core sources are included too: ArduboyFX #includes <wiring.c>.
  const files: FileSet = readTree(path.join(boardPackageDir, 'cores/arduboy'), CORE_DIR, () => true)
  // Variants include one another, so all of them are shipped.
  for (const variant of fs.readdirSync(path.join(boardPackageDir, 'variants'))) {
    for (const [p, data] of readTree(
      path.join(boardPackageDir, 'variants', variant),
      variantDir(variant),
      isHeader,
    )) {
      files.set(p, data)
    }
  }
  for (const lib of LIBRARIES) {
    for (const [p, data] of readTree(lib.dir, libraryIncludeDir(lib.name), isHeader)) files.set(p, data)
  }
  return files
}

async function compileToObject(
  target: Target,
  includeDirs: string[],
  context: FileSet[],
  virtualSource: string,
  contents: Uint8Array,
): Promise<Uint8Array> {
  const asm = '/build/out.s'
  const isC = virtualSource.endsWith('.c')
  const unitSource = isC ? '/build/wrapper.cpp' : virtualSource
  const sources: FileSet = new Map([[virtualSource, contents]])
  if (isC) sources.set(unitSource, cWrapperSource(virtualSource))
  const cc = await runTool(
    loadTool,
    'cc1plus',
    cc1plusArgs(target, includeDirs, {
      source: unitSource,
      output: asm,
      displayName: path.posix.basename(virtualSource),
      language: isC ? 'c' : 'c++',
    }),
    [...context, sources],
    [asm],
  )
  if (cc.status !== 0)
    throw new Error(`cc1plus failed on ${virtualSource} for ${target.id}:\n${cc.stderr.join('\n')}`)

  const obj = '/build/out.o'
  const as = await runTool(loadTool, 'avr-as', asArgs(asm, obj), [new Map([[asm, outputOf(cc, asm)]])], [obj])
  if (as.status !== 0) throw new Error(`avr-as failed on ${virtualSource} for ${target.id}:\n${as.stderr.join('\n')}`)
  return outputOf(as, obj)
}

async function buildTarget(target: Target, context: FileSet[], libraryIncludeDirs: string[]): Promise<FileSet> {
  const includeDirs = [CORE_DIR, variantDir(target.variant), ...libraryIncludeDirs]
  const archives: FileSet = new Map()

  const coreDir = path.join(boardPackageDir, 'cores/arduboy')
  const coreObjects = []
  for (const file of walk(coreDir, isSource)) {
    const name = path.basename(file)
    if (SKIPPED_CORE_SOURCES.has(name)) continue
    const data = await compileToObject(target, includeDirs, context, `${CORE_DIR}/${name}`, fs.readFileSync(file))
    coreObjects.push({ name: `${name}.o`, data })
  }
  archives.set(`${LIB_DIR}/core.a`, createArchive(coreObjects))

  for (const lib of LIBRARIES) {
    // Some libraries #include their own source files, so all of them are made available.
    const librarySources = readTree(lib.dir, libraryIncludeDir(lib.name), isSource)
    const members = []
    for (const file of walk(lib.dir, isSource)) {
      const rel = path.relative(lib.dir, file).split(path.sep).join('/')
      const virtualSource = `${libraryIncludeDir(lib.name)}/${rel}`
      const data = await compileToObject(
        target,
        includeDirs,
        [...context, librarySources],
        virtualSource,
        fs.readFileSync(file),
      )
      members.push({ name: `${rel.replace(/\//g, '_')}.o`, data })
    }
    if (members.length) archives.set(`${LIB_DIR}/lib${lib.name}.a`, createArchive(members))
  }
  return archives
}

function writePack(outDir: string, name: string, files: FileSet): string {
  const bytes = pack(
    new Map([...files].map(([p, d]) => [p, typeof d === 'string' ? new TextEncoder().encode(d) : d])),
  )
  fs.writeFileSync(path.join(outDir, name), bytes)
  console.info(`  ${name}: ${files.size} files, ${(bytes.length / 1024).toFixed(0)} KiB`)
  return name
}

async function main(): Promise<void> {
  const outDir = path.resolve(options.out)
  const targets = options.target ? options.target.map(getTarget) : TARGETS
  fs.mkdirSync(outDir, { recursive: true })
  console.info(`Preparing Arduboy toolchain assets in ${outDir}`)

  copyTools(outDir)
  const sysroot = sysrootFiles()
  const headers = headerFiles()
  const libs = libFiles()
  writePack(outDir, 'sysroot.pack', sysroot)
  writePack(outDir, 'libs.pack', libs)
  writePack(outDir, 'headers.pack', headers)

  const libraryIncludeDirs = LIBRARIES.map((lib) => libraryIncludeDir(lib.name))
  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    packs: { sysroot: 'sysroot.pack', libs: 'libs.pack', headers: 'headers.pack' },
    libraryIncludeDirs,
    targets: {},
  }

  for (const target of targets) {
    const started = Date.now()
    console.info(`Compiling core and libraries for ${target.id} (${os.availableParallelism()} CPUs available)`)
    const archives = await buildTarget(target, [sysroot, headers], libraryIncludeDirs)
    manifest.targets[target.id] = {
      pack: writePack(outDir, `target-${target.id}.pack`, archives),
      archives: [...archives.keys()],
    }
    console.info(`  done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.info('Done.')
}

await main()
