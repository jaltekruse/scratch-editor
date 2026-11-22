import { describe, expect, it } from 'vitest'
import { parseIntelHex } from '../src/hex.ts'

describe('parseIntelHex', () => {
  it('builds a contiguous image with gaps filled with 0xFF', () => {
    const hex = [':020000000102FB', ':02000400AABB95', ':00000001FF', ''].join('\r\n')
    const image = parseIntelHex(hex)
    expect(Array.from(image.data)).toEqual([0x01, 0x02, 0xff, 0xff, 0xaa, 0xbb])
    expect(image.programmedBytes).toBe(4)
  })

  it('applies extended linear address records', () => {
    const image = parseIntelHex([':020000040000FA', ':0100030042BA', ':00000001FF'].join('\n'))
    expect(Array.from(image.data)).toEqual([0xff, 0xff, 0xff, 0x42])
  })

  it('rejects bad checksums', () => {
    expect(() => parseIntelHex(':020000000102FC')).toThrow(/checksum/)
  })

  it('rejects malformed records', () => {
    expect(() => parseIntelHex('020000000102FB')).toThrow(/malformed/)
  })
})
