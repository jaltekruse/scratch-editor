/**
 * AVR109 ("butterfly") bootloader protocol, as spoken by the Caterina bootloader on Arduino Leonardo / Pro Micro
 * boards and by the Cathy3K bootloader on the Arduboy FX.
 */

/** A bidirectional byte stream to the bootloader. */
export interface ByteTransport {
  write(data: Uint8Array): Promise<void>
  /**
   * Read exactly `length` bytes.
   * @param length - Number of bytes to read.
   * @param timeoutMs - Reject if the bytes don't arrive within this time.
   */
  read(length: number, timeoutMs: number): Promise<Uint8Array>
}

export interface ProgramProgress {
  phase: 'write' | 'verify'
  /** Bytes processed so far in this phase. */
  done: number
  total: number
}

export interface ProgramOptions {
  onProgress?: (progress: ProgramProgress) => void
  /** Read flash back and compare after writing. Defaults to true. */
  verify?: boolean
}

const CR = 0x0d
const RESPONSE_TIMEOUT_MS = 1000
/** ATmega32U4 device signature, as returned by the `s` command (most significant byte last). */
const ATMEGA32U4_SIGNATURE = [0x87, 0x95, 0x1e]
/** The ATmega32U4 flash page size; writes are padded to whole pages. */
export const PAGE_SIZE = 128

const encoder = new TextEncoder()
const hex = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')

export class Avr109 {
  private readonly transport: ByteTransport

  constructor(transport: ByteTransport) {
    this.transport = transport
  }

  private async command(bytes: number[] | string, responseLength: number): Promise<Uint8Array> {
    await this.transport.write(typeof bytes === 'string' ? encoder.encode(bytes) : new Uint8Array(bytes))
    return this.transport.read(responseLength, RESPONSE_TIMEOUT_MS)
  }

  private async expectCR(bytes: number[] | string, what: string): Promise<void> {
    const response = await this.command(bytes, 1)
    if (response[0] !== CR) {
      throw new Error(`AVR109 ${what}: expected carriage return, got ${hex(response)}`)
    }
  }

  /** @returns The bootloader's 7-character identifier, e.g. `CATERIN`. */
  async softwareIdentifier(): Promise<string> {
    return new TextDecoder().decode(await this.command('S', 7))
  }

  /** Check that the bootloader runs on an ATmega32U4. */
  async checkSignature(): Promise<void> {
    const signature = await this.command('s', 3)
    if (ATMEGA32U4_SIGNATURE.some((b, i) => signature[i] !== b)) {
      throw new Error(
        `AVR109: device signature ${hex(signature)} is not an ATmega32U4 (${hex(ATMEGA32U4_SIGNATURE)})`,
      )
    }
  }

  /** @returns The maximum block size for block reads and writes. */
  async blockSize(): Promise<number> {
    const response = await this.command('b', 3)
    if (response[0] !== 0x59 /* Y */) throw new Error(`AVR109: bootloader lacks block mode (${hex(response)})`)
    return (response[1] << 8) | response[2]
  }

  async enterProgrammingMode(): Promise<void> {
    await this.expectCR('P', 'enter programming mode')
  }

  async leaveProgrammingMode(): Promise<void> {
    await this.expectCR('L', 'leave programming mode')
  }

  /** Leave the bootloader and start the application. */
  async exit(): Promise<void> {
    await this.expectCR('E', 'exit')
  }

  /**
   * Set the flash address for the next block operation.
   * @param byteAddress - Byte address; must be even.
   */
  async setAddress(byteAddress: number): Promise<void> {
    const word = byteAddress >> 1
    await this.expectCR([0x41 /* A */, (word >> 8) & 0xff, word & 0xff], 'set address')
  }

  /**
   * Write a block of flash at the current address. The bootloader erases each page before writing it.
   * @param data - Block contents; at most the block size.
   */
  async writeFlashBlock(data: Uint8Array): Promise<void> {
    await this.transport.write(
      new Uint8Array([0x42 /* B */, (data.length >> 8) & 0xff, data.length & 0xff, 0x46 /* F */]),
    )
    await this.transport.write(data)
    const response = await this.transport.read(1, RESPONSE_TIMEOUT_MS)
    if (response[0] !== CR) throw new Error(`AVR109 write block: expected carriage return, got ${hex(response)}`)
  }

  /**
   * Read a block of flash at the current address.
   * @param length - Number of bytes; at most the block size.
   * @returns The flash contents.
   */
  async readFlashBlock(length: number): Promise<Uint8Array> {
    return this.command([0x67 /* g */, (length >> 8) & 0xff, length & 0xff, 0x46 /* F */], length)
  }

  /**
   * Program and optionally verify a flash image starting at address 0, then leave programming mode.
   * Does not exit the bootloader; call {@link exit} to start the new program.
   * @param image - Flash contents from address 0.
   * @param options - Progress reporting and verification.
   */
  async program(image: Uint8Array, options: ProgramOptions = {}): Promise<void> {
    const { onProgress, verify = true } = options
    const padded = new Uint8Array(Math.ceil(image.length / PAGE_SIZE) * PAGE_SIZE).fill(0xff)
    padded.set(image)

    await this.checkSignature()
    const blockSize = Math.min(await this.blockSize(), PAGE_SIZE)
    await this.enterProgrammingMode()

    for (let offset = 0; offset < padded.length; offset += blockSize) {
      await this.setAddress(offset)
      await this.writeFlashBlock(padded.subarray(offset, offset + blockSize))
      onProgress?.({ phase: 'write', done: offset + blockSize, total: padded.length })
    }

    if (verify) {
      for (let offset = 0; offset < padded.length; offset += blockSize) {
        await this.setAddress(offset)
        const actual = await this.readFlashBlock(blockSize)
        for (let i = 0; i < blockSize; i++) {
          if (actual[i] !== padded[offset + i]) {
            throw new Error(
              `AVR109 verify: flash differs at 0x${(offset + i).toString(16)}: ` +
                `expected 0x${padded[offset + i].toString(16)}, read 0x${actual[i].toString(16)}`,
            )
          }
        }
        onProgress?.({ phase: 'verify', done: offset + blockSize, total: padded.length })
      }
    }

    await this.leaveProgrammingMode()
  }
}
