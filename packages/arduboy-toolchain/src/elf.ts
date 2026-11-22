/**
 * Minimal reader for 32-bit little-endian ELF files, as produced by the AVR toolchain.
 * Only the pieces needed to build archive symbol tables and report memory usage are implemented.
 */

const SHT_SYMTAB = 2
const SHN_UNDEF = 0
const STB_GLOBAL = 1
const STB_WEAK = 2
const SHF_ALLOC = 0x2

export interface ElfSection {
  name: string
  type: number
  flags: number
  addr: number
  offset: number
  size: number
  link: number
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function readCString(bytes: Uint8Array, offset: number): string {
  let end = offset
  while (end < bytes.length && bytes[end] !== 0) end++
  return new TextDecoder().decode(bytes.subarray(offset, end))
}

/**
 * Parse the section header table of an ELF32 file.
 * @param bytes - The ELF file contents.
 * @returns The sections, in file order, with resolved names.
 */
export function readSections(bytes: Uint8Array): ElfSection[] {
  if (bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    throw new Error('readSections: not an ELF file')
  }
  if (bytes[4] !== 1 || bytes[5] !== 1) {
    throw new Error(`readSections: expected ELF32 little-endian, got class=${bytes[4]} data=${bytes[5]}`)
  }
  const dv = view(bytes)
  const shoff = dv.getUint32(32, true)
  const shentsize = dv.getUint16(46, true)
  const shnum = dv.getUint16(48, true)
  const shstrndx = dv.getUint16(50, true)

  const raw = []
  for (let i = 0; i < shnum; i++) {
    const base = shoff + i * shentsize
    raw.push({
      nameOffset: dv.getUint32(base, true),
      type: dv.getUint32(base + 4, true),
      flags: dv.getUint32(base + 8, true),
      addr: dv.getUint32(base + 12, true),
      offset: dv.getUint32(base + 16, true),
      size: dv.getUint32(base + 20, true),
      link: dv.getUint32(base + 24, true),
    })
  }
  const strtab = raw.at(shstrndx)
  if (!strtab)
    throw new Error(`readSections: section name table index ${shstrndx} is out of range (${shnum} sections)`)
  return raw.map(({ nameOffset, ...rest }) => ({
    ...rest,
    name: readCString(bytes, strtab.offset + nameOffset),
  }))
}

/**
 * List the global and weak symbols an object file defines (common symbols included).
 * @param bytes - The ELF relocatable object contents.
 * @returns The defined external symbol names.
 */
export function definedGlobalSymbols(bytes: Uint8Array): string[] {
  const sections = readSections(bytes)
  const symtab = sections.find((s) => s.type === SHT_SYMTAB)
  if (!symtab) return []
  const strtab = sections[symtab.link]
  const dv = view(bytes)
  const names: string[] = []
  for (let off = symtab.offset; off + 16 <= symtab.offset + symtab.size; off += 16) {
    const nameOffset = dv.getUint32(off, true)
    const info = bytes[off + 12]
    const shndx = dv.getUint16(off + 14, true)
    const bind = info >> 4
    if ((bind === STB_GLOBAL || bind === STB_WEAK) && shndx !== SHN_UNDEF) {
      names.push(readCString(bytes, strtab.offset + nameOffset))
    }
  }
  return names
}

export interface MemoryUsage {
  /** Bytes of program flash used (.text + .data initializers). */
  flash: number
  /** Bytes of static RAM used (.data + .bss + .noinit). */
  ram: number
}

/**
 * Compute flash and static RAM usage of a linked AVR ELF, matching what `avr-size -A` reports.
 * @param bytes - The linked ELF contents.
 * @returns Flash and RAM usage in bytes.
 */
export function memoryUsage(bytes: Uint8Array): MemoryUsage {
  let flash = 0
  let ram = 0
  for (const section of readSections(bytes)) {
    if (!(section.flags & SHF_ALLOC)) continue
    if (section.name === '.text' || section.name === '.data') flash += section.size
    if (section.name === '.data' || section.name === '.bss' || section.name === '.noinit') ram += section.size
  }
  return { flash, ram }
}
