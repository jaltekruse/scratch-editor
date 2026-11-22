import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createNodeToolchain } from '../scripts/node-tools.ts'
import { compileSketch, planUnits, type SketchFile, type Toolchain } from '../src/compiler/build.ts'
import type { Manifest } from '../src/manifest.ts'
import { TARGETS } from '../src/targets.ts'
import { ArduboyEmulator, frameToText, lastFrame } from './emulator.ts'

const packageDir = path.resolve(import.meta.dirname, '..')
const hello: SketchFile[] = [
  {
    path: 'hello.ino',
    contents: fs.readFileSync(path.join(import.meta.dirname, 'fixtures/hello/hello.ino'), 'utf8'),
  },
]

/**
 * Find prepared toolchain assets.
 * @returns A previous build's assets when they cover every target; otherwise a freshly prepared copy.
 */
function assetsDir(): string {
  const built = path.join(packageDir, 'dist/toolchain')
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8')) as Manifest
    if (TARGETS.every((t) => manifest.targets[t.id])) return built
  } catch {
    // Not built yet.
  }
  const fresh = path.join(packageDir, 'test-results/toolchain')
  execFileSync(
    process.execPath,
    ['--import', 'tsx', path.join(packageDir, 'scripts/prepare-assets.ts'), '--out', fresh],
    {
      stdio: 'inherit',
    },
  )
  return fresh
}

let toolchain: Toolchain
beforeAll(() => {
  toolchain = createNodeToolchain(assetsDir())
}, 300_000)

describe('planUnits', () => {
  it('follows Arduino sketch conventions', () => {
    const { units, generated } = planUnits(
      [
        { path: 'b.ino', contents: '' },
        { path: 'main.ino', contents: '' },
        { path: 'util.cpp', contents: '' },
        { path: 'legacy.c', contents: '' },
        { path: 'src/lib/thing.cpp', contents: '' },
        { path: 'Sprite1/Sprite1.cpp', contents: '' },
      ],
      'main.ino',
    )
    expect(units.map((u) => u.displayName)).toEqual(['main.ino', 'util.cpp', 'legacy.c', 'src/lib/thing.cpp'])
    const ino = generated.get(units[0].source) as string
    expect(ino.indexOf('/sketch/main.ino')).toBeLessThan(ino.indexOf('/sketch/b.ino'))
    expect(units[2].language).toBe('c')
  })

  it('requires a primary .ino file', () => {
    expect(() => planUnits([{ path: 'x.cpp', contents: '' }])).toThrow(/no primary .ino/)
  })
})

describe('compileSketch', () => {
  it.each(TARGETS.map((t) => t.id))('builds firmware for %s that draws on the display', async (target) => {
    const result = await compileSketch(toolchain, { target, files: hello })
    expect(result.diagnostics).toBe('')
    expect(result.ok).toBe(true)
    expect(result.flashBytes).toBeGreaterThan(4000)
    expect(result.flashBytes).toBeLessThan(result.maxFlashBytes)
    expect(result.ramBytes).toBeGreaterThan(1024) // Arduboy2's screen buffer alone is 1 KiB.

    if (!result.hex) throw new Error('compileSketch reported success without firmware')
    const emulator = new ArduboyEmulator(result.hex)
    emulator.run(3)
    const frame = lastFrame(emulator.display)
    const litRows = frame.flatMap((row, y) => (row.some(Boolean) ? [y] : []))
    // "Hello, Arduboy!" printed at y=28 in the 8-pixel-high default font.
    expect(litRows.length, frameToText(frame)).toBeGreaterThan(5)
    expect(Math.min(...litRows), frameToText(frame)).toBeGreaterThanOrEqual(28)
    expect(Math.max(...litRows), frameToText(frame)).toBeLessThan(36)
    expect(frameToText(frame)).toMatchSnapshot()
  })

  it('compiles multi-file sketches with C and C++ sources', async () => {
    const result = await compileSketch(toolchain, {
      target: 'arduboy',
      files: [
        {
          path: 'multi.ino',
          contents: [
            '#include "shared.h"',
            '#include "Extra/extra.h"',
            'void setup() { counter = add(extraValue(), cValue()); }',
            'void loop() {}',
          ].join('\n'),
        },
        { path: 'shared.h', contents: 'extern int counter;\nint add(int a, int b);\nextern "C" int cValue(void);\n' },
        {
          path: 'shared.cpp',
          contents: '#include "shared.h"\nint counter;\nint add(int a, int b) { return a + b; }\n',
        },
        {
          path: 'src/value.c',
          contents: '#include <stdbool.h>\nstatic bool on = true;\nint cValue(void) { return on ? 2 : 0; }\n',
        },
        // Not compiled on its own (outside the root and src/), only via #include.
        { path: 'Extra/extra.h', contents: 'static int extraValue() { return 1; }\n' },
        { path: 'Extra/broken.cpp', contents: 'this is not C++' },
      ],
    })
    expect(result.diagnostics).toBe('')
    expect(result.ok).toBe(true)
  })

  it('reports compile errors with file and line', async () => {
    const result = await compileSketch(toolchain, {
      target: 'arduboy',
      files: [{ path: 'bad.ino', contents: 'void setup() {}\nvoid loop() { undefinedThing(); }\n' }],
    })
    expect(result.ok).toBe(false)
    expect(result.hex).toBeUndefined()
    expect(result.diagnostics).toMatch(/bad\.ino:2:\d+: error: 'undefinedThing' was not declared/)
  })

  it('reports link errors', async () => {
    const result = await compileSketch(toolchain, {
      target: 'arduboy',
      files: [{ path: 'link.ino', contents: 'void missing();\nvoid setup() { missing(); }\nvoid loop() {}\n' }],
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toMatch(/undefined reference to `missing\(\)'/)
  })

  it('rejects sketches that do not fit in flash', async () => {
    const result = await compileSketch(toolchain, {
      target: 'arduboy',
      files: [
        {
          path: 'big.ino',
          contents: [
            'const uint8_t big[27000] PROGMEM = {1};',
            'volatile uint8_t sink;',
            'void setup() { sink = pgm_read_byte(&big[sink]); }',
            'void loop() {}',
          ].join('\n'),
        },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.flashBytes).toBeGreaterThan(28672)
    expect(result.diagnostics).toMatch(/maximum for Arduboy \(official hardware\) is 28672/)
  })
})
