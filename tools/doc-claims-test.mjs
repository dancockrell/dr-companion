/**
 * Re-derives the checkable claims in the user-facing documentation, so a
 * number, a path, a command or a version cannot rot in prose while the code
 * moves underneath it.
 *
 *   node tools/doc-claims-test.mjs
 *
 * Written after an audit of README.md, docs/TESTING.md, docs/PACKAGING.md and
 * docs/SETUP-POLICY.md found five claims that had simply stopped being true:
 * "nothing in this app has ever talked to DragonRealms" (there had been a live
 * session), "healthMax: 100 hardcoded" (the bridge reads XMLData.max_health
 * now), "the two intents that touch the game" (there are 26), "the bridge does
 * not drive the game yet" (it does), and a "CI later" section describing a
 * workflow that had already shipped. Every one of them was written true and
 * went false without anybody editing the file, which is the failure a rule
 * cannot catch and a test can.
 *
 * Not named readme-claims-test: it covers four documents plus the Tauri bundle
 * config, and a name that lied about its own scope would be the same defect
 * this file exists to prevent.
 *
 * Deliberately narrow. It checks the claims that have an authority in this
 * repository to check them against. It cannot check prose, intent, or anything
 * whose authority is a live game - so where it cannot decide, it prints
 * NOT CHECKED with the reason rather than passing quietly. A skip is not a
 * pass; the summary carries the count.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** The documents this suite is the guard for. */
const DOCS = [
  'README.md',
  'docs/TESTING.md',
  'docs/PACKAGING.md',
  'docs/SETUP-POLICY.md',
  'docs/PRIVACY.md',
  'docs/PLAYER_DATA.md',
  'THIRD_PARTY.md',
]

/**
 * Repo-relative paths a document names that are legitimately absent from a
 * clean checkout. Each carries the reason, because an unexplained skip list is
 * how a real regression gets waved through. Not silently tolerated: they are
 * reported as NOT CHECKED and counted in the summary.
 */
const ABSENT_BY_DESIGN = new Map([
  ['src-tauri/vendor', 'created by `npm run vendor:stub`; large release-only files are not committed'],
])

/**
 * Build outputs are not source paths, so `existsSync` is the wrong question for
 * them. They get their own check below, against the bundle targets
 * tauri.conf.json declares, rather than a skip nobody reads.
 */
const BUILD_OUTPUT = 'src-tauri/target/'

let failed = 0
let checked = 0
const skipped = []

const ok = (name, cond, detail = '') => {
  checked++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(58)}${detail}`)
  if (!cond) failed++
}
const notChecked = (name, why) => {
  skipped.push(`${name}: ${why}`)
  console.log(`     NOT CHECKED  ${name.padEnd(45)}${why}`)
}

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const pkg = JSON.parse(read('package.json'))

// --------------------------------------------------------------------------
// A. Every `npm run x` a document tells a reader to type.
// --------------------------------------------------------------------------
// The denominator first: if the extractor breaks, "0 missing" is the answer it
// gives, and that is indistinguishable from success.
{
  const mentions = new Set()
  for (const doc of DOCS) {
    for (const m of read(doc).matchAll(/npm run ([a-z0-9:_-]+)/g)) mentions.add(m[1])
  }
  ok('the npm-script extractor found scripts to check', mentions.size >= 8, `${mentions.size} distinct`)
  const missing = [...mentions].filter((n) => !pkg.scripts[n])
  ok('every documented `npm run` resolves', missing.length === 0, missing.join(', '))
}

// --------------------------------------------------------------------------
// B. Every repo-relative path a document names.
// --------------------------------------------------------------------------
{
  const roots = 'src|src-tauri|tools|docs|lich-scripts|python|typescript|godot|data|public|genie-plugin'
  const rx = new RegExp(`(?:^|[\\s\`("'\\[])((?:${roots})/[A-Za-z0-9_./*@-]*[A-Za-z0-9_/*-])`, 'g')
  const mentions = new Set()
  for (const doc of DOCS) {
    for (const m of read(doc).matchAll(rx)) mentions.add(m[1].replace(/[.,;:)`'"\]]+$/, ''))
  }
  ok('the path extractor found paths to check', mentions.size >= 30, `${mentions.size} distinct`)
  const missing = []
  const buildOutputs = []
  for (const p of mentions) {
    if (p.startsWith(BUILD_OUTPUT)) {
      buildOutputs.push(p)
      continue
    }
    // A glob can only be checked as far as its directory.
    const target = p.includes('*') ? p.slice(0, p.lastIndexOf('/')) : p
    if (existsSync(join(process.cwd(), target))) continue
    const excuse = [...ABSENT_BY_DESIGN.keys()].find((k) => target === k || target.startsWith(`${k}/`))
    if (excuse) {
      notChecked(`path ${p}`, ABSENT_BY_DESIGN.get(excuse))
      continue
    }
    missing.push(p)
  }
  ok('every documented repo path exists', missing.length === 0, missing.join(', '))

  // A documented build artefact must sit under a bundle target the config
  // actually declares. When MSI was dropped, a doc still naming
  // `bundle/msi/*.msi` would have sent a reader to a directory the build no
  // longer creates - and no `existsSync` on a clean tree can see that.
  const targets = JSON.parse(read('src-tauri/tauri.conf.json')).bundle.targets
  const strays = buildOutputs.filter((p) => {
    const m = p.match(/^src-tauri\/target\/release\/bundle\/([^/]+)\//)
    return m ? !targets.includes(m[1]) : false
  })
  ok('documented build artefacts name a declared bundle target', strays.length === 0, `${buildOutputs.length} artefact path(s), targets ${JSON.stringify(targets)}${strays.length ? ` - stray ${strays.join(', ')}` : ''}`)
}

// --------------------------------------------------------------------------
// C. Room and zone counts, wherever prose states them.
// --------------------------------------------------------------------------
// Counted from the shipped map data rather than trusted. The rooms number is
// the fragile one: a truncated build produces a smaller map and every other
// check in this file still passes.
{
  const dir = 'src/data/map'
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json')
  let rooms = 0
  for (const f of files) rooms += (JSON.parse(read(join(dir, f))).rooms ?? []).length
  ok('the map data is readable', files.length > 0 && rooms > 0, `${files.length} zones, ${rooms} rooms`)

  // The documents that state a total. Wider than DOCS on purpose: none of the
  // four user-facing pages quotes one, so checking only those would be a check
  // over an empty population - green, and saying nothing. docs/AUDIO.md and
  // docs/ENGINE.md are where the numbers actually live.
  const stated = []
  for (const doc of [...DOCS, 'docs/AUDIO.md', 'docs/ENGINE.md']) {
    const src = read(doc)
    for (const m of src.matchAll(/([\d][\d,]*) zones/g)) stated.push([doc, 'zones', m[1]])
    for (const m of src.matchAll(/([\d][\d,]*) rooms/g)) stated.push([doc, 'rooms', m[1]])
  }
  ok('some document states a zone or room total', stated.length >= 3, `${stated.length} statements`)
  const wrong = stated.filter(([, kind, raw]) => {
    const n = Number(raw.replace(/,/g, ''))
    return kind === 'zones' ? n !== files.length : n !== rooms
  })
  ok('every stated zone/room count matches the map data', wrong.length === 0, JSON.stringify(wrong))
}

// --------------------------------------------------------------------------
// D. The window size docs/PACKAGING.md promises.
// --------------------------------------------------------------------------
{
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'))
  const win = conf.app.windows[0]
  const m = read('docs/PACKAGING.md').match(/(\d{3,4})[x\u00d7](\d{3,4}) window/)
  if (!m) {
    notChecked('PACKAGING window size', 'the document no longer states one')
  } else {
    ok('PACKAGING names the configured window size', Number(m[1]) === win.width && Number(m[2]) === win.height, `doc ${m[1]}x${m[2]}, conf ${win.width}x${win.height}`)
  }
  ok('PACKAGING names the configured bundle target', read('docs/PACKAGING.md').includes('NSIS') && conf.bundle.targets.includes('nsis'))
  ok('the bundle description does not call the app a panel', !/control panel|companion panel/i.test(`${conf.bundle.shortDescription} ${conf.bundle.longDescription}`), conf.bundle.shortDescription)
  ok('the bundle description spells DragonRealms as one word', !/Dragon Realms/.test(`${conf.bundle.shortDescription} ${conf.bundle.longDescription}`))
}

// --------------------------------------------------------------------------
// E. Three manifests, one version. They must agree with each other.
// --------------------------------------------------------------------------
{
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'))
  const cargo = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)
  ok('Cargo.toml states a version', Boolean(cargo), cargo?.[1] ?? '')
  ok('package.json, Cargo.toml and tauri.conf.json agree', pkg.version === cargo?.[1] && pkg.version === conf.version, `${pkg.version} / ${cargo?.[1]} / ${conf.version}`)
}

// --------------------------------------------------------------------------
// F. The intent counts docs/TESTING.md quotes.
// --------------------------------------------------------------------------
// Compared against tools/intent-drift-test.mjs's own output rather than a
// second parse of companion_bridge.lic. Two parsers of one file would drift,
// and that script is already the authority the build runs.
{
  const testing = read('docs/TESTING.md')
  let out = ''
  try {
    out = execFileSync(process.execPath, ['tools/intent-drift-test.mjs'], { encoding: 'utf8' })
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
  const real = out.match(/Implemented in bridge \(real\):\s*(\d+)/)
  const unimpl = out.match(/True unimplemented set:\s*(\d+)/)
  if (!real || !unimpl) {
    ok('intent-drift-test reported the counts this suite reads', false, 'its output shape changed - update this suite, do not silence it')
  } else {
    const docReal = testing.match(/Implemented in bridge \(real\):\s*(\d+)/)
    if (!docReal) {
      notChecked('TESTING implemented-intent count', 'the document no longer quotes one')
    } else {
      ok('TESTING quotes the real implemented-intent count', docReal[1] === real[1], `doc ${docReal[1]}, bridge ${real[1]}`)
    }
    // The prose list of unimplemented intents, as backticked names on the
    // bullet that introduces them. Counted, not spot-checked: a name silently
    // dropped is exactly how this section went stale before.
    const bullet = testing.match(/reports as unimplemented[^\n]*\n(?:[^\n]*\n){0,4}?[^\n]*\.\s*Run it/)
    if (!bullet) {
      notChecked('TESTING unimplemented-intent list', 'the bullet naming them was not found in the expected shape')
    } else {
      const names = new Set([...bullet[0].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]))
      ok('TESTING names as many unimplemented intents as there are', names.size === Number(unimpl[1]), `doc names ${names.size}, drift test counts ${unimpl[1]}`)
    }
  }
}

// --------------------------------------------------------------------------
// G. README's index entry for the local-AI document.
// --------------------------------------------------------------------------
// The entry described a shipped capability while the document itself said the
// implementation was incomplete. Checked in both directions, so the caveat has
// to go when the status line does.
{
  const readme = read('README.md')
  const worker = read('docs/LOCAL_AI_BACKGROUND_WORKER.md')
  const incomplete = /implementation is not yet complete/i.test(worker)
  const line = readme.split('\n').find((l) => l.includes('LOCAL_AI_BACKGROUND_WORKER.md'))
  ok('README still indexes the local-AI document', Boolean(line))
  if (line) {
    const caveated = /not yet complete|approved architecture/i.test(line)
    ok('README\u2019s local-AI entry matches that document\u2019s status', incomplete === caveated, incomplete ? 'doc says incomplete' : 'doc no longer says incomplete')
  }
}

// --------------------------------------------------------------------------
// H. docs/TESTING.md must not have gone back to claiming zero live sessions.
// --------------------------------------------------------------------------
{
  const testing = read('docs/TESTING.md')
  const runbookExists = existsSync('docs/LIVE-SESSION-RUNBOOK.md')
  ok('the live-session runbook is where TESTING points', runbookExists && testing.includes('LIVE-SESSION-RUNBOOK.md'))
  ok('TESTING no longer claims nothing has ever talked to DragonRealms', !/Nothing in this app has ever talked to DragonRealms/.test(testing))
}

// --------------------------------------------------------------------------
// I. One Node version, in one place.
// --------------------------------------------------------------------------
// Three statements of the same fact: package.json's `engines.node`, README's
// prose, and whatever every workflow hands actions/setup-node. Before 6 Sep
// 2026 there was no `engines` field at all, so the README's "Node 24 or newer"
// had nothing to be checked against, and elanthipedia.yml sat on 22 - a
// difference nobody intended and therefore nobody was testing. `engines` is now
// the authority and no workflow may hand-type a version.
{
  const engines = pkg.engines?.node
  ok('package.json declares engines.node', typeof engines === 'string', engines ?? '(absent)')
  const engineMajor = engines?.match(/(\d+)/)?.[1]
  ok('engines.node names a major version', Boolean(engineMajor), engineMajor ?? '')

  const readme = read('README.md')
  const claim = readme.match(/Node (\d+) or newer is the supported JavaScript runtime/)
  if (!claim) {
    notChecked('README Node version claim', 'the document no longer states one in the expected shape')
  } else {
    ok('README’s Node claim matches engines.node', claim[1] === engineMajor, `README ${claim[1]}, engines ${engines}`)
  }

  // The workflows. The denominator first: if the glob or the regexp breaks,
  // "no hand-typed pins" is exactly what a broken extractor says.
  const wfDir = '.github/workflows'
  const wfs = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  ok('the workflow scan found workflows', wfs.length >= 3, `${wfs.length} file(s)`)
  let setupNodeSteps = 0
  const handTyped = []
  for (const f of wfs) {
    const src = read(join(wfDir, f))
    setupNodeSteps += src.match(/actions\/setup-node@/g)?.length ?? 0
    for (const m of src.matchAll(/^\s*node-version:\s*'?([^'\s#]+)'?/gm)) handTyped.push(`${f}:${m[1]}`)
  }
  ok('the workflows still call setup-node', setupNodeSteps >= 5, `${setupNodeSteps} step(s)`)
  ok('no workflow hand-types a node-version', handTyped.length === 0, handTyped.join(', ') || 'all read node-version-file')

  // And the other direction: reading the file is only a single source if every
  // setup-node step actually does it. A step with neither key would silently
  // take the runner's default.
  let fromFile = 0
  for (const f of wfs) fromFile += read(join(wfDir, f)).match(/^\s*node-version-file:\s*package\.json\s*$/gm)?.length ?? 0
  ok('every setup-node step reads package.json', fromFile === setupNodeSteps, `${fromFile} of ${setupNodeSteps}`)
}

// --------------------------------------------------------------------------
// J. docs/TESTING.md's problem-kind table, derived from the exported set.
// --------------------------------------------------------------------------
// The table used to be a fourth copy of a list that already existed twice in
// the source (src/lib/bugReport.ts had four kinds, Console.tsx five). The set
// is now exported from the lib and imported by the component, and the expected
// rows of the table come from that same export - so the doc cannot describe a
// filter the app does not have, in either direction.
{
  const { PROBLEM_KINDS } = await import('../src/lib/bugReport.ts')
  const expected = [...PROBLEM_KINDS].sort()
  ok('the exported problem-kind set is non-empty', expected.length >= 4, expected.join(', '))

  const testing = read('docs/TESTING.md')
  // The table under the "problems filter" sentence: its rows, in file order,
  // until the first line that is not a row.
  const start = testing.indexOf('The **problems** filter shows only the rows')
  ok('TESTING still introduces the problems table', start >= 0)
  const rows = []
  if (start >= 0) {
    for (const line of testing.slice(start).split('\n')) {
      const m = line.match(/^\|\s*`([a-z_]+)`\s*\|/)
      if (m) rows.push(m[1])
      else if (rows.length) break
    }
  }
  const documented = [...new Set(rows)].sort()
  const missing = expected.filter((k) => !documented.includes(k))
  const extra = documented.filter((k) => !expected.includes(k))
  ok(
    'TESTING’s problem table equals PROBLEM_KINDS',
    missing.length === 0 && extra.length === 0 && documented.length === expected.length,
    `doc [${documented.join(', ')}] vs code [${expected.join(', ')}]${missing.length ? ` - missing ${missing.join(', ')}` : ''}${extra.length ? ` - extra ${extra.join(', ')}` : ''}`,
  )

  // The fork this replaced: a second literal list in the component would pass
  // every check above while drifting again the moment somebody edited one.
  const console_ = read('src/components/layout/Console.tsx')
  ok('Console.tsx imports the set rather than redeclaring it', /import \{[^}]*PROBLEM_KINDS[^}]*\} from '\.\.\/\.\.\/lib\/bugReport\.ts'/.test(console_) && !/^\s*const PROBLEM_KINDS\s*=/m.test(console_))
}

console.log(`\n${checked} checked, ${failed} failed` + (skipped.length ? `, ${skipped.length} not checked` : ''))
if (checked < 12) {
  console.log('REFUSING TO REPORT A RESULT: too few checks ran for a pass to mean anything.')
  process.exit(2)
}
if (skipped.length) {
  console.log(`\nnot checked (a skip is not a pass):`)
  for (const s of skipped) console.log(`  ${s}`)
}
process.exit(failed > 0 ? 1 : 0)
