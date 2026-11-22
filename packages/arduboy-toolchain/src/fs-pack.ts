/**
 * A trivial container format for shipping many small files (headers, objects) as one download.
 *
 * Layout: 4-byte little-endian index length, UTF-8 JSON index, then the concatenated file contents.
 * The index maps each path to its byte range within the contents area.
 */

export interface PackEntry {
  path: string
  offset: number
  size: number
}

/**
 * Pack files into a single buffer.
 * @param files - Map of virtual path to file contents.
 * @returns The packed bytes.
 */
export function pack(files: Map<string, Uint8Array>): Uint8Array {
  const entries: PackEntry[] = []
  let offset = 0
  for (const [path, data] of files) {
    entries.push({ path, offset, size: data.length })
    offset += data.length
  }
  const index = new TextEncoder().encode(JSON.stringify(entries))
  const out = new Uint8Array(4 + index.length + offset)
  new DataView(out.buffer).setUint32(0, index.length, true)
  out.set(index, 4)
  const start = 4 + index.length
  let i = 0
  for (const data of files.values()) {
    out.set(data, start + entries[i++].offset)
  }
  return out
}

/**
 * Unpack a buffer produced by {@link pack}.
 * @param bytes - Packed bytes.
 * @returns Map of virtual path to file contents (views into `bytes`).
 */
export function unpack(bytes: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const indexLength = dv.getUint32(0, true)
  const entries = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + indexLength))) as PackEntry[]
  const start = 4 + indexLength
  const files = new Map<string, Uint8Array>()
  for (const { path, offset, size } of entries) {
    files.set(path, bytes.subarray(start + offset, start + offset + size))
  }
  return files
}
