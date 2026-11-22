import { definedGlobalSymbols } from './elf.ts'

/**
 * Writer for GNU-format static archives (`.a`), including the symbol index that `ld` requires.
 * The WebAssembly toolchain ships no `ar`/`ranlib`, so archives are assembled here.
 */

export interface ArchiveMember {
  name: string
  data: Uint8Array
}

const HEADER_SIZE = 60
const encoder = new TextEncoder()

function field(value: string, width: number): string {
  if (value.length > width) throw new Error(`ar: field "${value}" exceeds width ${width}`)
  return value.padEnd(width, ' ')
}

function header(name: string, size: number): Uint8Array {
  const text =
    field(name, 16) +
    field('0', 12) +
    field('0', 6) +
    field('0', 6) +
    field('644', 8) +
    field(String(size), 10) +
    '`\n'
  return encoder.encode(text)
}

function padded(size: number): number {
  return size + (size & 1)
}

/**
 * Build a static archive from object files.
 * @param members - Object files to include; names must be unique.
 * @returns The archive bytes.
 */
export function createArchive(members: ArchiveMember[]): Uint8Array {
  // Long-name table for names that don't fit the 15-character header field.
  let longNames = ''
  const headerNames = members.map(({ name }) => {
    if (name.length <= 15) return `${name}/`
    const ref = `/${longNames.length}`
    longNames += `${name}/\n`
    return ref
  })
  const longNamesBytes = encoder.encode(longNames)

  const symbols = members.map((m) => definedGlobalSymbols(m.data))
  const symbolCount = symbols.reduce((n, list) => n + list.length, 0)
  const symbolNames = encoder.encode(
    symbols
      .flat()
      .map((s) => `${s}\0`)
      .join(''),
  )
  const indexSize = 4 + 4 * symbolCount + symbolNames.length

  // Member offsets are needed before the index can be written.
  let offset = 8 + HEADER_SIZE + padded(indexSize)
  if (longNamesBytes.length) offset += HEADER_SIZE + padded(longNamesBytes.length)
  const memberOffsets = members.map((m) => {
    const at = offset
    offset += HEADER_SIZE + padded(m.data.length)
    return at
  })

  const out = new Uint8Array(offset)
  const dv = new DataView(out.buffer)
  let pos = 0
  const write = (bytes: Uint8Array) => {
    out.set(bytes, pos)
    pos += bytes.length
  }
  const pad = () => {
    if (pos & 1) out[pos++] = 0x0a
  }

  write(encoder.encode('!<arch>\n'))

  write(header('/', indexSize))
  dv.setUint32(pos, symbolCount)
  pos += 4
  symbols.forEach((list, i) => {
    for (const _symbol of list) {
      dv.setUint32(pos, memberOffsets[i])
      pos += 4
    }
  })
  write(symbolNames)
  pad()

  if (longNamesBytes.length) {
    write(header('//', longNamesBytes.length))
    write(longNamesBytes)
    pad()
  }

  members.forEach((m, i) => {
    write(header(headerNames[i], m.data.length))
    write(m.data)
    pad()
  })

  return out
}
