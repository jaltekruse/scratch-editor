import { describe, expect, it } from 'vitest'
import { createArchive } from '../src/ar.ts'

/**
 * Build a minimal ELF32 relocatable object.
 * @param symbols - Global symbols to define (in section 1).
 * @returns The object file bytes.
 */
function fakeObject(symbols: string[]): Uint8Array {
  const strtab = `\0${symbols.join('\0')}\0`
  const shstrtab = '\0.symtab\0.strtab\0.shstrtab\0'
  const symtabSize = 16 * (symbols.length + 1)
  const symtabOffset = 52
  const strtabOffset = symtabOffset + symtabSize
  const shstrtabOffset = strtabOffset + strtab.length
  const shoff = shstrtabOffset + shstrtab.length
  const bytes = new Uint8Array(shoff + 40 * 4)
  const dv = new DataView(bytes.buffer)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 1, 1])
  dv.setUint32(32, shoff, true)
  dv.setUint16(46, 40, true)
  dv.setUint16(48, 4, true)
  dv.setUint16(50, 3, true)
  let nameOffset = 1
  symbols.forEach((name, i) => {
    const at = symtabOffset + 16 * (i + 1)
    dv.setUint32(at, nameOffset, true)
    bytes[at + 12] = 0x10 // STB_GLOBAL
    dv.setUint16(at + 14, 1, true)
    nameOffset += name.length + 1
  })
  bytes.set(new TextEncoder().encode(strtab), strtabOffset)
  bytes.set(new TextEncoder().encode(shstrtab), shstrtabOffset)
  const section = (i: number, name: number, type: number, offset: number, size: number, link = 0) => {
    const at = shoff + 40 * i
    dv.setUint32(at, name, true)
    dv.setUint32(at + 4, type, true)
    dv.setUint32(at + 16, offset, true)
    dv.setUint32(at + 20, size, true)
    dv.setUint32(at + 24, link, true)
  }
  section(1, 1, 2, symtabOffset, symtabSize, 2)
  section(2, 9, 3, strtabOffset, strtab.length)
  section(3, 17, 3, shstrtabOffset, shstrtab.length)
  return bytes
}

describe('createArchive', () => {
  it('writes a GNU archive with a symbol index pointing at the defining members', () => {
    const a = fakeObject(['foo', 'bar'])
    const b = fakeObject(['baz'])
    const archive = createArchive([
      { name: 'a.o', data: a },
      { name: 'a_rather_long_member_name.o', data: b },
    ])
    const text = new TextDecoder('latin1').decode(archive)
    expect(text.startsWith('!<arch>\n/               ')).toBe(true)

    const dv = new DataView(archive.buffer)
    const indexStart = 8 + 60
    expect(dv.getUint32(indexStart)).toBe(3)
    const offsets = [0, 1, 2].map((i) => dv.getUint32(indexStart + 4 + 4 * i))
    const names = text
      .slice(indexStart + 16)
      .split('\0')
      .slice(0, 3)
    expect(names).toEqual(['foo', 'bar', 'baz'])

    const headerName = (offset: number) => text.slice(offset, offset + 16).trimEnd()
    expect(headerName(offsets[0])).toBe('a.o/')
    expect(offsets[1]).toBe(offsets[0])
    expect(headerName(offsets[2])).toBe('/0')
    expect(text).toContain('//              ')
    expect(text).toContain('a_rather_long_member_name.o/\n')

    const size = (offset: number) => parseInt(text.slice(offset + 48, offset + 58), 10)
    expect(size(offsets[0])).toBe(a.length)
    expect(archive.slice(offsets[2] + 60, offsets[2] + 60 + b.length)).toEqual(b)
  })
})
