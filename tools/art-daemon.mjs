/**
 * The art daemon. Turn it on and leave it; it fills the pack and then improves it.
 *
 *   node tools/art-daemon.mjs           start, and keep going
 *   node tools/art-daemon.mjs status    what it is doing, without touching it
 *   node tools/art-daemon.mjs stop      finish the current image and quit
 *   node tools/art-daemon.mjs plan      show the queue order and exit
 *   node tools/art-daemon.mjs review    the worst art in the pack, worst first
 *
 * The pack is 22 portraits, 773 creatures and 17,750 rooms. That was being
 * done in hand-run batches with the card idle in between, and rooms sat at
 * zero for weeks. Worse, the only quality gate was me opening files one at a
 * time — which is a sample, not a gate, and it let a topless fire maiden and a
 * horned Gor'Tog through for as long as nobody happened to look.
 *
 * So this does the whole loop without anyone in it. For each subject it
 * renders several candidates, measures each one off its own pixels, keeps the
 * best and deletes the rest. When nothing is missing it does not stop: it goes
 * back to the weakest art in the pack and tries again with a fresh seed. There
 * is always work, and the work gets better rather than merely longer.
 *
 * Three rules it holds to, each of which was learned the hard way here:
 *   - nothing is recorded until the file is on disk (a manifest entry for a
 *     missing file means that subject is skipped forever)
 *   - the manifest is re-read before every write (two renderers once spent an
 *     afternoon undoing each other's changes, silently)
 *   - ComfyUI going away is a wait, not an error
 *
 * No dependencies, one file, plus art-eval.mjs for the scoring.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { scoreFile } from './art-eval.mjs'
import { hamming } from './art-eval.mjs'

const HOST = 'http://127.0.0.1:8188'

/**
 * Pinned here for the reason art-run.mjs pins them: consistency across the
 * pack is a stated reject condition, so a daemon quietly rendering at
 * different settings would poison thousands of images before anyone noticed.
 * FLUX.1-schnell is Apache 2.0 and its output carries no conditions. dev is on
 * this machine, is non-commercial, and must never be swapped in.
 */
const CKPT = 'flux1-schnell-fp8.safetensors'
const STEPS = 4
const CFG = 1.0

const ART = 'data/art'
const MANIFEST = join(ART, 'manifest.json')
const STATUS = join(ART, 'daemon-status.json')
const LOCK = join(ART, 'daemon.lock')
const STOP = join(ART, 'daemon.stop')
const FAILURES = join(ART, 'failures.json')
const THUMBS = join(ART, 'out/thumbs')

const SOURCES = {
  portraits: join(ART, 'portrait-prompts.json'),
  creatures: join(ART, 'creature-prompts.json'),
  rooms: join(ART, 'room-prompts.json'),
}

const OUT_DIRS = {
  portraits: { out: join(ART, 'out/portraits'), dest: 'public/portraits' },
  creatures: { out: join(ART, 'out/creatures'), dest: 'public/creatures' },
  rooms: { out: join(ART, 'out/rooms'), dest: 'public/rooms' },
}

/**
 * How much GPU each kind is worth.
 *
 * Candidates multiply cost directly, so this is the only place resource use is
 * really decided. Portraits get four because there are twenty-two of them and
 * a player looks at their own every session. Creatures get two: 773 subjects
 * on cards that appear mid-fight. Rooms get one, because 17,750 at four
 * candidates is a fortnight of GPU for scenery — they earn a second attempt
 * only by scoring badly.
 *
 * `good` is the bar above which a subject is left alone. `improve` is the
 * score below which the daemon comes back to it once the queue is empty.
 */
const POLICY = {
  portraits: { candidates: 4, good: 0.72, improve: 0.62 },
  creatures: { candidates: 2, good: 0.62, improve: 0.5 },
  rooms: { candidates: 1, good: 0.55, improve: 0.4 },
}

/** Give up on one subject after this many failed attempts and move on. */
const MAX_ATTEMPTS = 3
/** A render slower than this is wedged, not slow. */
const RENDER_TIMEOUT_MS = 240_000
/** Copy finished art into public/ every this many subjects. */
const INSTALL_EVERY = 25
/** Trailing window for the throughput figure. */
const RATE_WINDOW = 30
/** Two candidates closer than this are the same picture. */
const DUPLICATE_BITS = 6

const read = (f, fallback) => {
  try {
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fallback
  } catch {
    // A half-written status or ledger is not worth crashing a two-day run
    // over. The manifest is written whole, one key at a time.
    return fallback
  }
}

const writeJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 1))
const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rm = (p) => {
  try {
    unlinkSync(p)
  } catch {
    // Already gone, or held open. Neither is worth stopping for.
  }
}

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------

/**
 * Only one daemon, because two would fight over the manifest.
 *
 * That fight has already happened by hand: two renderers ran at once, each
 * held the whole manifest in memory, and the long one kept restoring the short
 * one's deletions. Nothing errored — images simply refused to re-render while
 * the count went up and the disk stayed empty.
 *
 * A lock file alone is not enough, since a killed daemon never removes one. The
 * pid is checked, so a stale lock is taken over rather than needing a human to
 * delete a file before work can resume.
 */
function claimLock() {
  const held = read(LOCK, null)
  if (held?.pid && held.pid !== process.pid) {
    let alive = false
    try {
      process.kill(held.pid, 0)
      alive = true
    } catch {
      alive = false
    }
    if (alive) return false
    console.log(`taking over a stale lock from pid ${held.pid}`)
  }
  writeJson(LOCK, { pid: process.pid, since: new Date().toISOString() })
  return true
}

function releaseLock() {
  const held = read(LOCK, null)
  if (held?.pid === process.pid) rm(LOCK)
}

// ---------------------------------------------------------------------------
// ComfyUI
// ---------------------------------------------------------------------------

async function comfyUp() {
  try {
    const res = await fetch(`${HOST}/system_stats`, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Wait for ComfyUI, however long that takes.
 *
 * Never gives up, never exits. The whole point is that closing ComfyUI to play
 * a game, or rebooting, costs the image in flight and nothing else. Backoff
 * climbs to a minute so a machine left overnight is not polling in a tight
 * loop.
 */
async function waitForComfy() {
  let delay = 2000
  let waited = 0
  while (!(await comfyUp())) {
    await sleep(delay)
    waited += delay
    delay = Math.min(60_000, Math.round(delay * 1.6))
  }
  return waited
}

/**
 * The render graph, plus a thumbnail nobody sees.
 *
 * Nodes 8 and 9 scale the image down and save it as PNG. It exists only so the
 * daemon can judge its own output: WebP cannot be decoded here without a
 * dependency, PNG can be decoded with Node's own zlib, and 96 pixels wide is
 * plenty for coverage, contrast and composition. Each thumbnail is deleted the
 * moment it has been scored.
 */
function workflow(entry, prefix, seed, thumbPrefix) {
  const tw = 96
  const th = Math.max(1, Math.round((entry.height / entry.width) * tw))
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: entry.prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: entry.negative ?? '', clip: ['1', 1] } },
    4: {
      class_type: 'EmptyLatentImage',
      inputs: { width: entry.width, height: entry.height, batch_size: 1 },
    },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    // WebP through the animated node with a single frame. Nothing on this
    // machine can encode WebP otherwise, and PNG at 832x1216 is roughly 680 KB
    // against 180 KB — across 17,750 rooms, a 12 GB pack rather than 3 GB.
    7: {
      class_type: 'SaveAnimatedWEBP',
      inputs: {
        images: ['6', 0],
        filename_prefix: prefix,
        fps: 1,
        lossless: false,
        quality: 90,
        method: 'slowest',
      },
    },
    8: {
      class_type: 'ImageScale',
      inputs: {
        image: ['6', 0],
        upscale_method: 'area',
        width: tw,
        height: th,
        crop: 'disabled',
      },
    },
    9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: thumbPrefix } },
  }
}

async function submit(graph) {
  const res = await fetch(`${HOST}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`submit ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).prompt_id
}

async function awaitRender(promptId) {
  const started = Date.now()
  for (;;) {
    if (Date.now() - started > RENDER_TIMEOUT_MS) throw new Error('render timed out')
    await sleep(1100)
    let entry
    try {
      const res = await fetch(`${HOST}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      entry = (await res.json())[promptId]
    } catch {
      // A blip while polling is not a failed render. ComfyUI restarting is,
      // and the timeout above catches that.
      continue
    }
    if (entry?.status?.completed) return entry
    if (entry?.status?.status_str === 'error') {
      throw new Error(JSON.stringify(entry.status.messages ?? entry.status).slice(0, 300))
    }
  }
}

// ---------------------------------------------------------------------------
// Recording, and only when it is true
// ---------------------------------------------------------------------------

/**
 * Write one manifest entry, merged against whatever is on disk right now.
 *
 * Re-read rather than held in memory. A daemon running for two days on a stale
 * copy would undo every change anything else made — which is the bug that
 * already cost an afternoon.
 */
function record(name, entry) {
  const disk = read(MANIFEST, {})
  disk[name] = entry
  writeJson(MANIFEST, disk)
}

function noteFailure(name, message) {
  const ledger = read(FAILURES, {})
  const prev = ledger[name] ?? { attempts: 0 }
  ledger[name] = {
    attempts: prev.attempts + 1,
    lastError: String(message).slice(0, 300),
    at: new Date().toISOString(),
  }
  writeJson(FAILURES, ledger)
  return ledger[name].attempts
}

function clearFailure(name) {
  const ledger = read(FAILURES, {})
  if (!ledger[name]) return
  delete ledger[name]
  writeJson(FAILURES, ledger)
}

/**
 * Did the render actually produce a file?
 *
 * ComfyUI reporting `completed` means the graph ran. It does not mean an image
 * is where we expect one, and a manifest entry pointing at a missing file is
 * worse than no entry: that subject is skipped forever and the gap surfaces
 * months later as a broken image in the app.
 */
function fileFor(kind, files) {
  const dir = OUT_DIRS[kind].out
  for (const rel of files) {
    const base = rel.split(/[\\/]/).pop()
    const full = join(dir, base)
    if (!existsSync(full)) throw new Error(`no file at ${base}`)
    if (statSync(full).size < 1024) throw new Error(`${base} is empty`)
  }
  if (!files.length) throw new Error('no image produced')
  return files
}

const outputsOf = (result, node) =>
  (result.outputs?.[node]?.images ?? []).map((i) => ({
    file: i.filename,
    sub: i.subfolder ?? '',
  }))

// ---------------------------------------------------------------------------
// One subject, several candidates, the best one kept
// ---------------------------------------------------------------------------

/**
 * Seeds for a subject's candidates.
 *
 * Derived from the name so the whole thing stays reproducible: the same
 * subject asked for four candidates always gets the same four. A random jump
 * would make a good result impossible to get back.
 */
function seedFor(name, attempt) {
  let h = 2166136261
  const s = attempt ? `${name}#${attempt}` : name
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Render one subject, judge the candidates, keep the winner.
 *
 * The losing WebPs are deleted rather than left to accumulate: four candidates
 * across 17,750 rooms would be 60 GB of images nobody chose.
 */
async function renderSubject(kind, name, entry, round) {
  const policy = POLICY[kind]
  const dir = OUT_DIRS[kind].out
  const candidates = []

  for (let i = 0; i < policy.candidates; i++) {
    const seed = seedFor(name, round * policy.candidates + i)
    const prefix = `${kind}/${slug(name)}--c${i}`
    const thumbPrefix = `thumbs/${slug(name)}--c${i}`

    const result = await awaitRender(await submit(workflow(entry, prefix, seed, thumbPrefix)))
    const art = outputsOf(result, '7')
    const thumb = outputsOf(result, '9')
    fileFor(kind, art.map((a) => join(a.sub, a.file)))

    const thumbPath = thumb[0] ? join(ART, 'out', thumb[0].sub, thumb[0].file) : null
    let judged = { score: 0, parts: {}, broken: 'no thumbnail' }
    if (thumbPath && existsSync(thumbPath)) {
      try {
        judged = scoreFile(kind, thumbPath)
      } catch (e) {
        // A thumbnail that will not decode is a problem with this tool, not
        // with the art. Keep the render and score it neutrally rather than
        // throwing away a good image over a decoder bug.
        judged = { score: 0.5, parts: {}, broken: null, decodeError: e.message }
      }
      rm(thumbPath)
    }

    const m = judged.measures
    candidates.push({
      i,
      seed,
      score: judged.score,
      parts: judged.parts,
      broken: judged.broken,
      hash: m?.hash ?? null,
      // The raw numbers, kept so the targets can be set from what the model
      // actually produces rather than from my guesses about it. The first set
      // of room bands were wide enough that every render scored a flat 1.000,
      // which is the failure that made this necessary: without the underlying
      // measures there was no way to tell a lenient scale from good art.
      // Twelve floats per subject, rounded, so 17,750 rooms cost about a
      // megabyte.
      measures: m
        ? {
            coverage: Number(m.coverage.toFixed(3)),
            bottomBand: Number(m.bottomBand.toFixed(3)),
            midBand: Number(m.midBand.toFixed(3)),
            topBand: Number(m.topBand.toFixed(3)),
            stdev: Number(m.stdev.toFixed(1)),
            entropy: Number(m.entropy.toFixed(2)),
            edges: Number(m.edges.toFixed(1)),
            mean: Number(m.mean.toFixed(1)),
            centreX: Number(m.centreX.toFixed(3)),
            cornerEdges: Number(m.cornerEdges.toFixed(1)),
          }
        : null,
      files: art.map((a) => join(a.sub, a.file)),
      paths: art.map((a) => join(dir, a.file)),
    })
  }

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]

  // Every candidate the same picture means the seed is not the problem and
  // another roll will not help. Worth saying once, in the log, rather than
  // silently spending the GPU on it again next pass.
  let identical = false
  if (candidates.length > 1 && best.hash) {
    identical = candidates
      .slice(1)
      .every((c) => c.hash && hamming(best.hash, c.hash) <= DUPLICATE_BITS)
  }

  for (const c of candidates.slice(1)) for (const p of c.paths) rm(p)

  return { best, tried: candidates.length, identical }
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/**
 * Which rooms to draw first, out of 17,750.
 *
 * The order matters more here than anywhere else, because the tail of this
 * queue is two days away and most of it is scenery nobody will stand in. Two
 * signals decide it, both from the cartography rather than guesswork: the size
 * of the zone, since the big zones are the populated ones and Crossing is
 * where every character starts, and whether a cartographer bothered to name
 * the room — a named room is a bank or a guild rather than a stretch of road.
 *
 * The effect is that the pack is useful after an evening instead of after two
 * days.
 */
function roomPriority() {
  const dir = 'src/data/map'
  const labelled = new Set()
  const zoneSize = new Map()
  if (!existsSync(dir)) return { labelled, zoneSize }
  for (const f of readdirSync(dir)) {
    if (f === 'index.json') continue
    const z = read(join(dir, f), null)
    if (!z?.rooms) continue
    zoneSize.set(z.id, z.rooms.length)
    for (const r of z.rooms) if (r.label) labelled.add(`${z.id}-${r.id}`)
  }
  return { labelled, zoneSize }
}

/**
 * Everything worth rendering, best first.
 *
 * Two phases in one list. Missing art comes first, portraits before creatures
 * before rooms. Then art that exists and scored badly, worst first — which is
 * what makes this a daemon rather than a batch job: when nothing is missing it
 * has not finished, it has moved on to the weakest thing in the pack.
 */
function plan() {
  const done = read(MANIFEST, {})
  const failures = read(FAILURES, {})
  const dead = new Set(
    Object.entries(failures)
      .filter(([, v]) => (v.attempts ?? 0) >= MAX_ATTEMPTS)
      .map(([k]) => k)
  )

  const missing = []
  const weak = []
  const { labelled, zoneSize } = roomPriority()

  for (const kind of ['portraits', 'creatures', 'rooms']) {
    const prompts = read(SOURCES[kind], {})
    const policy = POLICY[kind]

    const rank = (name) =>
      kind === 'rooms'
        ? (labelled.has(name) ? 1_000_000 : 0) + (zoneSize.get(prompts[name]?.zone ?? '') ?? 0)
        : 0

    for (const name of Object.keys(prompts)) {
      if (dead.has(name)) continue
      const have = done[name]
      if (!have) {
        missing.push({ kind, name, rank: rank(name), round: 0 })
        continue
      }
      // Art with no score predates the evaluator. It is not known to be bad,
      // so it queues for improvement below the genuinely poor rather than
      // being re-rendered ahead of them.
      const score = typeof have.score === 'number' ? have.score : null
      if (score !== null && score >= policy.improve) continue
      if (have.identical) continue
      weak.push({
        kind,
        name,
        rank: rank(name),
        round: (have.round ?? 0) + 1,
        score: score ?? policy.improve - 0.001,
      })
    }
  }

  const kindOrder = { portraits: 0, creatures: 1, rooms: 2 }
  missing.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.rank - a.rank)
  weak.sort((a, b) => a.score - b.score || kindOrder[a.kind] - kindOrder[b.kind] || b.rank - a.rank)

  return { missing, weak, dead: dead.size }
}

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

/** ComfyUI appends _00001_ and counts up. The subject is what comes before. */
const subjectOf = (f) => f.replace(/--c\d+_\d+_\.(webp|png)$/i, '').replace(/_\d+_\.(webp|png)$/i, '')

/**
 * Copy finished art into public/, newest per subject.
 *
 * Run periodically rather than at the end, because a queue that is two days
 * long should still be producing something visible tonight.
 */
function install() {
  let copied = 0
  for (const [, { out, dest }] of Object.entries(OUT_DIRS)) {
    if (!existsSync(out)) continue
    mkdirSync(dest, { recursive: true })

    const newest = new Map()
    for (const f of readdirSync(out)) {
      if (!f.endsWith('.webp')) continue
      const subject = subjectOf(f)
      const at = statSync(join(out, f)).mtimeMs
      const seen = newest.get(subject)
      if (!seen || at > seen.at) newest.set(subject, { file: f, at })
    }

    const manifest = []
    for (const [subject, { file }] of newest) {
      const target = `${subject}.webp`
      const from = join(out, file)
      const to = join(dest, target)
      // Skip a copy whose destination already matches: across 17,750 rooms
      // this is a moment rather than a minute, every twenty-five subjects.
      if (!existsSync(to) || statSync(to).size !== statSync(from).size) {
        copyFileSync(from, to)
        copied++
      }
      manifest.push(target)
    }
    manifest.sort()
    writeJson(join(dest, 'manifest.json'), manifest)
  }
  return copied
}

// ---------------------------------------------------------------------------
// Status, written for someone else to read
// ---------------------------------------------------------------------------

function totals() {
  const done = read(MANIFEST, {})
  const byKind = {}
  const scored = {}
  for (const v of Object.values(done)) {
    byKind[v.kind] = (byKind[v.kind] ?? 0) + 1
    if (typeof v.score === 'number') {
      scored[v.kind] = scored[v.kind] ?? []
      scored[v.kind].push(v.score)
    }
  }
  const out = {}
  for (const kind of ['portraits', 'creatures', 'rooms']) {
    const total = Object.keys(read(SOURCES[kind], {})).length
    const s = scored[kind] ?? []
    out[kind] = {
      done: byKind[kind] ?? 0,
      total,
      meanScore: s.length ? Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(3)) : null,
    }
  }
  return out
}

const hhmm = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return 'unknown'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.round((ms % 3_600_000) / 60_000)
  return h ? `${h}h ${m}m` : `${m}m`
}

function writeStatus(partial) {
  const t = totals()
  const remaining = Object.values(t).reduce((n, k) => n + (k.total - k.done), 0)
  writeJson(STATUS, {
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    ...partial,
    totals: t,
    remaining,
    eta: partial.perHour > 0 ? hhmm((remaining / partial.perHour) * 3_600_000) : 'unknown',
  })
}

function printStatus() {
  const s = read(STATUS, null)
  if (!s) return console.log('no status file — the daemon has not run yet')

  const held = read(LOCK, null)
  let running = false
  if (held?.pid) {
    try {
      process.kill(held.pid, 0)
      running = true
    } catch {
      running = false
    }
  }

  const age = Math.round((Date.now() - new Date(s.updatedAt).getTime()) / 1000)
  console.log(`${running ? `running (pid ${held.pid})` : 'not running'}, status ${age}s old`)
  for (const [kind, k] of Object.entries(s.totals ?? {})) {
    const pct = k.total ? Math.round((k.done / k.total) * 100) : 0
    const q = k.meanScore === null ? '' : `  mean quality ${k.meanScore}`
    console.log(
      `  ${kind.padEnd(10)} ${String(k.done).padStart(6)}/${String(k.total).padEnd(6)} ${String(pct).padStart(3)}%${q}`
    )
  }
  console.log(`  missing    ${s.remaining?.toLocaleString?.() ?? '?'}`)
  if (s.improving) console.log(`  improving  ${s.improving.toLocaleString()} below par`)
  if (s.perHour) console.log(`  rate       ${s.perHour} subjects/hour, eta ${s.eta}`)
  if (s.current) console.log(`  current    ${s.current}`)
  if (s.comfy && s.comfy !== 'up') console.log(`  comfyui    ${s.comfy}`)
  if (s.failures) console.log(`  failed     ${s.failures} given up on after ${MAX_ATTEMPTS} tries`)
}

/**
 * What the model actually produces, per measure, per kind.
 *
 * The targets in art-eval.mjs started as estimates, and estimates that are too
 * wide are invisible: every render scores a flat 1.000 and the evaluator looks
 * like it is working while ranking nothing. This reads the measures back off
 * the manifest and prints the real distribution, so the bands can be set to
 * the middle of what the model does rather than to a guess.
 *
 * It suggests rather than writes. A target is a statement about what good
 * looks like, and the 10th percentile of a run is not automatically bad — it
 * is only where to look first.
 */
function calibrate(kind = 'rooms') {
  const rows = Object.values(read(MANIFEST, {})).filter(
    (v) => v.kind === kind && v.measures
  )
  if (rows.length < 20) {
    return console.log(`only ${rows.length} scored ${kind} so far — need at least 20`)
  }

  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]
  console.log(`${rows.length} ${kind}, measured:\n`)
  console.log('  measure        p10     p25     p50     p75     p90    suggested band')
  for (const key of Object.keys(rows[0].measures)) {
    const vals = rows.map((r) => r.measures[key]).filter((v) => typeof v === 'number').sort((a, b) => a - b)
    if (!vals.length) continue
    const f = (v) => String(Number(v).toFixed(2)).padStart(6)
    // A band from the quartiles: half the renders inside, so the score has
    // something to say about the other half.
    console.log(
      `  ${key.padEnd(13)}${f(pct(vals, 0.1))}  ${f(pct(vals, 0.25))}  ${f(pct(vals, 0.5))}  ` +
        `${f(pct(vals, 0.75))}  ${f(pct(vals, 0.9))}    [${Number(pct(vals, 0.25)).toFixed(2)}, ${Number(pct(vals, 0.75)).toFixed(2)}]`
    )
  }
  const scores = rows.map((r) => r.score).sort((a, b) => a - b)
  console.log(
    `\n  score spread: p10 ${pct(scores, 0.1)}  p50 ${pct(scores, 0.5)}  p90 ${pct(scores, 0.9)}`
  )
  if (pct(scores, 0.9) - pct(scores, 0.1) < 0.05) {
    console.log('  the scale is not separating these — the bands are too wide')
  }
}

/** The worst art in the pack, so a bad prompt can be found without hunting. */
function review(limit = 25) {
  const done = read(MANIFEST, {})
  const rows = Object.entries(done)
    .filter(([, v]) => typeof v.score === 'number')
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, limit)

  if (!rows.length) return console.log('nothing scored yet')
  console.log(`worst ${rows.length} of ${Object.keys(done).length}:`)
  for (const [name, v] of rows) {
    const worst = Object.entries(v.parts ?? {})
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')
    console.log(
      `  ${String(v.score).padEnd(6)} ${v.kind.padEnd(10)} ${name.slice(0, 40).padEnd(42)}${worst}`
    )
  }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

async function run() {
  if (!claimLock()) {
    const held = read(LOCK, null)
    console.error(`already running as pid ${held?.pid}. "stop" first, or read "status".`)
    process.exit(1)
  }

  let stopping = false
  process.on('SIGINT', () => (stopping = true))
  process.on('SIGTERM', () => (stopping = true))
  process.on('exit', releaseLock)

  if (existsSync(STOP)) rm(STOP)
  mkdirSync(THUMBS, { recursive: true })
  for (const { out } of Object.values(OUT_DIRS)) mkdirSync(out, { recursive: true })

  const recent = []
  let subjects = 0
  let since = 0

  // Outer loop: re-plan when a pass finishes. Missing art becomes weak art
  // becomes better art, and there is never a state with nothing to do.
  while (!stopping && !existsSync(STOP)) {
    const { missing, weak, dead } = plan()
    const queue = [...missing, ...weak]

    if (!queue.length) {
      // Everything exists and everything is above par. Idle cheaply rather
      // than exiting, so adding prompts or lowering a bar picks straight up.
      writeStatus({ comfy: 'up', perHour: 0, failures: dead, current: null, improving: 0 })
      console.log('nothing below par — idling')
      await sleep(60_000)
      continue
    }

    console.log(
      `${missing.length.toLocaleString()} missing, ${weak.length.toLocaleString()} below par` +
        (dead ? `, ${dead} given up on` : '')
    )

    for (const item of queue) {
      if (stopping || existsSync(STOP)) break

      if (!(await comfyUp())) {
        writeStatus({ comfy: 'down, waiting', perHour: 0, failures: dead, current: null })
        console.log('comfyui is not up — waiting')
        const waited = await waitForComfy()
        console.log(`comfyui came back after ${Math.round(waited / 1000)}s`)
        if (stopping || existsSync(STOP)) break
      }

      const prompts = read(SOURCES[item.kind], {})
      const entry = prompts[item.name]
      if (!entry) continue

      const perHour =
        recent.length >= 3
          ? Math.round(3_600_000 / (recent.reduce((a, b) => a + b, 0) / recent.length))
          : 0
      writeStatus({
        comfy: 'up',
        perHour,
        failures: dead,
        improving: weak.length,
        current: `${item.kind}: ${item.name}`,
      })

      const startedAt = Date.now()
      try {
        const { best, tried, identical } = await renderSubject(
          item.kind,
          item.name,
          entry,
          item.round
        )

        const previous = read(MANIFEST, {})[item.name]
        // An improvement pass that produced something worse keeps the old
        // entry. Otherwise a bad roll would undo a good render, and the pack
        // would drift downwards the longer this ran — which is the opposite of
        // the point.
        if (previous && typeof previous.score === 'number' && previous.score > best.score) {
          record(item.name, { ...previous, round: item.round, identical })
          console.log(
            `${String(++subjects).padStart(6)}  kept ${previous.score} over ${best.score}  ${item.kind}/${item.name}`
          )
        } else {
          record(item.name, {
            kind: item.kind,
            seed: best.seed,
            source: entry.source,
            files: best.files,
            steps: STEPS,
            checkpoint: CKPT,
            score: best.score,
            parts: best.parts,
            measures: best.measures,
            round: item.round,
            identical,
            at: new Date().toISOString(),
          })
          const took = Date.now() - startedAt
          recent.push(took)
          if (recent.length > RATE_WINDOW) recent.shift()
          console.log(
            `${String(++subjects).padStart(6)}  ${(took / 1000).toFixed(1)}s  ${String(best.score).padEnd(6)}` +
              `${tried > 1 ? `best of ${tried}  ` : ''}${identical ? '(all alike)  ' : ''}${item.kind}/${item.name}`
          )
        }
        clearFailure(item.name)

        if (++since >= INSTALL_EVERY) {
          since = 0
          const copied = install()
          if (copied) console.log(`         installed ${copied} into public/`)
        }
      } catch (e) {
        const attempts = noteFailure(item.name, e.message)
        console.log(`  FAIL  ${item.name} (${attempts}/${MAX_ATTEMPTS}): ${e.message}`)
        // A broken ComfyUI fails every subject instantly and would burn the
        // whole queue's attempts in a minute. A short pause makes that cost
        // time instead of the queue.
        await sleep(2000)
      }
    }
  }

  const copied = install()
  writeStatus({ comfy: 'stopped', perHour: 0, current: null })
  console.log(`stopped after ${subjects} subjects${copied ? `, ${copied} installed` : ''}`)
  if (existsSync(STOP)) rm(STOP)
  releaseLock()
}

// ---------------------------------------------------------------------------

const cmd = process.argv[2] ?? 'start'

if (cmd === 'status') {
  printStatus()
} else if (cmd === 'review') {
  review(Number(process.argv[3]) || 25)
} else if (cmd === 'calibrate') {
  calibrate(process.argv[3] ?? 'rooms')
} else if (cmd === 'stop') {
  const held = read(LOCK, null)
  if (!held?.pid) console.log('not running')
  else {
    writeFileSync(STOP, new Date().toISOString())
    console.log(`asked pid ${held.pid} to stop after the current image`)
  }
} else if (cmd === 'plan') {
  const { missing, weak, dead } = plan()
  const by = {}
  for (const q of missing) by[q.kind] = (by[q.kind] ?? 0) + 1
  console.log(`${missing.length.toLocaleString()} missing, ${weak.length.toLocaleString()} below par${dead ? `, ${dead} given up on` : ''}`)
  for (const [k, n] of Object.entries(by)) console.log(`  ${k.padEnd(10)} ${n.toLocaleString()}`)
  console.log('\nfirst 12 in order:')
  for (const q of [...missing, ...weak].slice(0, 12)) {
    console.log(`  ${q.kind.padEnd(10)} ${q.name}${q.score !== undefined ? `  (${q.score})` : ''}`)
  }
} else {
  await run()
}
