import { createHash } from 'node:crypto'

export const VIEWER_DATA_FILES = ['mock/crossing_mock_world.json', 'mock/demo_session.json']

// Godot 4's unencrypted PCK v2 directory and embedded footer:
// https://github.com/godotengine/godot/blob/4.3/core/io/file_access_pack.cpp
// Read the actual executable, not the export log or a loose source directory.
export function readViewerPackage(bytes) {
  const require = (condition, message) => {
    if (!condition) throw new Error(`Invalid Windows viewer package: ${message}`)
  }
  const range = (offset, length, end = bytes.length) => {
    require(Number.isSafeInteger(offset) && Number.isSafeInteger(length) &&
      offset >= 0 && length >= 0 && offset <= end - length, 'truncated or out-of-range data')
  }
  const u32 = (offset) => { range(offset, 4); return bytes.readUInt32LE(offset) }
  const u64 = (offset) => {
    range(offset, 8)
    const value = Number(bytes.readBigUInt64LE(offset))
    require(Number.isSafeInteger(value), 'offset exceeds safe integer range')
    return value
  }
  range(0, 64)
  require(bytes.toString('ascii', 0, 2) === 'MZ', 'missing DOS executable signature')
  const pe = u32(60)
  range(pe, 26)
  require(bytes.toString('ascii', pe, pe + 4) === 'PE\0\0', 'missing PE executable signature')
  require(bytes.readUInt16LE(pe + 4) === 0x8664 && bytes.readUInt16LE(pe + 24) === 0x20b,
    'expected a Windows x86-64 executable')
  const magic = 0x43504447 // GDPC
  require(u32(bytes.length - 4) === magic, 'missing embedded PCK footer')
  const end = bytes.length - 12
  const start = end - u64(end)
  range(start, 100, end)
  require(u32(start) === magic, 'missing embedded PCK header')
  require(u32(start + 4) === 2 && u32(start + 8) === 4, 'unsupported PCK or engine version')
  const flags = u32(start + 20)
  require((flags & ~2) === 0, 'encrypted or unsupported PCK flags')
  const base = u64(start + 24) + ((flags & 2) ? start : 0)
  range(base, 0, end)
  const count = u32(start + 96)
  require(count > 0 && count <= Math.floor((end - start - 100) / 40), 'invalid PCK file count')
  let cursor = start + 100
  const files = new Map()
  for (let index = 0; index < count; index += 1) {
    range(cursor, 4, base)
    const length = u32(cursor)
    cursor += 4
    range(cursor, length + 36, base)
    const path = bytes.toString('utf8', cursor, cursor + length).replace(/\0+$/, '')
    require(path.startsWith('res://') && !path.includes('\0') && !files.has(path), 'invalid or duplicate resource path')
    cursor += length
    const offset = base + u64(cursor)
    const size = u64(cursor + 8)
    range(offset, size, end)
    require(u32(cursor + 32) === 0, `encrypted or unsupported resource: ${path}`)
    const data = bytes.subarray(offset, offset + size)
    require(createHash('md5').update(data).digest().equals(bytes.subarray(cursor + 16, cursor + 32)),
      `checksum mismatch: ${path}`)
    files.set(path, data)
    cursor += 36
  }
  require(files.has('res://project.binary'), 'missing project settings')
  require(files.has('res://scenes/tabletop.tscn') || files.has('res://scenes/tabletop.tscn.remap'), 'missing tabletop scene')
  for (const [path, data] of files) {
    if (!path.endsWith('.remap') && !path.endsWith('.import')) continue
    const targets = [...data.toString('utf8').matchAll(/^path(?:\.[^=\s]+)?\s*=\s*"([^"]+)"/gm)]
      .map((match) => match[1])
    require(targets.length > 0 && targets.every((target) => files.has(target)), `missing remapped resource: ${path}`)
  }
  for (const local of VIEWER_DATA_FILES) {
    const data = files.get(`res://${local}`)
    require(data, `missing standalone data: ${local}`)
    let parsed
    try { parsed = JSON.parse(data.toString('utf8')) } catch { /* Report the resource below. */ }
    require(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `invalid JSON object: ${local}`)
  }
  return { files, engine: `${u32(start + 8)}.${u32(start + 12)}.${u32(start + 16)}` }
}
