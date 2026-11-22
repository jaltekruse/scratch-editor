/// <reference types="w3c-web-serial" />
import { parseIntelHex } from '../hex.ts'
import { Avr109, type ByteTransport, type ProgramProgress } from './avr109.ts'

/**
 * Uploading firmware to ATmega32U4 boards (Arduboy, Leonardo, Micro, Pro Micro) with the Web Serial API.
 */

/** USB vendor IDs used by Arduboy-compatible boards and their bootloaders. */
const VENDOR_IDS = [0x2341 /* Arduino */, 0x2a03 /* Arduino.org */, 0x1b4f /* SparkFun */]

/** USB product IDs of Caterina / Cathy3K bootloaders (as opposed to running sketches). */
const BOOTLOADER_PRODUCT_IDS = new Set([0x0036, 0x0037, 0x9203, 0x9205, 0x9207])

/** How long to wait for the bootloader to appear after requesting a reset. */
const BOOTLOADER_WAIT_MS = 3000
const POLL_MS = 100

export const SERIAL_PORT_FILTERS: SerialPortFilter[] = VENDOR_IDS.map((usbVendorId) => ({ usbVendorId }))

/**
 * Whether a port belongs to a board that is currently running its bootloader.
 * @param port - The serial port.
 * @returns True for bootloader ports.
 */
export function isBootloaderPort(port: SerialPort): boolean {
  const { usbVendorId, usbProductId } = port.getInfo()
  return (
    usbVendorId !== undefined &&
    VENDOR_IDS.includes(usbVendorId) &&
    usbProductId !== undefined &&
    BOOTLOADER_PRODUCT_IDS.has(usbProductId)
  )
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A {@link ByteTransport} over an open Web Serial port. */
export class SerialTransport implements ByteTransport {
  private readonly port: SerialPort
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  private buffer = new Uint8Array(0)
  private pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined

  constructor(port: SerialPort) {
    this.port = port
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.port.writable) throw new Error('SerialTransport.write: port is not open')
    const writer = this.port.writable.getWriter()
    try {
      await writer.write(data)
    } finally {
      writer.releaseLock()
    }
  }

  async read(length: number, timeoutMs: number): Promise<Uint8Array> {
    if (!this.port.readable) throw new Error('SerialTransport.read: port is not open')
    this.reader ??= this.port.readable.getReader()
    const deadline = Date.now() + timeoutMs
    while (this.buffer.length < length) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error(`Timed out waiting for the bootloader (got ${this.buffer.length} of ${length} bytes)`)
      }
      // An unfinished read is kept for the next call rather than cancelled, so no bytes are lost.
      this.pending ??= this.reader.read()
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        this.pending,
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), remaining)
        }),
      ])
      clearTimeout(timer)
      if (result === 'timeout') continue
      this.pending = undefined
      if (result.done) throw new Error('SerialTransport.read: port closed')
      const merged = new Uint8Array(this.buffer.length + result.value.length)
      merged.set(this.buffer)
      merged.set(result.value, this.buffer.length)
      this.buffer = merged
    }
    const out = this.buffer.slice(0, length)
    this.buffer = this.buffer.slice(length)
    return out
  }

  /** Release the reader and close the port. */
  async close(): Promise<void> {
    if (this.reader) {
      await this.reader.cancel().catch(() => undefined)
      this.reader.releaseLock()
    }
    await this.port.close()
  }
}

/**
 * Ask a running sketch to reboot into its bootloader: opening the port at 1200 baud and closing it (dropping DTR)
 * is the Arduino "1200 bps touch" signal handled by the USB core.
 * @param port - The sketch's serial port.
 */
export async function requestBootloaderReset(port: SerialPort): Promise<void> {
  await port.open({ baudRate: 1200 })
  await port.setSignals({ dataTerminalReady: false }).catch(() => undefined)
  await port.close()
}

/**
 * Wait for a bootloader port this page already has permission for to appear.
 * @param timeoutMs - How long to wait.
 * @returns The port, or undefined if none appeared.
 */
export async function waitForBootloaderPort(timeoutMs = BOOTLOADER_WAIT_MS): Promise<SerialPort | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const port = (await navigator.serial.getPorts()).find(isBootloaderPort)
    if (port) return port
    await sleep(POLL_MS)
  }
  return undefined
}

export type UploadStatus =
  | { step: 'resetting' }
  | { step: 'waiting-for-bootloader' }
  | { step: 'connecting' }
  | ({ step: 'programming' } & ProgramProgress)
  | { step: 'done' }

export interface UploadOptions {
  /** The port the user selected: either a running sketch or a board already in its bootloader. */
  port: SerialPort
  /** Intel HEX firmware. */
  hex: string
  onStatus?: (status: UploadStatus) => void
  /**
   * Called when the bootloader appears as a port the page has no permission for yet. Must resolve with the port
   * chosen via `navigator.serial.requestPort({ filters: SERIAL_PORT_FILTERS })`, which needs a user gesture, so
   * typically shows a button. The bootloader stays active for about 8 seconds.
   */
  requestBootloaderPort: () => Promise<SerialPort>
}

/**
 * Upload firmware to an Arduboy-compatible board.
 * @param options - The port, firmware and callbacks.
 */
export async function uploadFirmware(options: UploadOptions): Promise<void> {
  const { onStatus } = options
  const image = parseIntelHex(options.hex).data

  let port = options.port
  if (!isBootloaderPort(port)) {
    onStatus?.({ step: 'resetting' })
    await requestBootloaderReset(port)
    onStatus?.({ step: 'waiting-for-bootloader' })
    port = (await waitForBootloaderPort()) ?? (await options.requestBootloaderPort())
  }

  onStatus?.({ step: 'connecting' })
  // The baud rate is irrelevant for USB CDC; 57600 matches avrdude's.
  await port.open({ baudRate: 57600 })
  const transport = new SerialTransport(port)
  try {
    const bootloader = new Avr109(transport)
    await bootloader.program(image, { onProgress: (progress) => onStatus?.({ step: 'programming', ...progress }) })
    await bootloader.exit()
  } finally {
    await transport.close().catch(() => undefined)
  }
  onStatus?.({ step: 'done' })
}
