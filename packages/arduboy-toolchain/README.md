# @scratch/arduboy-toolchain

Compile Arduboy sketches to firmware and upload them to Arduboy-compatible hardware, entirely in the browser — no
server and no locally installed tools.

- **Compiler:** GCC 7.3 for AVR and GNU binutils built for WebAssembly (from
  [`@horang-corp/avr-gcc-wasm`](https://www.npmjs.com/package/@horang-corp/avr-gcc-wasm)), driven directly
  (`cc1plus` → `avr-as` → `avr-ld` → `avr-objcopy`) in a Web Worker. The Arduboy core and libraries are precompiled
  per hardware target at build time, so a typical sketch builds in well under a second once the toolchain is cached.
- **Uploader:** the AVR109 protocol spoken by the Caterina and Cathy3K bootloaders, over the
  [Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API) (Chrome, Edge, Opera), including the
  Arduino "1200 bps touch" that reboots a running sketch into its bootloader.

## Hardware targets

| Target id             | Hardware                                               |
| --------------------- | ------------------------------------------------------ |
| `arduboy`             | Official Arduboy (and Arduboy FX)                      |
| `promicro-sh1106`     | Pro Micro 5V with an SH1106 SPI OLED, standard wiring  |
| `promicro-alt-sh1106` | Pro Micro 5V with an SH1106 SPI OLED, alternate wiring |

Targets mirror the board menu of the [Arduboy homemade package](../../vendor/Arduboy-homemade-package), which also
documents the wiring. Adding another target is a matter of adding an entry to `src/targets.ts` with the matching
defines from `boards.txt`.

Bundled libraries: Arduboy2, ArduboyTones, ArduboyPlaytune, Arduboy-TinyFont, ArdBitmap, ArduboyFX, ATMlib, ArdVoice,
EEPROM, FixedPointsArduino, SPI, AceRoutine and AceCommon.

## Usage

Serve `dist/toolchain/` from the same origin as your page (it contains the worker, so it can't be cross-origin), then:

```js
import { ArduboyCompiler, SERIAL_PORT_FILTERS, uploadFirmware } from '@scratch/arduboy-toolchain'

const compiler = new ArduboyCompiler({ assetsBase: '/static/arduboy-toolchain/' })
compiler.warmUp() // optional: start downloading the toolchain early

const result = await compiler.compile({
  target: 'arduboy',
  files: [{ path: 'game.ino', contents: sketchSource }],
})
if (!result.ok) throw new Error(result.diagnostics)

// In a click handler: Web Serial needs a user gesture to choose a device.
const port = await navigator.serial.requestPort({ filters: SERIAL_PORT_FILTERS })
await uploadFirmware({
  port,
  hex: result.hex,
  onStatus: (status) => console.log(status),
  // After the reset the bootloader is a new USB device. If the page has no permission for it yet, this is called
  // so you can show a button that calls navigator.serial.requestPort() again (within ~8 seconds).
  requestBootloaderPort: () => askUserToPickBootloaderPort(),
})
```

Sketches follow Arduino IDE conventions: all root-level `.ino` files are concatenated into one translation unit (the
primary file first), and `.c`/`.cpp` files in the sketch root and under `src/` are compiled separately. Other files
are reachable through `#include` only. Unlike the Arduino IDE, function prototypes are not generated, so functions
must be declared before use.

If a sketch doesn't respond to the 1200 bps reset (for example because it disables USB), put the board into its
bootloader manually (reset button / reset pin) and choose the bootloader port directly.

## Development

```sh
npm run build    # library, worker and toolchain assets (dist/)
npm test         # lint + unit tests; compiles real sketches and runs them in an ATmega32U4 emulator
npm run dev      # demo page at http://localhost:5173/ (run `npm run build` first)
```

`scripts/prepare-assets.ts` builds `dist/toolchain/`. It needs the submodules under `vendor/`
(`git submodule update --init`).

The tests run compiled firmware in [avr8js](https://github.com/wokwi/avr8js) and decode what the sketch sends to
the display, so a passing test means the firmware actually draws on screen, for every target.

## Licensing

The toolchain assets in `dist/toolchain/` include third-party binaries and sources under their own licenses (GPL
for the compiler and binutils, LGPL for the Arduino core, MIT/BSD for most libraries); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
