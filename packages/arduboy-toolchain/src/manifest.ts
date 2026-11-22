/**
 * Layout of the prepared toolchain assets (see `scripts/prepare-assets.ts`) and the virtual filesystem.
 */

export const MANIFEST_VERSION = 1

export const CORE_DIR = '/arduboy/core'

/**
 * Virtual directory holding a variant's `pins_arduino.h`.
 * @param variant - Variant name.
 * @returns The directory path.
 */
export function variantDir(variant: string): string {
  return `/arduboy/variants/${variant}`
}

/**
 * Virtual include directory for a library.
 * @param name - Library name, e.g. `Arduboy2`.
 * @returns Where the library's sources and headers are placed.
 */
export function libraryIncludeDir(name: string): string {
  return `/arduboy/libraries/${name}`
}

export interface Manifest {
  version: number
  packs: {
    sysroot: string
    libs: string
    headers: string
  }
  /** Include directories for all bundled libraries, in search order. */
  libraryIncludeDirs: string[]
  /** Per-target precompiled archives. */
  targets: Partial<Record<string, { pack: string; archives: string[] }>>
}
