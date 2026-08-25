/**
 * Generate the source app icon as a 1024x1024 RGBA PNG.
 *
 * Written by hand with zlib because the project has no image toolchain and
 * adding one (sharp, canvas, ImageMagick) for a single static asset is not
 * worth the install burden on contributors. Run it when the mark changes:
 *
 *   node tools/make-icon.mjs
 *   npx tauri icon src-tauri/icons/source.png
 *
 * The second command is what produces the .ico and .icns sets the Windows and
 * macOS bundlers require. Tauri's bundler needs RGBA; a plain RGB png is
 * rejected, which is what the original 99-byte placeholder was.
 *
 * Mark: a gold ring broken at the bottom with a bar rising into the centre.
 * A gate, and a keyhole, which is roughly what a control panel for a MUD is.
 * Kept to two colours and thick strokes so it survives 16x16.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SIZE = 1024

// Palette matches src/index.css so the icon and the app agree.
const BG = [0x0c, 0x0e, 0x12]
const GOLD = [0xd4, 0xa8, 0x4b]
const GOLD_DIM = [0xb8, 0x92, 0x3f]

const px = Buffer.alloc(SIZE * SIZE * 4)

function set(x, y, [r, g, b], a = 255) {
  const i = (y * SIZE + x) * 4
  // Source-over onto whatever is already there, so anti-aliased edges blend.
  const sa = a / 255
  const da = px[i + 3] / 255
  const outA = sa + da * (1 - sa)
  if (outA === 0) return
  px[i] = Math.round((r * sa + px[i] * da * (1 - sa)) / outA)
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / outA)
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / outA)
  px[i + 3] = Math.round(outA * 255)
}

/** Signed distance helpers, sampled 3x3 per pixel for cheap anti-aliasing. */
function coverage(x, y, sdf) {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px_ = x + (sx + 0.5) / 3
      const py_ = y + (sy + 0.5) / 3
      if (sdf(px_, py_) <= 0) hits++
    }
  }
  return hits / 9
}

const C = SIZE / 2

// Rounded-square background tile.
const tileR = SIZE * 0.22
const tileHalf = SIZE * 0.5
function sdfTile(x, y) {
  const dx = Math.abs(x - C) - (tileHalf - tileR)
  const dy = Math.abs(y - C) - (tileHalf - tileR)
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ax, ay) - tileR
}

// Ring, broken at the bottom.
const ringR = SIZE * 0.29
const ringW = SIZE * 0.075
function sdfRing(x, y) {
  const d = Math.abs(Math.hypot(x - C, y - C) - ringR) - ringW / 2
  // Cut a gap at the bottom: angle measured from centre, downward is +y.
  const ang = Math.atan2(y - C, x - C)
  const gapHalf = 0.42
  const inGap = Math.abs(ang - Math.PI / 2) < gapHalf
  return inGap ? 1 : d
}

// Bar rising from the gap into the centre.
const barW = SIZE * 0.075
function sdfBar(x, y) {
  const dx = Math.abs(x - C) - barW / 2
  const top = C - SIZE * 0.04
  const bot = C + SIZE * 0.36
  const dy = Math.max(top - y, y - bot)
  return Math.max(dx, dy)
}

// Centre dot, the "eye" of the keyhole.
function sdfDot(x, y) {
  return Math.hypot(x - C, y - C) - SIZE * 0.085
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const t = coverage(x, y, sdfTile)
    if (t > 0) set(x, y, BG, Math.round(t * 255))
  }
}
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const r = coverage(x, y, sdfRing)
    if (r > 0) set(x, y, GOLD, Math.round(r * 255))
    const b = coverage(x, y, sdfBar)
    if (b > 0) set(x, y, GOLD_DIM, Math.round(b * 255))
    const d = coverage(x, y, sdfDot)
    if (d > 0) set(x, y, GOLD, Math.round(d * 255))
  }
}

// ---- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type 6 = RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

// Filter byte 0 (None) in front of each scanline.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  const off = y * (SIZE * 4 + 1)
  raw[off] = 0
  px.copy(raw, off + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = process.argv[2] ?? 'src-tauri/icons/source.png'
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out} — ${SIZE}x${SIZE} RGBA, ${png.length} bytes`)
