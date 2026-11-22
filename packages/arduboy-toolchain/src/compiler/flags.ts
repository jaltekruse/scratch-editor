import type { Target } from '../targets.ts'

/**
 * Command lines for driving `cc1plus`, `avr-as` and `avr-ld` directly. The GCC driver (`avr-gcc`) is not available
 * as WebAssembly, so the flags it would derive for `-mmcu=atmega32u4` are spelled out here.
 */

export const MCU = 'atmega32u4'
const MULTILIB = 'avr5'

export const SYSROOT_INCLUDE_DIRS = ['/sysroot/gcc/include', '/sysroot/gcc/include-fixed', '/sysroot/avr/include']

/** Where library archives, startup code and the linker script live in the virtual filesystem. */
export const LIB_DIR = '/libs'

export interface CompileUnit {
  source: string
  output: string
  /** Name used for diagnostics. */
  displayName?: string
  /** C units must be wrapped with {@link cWrapperSource}. Defaults to C++. */
  language?: 'c' | 'c++'
}

/**
 * Only the C++ front end is available, so a C file is compiled through a wrapper that includes it inside
 * `extern "C"`, together with `-U__cplusplus` (see {@link cc1plusArgs}) so headers take their C code paths.
 * Symbols then get C linkage, as they would from a real C compiler.
 * @param cSource - Path of the C file in the virtual filesystem.
 * @returns Wrapper source text to compile in place of the C file.
 */
export function cWrapperSource(cSource: string): string {
  return `extern "C" {\n#include "${cSource}"\n}\n`
}

/**
 * Arguments for compiling one translation unit to assembly with `cc1plus`.
 * @param target - Hardware target.
 * @param includeDirs - User include directories, searched in order after the source's own directory.
 * @param unit - Source and output paths.
 * @returns The argument list.
 */
export function cc1plusArgs(target: Target, includeDirs: string[], unit: CompileUnit): string[] {
  const base = unit.displayName ?? unit.source.slice(unit.source.lastIndexOf('/') + 1)
  return [
    '-quiet',
    '-imultilib',
    MULTILIB,
    '-D__AVR_ATmega32U4__',
    `-D__AVR_DEVICE_NAME__=${MCU}`,
    ...target.defines,
    // stdbool.h maps bool to the C-only _Bool once __cplusplus is undefined.
    ...(unit.language === 'c' ? ['-U__cplusplus', '-D_Bool=bool'] : []),
    ...SYSROOT_INCLUDE_DIRS.flatMap((dir) => ['-isystem', dir]),
    ...includeDirs.flatMap((dir) => ['-I', dir]),
    unit.source,
    '-mn-flash=1',
    '-mno-skip-bug',
    '-mmcu=avr5',
    '-dumpbase',
    base,
    '-Os',
    '-w',
    '-std=gnu++11',
    '-fpermissive',
    '-fno-exceptions',
    '-fno-threadsafe-statics',
    '-fno-rtti',
    '-fno-enforce-eh-specs',
    '-ffunction-sections',
    '-fdata-sections',
    '-Wno-error=narrowing',
    '-o',
    unit.output,
  ]
}

/**
 * Arguments for assembling compiler output with `avr-as`.
 * @param source - Assembly path.
 * @param output - Object path.
 * @returns The argument list.
 */
export function asArgs(source: string, output: string): string[] {
  return [`-mmcu=${MCU}`, '-o', output, source]
}

/**
 * Arguments for linking a sketch with `avr-ld`.
 * @param objects - Sketch object paths.
 * @param archives - Library and core archive paths.
 * @param output - ELF output path.
 * @returns The argument list.
 */
export function ldArgs(objects: string[], archives: string[], output: string): string[] {
  return [
    '-m',
    MULTILIB,
    // SRAM on the ATmega32U4 starts at 0x100; the avr5 default (0x60) would overlap I/O registers.
    '-Tdata=0x800100',
    '--gc-sections',
    '-o',
    output,
    `${LIB_DIR}/crt${MCU}.o`,
    ...objects,
    `-L${LIB_DIR}`,
    '--start-group',
    ...archives,
    `-l${MCU}`,
    '-lm',
    '-lc',
    '-lgcc',
    '--end-group',
  ]
}

/**
 * Arguments for converting a linked ELF to Intel HEX.
 * @param elf - ELF path.
 * @param output - HEX output path.
 * @returns The argument list.
 */
export function objcopyArgs(elf: string, output: string): string[] {
  return ['-O', 'ihex', '-R', '.eeprom', elf, output]
}
