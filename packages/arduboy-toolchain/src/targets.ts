/**
 * Hardware targets, mirroring the board menu choices of the Arduboy homemade board package
 * (`vendor/Arduboy-homemade-package/board-package-source/boards.txt`).
 */

export interface Target {
  id: string
  /** Human-readable name. */
  name: string
  /** Variant directory name in the board package (`variants/<variant>/pins_arduino.h`). */
  variant: string
  /** Preprocessor definitions, in the order the Arduino IDE would pass them. */
  defines: string[]
  /** Maximum sketch size in bytes with the stock Caterina bootloader. */
  maxFlashBytes: number
  /** Maximum static RAM usage in bytes. */
  maxRamBytes: number
}

const MAX_FLASH_CATERINA = 28672
const MAX_RAM = 2560

function usbDefines(vid: string, pid: string, manufacturer: string, product: string): string[] {
  return [
    `-DUSB_VID=${vid}`,
    `-DUSB_PID=${pid}`,
    `-DUSB_MANUFACTURER="${manufacturer}"`,
    `-DUSB_PRODUCT="${product}"`,
  ]
}

const COMMON = ['-DF_CPU=16000000L', '-DARDUINO=10819', '-DARDUINO_ARCH_AVR']

export const TARGETS: readonly Target[] = Object.freeze([
  {
    id: 'arduboy',
    name: 'Arduboy (official hardware)',
    variant: 'arduboy',
    defines: [
      ...COMMON,
      '-DARDUINO_AVR_ARDUBOY',
      '-DARDUBOY_10',
      '-DCART_CS_SDA',
      ...usbDefines('0x2341', '0x8036', 'Arduboy Inc', 'Arduboy'),
    ],
    maxFlashBytes: MAX_FLASH_CATERINA,
    maxRamBytes: MAX_RAM,
  },
  {
    id: 'promicro-sh1106',
    name: 'Pro Micro + SH1106 SPI (standard wiring)',
    variant: 'arduboy-promicro',
    defines: [
      ...COMMON,
      '-DARDUINO_AVR_PROMICRO',
      '-DARDUBOY_10',
      '-DOLED_SH1106',
      '-DCART_CS_SDA',
      ...usbDefines('0x2341', '0x8036', 'Unknown', 'ABP1106'),
    ],
    maxFlashBytes: MAX_FLASH_CATERINA,
    maxRamBytes: MAX_RAM,
  },
  {
    id: 'promicro-alt-sh1106',
    name: 'Pro Micro + SH1106 SPI (alternate wiring)',
    variant: 'arduboy-promicro-alt',
    defines: [
      ...COMMON,
      '-DARDUINO_AVR_PROMICRO',
      '-DAB_ALTERNATE_WIRING',
      '-DARDUBOY_10',
      '-DOLED_SH1106',
      // The alternate wiring uses pin 2 (SDA) for display reset, so a flash cart must use RX for chip select.
      '-DCART_CS_RX',
      ...usbDefines('0x2341', '0x8036', 'Unknown', 'ABA1106'),
    ],
    maxFlashBytes: MAX_FLASH_CATERINA,
    maxRamBytes: MAX_RAM,
  },
])

/**
 * Look up a target by id.
 * @param id - One of the ids in {@link TARGETS}.
 * @returns The matching target; throws for unknown ids.
 */
export function getTarget(id: string): Target {
  const target = TARGETS.find((t) => t.id === id)
  if (!target)
    throw new Error(`Unknown Arduboy target "${id}". Known targets: ${TARGETS.map((t) => t.id).join(', ')}`)
  return target
}
