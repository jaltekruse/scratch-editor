/**
 * Intel HEX parsing for AVR flash images.
 */

export interface FlashImage {
  /** Flash contents from address 0 through the highest programmed byte; gaps are 0xFF. */
  data: Uint8Array
  /** Number of data bytes actually present in the HEX file. */
  programmedBytes: number
}

/**
 * Parse Intel HEX text into a contiguous flash image.
 * Supports data (00), end-of-file (01), extended segment (02) and extended linear (04) records.
 * @param hex - Intel HEX text.
 * @returns The flash image.
 */
export function parseIntelHex(hex: string): FlashImage {
  const chunks: { address: number; bytes: Uint8Array }[] = []
  let base = 0
  let end = 0
  let programmedBytes = 0
  const lines = hex.split(/\r?\n/)

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim()
    if (!line) continue
    if (!line.startsWith(':') || line.length < 11 || line.length % 2 === 0) {
      throw new Error(`parseIntelHex: malformed record on line ${lineNo + 1}: ${line}`)
    }
    const bytes = new Uint8Array((line.length - 1) / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(line.substr(1 + i * 2, 2), 16)
    }
    const sum = bytes.reduce((a, b) => (a + b) & 0xff, 0)
    if (sum !== 0) throw new Error(`parseIntelHex: checksum mismatch on line ${lineNo + 1}`)

    const count = bytes[0]
    if (bytes.length !== count + 5) throw new Error(`parseIntelHex: length mismatch on line ${lineNo + 1}`)
    const address = (bytes[1] << 8) | bytes[2]
    const type = bytes[3]
    const payload = bytes.subarray(4, 4 + count)

    switch (type) {
      case 0x00: {
        const at = base + address
        chunks.push({ address: at, bytes: payload })
        end = Math.max(end, at + count)
        programmedBytes += count
        break
      }
      case 0x01:
        lineNo = lines.length
        break
      case 0x02:
        base = ((payload[0] << 8) | payload[1]) << 4
        break
      case 0x04:
        base = ((payload[0] << 8) | payload[1]) << 16
        break
      default:
        // Start address records (03, 05) carry no flash data.
        break
    }
  }

  const data = new Uint8Array(end).fill(0xff)
  for (const { address, bytes } of chunks) data.set(bytes, address)
  return { data, programmedBytes }
}
