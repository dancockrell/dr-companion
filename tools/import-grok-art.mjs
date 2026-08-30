/**
 * Pulls in whatever Grok produced by hand, converts it to webp, and installs
 * it — matched, generic, or rejected, three different piles because they
 * mean three different things.
 *
 *   node tools/import-grok-art.mjs
 *
 * Deliberately does NOT write into public/creatures or data/art/manifest.json
 * — those are the local daemon's own territory, and its own install() step
 * re-syncs public/creatures periodically from its raw renders. A hand-placed
 * file sitting there would get silently overwritten the next time the daemon
 * decided that creature was worth another render, with nothing to say it had
 * happened. Creature/npc-guildleader/fix entries land in
 * public/grok-art/<category>/ instead — a separate pool, tracked in its own
 * data/art/grok-manifest.json, safe from that collision by construction. A
 * "creature" entry names the existing local creature key it could replace
 * (see data/art/grok-requests.json's "target" field) so a person can swap it
 * in on purpose later — this script never does that swap itself.
 *
 * pc-concept entries are different on purpose: they DO write straight into
 * public/portraits/, because that folder has an actual consumer already
 * (Portrait.tsx / portraits.ts) and the whole point of asking Grok for these
 * was to give it a better default, not park it somewhere nothing reads. Each
 * request names its race+sex; the matching public/portraits/<race>-<sex>.webp
 * is the real, live slot. The one already there — from local generation,
 * scoring 0.888 mean — is never deleted, only moved to
 * public/portraits/replaced/ with a timestamp, so a swap that turns out worse
 * is one file move to undo. Two requests naming the same race+sex (there is
 * exactly one such collision in the current list: two human-male entries)
 * cannot both hold that slot — the first one processed wins it, the second
 * is logged and dropped into the generic-pc pool instead of silently losing
 * the first swap or silently being discarded.
 *
 * Three intake folders, three different outcomes:
 *   data/art/grok-in/<id>.png       matched against grok-requests.json by
 *                                   filename, installed under that request's
 *                                   category and id.
 *   data/art/grok-in/generic/*      already decided good, reusable art that
 *                                   didn't fit its original ask — installed
 *                                   straight into the generic pc/npc pool.
 *   data/art/grok-in/reject/*       came out wrong for what it was asked for,
 *                                   NOT yet decided — a review queue, not a
 *                                   discard pile. Never installed by this
 *                                   script. Instead a contact sheet is built
 *                                   for whoever reviews next (almost always
 *                                   me) to look at and decide — the expected
 *                                   outcome for most of these is moving them
 *                                   into generic/ as PC concept art, not
 *                                   throwing them away.
 *
 * Processed originals move to data/art/grok-in/done/ so a re-run picks up
 * only what is new.
 */
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs'
import { join, extname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'

const IN = 'data/art/grok-in'
const GENERIC = join(IN, 'generic')
const REJECT = join(IN, 'reject')
const DONE = join(IN, 'done')
const OUT = 'public/grok-art'
const MANIFEST = 'data/art/grok-manifest.json'
const COMFY_PY = 'data/art/comfy-venv/Scripts/python.exe'

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

for (const d of [IN, GENERIC, REJECT, DONE, OUT]) mkdirSync(d, { recursive: true })

const requestsDoc = JSON.parse(readFileSync('data/art/grok-requests.json', 'utf8'))
const requests = new Map(requestsDoc.requests.map((r) => [r.id, r]))

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}

/** Any raster Python/cv2 can read, converted to a webp at the given path. */
function toWebp(srcPath, destPath) {
  execFileSync(COMFY_PY, ['-c', `
import cv2, sys
img = cv2.imread(r"${srcPath}")
if img is None:
    sys.exit(1)
cv2.imwrite(r"${destPath}", img)
`])
}

const PORTRAITS = 'public/portraits'
const REPLACED = join(PORTRAITS, 'replaced')

let matched = 0
let unmatched = 0
let generic = 0
const claimedSlots = new Set()

// --- Matched: filename (minus extension) must equal a request id. ---
for (const f of readdirSync(IN)) {
  const full = join(IN, f)
  if (!/\.(png|jpe?g|webp)$/i.test(f)) continue
  const id = basename(f, extname(f))
  const req = requests.get(id)
  if (!req) {
    console.log(`no request matches "${id}" — leaving it in place, check the filename`)
    unmatched++
    continue
  }

  if (req.dest === 'portraits') {
    const slotName = `${slug(req.race)}-${slug(req.sex)}.webp`
    if (claimedSlots.has(slotName)) {
      // Two requests named the same race+sex — the first one through this
      // loop already took the slot. This one is still good art, so it goes
      // to the generic pool rather than being dropped.
      mkdirSync(join(OUT, 'generic-pc'), { recursive: true })
      const dest = join(OUT, 'generic-pc', `${id}.webp`)
      toWebp(full, dest)
      manifest[id] = { category: 'generic-pc', target: null, dest, installedAt: new Date().toISOString() }
      renameSync(full, join(DONE, f))
      console.log(`matched  ${id}  ->  ${dest}  (${slotName} already claimed this run, routed to generic-pc)`)
      generic++
      continue
    }

    mkdirSync(PORTRAITS, { recursive: true })
    mkdirSync(REPLACED, { recursive: true })
    const slotPath = join(PORTRAITS, slotName)
    if (existsSync(slotPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      renameSync(slotPath, join(REPLACED, `${slotName.replace(/\.webp$/, '')}-${stamp}.webp`))
    }
    toWebp(full, slotPath)
    claimedSlots.add(slotName)
    manifest[id] = {
      category: 'pc-concept', target: slotName, dest: slotPath, installedAt: new Date().toISOString(),
    }
    renameSync(full, join(DONE, f))
    console.log(`matched  ${id}  ->  ${slotPath}  (replaced the local default, old one kept in ${REPLACED})`)
    matched++
    continue
  }

  mkdirSync(join(OUT, req.category), { recursive: true })
  const dest = join(OUT, req.category, `${id}.webp`)
  toWebp(full, dest)
  manifest[id] = {
    category: req.category,
    target: req.target ?? null,
    dest,
    installedAt: new Date().toISOString(),
  }
  renameSync(full, join(DONE, f))
  console.log(`matched  ${id}  ->  ${dest}`)
  matched++
}

// --- Generic: any filename, installed as reusable pool art. ---
mkdirSync(join(OUT, 'generic-pc'), { recursive: true })
mkdirSync(join(OUT, 'generic-npc'), { recursive: true })
for (const f of readdirSync(GENERIC)) {
  if (!/\.(png|jpe?g|webp)$/i.test(f)) continue
  const full = join(GENERIC, f)
  const stem = basename(f, extname(f))
  // A filename starting "pc" sorts as player-concept reuse; everything else
  // is generic NPC material, since that pool is the larger and vaguer one.
  const bucket = /^pc[-_]/i.test(stem) ? 'generic-pc' : 'generic-npc'
  const id = `grok-${bucket}-${slug(stem)}`
  const dest = join(OUT, bucket, `${id}.webp`)
  toWebp(full, dest)
  manifest[id] = { category: bucket, target: null, dest, installedAt: new Date().toISOString() }
  renameSync(full, join(DONE, f))
  console.log(`generic  ${id}  ->  ${dest}`)
  generic++
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1))

const rejectFiles = readdirSync(REJECT).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))

console.log('')
console.log(`${matched} matched, ${generic} generic, ${unmatched} unmatched (left in place), ` +
  `${rejectFiles.length} waiting in the reject pile for review`)

// Nothing in the reject pile is installed here — it needs a look first. A
// contact sheet is built automatically so that look is fast: read it, and
// move whatever's worth keeping into grok-in/generic/ (most of it, per Dan —
// these came out wrong for their original ask, not wrong outright) for the
// next run to pick up as generic PC concept art. What genuinely isn't usable
// just stays in reject/, still there, still not installed, still not lost.
if (rejectFiles.length > 0) {
  const sheetPath = 'data/art/grok-reject-review.png'
  const pySrc = `
import cv2, numpy as np, os
files = ${JSON.stringify(rejectFiles.map((f) => join(REJECT, f)))}
cell = 220
cols = min(6, len(files)) or 1
rows = (len(files) + cols - 1) // cols
sheet = np.full((rows * (cell + 18), cols * cell, 3), 40, dtype=np.uint8)
for i, f in enumerate(files):
    img = cv2.imread(f)
    if img is None:
        continue
    img = cv2.resize(img, (cell, cell))
    r, c = divmod(i, cols)
    y0, x0 = r * (cell + 18), c * cell
    sheet[y0:y0 + cell, x0:x0 + cell] = img
    cv2.putText(sheet, os.path.basename(f)[:28], (x0 + 2, y0 + cell + 13),
                cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1)
cv2.imwrite(r"${sheetPath}", sheet)
`
  execFileSync(COMFY_PY, ['-c', pySrc])
  console.log(`reject pile review sheet: ${sheetPath} — look at it, move keepers into ${GENERIC}`)
}
