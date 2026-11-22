import { describe, expect, it } from 'vitest'
import { Avr109, type ProgramProgress } from '../src/upload/avr109.ts'
import { FakeCaterina } from './fake-caterina.ts'

const image = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff)

describe('Avr109', () => {
  it('programs, verifies and exits', async () => {
    const device = new FakeCaterina()
    const bootloader = new Avr109(device)
    const progress: ProgramProgress[] = []
    expect(await bootloader.softwareIdentifier()).toBe('CATERIN')
    await bootloader.program(image, { onProgress: (p) => progress.push(p) })
    await bootloader.exit()

    expect(Array.from(device.flash.subarray(0, 300))).toEqual(Array.from(image))
    // Padded to whole 128-byte pages.
    expect(Array.from(device.flash.subarray(300, 384))).toEqual(new Array(84).fill(0xff))
    expect(device.commands.filter((c) => c === 'B')).toHaveLength(3)
    expect(device.commands.at(0)).toBe('S')
    expect(device.commands.slice(-2)).toEqual(['L', 'E'])
    expect(device.exited).toBe(true)
    expect(progress.at(-1)).toEqual({ phase: 'verify', done: 384, total: 384 })
  })

  it('reports verification failures with the address', async () => {
    const device = new FakeCaterina()
    device.corruptAddress = 130
    await expect(new Avr109(device).program(image)).rejects.toThrow(/differs at 0x82/)
  })

  it('rejects devices that are not ATmega32U4', async () => {
    const device = new FakeCaterina()
    const write = device.write.bind(device)
    device.write = async (data) => {
      await write(data)
      if (data[0] === 0x73 /* s */) {
        await device.read(3)
        // An ATmega328P signature, reported most significant byte last.
        ;(device as unknown as { output: number[] }).output.push(0x0f, 0x95, 0x1e)
      }
    }
    await expect(new Avr109(device).program(image)).rejects.toThrow(/not an ATmega32U4/)
  })
})
