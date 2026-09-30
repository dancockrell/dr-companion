import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readViewerPackage, VIEWER_DATA_FILES } from './godot-viewer-package.mjs'

// Tiny format fixtures exercise refusals without needing an engine or shipping
// a fake executable into godot/build. Actual exports use the same reader.
function fixture(overrides = {}) {
  const files = {
    'project.binary': Buffer.from('settings'),
    'scenes/tabletop.tscn.remap': Buffer.from('[remap]\npath="res://scene.scn"\n'),
    'scene.scn': Buffer.from('scene'),
    ...Object.fromEntries(VIEWER_DATA_FILES.map((path) => [path, Buffer.from('{}')])),
    ...overrides,
  }
  const entries = Object.entries(files).filter(([, data]) => data !== null)
  const directory = entries.map(([path, data]) => {
    const name = Buffer.from(`res://${path}\0`)
    const entry = Buffer.alloc(4 + name.length + 36)
    entry.writeUInt32LE(name.length)
    name.copy(entry, 4)
    entry.writeBigUInt64LE(BigInt(data.length), 4 + name.length + 8)
    createHash('md5').update(data).digest().copy(entry, 4 + name.length + 16)
    return entry
  })
  const header = Buffer.alloc(100)
  header.write('GDPC')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(4, 8)
  header.writeUInt32LE(3, 12)
  header.writeUInt32LE(2, 20)
  header.writeBigUInt64LE(BigInt(100 + directory.reduce((sum, entry) => sum + entry.length, 0)), 24)
  header.writeUInt32LE(entries.length, 96)
  let offset = 0
  directory.forEach((entry, index) => {
    entry.writeBigUInt64LE(BigInt(offset), 4 + entry.readUInt32LE())
    offset += entries[index][1].length
  })
  const pack = Buffer.concat([header, ...directory, ...entries.map(([, data]) => data)])
  const exe = Buffer.alloc(128)
  exe.write('MZ')
  exe.writeUInt32LE(64, 60)
  exe.write('PE\0\0', 64)
  exe.writeUInt16LE(0x8664, 68)
  exe.writeUInt16LE(0x20b, 88)
  const footer = Buffer.alloc(12)
  footer.writeBigUInt64LE(BigInt(pack.length))
  footer.write('GDPC', 8)
  return Buffer.concat([exe, pack, footer])
}

export function checkViewerPackageReader() {
  let checked = 0
  const check = (label, action) => {
    action()
    checked += 1
    console.log(`OK   ${label}`)
  }
  const reject = (label, bytes, expected) => check(label, () => assert.throws(() => readViewerPackage(bytes), expected))
  check('embedded viewer reader accepts a complete package', () => {
    const { files, engine } = readViewerPackage(fixture())
    assert.equal(files.size, 5)
    assert.equal(engine, '4.3.0')
  })
  reject('MZ alone is not a packaged viewer', Buffer.from('MZ'), /truncated/)
  let broken = fixture(); broken.write('NOPE', 64)
  reject('invalid PE header is rejected', broken, /PE executable/)
  broken = fixture(); broken.writeUInt16LE(0x14c, 68)
  reject('wrong executable architecture is rejected', broken, /x86-64/)
  reject('truncated embedded footer is rejected', fixture().subarray(0, -1), /PCK footer/)
  broken = fixture(); broken.writeBigUInt64LE(0xffffffffffffffffn, broken.length - 12)
  reject('invalid embedded length is rejected', broken, /safe integer/)
  broken = fixture(); broken.writeUInt32LE(3, 132)
  reject('unsupported PCK format is rejected', broken, /unsupported PCK/)
  broken = fixture(); broken.writeUInt32LE(1, 148)
  reject('encrypted directory is rejected', broken, /encrypted/)
  broken = fixture(); broken.writeUInt32LE(0xffffffff, 224)
  reject('impossible resource count is rejected', broken, /file count/)
  broken = fixture(); broken[broken.length - 13] ^= 1
  reject('corrupt resource bytes are rejected', broken, /checksum mismatch/)
  reject('missing project settings are rejected', fixture({ 'project.binary': null }), /project settings/)
  reject('missing main scene is rejected', fixture({ 'scenes/tabletop.tscn.remap': null }), /tabletop scene/)
  reject('missing remapped scene is rejected', fixture({ 'scene.scn': null }), /remapped resource/)
  check('imported textures resolve to packaged data', () => {
    readViewerPackage(fixture({
      'portrait.png.import': Buffer.from('[remap]\npath="res://portrait.ctex"\n'),
      'portrait.ctex': Buffer.from('texture'),
    }))
  })
  reject('missing imported texture is rejected', fixture({
    'portrait.png.import': Buffer.from('[remap]\npath="res://portrait.ctex"\n'),
  }), /remapped resource/)
  check('platform-specific imported texture paths are verified', () => {
    readViewerPackage(fixture({
      'portrait.png.import': Buffer.from('[remap]\npath.s3tc="res://portrait.s3tc.ctex"\n'),
      'portrait.s3tc.ctex': Buffer.from('texture'),
    }))
  })
  reject('missing platform-specific texture is rejected', fixture({
    'portrait.png.import': Buffer.from('[remap]\npath.s3tc="res://portrait.s3tc.ctex"\n'),
  }), /remapped resource/)
  for (const path of VIEWER_DATA_FILES) {
    reject(`missing ${path} is rejected`, fixture({ [path]: null }), /standalone data/)
    reject(`malformed ${path} is rejected`, fixture({ [path]: Buffer.from('{bad') }), /invalid JSON/)
  }
  return checked
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checked = checkViewerPackageReader()
  console.log(`\n${checked} checked, 0 failed\nall passed`)
}
