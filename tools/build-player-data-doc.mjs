/**
 * Generate docs/PLAYER_DATA.md - everything this client stores on a player's
 * machine, what it holds, who owns it, and what happens when the write fails.
 *
 * Generated rather than hand-written for the reason bar 4 of the plan states:
 * a player must lose nothing when anything breaks, and the first thing anyone
 * asks about that is "what is there to lose?". A hand-maintained list answers
 * that correctly once. The key set moves every time somebody persists a new
 * preference, and a list that has drifted reads exactly like one that has not.
 *
 *     node tools/build-player-data-doc.mjs           write the doc
 *     node tools/build-player-data-doc.mjs --check   fail if it has drifted
 *
 * Same shape as tools/build-crossing-build-list.mjs: prose authored here,
 * every figure derived at generation time, a floor that refuses to publish
 * from what looks like a truncated scan. It carries its own --check because
 * the question it answers ("has the tree grown a key the doc does not know
 * about?") is the generator's own comparison rather than a second derivation.
 *
 * # The direction that finds things
 *
 * Counting what is present cannot detect what is absent, so this does not
 * only enumerate keys. It also walks every storage call site in src/ and
 * insists the identifier each one passes is a key this file knows, which is
 * the direction that catches a key stored by a name the scan's pattern does
 * not match.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'docs/PLAYER_DATA.md'
const SRC = 'src'

/**
 * The scan, in one place, so the generator and its --check cannot disagree
 * about what a key is. Mirrors the increment's grep:
 *
 *   grep -rhoE "(KEY|STORAGE_KEY) = '[^']+'" src/ | sort -u
 */
const KEY_PATTERN = /\b([A-Z][A-Z0-9_]*) = '([^']+)'/g
/** A constant is a storage key when its name ends in KEY. */
const isKeyName = (name) => /KEY$/.test(name)

/** Every .ts/.tsx file under src/, deepest-first order irrelevant. */
function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry)) out.push(path.split('\\').join('/'))
  }
  return out
}

const files = sourceFiles(SRC)

// A floor, not a comment. A scan that found three files has not scanned this
// tree, and publishing a data inventory from it would say "these are all the
// keys" about a fraction of them.
const MIN_FILES = 100
if (files.length < MIN_FILES) {
  throw new Error(
    `Scanned only ${files.length} source files under ${SRC}/, expected at least ${MIN_FILES}. ` +
      'Refusing to publish a player-data inventory from what looks like a truncated scan.'
  )
}

/** { constant, key, file } for every storage key constant in the tree. */
const found = []
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  for (const m of source.matchAll(KEY_PATTERN)) {
    if (isKeyName(m[1])) found.push({ constant: m[1], key: m[2], file })
  }
}
found.sort((a, b) => a.key.localeCompare(b.key))

const MIN_KEYS = 15
if (found.length < MIN_KEYS) {
  throw new Error(
    `Found only ${found.length} storage keys, expected at least ${MIN_KEYS}. ` +
      'Refusing to publish an inventory from what looks like a broken scan.'
  )
}

/**
 * The increment's own grep, run as a second, differently-shaped derivation.
 *
 *   grep -rhoE "writeJSON\('[^']+'|readJSON<[^>]*>\('[^']+'|(KEY|STORAGE_KEY) = '[^']+'" src/ | sort -u
 *
 * It matches on the *literal suffix* `KEY = '` where the scan above matches on
 * a constant name ending in KEY, so the two can disagree - and a disagreement
 * is the interesting result, not a nuisance. Two derivations of one number
 * that share their method would only ever confirm each other.
 */
const GREP_PATTERN = /writeJSON\('[^']+'|readJSON<[^>]*>\('[^']+'|(?:KEY|STORAGE_KEY) = '([^']+)'/g
{
  const viaGrep = new Set()
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(GREP_PATTERN)) {
      if (m[1]) viaGrep.add(m[1])
      else viaGrep.add(m[0]) // a literal key passed straight to a storage call
    }
  }
  const viaScan = new Set(found.map((f) => f.key))
  const onlyGrep = [...viaGrep].filter((k) => !viaScan.has(k))
  const onlyScan = [...viaScan].filter((k) => !viaGrep.has(k))
  if (viaGrep.size !== viaScan.size || onlyGrep.length || onlyScan.length) {
    throw new Error(
      `The two derivations disagree: the grep found ${viaGrep.size} keys, the scan found ${viaScan.size}.` +
        (onlyGrep.length ? `\n  only the grep: ${onlyGrep.join(', ')}` : '') +
        (onlyScan.length ? `\n  only the scan: ${onlyScan.join(', ')}` : '')
    )
  }
}

/**
 * What each key holds, in a player's terms, and anything true of it that the
 * key name does not say.
 *
 * Authored, because "what it holds" is not derivable from a string constant.
 * The generator refuses to run when this map and the scan disagree in either
 * direction, so a new key stops the build until somebody describes it, and a
 * removed key cannot leave a description behind describing nothing.
 */
const DESCRIBES = {
  'dr-companion-prefs-v1': 'UI preferences: mode, theme, sound volumes, and the other settings in `PersistedPrefs`. Explicitly not credentials or session secrets.',
  'dr-companion-profiles-v1': 'One record per character (last seen, per-character toggles), keyed by profile.',
  'dr-companion:task-tile-order': 'The order the task tiles are arranged in on the Tasks panel.',
  'drc.attach-port.v2': 'The last port the player typed into the game connection bar. A number, not JSON.',
  'drc.board-slot-width.v1': 'How wide the middle board slot is, as a fraction of the window. Replaces `drc.battle-width.v3`: the slot holds the map and the battle picture together now, so the key was bumped rather than reused under a new meaning.',
  'drc.left-rail-width.v1': 'How wide the character side is, as a fraction of the window. Replaces `drc.room-width.v2`, which measured a much wider column holding the map and the transcript.',
  'drc.right-rail-width.v1': 'How wide the context side is, as a fraction of the window. Replaces `drc.experience-width.v2`; the experience strip moved to the console row and this rail holds alerts, actions and the AI worker.',
  'drc.layout.v1': 'Panel order and rectangles, one entry per UI mode: the real keys are `drc.layout.v1.<mode>`. Merged against the current defaults on read, so a panel added later still appears.',
  'drc.macros.v1': 'Which variation each macro slot runs.',
  'drc.map-height.v1': 'Superseded by `drc.map-height.v4`. Read once, to migrate a genuine v1 customisation; never written.',
  'drc.map-height.v4': 'How the board slot divides between the map above and the battle picture below, as a fraction of the window. `.v4` because v3 measured the map against the game transcript, which now lives in the console row.',
  'drc.map.v1': 'Where the map is docked, how wide, and how far it is zoomed. A property of this window rather than of a character, so it does not follow a profile.',
  'drc.middle-panels-hidden.v1': 'Which boxes in the dashboard middle column the player has switched off, on top of whichever set the mode already shows.',
  'drc.off-highlight-classes.v1': 'Highlight classes the player has switched off, kept out of the shared highlight file so a shared set is not edited by toggling one.',
  'drc.pins.v1': 'Map pins the player placed, per profile.',
  'drc.player-marker.v1': 'The icon and colour of the player marker on the map.',
  'drc.portrait.v1': 'The portrait chosen for each character.',
  'drc.quickswitch.v3': 'What is pinned to the Quick Switch bar and in what order: tasks (with their language), commands and raw scripts.',
  'drc.script-icons.v1': 'Icon overrides for scripts, one entry per script rather than one per profile.',
  'drc.watched-rooms.v1': 'Rooms the player is watching, per profile.',
  'drc.armor-loadouts.v1': "A character's corrections to the derived armour coverage, which the live inventory feed cannot supply.",
  'drc.ai-jobs.v1': 'Background AI jobs and their status. Absent unless the optional local model has been used.',
  'drc.ai-claims.v1': 'Candidate claims the AI worker proposed, with their evidence references, producer and review state. Candidates only: nothing here is map, pin or bestiary data until a person promotes it.',
  'drc.ai-evidence.v1': 'Journal events an AI job or candidate claim cites, copied so the evidence outlives the journal that recorded it. Game text only where an event already carried it; nothing new is captured for this.',
  'drc.ai-cursor.v1': 'How far the AI worker had read when its window was last rebuilt, tagged with the run that wrote it so a later run ignores it. Two numbers and a tag; no game text.',
  'drc.nudge.v1': 'Visit counts behind the "you keep coming back here, pin it?" nudge, per profile.',
}

const keys = [...new Set(found.map((f) => f.key))].sort()
const described = Object.keys(DESCRIBES).sort()

const undescribed = keys.filter((k) => !(k in DESCRIBES))
const orphaned = described.filter((k) => !keys.includes(k))
if (undescribed.length || orphaned.length) {
  throw new Error(
    [
      'The description map and the tree disagree.',
      undescribed.length ? `  keys with no description: ${undescribed.join(', ')}` : '',
      orphaned.length ? `  descriptions for keys that no longer exist: ${orphaned.join(', ')}` : '',
      '  Edit DESCRIBES in tools/build-player-data-doc.mjs, then re-run.',
    ].filter(Boolean).join('\n')
  )
}

/**
 * The other direction: every storage call site's key identifier must be one
 * this file knows about.
 *
 * `writeJSON(SOMETHING_ELSE, ...)` with a constant this scan's pattern does
 * not match is exactly the key that would be missing from the inventory, and
 * no amount of counting the keys that were found can reveal it.
 */
// The lookbehind excludes `navigator.clipboard.writeText`, which is a
// different function that happens to share a name and touches no storage.
const CALL_PATTERN = /(?<![.\w])(?:readJSON|writeJSON|writeText)\s*(?:<[^>]*>)?\s*\(\s*([^,)]+)/g
const knownConstants = new Set(found.map((f) => f.constant))
const strays = []
for (const file of files) {
  if (file === 'src/lib/storage.ts') continue
  const source = readFileSync(file, 'utf8')
  for (const m of source.matchAll(CALL_PATTERN)) {
    const arg = m[1].trim()
    // `${KEY}.${mode}` and `KEY` both name a known constant; a bare string
    // literal or an unrecognised identifier does not.
    const named = arg.match(/[A-Z][A-Z0-9_]*/)
    if (named && knownConstants.has(named[0])) continue
    // A parameter named `key` is the storage module's own indirection
    // (App.tsx's readShare/writeShare take one), and its callers pass a
    // constant this scan already has.
    if (/^key$/.test(arg)) continue
    strays.push(`${file}: ${arg}`)
  }
}
if (strays.length) {
  throw new Error(
    'Storage call sites pass a key this inventory does not know about:\n  ' +
      strays.join('\n  ') +
      '\n  Either name it <SOMETHING>_KEY so the scan sees it, or add it to DESCRIBES.'
  )
}

// localStorage.getItem call sites are read-only and pass the same constants;
// counted so the doc can say how many places read directly rather than
// through readJSON, which is a real difference for a reader.
const directReads = files
  .filter((f) => f !== 'src/lib/storage.ts')
  .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/localStorage\.getItem\(/g)].map(() => f))

const owners = new Map()
for (const f of found) {
  if (!owners.has(f.key)) owners.set(f.key, [])
  owners.get(f.key).push(f.file)
}

const rows = keys.map((key) => {
  const files = [...new Set(owners.get(key))].sort()
  return `| \`${key}\` | ${DESCRIBES[key]} | ${files.map((f) => `\`${f}\``).join(', ')} |`
})

const md = `# What DR Companion keeps on your machine

> Generated by \`tools/build-player-data-doc.mjs\` by scanning \`src/\`.
> Do not edit by hand - re-run the script. \`--check\` fails the build when
> the tree has a key this document does not, or the other way round.

Everything below lives in this window's \`localStorage\`, on this computer, in
this app. None of it is sent anywhere. Nothing here is a password, a
credential or a game session secret: the app never sees the player's
password, which goes to Lich's own login (plan section 5, bar 2).

${keys.length} keys, owned by ${new Set(found.map((f) => f.file)).size} files, found by scanning
${files.length} source files.

## The keys

| Key | What it holds | Owner |
|---|---|---|
${rows.join('\n')}

## When a write fails

Every write goes through \`src/lib/storage.ts\`. Nothing in \`src/\` calls
\`localStorage.setItem\` directly, so there is one answer to this question
rather than one per key.

\`writeJSON\` and \`writeText\` do not throw and do not silently succeed. A
failed write is classified - \`quota\`, \`security\`, \`serialization\`,
\`unavailable\`, \`unknown\` - the value is kept in memory as a pending write,
and every subscriber is told.

**What the player sees.** \`src/components/shared/StorageWarning.tsx\` renders
a banner in all three shells (\`src/App.tsx\` mounts it three times, once per
layout), reading:

> Changes can't be saved on this device right now. *N* accepted changes are
> session-only.

with a **Retry saving** button that re-attempts every pending write. So a full
quota does not lose what the player just did in this session, does not throw an
error in front of somebody mid-fight, and does not pretend the change was
saved. It says the change is session-only, which is what it is.

**Serialization failures are not retried.** A value that will not stringify
will not stringify a second time, so it is recorded as a failure and left out
of the retry set rather than reappearing every time the player presses Retry.

**Reads never fail.** \`readJSON\` returns the caller's fallback on anything at
all - absent key, private mode, corrupt JSON - so a damaged entry costs one
setting rather than a start-up crash. ${directReads.length} call sites read
\`localStorage\` directly instead, all of them for values stored as plain
numbers rather than JSON.

## Removing it

Everything here is under one origin's \`localStorage\`, so clearing site data
for the app removes all of it and the app starts as it does for a new player.
There is nothing to uninstall separately and nothing left outside this list
(plan section 5, bar 7).
`

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    console.error(`FAIL ${OUT} is not committed. Run: node tools/build-player-data-doc.mjs`)
    process.exit(1)
  }
  // Compared on normalised line endings: the repo checks out CRLF on Windows
  // and a line-ending difference is not drift in the inventory.
  const norm = (s) => s.split('\r\n').join('\n')
  if (norm(current) !== norm(md)) {
    console.error(`FAIL ${OUT} has drifted from src/. Run: node tools/build-player-data-doc.mjs`)
    process.exit(1)
  }
  console.log(`OK   ${OUT} matches src/: ${keys.length} keys across ${files.length} source files`)
  console.log(`OK   every key has a description and every description has a key`)
  console.log(`OK   no storage call site passes a key outside the inventory`)
  console.log(`${keys.length} keys checked, 0 failed`)
  process.exit(0)
}

mkdirSync('docs', { recursive: true })
writeFileSync(OUT, md)
console.log(`${OUT}: ${keys.length} keys, ${new Set(found.map((f) => f.file)).size} owner files, ${files.length} source files scanned`)
