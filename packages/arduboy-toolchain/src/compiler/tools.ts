/**
 * Runs the Emscripten-built AVR toolchain programs (from `@horang-corp/avr-gcc-wasm`) against an in-memory
 * filesystem. Works in browsers, Web Workers and Node.js; the caller supplies how tool code is loaded.
 */

export type ToolName = 'cc1plus' | 'avr-as' | 'avr-ld' | 'avr-objcopy'

export const TOOL_NAMES: readonly ToolName[] = ['cc1plus', 'avr-as', 'avr-ld', 'avr-objcopy']

/** The subset of the Emscripten FS API used here. */
export interface EmscriptenFS {
  mkdir(path: string): void
  writeFile(path: string, data: Uint8Array | string): void
  readFile(path: string): Uint8Array
  analyzePath(path: string): { exists: boolean }
}

interface EmscriptenModule {
  FS: EmscriptenFS
  callMain(args: string[]): number | undefined
}

export type EmscriptenFactory = (options: Record<string, unknown>) => Promise<EmscriptenModule>

export interface LoadedTool {
  factory: EmscriptenFactory
  /** Pre-compiled WebAssembly module, so repeated runs skip compilation. */
  wasm: WebAssembly.Module
}

/** Supplies tool code; implementations should cache, as tools run many times per build. */
export type ToolLoader = (name: ToolName) => Promise<LoadedTool>

export type FileSet = Map<string, Uint8Array | string>

export interface ToolRun {
  status: number
  stderr: string[]
  outputs: Map<string, Uint8Array>
}

/**
 * Get an output file of a successful run.
 * @param run - Result of {@link runTool}.
 * @param path - One of the output paths requested from {@link runTool}.
 * @returns The file contents.
 */
export function outputOf(run: ToolRun, path: string): Uint8Array {
  const data = run.outputs.get(path)
  if (!data) throw new Error(`outputOf: ${path} was not produced (exit status ${run.status})`)
  return data
}

function mkdirp(fs: EmscriptenFS, dir: string): void {
  let current = ''
  for (const part of dir.split('/').filter(Boolean)) {
    current += `/${part}`
    if (!fs.analyzePath(current).exists) fs.mkdir(current)
  }
}

/**
 * Write files into an Emscripten filesystem, creating parent directories.
 * @param fs - Target filesystem.
 * @param files - Files to write, keyed by absolute path.
 */
export function writeFiles(fs: EmscriptenFS, files: FileSet): void {
  for (const [path, data] of files) {
    mkdirp(fs, path.slice(0, path.lastIndexOf('/')))
    fs.writeFile(path, data)
  }
}

/**
 * Run one toolchain program to completion in a fresh instance.
 * @param loader - Loads the tool's code.
 * @param name - Which tool to run.
 * @param args - Command-line arguments (without argv[0]).
 * @param inputs - Files to place in the filesystem before running.
 * @param outputPaths - Files to read back after a successful run.
 * @returns Exit status, captured stderr and the requested outputs.
 */
export async function runTool(
  loader: ToolLoader,
  name: ToolName,
  args: string[],
  inputs: FileSet[],
  outputPaths: string[],
): Promise<ToolRun> {
  const { factory, wasm } = await loader(name)
  const stderr: string[] = []
  const mod = await factory({
    noInitialRun: true,
    thisProgram: name,
    print: (line: string) => stderr.push(line),
    printErr: (line: string) => stderr.push(line),
    // Never let a tool exit the hosting process (Emscripten's Node.js default).
    quit: (_status: number, toThrow: unknown) => {
      throw toThrow
    },
    instantiateWasm: (
      imports: WebAssembly.Imports,
      done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) => {
      void WebAssembly.instantiate(wasm, imports).then((instance) => done(instance, wasm))
      return {}
    },
  })

  for (const files of inputs) writeFiles(mod.FS, files)
  for (const path of outputPaths) mkdirp(mod.FS, path.slice(0, path.lastIndexOf('/')))

  let status: number
  try {
    status = mod.callMain(args) ?? 0
  } catch (error) {
    const exitStatus = (error as { status?: unknown } | null)?.status
    if (typeof exitStatus !== 'number') throw error
    status = exitStatus
  }

  const outputs = new Map<string, Uint8Array>()
  if (status === 0) {
    for (const path of outputPaths) {
      if (!mod.FS.analyzePath(path).exists) {
        throw new Error(`${name} exited successfully but did not produce ${path}\n${stderr.join('\n')}`)
      }
      outputs.set(path, mod.FS.readFile(path))
    }
  }
  return { status, stderr, outputs }
}
