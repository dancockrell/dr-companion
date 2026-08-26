/**
 * Scoring a generated image, without a person looking at it.
 *
 * The pack is fifty-odd GPU hours and the only quality gate it has ever had is
 * me opening files one at a time. That gate caught the topless fire maiden and
 * the horned Gor'Tog, and it missed both for weeks first, because a human
 * spot-check across eighteen thousand images is not a gate — it is a sample.
 *
 * So the daemon renders several candidates and picks between them itself, and
 * this is the part that decides. Everything here is measured off the pixels.
 * There is no model and no network call: a small PNG comes back beside each
 * render, gets decoded with Node's own zlib, and turns into numbers.
 *
 * What it can and cannot do is worth being exact about. It cannot tell whether
 * a face is beautiful, whether an Elothean looks Elothean, or whether the
 * clothing is right. It can tell, reliably and for free, that an image is
 * blank, muddy, degenerate, cropped through the subject's head, a tiny figure
 * lost in a field of background, or a near-duplicate of the candidate beside
 * it. Those are the failures that actually happened, and every one of them
 * cost a re-render that nobody noticed was needed.
 */
import { inflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// PNG, only the shape ComfyUI writes
// ---------------------------------------------------------------------------

/**
 * Decode a non-interlaced 8-bit PNG to { width, height, rgb }.
 *
 * Deliberately narrow. ComfyUI's SaveImage writes 8-bit RGB or RGBA,
 * non-interlaced, and supporting the rest of the format would be a decoder
 * nobody asked for. Anything else throws rather than returning a plausible
 * wrong answer, because a silently mis-decoded image scores as noise and would
 * fail good renders at random.
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png')

  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let colour = 0
  const idat = []

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    pos += 12 + len

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      colour = data[9]
      if (data[12] !== 0) throw new Error('interlaced png')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`)
  const channels = colour === 2 ? 3 : colour === 6 ? 4 : 0
  if (!channels) throw new Error(`unsupported colour type ${colour}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rgb = Buffer.alloc(width * height * 3)
  const line = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)

  let at = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[at++]
    raw.copy(line, 0, at, at + stride)
    at += stride

    // The five PNG filters, undone in place. Paeth is the fiddly one and the
    // only reason this is worth spelling out: getting it subtly wrong gives an
    // image that looks almost right and scores like noise.
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 0xff
    }
    line.copy(prev)

    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 3
      rgb[d] = line[s]
      rgb[d + 1] = line[s + 1]
      rgb[d + 2] = line[s + 2]
    }
  }

  return { width, height, rgb }
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * Everything measurable about one image, before any judgement is applied.
 *
 * Split from scoring on purpose. The numbers are facts about the pixels; the
 * weights are opinions about what a portrait should look like, and those will
 * change. Keeping them apart means a change of mind does not require
 * re-rendering anything.
 */
export function measure(img) {
  const { width: w, height: h, rgb } = img
  const n = w * h
  const px = (x, y) => {
    const i = (y * w + x) * 3
    return [rgb[i], rgb[i + 1], rgb[i + 2]]
  }

  // Luminance statistics, and a histogram for entropy.
  const hist = new Array(64).fill(0)
  let sum = 0
  let sumSq = 0
  const L = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const v = lum(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
    L[i] = v
    sum += v
    sumSq += v * v
    hist[Math.min(63, v >> 2)]++
  }
  const mean = sum / n
  const rawStdev = Math.sqrt(Math.max(0, sumSq / n - mean * mean))

  /**
   * Detail measured on a contrast-stretched copy, not on the raw pixels.
   *
   * This exists because the first calibrated scale scored a good picture at
   * zero. Room 1-218 is a lamp on a table in a dark cellar with figures in the
   * doorway: composed, atmospheric, entirely intact. It measured stdev 15 and
   * entropy 3.4 and was rejected outright, while across the set rooms with a
   * mean below 40 averaged 0.148 against 0.675 for everything else.
   *
   * The scale was measuring brightness and calling it quality. A dark scene
   * has all of its detail compressed into the bottom of the range, so every
   * absolute detail metric reads low even when the structure is all there —
   * and half of Elanthia is caves, cellars and night.
   *
   * Stretching between the 2nd and 98th percentiles first makes the measures
   * say what they were meant to say: how much structure is present,
   * independent of how the scene is lit. The raw values are still recorded,
   * because "this render is nearly black" is worth knowing; it is just not the
   * same question as "this render is bad".
   */
  const sorted = Float32Array.from(L).sort()
  const lo = sorted[Math.floor(n * 0.02)]
  const hi = sorted[Math.min(n - 1, Math.floor(n * 0.98))]
  const span = Math.max(1, hi - lo)
  const N = new Float32Array(n)
  const histN = new Array(64).fill(0)
  let sumN = 0
  let sumSqN = 0
  for (let i = 0; i < n; i++) {
    const v = Math.min(255, Math.max(0, ((L[i] - lo) / span) * 255))
    N[i] = v
    sumN += v
    sumSqN += v * v
    histN[Math.min(63, v >> 2)]++
  }
  const meanN = sumN / n
  const stdev = Math.sqrt(Math.max(0, sumSqN / n - meanN * meanN))

  let entropy = 0
  for (const c of histN) {
    if (!c) continue
    const p = c / n
    entropy -= p * Math.log2(p)
  }

  /**
   * The background, taken from the corners.
   *
   * Every portrait and creature prompt asks for a plain dark background, so
   * the corners are the most reliable sample of it available without
   * segmenting anything. A 6% square in each corner is small enough to miss
   * the subject even in a tightly cropped bust.
   */
  const cw = Math.max(2, Math.round(w * 0.06))
  const ch = Math.max(2, Math.round(h * 0.06))
  let br = 0
  let bg = 0
  let bb = 0
  let bn = 0
  for (const [ox, oy] of [
    [0, 0],
    [w - cw, 0],
    [0, h - ch],
    [w - cw, h - ch],
  ]) {
    for (let y = oy; y < oy + ch; y++) {
      for (let x = ox; x < ox + cw; x++) {
        const [r, g, b] = px(x, y)
        br += r
        bg += g
        bb += b
        bn++
      }
    }
  }
  const back = [br / bn, bg / bn, bb / bn]

  /**
   * Which pixels are subject rather than background.
   *
   * A fixed distance in RGB, chosen so a dark subject against a dark
   * background still separates. This is the measurement the tiny-Elothean
   * failure turns on: that render was a correct image of a person, and the
   * person was four percent of the frame.
   */
  const THRESH = 34
  const mask = new Uint8Array(n)
  let covered = 0
  let cx = 0
  let cy = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const [r, g, b] = px(x, y)
      const d = Math.abs(r - back[0]) + Math.abs(g - back[1]) + Math.abs(b - back[2])
      if (d > THRESH) {
        mask[i] = 1
        covered++
        cx += x
        cy += y
      }
    }
  }
  const coverage = covered / n
  const centreX = covered ? cx / covered / w : 0.5
  const centreY = covered ? cy / covered / h : 0.5

  /** Content per band, so a floating figure can be told from a bust. */
  const band = (from, to) => {
    let c = 0
    let t = 0
    for (let y = Math.floor(h * from); y < Math.floor(h * to); y++) {
      for (let x = 0; x < w; x++) {
        t++
        if (mask[y * w + x]) c++
      }
    }
    return t ? c / t : 0
  }

  /** Edge energy, overall and in the corners, as a proxy for burnt-in text. */
  let edgeSum = 0
  let cornerEdge = 0
  let cornerN = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = Math.abs(N[i + 1] - N[i - 1])
      const gy = Math.abs(N[i + w] - N[i - w])
      const e = gx + gy
      edgeSum += e
      // Bottom corners only: signatures land there, and the top corners of a
      // portrait routinely hold hair or a hood.
      if (y > h * 0.86 && (x < w * 0.22 || x > w * 0.78)) {
        cornerEdge += e
        cornerN++
      }
    }
  }
  const edges = edgeSum / n
  const cornerEdges = cornerN ? cornerEdge / cornerN : 0

  /** Mean hue and saturation of the subject, for palette checks. */
  let sr = 0
  let sg = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    sr += rgb[i * 3]
    sg += rgb[i * 3 + 1]
    sb += rgb[i * 3 + 2]
  }
  const subject = covered ? [sr / covered, sg / covered, sb / covered] : [0, 0, 0]

  return {
    width: w,
    height: h,
    mean,
    /** Raw spread. Low means dark or flat, which is not the same as bad. */
    rawStdev,
    /** Contrast-normalised, and what the scores are built on. */
    stdev,
    entropy,
    coverage,
    centreX,
    centreY,
    topBand: band(0, 0.08),
    bottomBand: band(0.85, 1),
    midBand: band(0.3, 0.7),
    edges,
    cornerEdges,
    background: back,
    subject,
    hash: dHash(img),
  }
}

/**
 * A 64-bit difference hash, for telling candidates apart.
 *
 * Variants of one subject share a prompt and differ only by seed, and schnell
 * at four steps will sometimes give three of them the same composition.
 * Keeping the "best" of three identical images is a waste of two renders, and
 * more importantly it hides that the subject needs a different prompt rather
 * than another roll.
 */
export function dHash(img) {
  const { width: w, height: h, rgb } = img
  const S = 9
  const grid = []
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < S; gx++) {
      const x = Math.min(w - 1, Math.floor((gx / S) * w))
      const y = Math.min(h - 1, Math.floor((gy / 8) * h))
      const i = (y * w + x) * 3
      grid.push(lum(rgb[i], rgb[i + 1], rgb[i + 2]))
    }
  }
  let bits = ''
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      bits += grid[gy * S + gx] < grid[gy * S + gx + 1] ? '1' : '0'
    }
  }
  return bits
}

export const hamming = (a, b) => {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++
  return d
}

// ---------------------------------------------------------------------------
// Judgement
// ---------------------------------------------------------------------------

/**
 * How well one measure sits in its wanted range. Peaks in the middle.
 *
 * The first version returned a flat 1 anywhere inside the range, and that made
 * the whole evaluator useless for the job it exists to do. Every room came
 * back scoring exactly 1.000 with every part at 1.000, because real renders
 * all land inside these ranges — so the score said "acceptable" and could not
 * say "better". Candidate selection was picking arbitrarily between ties, and
 * the improvement pass could never fire because nothing was ever below par.
 *
 * Now it prefers the centre. Inside the range the score falls from 1 at the
 * midpoint to 0.7 at the edges, which is enough spread to rank two acceptable
 * images without ever preferring a bad one to a good one. Outside, it decays
 * as before.
 *
 * The 0.3 interior drop is deliberately smaller than the exterior fall-off: an
 * image at the edge of acceptable must always beat one outside it.
 */
export function band(value, lo, hi, slack) {
  if (value >= lo && value <= hi) {
    const mid = (lo + hi) / 2
    const half = (hi - lo) / 2 || 1
    const off = Math.abs(value - mid) / half
    return 1 - 0.3 * off * off
  }
  const off = value < lo ? lo - value : value - hi
  return Math.max(0, 0.7 * (1 - off / slack))
}

/**
 * What each kind of image is supposed to look like.
 *
 * The portrait numbers come from measuring the renders that were wrong. The
 * tiny full-length Elothean sat at 0.07 coverage with almost nothing in the
 * bottom band; a good bust sits between a third and three quarters covered and
 * runs off the bottom edge. Rooms are scenery and have no subject at all, so
 * coverage means nothing there and detail is what matters.
 */
export const TARGETS = {
  portraits: {
    coverage: [0.3, 0.8, 0.25],
    bottomBand: [0.45, 1.0, 0.4],
    midBand: [0.35, 1.0, 0.35],
    stdev: [22, 90, 25],
    entropy: [3.6, 6.0, 1.6],
    centreX: [0.35, 0.65, 0.25],
  },
  creatures: {
    coverage: [0.16, 0.85, 0.3],
    bottomBand: [0.1, 1.0, 0.3],
    midBand: [0.2, 1.0, 0.35],
    stdev: [20, 95, 28],
    entropy: [3.4, 6.0, 1.8],
    centreX: [0.3, 0.7, 0.3],
  },
  rooms: {
    /*
     * Deliberately wide, and deliberately not calibrated yet.
     *
     * These were tightened to the measured quartiles of 164 renders and it was
     * a mistake that took a picture to catch. Room 1-218 is a lamp on a table
     * in a dark cellar, composed and intact, and it scored zero; across the
     * set, rooms with a mean below 40 averaged 0.148 against 0.675 for the
     * rest. The scale had learned brightness and was calling it quality, which
     * matters because half of Elanthia is caves, cellars and night.
     *
     * The measures are contrast-normalised now, which fixes the cause. But
     * those quartiles were taken from the *raw* numbers, so applying them to
     * normalised ones is a straight mismatch and would be wrong in a new
     * direction. They stay wide until there is normalised data to calibrate
     * against, which the daemon is collecting.
     *
     * Wide is the safe failure. It discriminates poorly, so the improvement
     * pass rarely fires; the tight version discriminated well and threw away
     * good art, and a scale that destroys work is far worse than one that
     * merely fails to rank it.
     */
    /*
     * Asymmetric on purpose. The floors come from measured data and the
     * ceilings stay generous, because the two ends are not the same claim: a
     * render with no structure is never good, while an unusually busy one may
     * simply be a market at noon.
     *
     * The floors were briefly set below anything the model produces - edges at
     * 8, against a measured p10 of 21.5 - and a structureless test image beat
     * a detailed one because it sat closer to that floor than the detailed one
     * sat to the ceiling. A bound below the whole distribution is not a
     * lenient bound, it is an absent one.
     */
    stdev: [28, 90, 30],
    entropy: [4.2, 6.2, 1.8],
    edges: [18, 70, 14],
  },
}

/**
 * Below these an image is not merely poor, it is not an image.
 *
 * Set low on purpose. The first version rejected anything under 1.6 bits of
 * entropy, which caught a figure standing alone on a plain dark background —
 * an image that is badly composed and perfectly intact. Calling that broken
 * threw away the diagnosis: it scored zero with no parts recorded, so the
 * daemon could say the render failed but not that the subject was four percent
 * of the frame, which is the only fact worth having.
 *
 * Broken means blank, one tone, or solid black or white. Everything else is a
 * score, not a rejection.
 */
export function isBroken(m) {
  // Raw, deliberately. A stretch of an almost-flat image manufactures a
  // plausible spread out of nothing, so the broken check has to look at the
  // pixels as they were.
  if ((m.rawStdev ?? m.stdev) < 4) return 'flat, one tone'
  if (m.entropy < 0.25) return 'almost no detail'
  if (m.mean < 6) return 'black'
  if (m.mean > 249) return 'white'
  return null
}

/**
 * Score one image for its kind, 0 to 1, with the reasons kept.
 *
 * The reasons matter as much as the number. A daemon that silently prefers one
 * candidate teaches nobody anything; one that records "chosen: coverage 0.52,
 * rejected: subject fills 6% of frame" explains a bad prompt the first time it
 * happens instead of the fiftieth.
 */
export function score(kind, m) {
  const broken = isBroken(m)
  if (broken) return { score: 0, broken, parts: {} }

  const targets = TARGETS[kind] ?? TARGETS.rooms
  const parts = {}
  let total = 0
  let n = 0
  for (const [key, [lo, hi, slack]] of Object.entries(targets)) {
    const v = m[key]
    if (typeof v !== 'number') continue
    parts[key] = Number(band(v, lo, hi, slack).toFixed(3))
    total += parts[key]
    n++
  }
  const s = n ? total / n : 0

  /*
   * There is no watermark penalty here, and that is a decision rather than an
   * omission.
   *
   * Two of the renders carry a burnt-in signature, so it is a real problem,
   * and the obvious detector — high edge energy in the bottom corners — was
   * written and then removed. It fires on shoulders. A correctly framed bust
   * fills its bottom corners with the subject, which is exactly the
   * composition the rest of this file is trying to reward, so the detector
   * penalised the good renders and left the tiny floating figures alone.
   *
   * cornerEdges is still measured and recorded, because it costs nothing and a
   * later pass may find a threshold that separates text from cloth. It just
   * does not move the score until it can.
   */

  return { score: Math.max(0, Math.min(1, Number(s.toFixed(3)))), broken: null, parts }
}

/** Convenience for the daemon: read a PNG off disk and score it. */
export function scoreFile(kind, path) {
  const m = measure(decodePng(readFileSync(path)))
  return { ...score(kind, m), measures: m }
}
