/**
 * Generate docs/PRIVACY.md - every host this app can reach, derived from the
 * source rather than remembered.
 *
 *     node tools/build-privacy-doc.mjs           write the doc
 *     node tools/build-privacy-doc.mjs --check   fail if it has drifted
 *
 * Same shape as tools/build-player-data-doc.mjs and tools/build-third-party.mjs:
 * prose authored here, every destination derived at generation time, a floor
 * that refuses to publish from what looks like a truncated scan.
 *
 * A privacy statement is the document where "written once, carefully, by
 * someone who had read the code that day" is worth least. It is read by
 * people deciding whether to trust the app, and a promise that has quietly
 * stopped being true reads exactly like one that has not. So the list of
 * hosts is not typed: the scan below finds them, and --check fails the build
 * the day somebody adds a seventh.
 *
 * # The scan
 *
 * F5's increment names the command:
 *
 *   grep -rn "fetch(\|reqwest\|https://" src/ src-tauri/src/ \
 *     | grep -v -E "test|127\.0\.0\.1|localhost"
 *
 * That is reproduced here in node rather than shelled out, because this runs
 * in CI on a runner whose `grep` is not this machine's. It was checked once
 * against the real command on 5 Sep 2026: both returned 56 matching lines and
 * the same six hosts. `--check` prints the line count so a future divergence
 * is visible rather than silent.
 *
 * # Why the doc says more than the scan does
 *
 * The scan cannot tell a request the app makes from a link a person clicks -
 * both are an `https://` in a source file. That distinction is the whole
 * point of the document, so each host is classified here, by hand, against
 * the call site. `--check` asserts every host the scan found is classified
 * and that nothing is classified which the scan did not find, which is the
 * direction that catches a host removed from the code and left in the prose.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'docs/PRIVACY.md'
const ROOTS = ['src', 'src-tauri/src']

/** The increment's first pattern, as one regexp. */
const HIT = /fetch\(|reqwest|https:\/\//
/** The increment's `grep -v`, verbatim. */
const EXCLUDE = /test|127\.0\.0\.1|localhost/
/** Hosts are read off the matching lines, which is what the doc enumerates. */
const HOST = /https?:\/\/([a-zA-Z0-9.-]+)/g

const SOURCE_EXT = new Set(['.ts', '.tsx', '.rs'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (SOURCE_EXT.has(p.slice(p.lastIndexOf('.')))) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap((r) => walk(r))
const lines = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    // grep -rn's own output shape, so a line here is a line there.
    const rendered = `${file.split('\\').join('/')}:${i + 1}:${line}`
    if (HIT.test(rendered) && !EXCLUDE.test(rendered)) lines.push(rendered)
  }
}

const hosts = new Map()
for (const line of lines) {
  for (const m of line.matchAll(HOST)) {
    hosts.set(m[1], (hosts.get(m[1]) ?? 0) + 1)
  }
}

// A floor set well below the real figures, so a scan that silently matched
// nothing - a moved directory, a regexp that stopped compiling the way it
// used to - refuses to publish an empty promise rather than a true one.
if (files.length < 200) throw new Error(`scanned only ${files.length} source files; refusing to publish.`)
if (lines.length < 20) throw new Error(`only ${lines.length} lines matched; refusing to publish.`)
if (hosts.size < 3) throw new Error(`only ${hosts.size} hosts found; refusing to publish.`)

/**
 * Every host the scan can find, and what the app actually does with it.
 *
 * `contacted` is the load-bearing field and the one the scan cannot derive:
 * true means this app opens the connection itself, false means the string is
 * a link a person may click, which their browser then fetches. A reader who
 * only wants to know "what does it talk to behind my back" needs exactly
 * that column.
 */
const DESTINATIONS = [
  {
    host: 'elanthipedia.play.net',
    contacted: true,
    what: 'The DragonRealms player wiki. The app asks its MediaWiki API for one page, and only for a room the player has explicitly marked to watch.',
    sends: 'The room title being looked up, and a user agent naming this app and its repository. No character name, no account, no game text.',
    where: '`src-tauri/src/elanthipedia.rs`, rate-limited by `src/lib/elanthipedia.ts` (`MIN_INTERVAL_MS = 60_000`).',
    note: 'Elanthipedia runs on Simutronics\' own infrastructure, and this app has no business making their servers pay for a feature of ours. That is why the fetch is once a minute per title, only for watched rooms, through the sanctioned `api.php` rather than scraping rendered pages, and with a user agent that says who is calling so they can block us if we get it wrong. It is also the reason the rest of the wiki links in this app are links rather than fetches.',
  },
  {
    host: 'api.github.com',
    contacted: true,
    what: 'GitHub\'s API, asked which release of Ruby4Lich5, Lich and the Genie script bundles to install, and what a bundle contains.',
    sends: 'Nothing about the player. An unauthenticated read of public repository metadata.',
    where: '`src-tauri/src/setup.rs`, `src-tauri/src/setup/bundles.rs`.',
    note: 'Only during setup, or when a player asks to check for or install a component.',
  },
  {
    host: 'github.com',
    contacted: true,
    what: 'Release assets - the Ruby4Lich5 and Genie downloads the setup wizard installs.',
    sends: 'Nothing about the player. A download of a public file.',
    where: '`src-tauri/src/setup/downloads.rs`, whose allowlist is `elanthia-online` and `GenieClient` only.',
    note: 'Also where the bug-report button and several help links point, which the player\'s own browser opens rather than this app.',
  },
  {
    host: 'objects.githubusercontent.com',
    contacted: true,
    what: 'Where a github.com release asset download is redirected to. Not a separate destination so much as the second half of the one above.',
    sends: 'Nothing about the player.',
    where: '`src-tauri/src/setup/downloads.rs`, in the same allowlist.',
    note: 'In the allowlist because a download that could not follow its own redirect would fail.',
  },
  {
    host: 'raw.githubusercontent.com',
    contacted: true,
    what: 'The raw text of a Lich or Genie script the player chose to install.',
    sends: 'Nothing about the player.',
    where: '`src-tauri/src/setup/bundles.rs`, allowlisted to `GenieClient/` and `elanthia-online/` paths.',
    note: 'A script is only fetched when a player asks for that script.',
  },
  {
    host: 'rubyinstaller.org',
    contacted: false,
    what: 'A link, shown when Ruby is missing and the player would rather install it themselves.',
    sends: 'Nothing. The app never opens this; it is text with an href.',
    where: '`src-tauri/src/setup.rs`.',
    note: 'Listed because the scan finds it, and a privacy document that quietly dropped a host would be worth nothing.',
  },
]

/* ------------------------------------------------------------- document --- */

const known = new Set(DESTINATIONS.map((d) => d.host))
const unclassified = [...hosts.keys()].filter((h) => !known.has(h))
const stale = [...known].filter((h) => !hosts.has(h))

const contactedCount = DESTINATIONS.filter((d) => d.contacted).length

const md = `# What DR Companion sends, and where

> Generated by \`tools/build-privacy-doc.mjs\` from a scan of \`src/\` and
> \`src-tauri/src/\`. Do not edit by hand - re-run the script. \`--check\` fails
> the build when the code has grown a destination this document does not name.

## The short version

- **No telemetry.** Nothing reports that you launched the app, what you did in
  it, or that it crashed.
- **No analytics.** No third-party script, no tracking pixel, no account.
- **Nothing leaves the machine about your character.** Your game text, your
  inventory, your skills, your character name and your Play.net credentials
  are never sent anywhere by this app. Your password never reaches it at all:
  it goes to Lich's own login.
- **Everything the app stores, it stores on your machine.** \`docs/PLAYER_DATA.md\`
  is the generated inventory of that.
- **A local AI model, if you install one, runs on loopback.** It is a process
  on your own machine, reached at \`127.0.0.1\`, and no prompt or completion
  leaves it. No model ships with the app and none is downloaded without asking.

## Every destination

${hosts.size} hosts appear in the source. ${contactedCount} of them this app
contacts itself; the rest are links, which do nothing until you click them and
are then fetched by your browser, not by this app.

${DESTINATIONS.map(
  (d) => `### \`${d.host}\`

**${d.contacted ? 'Contacted by the app.' : 'A link only - the app never opens it.'}** ${d.what}

- **What is sent:** ${d.sends}
- **Where in the code:** ${d.where}
- ${d.note}`,
).join('\n\n')}

## How this list is kept honest

The host list is not typed. The generator reproduces F5's scan -

\`\`\`
grep -rn "fetch(\\|reqwest\\|https://" src/ src-tauri/src/ | grep -v -E "test|127\\.0\\.0\\.1|localhost"
\`\`\`

- and \`--check\` fails if the scan finds a host this document does not name,
**or** if this document names one the scan no longer finds. The second
direction is the one that matters for a privacy statement: it is what stops
the document describing an app that no longer exists.

The scan currently matches ${lines.length} lines across ${files.length} source
files and finds ${hosts.size} hosts, which is the number of sections above. It
cannot tell a request from a link - both are an \`https://\` in a file - so
that distinction is recorded by hand against each call site, and is the part a
reader should check rather than take on trust.

What the scan does **not** cover, said plainly rather than left to be
discovered: the loopback addresses it deliberately excludes (the bridge to
Lich, and a local model), and anything a dependency might do on its own
account. \`THIRD_PARTY.md\` lists those dependencies.
`

/* ---------------------------------------------------------------- check --- */

if (process.argv.includes('--check')) {
  let failures = 0
  const ok = (what, cond, detail = '') => {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
    if (!cond) failures++
  }

  ok('the scan still reaches the source', files.length >= 200, `${files.length} files`)
  ok('the scan still matches outbound lines', lines.length >= 20, `${lines.length} lines`)
  ok('every host the scan found is described', unclassified.length === 0,
    unclassified.join(', ') || `${hosts.size} hosts`)
  // The direction that finds things: a host deleted from the code and left in
  // the prose describes an app that no longer exists.
  ok('every host described is still in the source', stale.length === 0,
    stale.join(', ') || `${known.size} described`)
  ok('the document names one section per host', hosts.size === DESTINATIONS.length,
    `${hosts.size} scanned, ${DESTINATIONS.length} sections`)

  let current = ''
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    ok(`${OUT} is committed`, false, 'run: node tools/build-privacy-doc.mjs')
    process.exit(1)
  }
  // Normalised line endings: the repo checks out CRLF on Windows and that is
  // not drift in what the app sends.
  const norm = (s) => s.split('\r\n').join('\n')
  ok(`${OUT} matches the source`, norm(current) === norm(md),
    norm(current) === norm(md) ? '' : 'run: node tools/build-privacy-doc.mjs')

  console.log(`\n${5 + 1} checked, ${failures} failed`)
  process.exit(failures ? 1 : 0)
}

if (unclassified.length) {
  throw new Error(`hosts found with no description: ${unclassified.join(', ')}. Add them to DESTINATIONS.`)
}
if (stale.length) {
  throw new Error(`described hosts no longer in the source: ${stale.join(', ')}. Remove them from DESTINATIONS.`)
}

mkdirSync('docs', { recursive: true })
writeFileSync(OUT, md)
console.log(`${OUT}: ${hosts.size} hosts (${contactedCount} contacted), ${lines.length} lines, ${files.length} source files scanned`)
