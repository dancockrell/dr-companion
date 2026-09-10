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
 * The files the app writes into its own data directory, as opposed to the
 * browser storage above. Added by Q5, which moved the pin export out of a
 * Genie install (`docs/PLAYER_CONFIG.md` section 8, question N-c).
 *
 * Derived, for the same reason the keys are: a hand-kept list of "what else
 * is on disk" answers the question correctly once. Every leaf constant in the
 * tree is collected, and every `writePlayerFile`/`readPlayerFile` call site is
 * required to name one of them - the direction that catches a file written
 * under a name this scan's pattern does not match.
 */
const LEAF_PATTERN = /\b([A-Z][A-Z0-9_]*_LEAF) = '([^']+)'/g
const leaves = []
for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(LEAF_PATTERN)) {
    leaves.push({ constant: m[1], leaf: m[2], file })
  }
}
leaves.sort((a, b) => a.leaf.localeCompare(b.leaf))
{
  // The absent direction. A call passing something that is not a known leaf
  // constant is a file this inventory would not list.
  const known = new Set(leaves.map((l) => l.constant))
  const bad = []
  for (const file of files) {
    // The wrapper module declares these functions, so its own matches are the
    // parameter name rather than a call site. Exempting the definition is not
    // a hole: a second module writing under a bare string is exactly what the
    // rest of this loop is for, and this exemption is one named path.
    if (file === 'src/lib/playerFiles.ts') continue
    const calls = readFileSync(file, 'utf8').matchAll(/(?:write|read)PlayerFile\(\s*([A-Za-z0-9_]+)/g)
    for (const m of calls) if (!known.has(m[1])) bad.push(file + ': ' + m[1])
  }
  if (bad.length) {
    throw new Error(
      'A player file is written under a name this inventory does not know, so the doc would ' +
        'omit it: ' + bad.join(', ') + '. Give it a *_LEAF constant and describe it below.'
    )
  }
}

/** What each such file is, in a player's terms. Authored, and required: an
 *  undescribed leaf stops the build rather than reaching the doc unexplained. */
const DESCRIBES_FILES = {
  'dr-companion-pins.yaml':
    'Every map pin you placed, for every character, as YAML you can read and edit. Written only when you press Export in the map panel, never on its own. Overwriting it keeps a `.bak` of the previous version beside it, and a second window of the app cannot silently overwrite an export you just made.',
  'player-config.json':
    'Your whole player config - presets, highlights, aliases, macros, substitutes, gags and variables - as one JSON file you can read, edit and carry to another machine. Written only when you press Save in the config panel, never on its own. It is a copy: the rules the app actually runs from are the seven browser keys below, and importing this file is what puts them back. Overwriting it keeps a `.bak` beside it, and a second window of the app cannot silently overwrite a save you just made.',
}

const fileRows = leaves.map((l) => {
  const what = DESCRIBES_FILES[l.leaf]
  if (!what) {
    throw new Error(
      'No description for the player file ' + l.leaf + ' (' + l.file + '). Add one to ' +
        'DESCRIBES_FILES so it reaches the doc explained rather than as a bare filename.'
    )
  }
  return '| `' + l.leaf + '` | ' + what + ' | `' + l.file + '` |'
})

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
  'drc.scene-rail-width.v2': 'How wide the right rail is, as a fraction of the window. One key because the play-first frame has one divider: the text takes whatever the rail leaves. Replaces `drc.left-rail-width.v1`, `drc.board-slot-width.v1` and `drc.right-rail-width.v1`, which described three columns that no longer exist, and `drc.scene-rail-width.v1` (10 Sep 2026), whose fallback default (380px) was the small size Dan corrected - bumped again rather than reused, so an install already sitting on that proportion actually re-defaults against the new, larger `DOCKED_RAIL_W`.',
  'drc.scene-pane.v2': 'Which of the pane\'s four states a window of this size is in - `docked` (the primary panel, default), `minimap` (a small preview), `popped` (its own window) or `hidden` - one answer per class of window size, because it is a different decision on a 1997px monitor and on a 720px minimum window. Replaces `drc.scene-pane.v1` (10 Sep 2026): that key\'s `minimap` meant "the pane, at its only size"; a stored `minimap` under the new meaning ("the pane, deliberately shrunk") would be a value nobody actually chose. See src/lib/scenePane.ts.',
  'drc.layout.v1': 'Panel order and rectangles, one entry per UI mode: the real keys are `drc.layout.v1.<mode>`. Merged against the current defaults on read, so a panel added later still appears.',
  'drc.macros.v1': 'Which variation each macro slot runs.',
  'drc.middle-panels-hidden.v1': 'Which boxes in the dashboard middle column the player has switched off, on top of whichever set the mode already shows.',
  'drc.off-highlight-classes.v1': 'Highlight classes the player has switched off, kept out of the shared highlight file so a shared set is not edited by toggling one.',
  'drc.pins.v1': 'Map pins the player placed, per profile.',
  'drc.player-marker.v1': 'The icon and colour of the player marker on the map.',
  'drc.portrait.v1': 'The portrait chosen for each character.',
  'drc.quickswitch.v3': 'What is pinned to the Quick Switch bar and in what order: tasks (with their language), commands and raw scripts.',
  'drc.script-icons.v1': 'Icon overrides for scripts, one entry per script rather than one per profile.',
  'drc.armor-loadouts.v1': "A character's corrections to the derived armour coverage, which the live inventory feed cannot supply.",
  'drc.ai-provider.v1': 'The address of a model server on this machine, if the player has chosen to run one. Absent on every install that has not. One URL and nothing else: no key, no token, no game text - the provider refuses any address that is not 127.0.0.1 or localhost, so this cannot name somewhere off the machine.',
  'drc.scene.v1': 'Corrections the player made in the scene editor: for a room id, which ground kind, block kind, landmark, backdrop image and placed scenery they chose instead of what the batch derived. Room ids, kind names and image paths only; no game text and nothing about the character. Bounded: 1,048,576 characters in total, 4,096 for any one room and 64 placed primitives in one cell, checked on every write and on every import (`SCENE_LIMITS` in `src/lib/sceneOverrides.ts`). An import past the total is refused room by room, naming each - unbounded, this one key could take the whole origin to its quota and every other key on this list would start failing to save.',
  'drc.ai-jobs.v1': 'Background AI jobs and their status. Absent unless the optional local model has been used.',
  'drc.ai-share-sources.v1': 'Game channels whose private messages you have chosen to let a local model read. Empty unless you set it: whispers, thoughts and group chat are excluded from every prompt by default.',
  'drc.ai-claims.v1': 'Candidate claims the AI worker proposed, with their evidence references, producer and review state. Candidates only: nothing here is map, pin or bestiary data until a person promotes it.',
  'drc.ai-evidence.v1': 'Journal events an AI job or candidate claim cites, copied so the evidence outlives the journal that recorded it. Game text only where an event already carried it; nothing new is captured for this.',
  'drc.ai-cursor.v1': 'How far the AI worker had read when its window was last rebuilt, tagged with the run that wrote it so a later run ignores it. Two numbers and a tag; no game text.',
  'drc.player-config.presets.v1': 'Colour presets a highlight can name. Part of the player config store (one key per domain), which is separate from the preferences key on purpose: a config of hundreds of rules should not be rewritten every time a volume slider moves.',
  'drc.player-config.highlights.v1': 'The colour and sound rules for game text. Read by the game pane through useHighlights; this replaced reading them out of a Genie install, so a machine with no Genie has highlights.',
  'drc.player-config.aliases.v1': 'Short words that expand into commands, read by the command bar through useAliases.',
  'drc.player-config.macros.v1': 'Keys bound to a list of commands, with their modifiers.',
  'drc.player-config.substitutes.v1': 'Text rewritten before a line is shown. A display rule: the raw transcript keeps the original.',
  'drc.player-config.gags.v1': 'Lines hidden from the game pane. Also a display rule, for the same reason.',
  'drc.player-config.variables.v1': 'Values an alias or a macro can use as $name. Genie bookkeeping (room ids, its clock) is deliberately not imported here.',
  'drc.show-gagged-lines.v1': 'Whether the game pane draws lines a gag is hiding, marked as hidden. A per-listener display preference rather than part of the gag rule, so looking at what a gag hides cannot change a config the player might share. The lines are never removed from the buffer; this only decides whether they are drawn.',
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
this app. None of it is sent anywhere, and **none of it is a password, a
credential or a game session secret** - that is checked rather than promised,
by \`tools/doc-claims-test.mjs\` section K, which fails if any persisted
preference is named like one.

The password is the one worth being exact about, and the exact statement
changed twice on 6 September 2026. The app signs the player in itself now
(\`src/components/shared/SignIn.tsx\`), so it does handle a password: for the
length of one call, sent over TLS to Play.net and to nowhere else. The account
name is stored, in plain text, like every other preference. See
\`docs/LICH_NATIVE_LOGIN.md\` section 5, and \`tools/sign-in-test.mjs\`, which
drives a whole sign-in and then reads these preferences back to prove it.

## The one thing that is not in this list

The second change is that the password is **remembered by default**. That is
the only thing this app stores anywhere but \`localStorage\` without you having
asked for a file by name, and the difference is deliberate:

| | \`localStorage\` | the remembered password |
|---|---|---|
| Where | this window's storage, in the app's own data directory | Windows Credential Manager |
| Written | whenever you change a setting | on every successful sign-in, unless you untick "Remember my sign-in on this computer" |
| Removed by | clearing site data, or uninstalling | the Forget control in Settings, or unticking the box, either of which deletes the Credential Manager entry at once |
| Readable by | this app | anything running as your Windows user - which is what the app tells you beside the box |

The box was off by default when it shipped on 6 September 2026 (increment N8).
Dan reversed it on **9 September 2026**, for a desktop app on his own machine,
and asked for everything a sign-in produces to be remembered rather than the
password alone. The account name, the game and the character were already
stored in \`localStorage\`; what changed is that they are now written together
with the password, by one function, under one choice
(\`src/lib/rememberSignIn.ts\`), and that the choice starts ticked.

Nothing in the table below is that password, and there is no third place: a
password in a settings file, obfuscated or not, is a plaintext password with a
decoding step (\`docs/LICH_NATIVE_LOGIN.md\` §5.2). The code is
\`src-tauri/src/credential_store.rs\`.

${keys.length} keys, owned by ${new Set(found.map((f) => f.file)).size} files, found by scanning
${files.length} source files.

## Files you asked for

Separately from all of the above, the app writes ${leaves.length} file${leaves.length === 1 ? '' : 's'}
into its own data directory, and only when you press a button that says so.
${leaves.length === 1 ? 'It lives' : 'They live'} in the \`config\` folder under
\`DR Companion Data\` - the same directory the table above means by "the app's
own data directory", and ${leaves.length === 1 ? 'it is yours' : 'they are yours'} to
open, copy, hand to somebody else, or delete.

Nothing outside that folder is written: **this app does not write into a Genie
install.** It still reads one, once, if you import a config from it.

| File | What it is | Written by |
|---|---|---|
${fileRows.join('\n')}

## The keys

| Key | What it holds | Owner |
|---|---|---|
${rows.join('\n')}

### Three keys this app used to write, and now deletes

\`drc.map.v1\`, \`drc.map-height.v4\` and \`drc.map-height.v1\` held where the map
was docked, how far it was zoomed, and how the board slot divided between the
map and the battle picture. The map is gone (\`docs/NO-3D.md\`) and nothing
reads them.

They are not merely unread. \`stripRetiredKeys()\` in \`src/lib/layout.ts\`
removes them on the next start, and \`src/lib/layout.ts\` also drops \`map\` out
of a saved layout's panels, placements and dock. Two reasons, and the second
is the one that matters to you: a number left in storage under a name whose
meaning has gone is a number the next version can read wrongly, and this page
should be able to say that what it lists is what is actually there.

This section is written by hand in \`tools/build-player-data-doc.mjs\`, not
derived, because a key nothing writes cannot be found by scanning for writes.
Where it and the table above disagree, the table is right: it is generated
from the source on every build and this paragraph is not.

## When a write fails

Every write goes through \`src/lib/storage.ts\`. Nothing in \`src/\` calls
\`localStorage.setItem\` directly, so there is one answer to this question
rather than one per key.

\`writeJSON\` and \`writeText\` do not throw and do not silently succeed. A
failed write is classified - \`quota\`, \`security\`, \`serialization\`,
\`unavailable\`, \`lost\`, \`unknown\` - the value is kept in memory as a pending
write, and every subscriber is told.

**\`lost\` is the one a caller cannot see for itself.** \`writeJSONVerified\`
reads the key back after writing it and compares the characters, because a
store that accepts a value and keeps nothing returns from \`setItem\` with no
complaint at all. Any caller that reports "saved" to the player should use it:
the scene editor does, and returns the failure into the panel rather than
leaving the app-wide banner to be the only thing that disagrees.

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
