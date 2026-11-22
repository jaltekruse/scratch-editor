import type { ByteTransport } from '../src/upload/avr109.ts'

/**
 * An in-memory model of the Caterina bootloader's AVR109 command handling, for testing the uploader.
 */
export class FakeCaterina implements ByteTransport {
  readonly flash = new Uint8Array(32 * 1024).fill(0xff)
  readonly commands: string[] = []
  exited = false
  /** Corrupt this flash address on write, to exercise verification. */
  corruptAddress: number | undefined

  private input: number[] = []
  private output: number[] = []
  private address = 0

  write(data: Uint8Array): Promise<void> {
    this.input.push(...data)
    this.process()
    return Promise.resolve()
  }

  read(length: number): Promise<Uint8Array> {
    if (this.output.length < length) {
      return Promise.reject(new Error(`FakeCaterina: ${length} bytes requested, ${this.output.length} available`))
    }
    return Promise.resolve(new Uint8Array(this.output.splice(0, length)))
  }

  private process(): void {
    for (;;) {
      if (this.input.length === 0) return
      const cmd = this.input[0]
      const c = String.fromCharCode(cmd)
      const need = { A: 3, B: 4, g: 4 }[c] ?? 1
      if (this.input.length < need) return
      if (c === 'B') {
        const size = (this.input[1] << 8) | this.input[2]
        if (this.input.length < 4 + size) return
        const data = this.input.slice(4, 4 + size)
        this.input.splice(0, 4 + size)
        this.commands.push('B')
        data.forEach((b, i) => {
          this.flash[this.address + i] = this.address + i === this.corruptAddress ? b ^ 0xff : b
        })
        this.address += size
        this.output.push(0x0d)
        continue
      }
      const args = this.input.splice(0, need)
      this.commands.push(c)
      switch (c) {
        case 'S':
          this.output.push(...new TextEncoder().encode('CATERIN'))
          break
        case 's':
          this.output.push(0x87, 0x95, 0x1e)
          break
        case 'b':
          this.output.push(0x59, 0x00, 0x80)
          break
        case 'A':
          this.address = ((args[1] << 8) | args[2]) << 1
          this.output.push(0x0d)
          break
        case 'g': {
          const size = (args[1] << 8) | args[2]
          this.output.push(...this.flash.subarray(this.address, this.address + size))
          this.address += size
          break
        }
        case 'E':
          this.exited = true
          this.output.push(0x0d)
          break
        case 'P':
        case 'L':
          this.output.push(0x0d)
          break
        default:
          this.output.push(0x3f)
      }
    }
  }
}
