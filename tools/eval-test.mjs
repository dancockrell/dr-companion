/**
 * The image evaluator, tested against images with known answers.
 *
 * Two things are being checked and they fail differently. The PNG decoder is
 * either right or it is producing noise, and noise scores like a bad render —
 * so a broken decoder would quietly reject good art forever. The metrics are
 * judgement calls, and the way to test those is to build the exact failures
 * that actually happened and confirm they score below the ones that did not.
 *
 * Images are synthesised here rather than loaded, so the expected answer is
 * known rather than asserted from whatever a render happened to produce.
 */
import { deflateSync } from 'node:zlib'
import { band as rawBand, decodePng, dHash, hamming, isBroken, measure, score, TARGETS } from './art-eval.mjs'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(50)}${detail}`)
}

// ---------------------------------------------------------------------------
// A minimal PNG encoder, so the decoder can be checked against known pixels
// ---------------------------------------------------------------------------

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** Encode RGB with filter 0, plus one variant using filter 1 to exercise it. */
function encodePng(w, h, paint, filterType = 0) {
  const raw = Buffer.alloc(h * (1 + w * 3))
  let at = 0
  for (let y = 0; y < h; y++) {
    raw[at++] = filterType
    const rowStart = at
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y)
      raw[at++] = r & 0xff
      raw[at++] = g & 0xff
      raw[at++] = b & 0xff
    }
    if (filterType === 1) {
      // Sub filter, applied right to left so earlier bytes stay original.
      for (let i = w * 3 - 1; i >= 3; i--) {
        raw[rowStart + i] = (raw[rowStart + i] - raw[rowStart + i - 3]) & 0xff
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------

const W = 96
const H = 140
const DARK = [16, 18, 22]

/** A bust: fills the middle, runs off the bottom edge, plain background. */
const bust = (x, y) => {
  const cx = W / 2
  const headY = H * 0.26
  const inHead = Math.hypot(x - cx, (y - headY) * 1.15) < W * 0.2
  const inBody = y > H * 0.42 && Math.abs(x - cx) < W * (0.2 + (y / H) * 0.24)
  if (!inHead && !inBody) return DARK
  // Some internal variation, or the subject is one flat blob and the entropy
  // check would fire on a picture that is fine.
  const v = 90 + ((x * 7 + y * 13) % 60)
  return [v, v - 14, v - 26]
}

/** The Elothean failure: a correct figure occupying almost none of the frame. */
const tinyFigure = (x, y) => {
  const cx = W / 2
  if (Math.abs(x - cx) > W * 0.05) return DARK
  if (y < H * 0.3 || y > H * 0.72) return DARK
  const v = 90 + ((x * 7 + y * 13) % 60)
  return [v, v - 14, v - 26]
}

const black = () => [0, 0, 0]
const flat = () => [128, 128, 128]
const noise = (x, y) => {
  const v = (x * 2654435761 + y * 40503) % 255
  return [v, (v * 3) % 255, (v * 7) % 255]
}
/** A room: detail everywhere, no figure, no plain background. */
const room = (x, y) => {
  const v = 60 + 60 * Math.sin(x / 5) * Math.cos(y / 7) + ((x * 13 + y * 29) % 40)
  return [v, v * 0.9, v * 0.7]
}

const load = (paint, filter) => decodePng(encodePng(W, H, paint, filter))

console.log('-- the decoder returns the pixels that went in --')
{
  const img = load(bust)
  ok('dimensions survive', img.width === W && img.height === H, `${img.width}x${img.height}`)

  // Filter 1 is where a decoder goes subtly wrong, so the same image encoded
  // two ways must decode identically.
  const a = load(bust, 0)
  const b = load(bust, 1)
  ok('filter 0 and filter 1 agree', Buffer.compare(a.rgb, b.rgb) === 0)

  const [r, g, bl] = [img.rgb[0], img.rgb[1], img.rgb[2]]
  ok('corner is the background it was painted', r === DARK[0] && g === DARK[1] && bl === DARK[2],
    `${r},${g},${bl}`)
  ok('rejects a file that is not a png', (() => {
    try { decodePng(Buffer.alloc(64)); return false } catch { return true }
  })())
}

console.log('\n-- broken images are caught before anything else --')
{
  ok('all black', isBroken(measure(load(black))) !== null, isBroken(measure(load(black))) ?? '')
  ok('one flat tone', isBroken(measure(load(flat))) !== null, isBroken(measure(load(flat))) ?? '')
  ok('a real image is not broken', isBroken(measure(load(bust))) === null)
  ok('a room is not broken', isBroken(measure(load(room))) === null)
  ok('broken scores zero', score('portraits', measure(load(black))).score === 0)
}

console.log('\n-- the failure that started this: a figure lost in the frame --')
{
  const good = measure(load(bust))
  const bad = measure(load(tinyFigure))
  ok('the bust covers much more of the frame',
    good.coverage > bad.coverage * 2, `${good.coverage.toFixed(2)} vs ${bad.coverage.toFixed(2)}`)
  ok('the bust reaches the bottom edge, the figure does not',
    good.bottomBand > 0.3 && bad.bottomBand < 0.1,
    `${good.bottomBand.toFixed(2)} vs ${bad.bottomBand.toFixed(2)}`)

  const gs = score('portraits', good).score
  const bs = score('portraits', bad).score
  ok('and it scores higher', gs > bs, `${gs} vs ${bs}`)
  ok('by a margin worth acting on', gs - bs > 0.2, `${(gs - bs).toFixed(2)}`)
}

console.log('\n-- kinds are judged by their own standards --')
{
  const r = measure(load(room))
  ok('a room scores well as a room', score('rooms', r).score > 0.6, `${score('rooms', r).score}`)
  const b = measure(load(bust))
  ok('a bust scores well as a portrait', score('portraits', b).score > 0.6,
    `${score('portraits', b).score}`)
  // A room has no plain background, so judging it on coverage would fail it
  // for being a room. This is why the target tables differ.
  ok('rooms are not judged on coverage', !('coverage' in score('rooms', r).parts))
}

console.log('\n-- corner edge energy is recorded but must not move the score --')
{
  // A watermark detector was written against this and removed. A correctly
  // framed bust fills its bottom corners with the subject, so the detector
  // penalised good composition and ignored the floating figures. The
  // measurement stays; the penalty does not, until something can tell a
  // signature from a shoulder.
  const clean = measure(load(bust))
  ok('cornerEdges is measured', typeof clean.cornerEdges === 'number', `${clean.cornerEdges.toFixed(1)}`)
  const signed = measure(
    load((x, y) => (y > H * 0.9 && x < W * 0.18 ? noise(x, y) : bust(x, y)))
  )
  ok('a shoulder is not penalised as text', !('cornerText' in score('portraits', signed).parts))
  ok('and the good bust keeps its score', score('portraits', clean).score > 0.6,
    `${score('portraits', clean).score}`)
}

console.log('\n-- near-duplicates are recognised --')
{
  const a = dHash(load(bust))
  const b = dHash(load(bust))
  const c = dHash(load(room))
  ok('the same image hashes the same', hamming(a, b) === 0)
  ok('a different image does not', hamming(a, c) > 8, `${hamming(a, c)} bits`)

  // A small shift is still the same composition, which is the case that
  // matters: three seeds giving one picture.
  const shifted = dHash(load((x, y) => bust(x + 1, y)))
  ok('a shifted copy stays close', hamming(a, shifted) < 12, `${hamming(a, shifted)} bits`)
}

console.log('\n-- the scale must separate two acceptable images --')
{
  // This is the bug that made the evaluator inert. Bands returned a flat 1
  // anywhere inside the range, real renders all land inside, and so every
  // room scored exactly 1.000 with every part at 1.000. The score could say
  // "acceptable" and could not say "better", which meant candidate selection
  // was picking arbitrarily and the improvement pass could never fire.
  const wide = measure(load(room))
  const detailless = measure(load((x, y) => {
    // Same palette, almost no structure. Fewer, larger, flatter areas.
    const v = 60 + 40 * Math.sin(x / 40)
    return [v, v * 0.9, v * 0.7]
  }))
  const a = score('rooms', wide).score
  const b = score('rooms', detailless).score
  ok('two rooms do not score identically', a !== b, `${a} vs ${b}`)
  ok('the one with more structure wins', a > b, `${a} vs ${b}`)

  /*
   * The test that would have caught room 1-218.
   *
   * A dark scene must score like a bright one with the same structure. The
   * first calibrated scale failed this badly: a lamp-lit cellar, composed and
   * intact, scored zero, and across 164 renders anything with a mean below 40
   * averaged 0.148 against 0.675 for the rest. The scale had learned
   * brightness and was calling it quality.
   *
   * The cost of the fix is stated rather than hidden: normalising also
   * forgives a genuinely washed-out render, because stretching puts it back.
   * Truly flat images are still caught, by isBroken against the raw pixels.
   */
  const dark = measure(load((x, y) => room(x, y).map((c) => c * 0.22)))
  const bright = score('rooms', wide).score
  const dimmed = score('rooms', dark).score
  ok('a dark copy is not punished for being dark', Math.abs(bright - dimmed) < 0.12,
    `bright ${bright} vs dark ${dimmed}`)
  ok('and it is not called broken', isBroken(dark) === null, isBroken(dark) ?? '')

  // And the invariant that makes the interior slope safe: an image at the very
  // edge of acceptable must still beat one outside it. Without it, preferring
  // the centre would start rejecting usable art.
  //
  // Checked against the target tables directly rather than through a
  // synthesised image, because the stand-in busts here use a narrow palette
  // and sit below the entropy floor a real render clears. That is a fact about
  // the test fixtures, not about the scale, and testing it through them would
  // be measuring the wrong thing.
  let held = true
  const detail = []
  for (const [kind, targets] of Object.entries(TARGETS)) {
    for (const [key, [lo, hi, slack]] of Object.entries(targets)) {
      const edge = rawBand(hi, lo, hi, slack)
      const outside = rawBand(hi + slack * 0.3, lo, hi, slack)
      const centre = rawBand((lo + hi) / 2, lo, hi, slack)
      if (!(centre > edge && edge > outside)) {
        held = false
        detail.push(`${kind}.${key}`)
      }
    }
  }
  ok('centre beats edge beats outside, for every target', held, detail.join(', '))
}

console.log('\n-- scores carry their reasons --')
{
  const s = score('portraits', measure(load(tinyFigure)))
  ok('parts are recorded', Object.keys(s.parts).length > 3, Object.keys(s.parts).join(','))
  ok('coverage is the part that fails', s.parts.coverage < 0.5, `${s.parts.coverage}`)
  ok('score stays within 0 and 1', s.score >= 0 && s.score <= 1, `${s.score}`)
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
