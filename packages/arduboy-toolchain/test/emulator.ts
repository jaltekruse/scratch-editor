import { AVRSPI, AVRTimer, CPU, avrInstruction, spiConfig, timer0Config } from 'avr8js'
import { parseIntelHex } from '../src/hex.ts'

/**
 * Just enough of an ATmega32U4 Arduboy to run a sketch headlessly and capture what it draws: CPU, timer 0
 * (`millis()`), SPI to the display, and stubs for peripherals the Arduboy core waits on.
 *
 * Register addresses of these peripherals match the ATmega328P that avr8js models; interrupt vectors differ.
 */

const FREQ_HZ = 16_000_000
const SRAM_BYTES = 2560

// ATmega32U4 interrupt vectors, as word addresses (vector number * 2).
const TIMER0_COMPA = 21 * 2
const TIMER0_COMPB = 22 * 2
const TIMER0_OVF = 23 * 2
const SPI_STC = 24 * 2

const PINB = 0x23
const PINE = 0x2c
const PINF = 0x2f
const PORTD = 0x2b
const DC_BIT = 1 << 4 // Display data/command select on PORTD4, for every supported wiring.
const PLLCSR = 0x49
const PLOCK = 1 << 0
const ADCSRA = 0x7a
const ADSC = 1 << 6

export interface DisplayTraffic {
  /** Bytes sent with D/C low. */
  commands: number[]
  /** Bytes sent with D/C high, in order. */
  data: number[]
}

export class ArduboyEmulator {
  readonly cpu: CPU
  readonly display: DisplayTraffic = { commands: [], data: [] }

  constructor(hex: string) {
    const image = parseIntelHex(hex).data
    const program = new Uint16Array(0x8000 / 2)
    new Uint8Array(program.buffer).set(image)
    this.cpu = new CPU(program, SRAM_BYTES)

    new AVRTimer(this.cpu, {
      ...timer0Config,
      compAInterrupt: TIMER0_COMPA,
      compBInterrupt: TIMER0_COMPB,
      ovfInterrupt: TIMER0_OVF,
    })

    const spi = new AVRSPI(this.cpu, { ...spiConfig, spiInterrupt: SPI_STC }, FREQ_HZ)
    spi.onByte = (value) => {
      const isData = (this.cpu.data[PORTD] & DC_BIT) !== 0
      ;(isData ? this.display.data : this.display.commands).push(value)
      this.cpu.addClockEvent(() => spi.completeTransfer(0xff), spi.transferCycles)
    }

    // No buttons pressed: button inputs have pull-ups and read high.
    for (const pin of [PINB, PINE, PINF]) this.cpu.readHooks[pin] = () => 0xff
    // The USB PLL locks immediately.
    this.cpu.readHooks[PLLCSR] = (addr) => this.cpu.data[addr] | PLOCK
    // ADC conversions (used for the random seed) complete immediately.
    this.cpu.writeHooks[ADCSRA] = (value) => {
      this.cpu.data[ADCSRA] = value & ~ADSC
      return true
    }
  }

  /**
   * Run for a span of simulated time.
   * @param seconds - Simulated seconds.
   */
  run(seconds: number): void {
    const end = this.cpu.cycles + seconds * FREQ_HZ
    while (this.cpu.cycles < end) {
      avrInstruction(this.cpu)
      this.cpu.tick()
    }
  }
}

export const WIDTH = 128
export const HEIGHT = 64

/**
 * Decode the most recent full frame: the last 1024 data bytes, in the vertical-byte page layout both the SSD1306 and
 * (as driven by Arduboy2) SH1106 use.
 * @param traffic - Captured display traffic.
 * @returns Rows of pixels, `true` meaning lit.
 */
export function lastFrame(traffic: DisplayTraffic): boolean[][] {
  const bytes = traffic.data.slice(-(WIDTH * HEIGHT) / 8)
  if (bytes.length < (WIDTH * HEIGHT) / 8) throw new Error(`lastFrame: only ${bytes.length} display bytes captured`)
  return Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (bytes[(y >> 3) * WIDTH + x] & (1 << (y & 7))) !== 0),
  )
}

/**
 * Render a frame as text, for readable assertion failures.
 * @param frame - Frame from {@link lastFrame}.
 * @returns One line per pixel row.
 */
export function frameToText(frame: boolean[][]): string {
  return frame.map((row) => row.map((on) => (on ? '#' : '.')).join('')).join('\n')
}
