/**
 * Move rendered art into the app and write the manifest it reads.
 *
 *   node tools/art-install.mjs
 *
 * The renderer writes to data/art/out with ComfyUI's own numbering
 * (kobold_00002_.webp) and records a build manifest keyed by wiki title. The
 * app looks for public/creatures/<slug>.webp and asks a runtime manifest which
 * of those exist.
 *
 * The gap between those two is this file, and it exists because the alternative
 * is worse: without a manifest the card optimistically renders an img and lets
 * onError fall back, which in a room of eight creatures is eight 404s per
 * update. A closed world with an index is quieter and faster.
 *
 * Two reconciliations happen here rather than at render time:
 *
 *   - ComfyUI's counter suffix is stripped, and the newest render of a subject
 *     wins, so re-rendering one creature replaces it rather than accumulating.
 *   - Wiki disambiguators are dropped. "Adult desert armadillo (1)" is one
 *     page about the creature the game calls "an adult desert armadillo", and
 *     a key carrying the (1) matches nothing the game will ever send.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { subjectOf } from './art-safety.mjs'
import { join } from 'node:path'

const KINDS = [
  { out: 'data/art/out/creatures', dest: 'public/creatures' },
  { out: 'data/art/out/portraits', dest: 'public/portraits' },
  { out: 'data/art/out/rooms', dest: 'public/rooms' },
]

const slug = (s) =>
  s
    .toLowerCase()
    // The wiki disambiguates pages the game does not distinguish.
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)


function install({ out, dest }) {
  let files
  try {
    files = readdirSync(out).filter((f) => /.(webp|png)$/i.test(f))
  } catch {
    return null
  }
  if (!files.length) return null

  // Newest render of each subject wins, so re-rendering one replaces it.
  const newest = new Map()
  for (const f of files) {
    const subject = subjectOf(f)
    const at = statSync(join(out, f)).mtimeMs
    const seen = newest.get(subject)
    const better =
      !seen ||
      at > seen.at ||
      (at === seen.at && f.endsWith('.webp') && !seen.file.endsWith('.webp'))
    if (better) newest.set(subject, { file: f, at })
  }

  mkdirSync(dest, { recursive: true })
  const manifest = []
  let png = 0
  for (const [subject, { file }] of newest) {
    if (file.endsWith('.png')) {
      png++
      continue
    }
    const target = `${subject}.webp`
    copyFileSync(join(out, file), join(dest, target))
    manifest.push(target)
  }

  manifest.sort()
  writeFileSync(join(dest, 'manifest.json'), JSON.stringify(manifest, null, 1))
  return { dest, count: manifest.length, png }
}

let any = false
for (const kind of KINDS) {
  const r = install(kind)
  if (!r) continue
  any = true
  console.log(`${String(r.count).padStart(6)} into ${r.dest}${r.png ? `  (${r.png} PNG skipped)` : ''}`)
}
if (!any) console.log('nothing rendered yet')
process.exit(0)

// Newest render of each subject wins, so re-running one creature replaces it.
const newest = new Map()
for (const f of files) {
  const subject = subjectOf(f)
  const at = statSync(join(OUT, f)).mtimeMs
  const seen = newest.get(subject)
  // WebP beats PNG at equal recency: the pack ships WebP and a stale PNG
  // sitting alongside it would win on nothing but alphabetical luck.
  const better =
    !seen ||
    at > seen.at ||
    (at === seen.at && f.endsWith('.webp') && !seen.file.endsWith('.webp'))
  if (better) newest.set(subject, { file: f, at })
}

mkdirSync(DEST, { recursive: true })

const manifest = []
let png = 0
for (const [subject, { file }] of newest) {
  if (file.endsWith('.png')) png++
  const target = `${subject}.webp`
  if (file.endsWith('.png')) continue // PNG is a leftover, not shippable art
  copyFileSync(join(OUT, file), join(DEST, target))
  manifest.push(target)
}

manifest.sort()
writeFileSync(join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 1))

console.log(`${manifest.length} installed to ${DEST}`)
if (png) console.log(`${png} PNG renders skipped; re-render them for WebP`)
