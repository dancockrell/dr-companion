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
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
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

/**
 * The two trailing spaces before `padEnd` are load-bearing.
 *
 * `doc-claims-break-check.mjs` recovers a check's name from this line by
 * splitting on a run of two or more spaces - the only thing separating the
 * name from its detail column. A name of 58 characters or more used to pad to
 * nothing, glue the detail on after a single space, and hand the negative
 * suite a "name" with the detail welded to it: the sabotage landed, the right
 * check went red, and the harness still reported FAIL because the string did
 * not match. N6 hit that with two checks 57 and 60 characters long, and it
 * reads like the guard is broken rather than the reporting. Appending the
 * separator before padding makes those two spaces unconditional, so a check
 * name may be any length.
 */
const ok = (name, cond, detail = '') => {
  checked++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${`${name}  `.padEnd(60)}${detail}`)
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
// Two statements of the same fact: package.json's `engines.node` and README's
// prose. Before 6 Sep 2026 there was no `engines` field at all, so the README's
// "Node 24 or newer" had nothing to be checked against.
//
// There used to be a third statement and a third check here: every workflow's
// `actions/setup-node`, asserted to read `node-version-file: package.json` and
// never to hand-type a version. That check is gone with its subject. Actions
// was disabled for this repository on 6 Sep 2026 and every workflow deleted,
// so a scan of `.github/workflows` would now find an empty directory - and
// "no workflow hand-types a node-version" is exactly what a scan of nothing
// says, which is the shape of check this file exists to refuse. `engines` is
// the authority and `npm run gate` is what runs against it.
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
    ok('README\u2019s Node claim matches engines.node', claim[1] === engineMajor, `README ${claim[1]}, engines ${engines}`)
  }
}

// --------------------------------------------------------------------------
// I2. There is no CI, and nothing may quietly reintroduce a check that reads
// a workflow.
// --------------------------------------------------------------------------
// The denominator problem this whole file is about, applied to its own
// premise. A suite that scans `.github/workflows` after the directory is gone
// reports "no violations" for a population of zero, and reads identically to
// one that swept five files clean. So rather than leave that trap for a future
// edit to walk into, assert the state directly: the directory is absent, and
// `npm run gate` - the thing that replaced it - exists and is a real script.
//
//   gh api repos/dancockrell/dr-companion/actions/permissions   # enabled: false
{
  ok('there is no workflow directory', !existsSync('.github/workflows'))
  // The control. If `existsSync` were resolving against the wrong working
  // directory, the line above would pass for the wrong reason and so would
  // every other absence check written the same way.
  ok('...and the control says .github itself is still here', existsSync('.github/dependabot.yml'))

  const gate = pkg.scripts?.gate
  ok('package.json declares the local gate', typeof gate === 'string', gate ?? '(absent)')
  ok('the gate runs tools/gate.mjs', /tools[/\\]gate\.mjs/.test(gate ?? ''), gate ?? '')
  ok('tools/gate.mjs exists', existsSync('tools/gate.mjs'))

  /*
   * The merge ritual reaches somebody who is about to merge, and quotes a
   * stage count that is true.
   *
   * #489's fourth finding: `npm run gate` appeared in exactly two documents,
   * neither of which anybody opens before merging, while `AGENTS.md` still
   * told agents to distinguish "pending CI, passing CI" — states that stopped
   * existing when the workflows were deleted. The command existed and the
   * instruction to run it did not reach the person who needed it.
   *
   * `docs/MERGING.md` is now the one copy and the others link to it. The
   * links are asserted rather than trusted, because a pointer to a page is
   * the whole mechanism here: if `CONTRIBUTING.md` stops naming it, the
   * ritual is unreachable again and nothing else would say so.
   *
   * The stage count is the part that rots. Both documents quote a number
   * that lives in `tools/gate.mjs` as `EXPECTED_STAGES`, so this reads that
   * constant and requires the quotes to match it. A lane adding a stage bumps
   * one constant and two documents in the same commit, or this goes red —
   * which is the point: a merger told to look for "7 of 7" on a gate that
   * prints "8 of 8" learns to ignore the line.
   */
  const gateSource = read('tools/gate.mjs')
  const expected = gateSource.match(/^const EXPECTED_STAGES = (\d+)$/m)?.[1]
  ok('tools/gate.mjs declares EXPECTED_STAGES', Boolean(expected), expected ?? '(absent)')
  const contributing = existsSync('CONTRIBUTING.md') ? read('CONTRIBUTING.md') : ''
  ok('CONTRIBUTING.md points at the merge ritual', contributing.includes('docs/MERGING.md'))
  ok('the README indexes it too', read('README.md').includes('docs/MERGING.md'))
  ok('AGENTS.md sends a merger there', read('AGENTS.md').includes('docs/MERGING.md'))
  ok('AGENTS.md no longer names CI states that do not exist', !/pending CI, passing CI/.test(read('AGENTS.md')))
  ok('there is a pull-request template', existsSync('.github/PULL_REQUEST_TEMPLATE.md'))
  if (!expected) {
    notChecked('the merge ritual quotes the gate’s stage count', 'EXPECTED_STAGES did not parse out of tools/gate.mjs')
  } else {
    for (const doc of ['docs/MERGING.md', '.github/PULL_REQUEST_TEMPLATE.md']) {
      const quoted = [...read(doc).matchAll(/(\d+) of (\d+) stages ran/g)]
      ok(`${doc} quotes the gate's summary line`, quoted.length > 0, `${quoted.length} quote(s)`)
      const wrong = quoted.filter((m) => m[1] !== expected || m[2] !== expected)
      ok(
        `${doc} quotes the real stage count (${expected})`,
        wrong.length === 0,
        wrong.map((m) => m[0]).join(', '),
      )
    }
    /*
     * The count appears a second time in `docs/MERGING.md`, bare rather than
     * inside the quoted summary line - the sentence that explains what
     * `EXPECTED_STAGES` is asserted against. The `N of N stages ran` pattern
     * above cannot see it, and it was stale at `10` against a twelve-stage
     * gate: found by a review pass, not by this suite, which was green over it.
     *
     * Any backticked integer on a line naming `EXPECTED_STAGES` is that count.
     * The floor matters as much as the comparison: if a rewording leaves no
     * number beside the constant this goes red naming the absence, because a
     * check whose input has vanished must not report a pass.
     */
    const bare = read('docs/MERGING.md')
      .split(/\r?\n/)
      .filter((line) => line.includes('EXPECTED_STAGES'))
      .flatMap((line) => [...line.matchAll(/`(\d+)`/g)].map((m) => m[1]))
    ok(
      `docs/MERGING.md's bare stage count agrees with EXPECTED_STAGES (${expected})`,
      bare.length > 0 && bare.every((n) => n === expected),
      bare.length ? bare.join(', ') : '(no backticked number on a line naming EXPECTED_STAGES)',
    )
    ok('both name the command that prints it', read('docs/MERGING.md').includes('npm run gate') && read('.github/PULL_REQUEST_TEMPLATE.md').includes('npm run gate'))
  }

  /*
   * V6: gate after the rebase, and the page says so because the gate does it.
   *
   * The rule used to be "run the gate again if the rebase moved anything you
   * did not write" — a judgement call at the moment somebody is most impatient,
   * about a question the rebase output does not answer. It is unconditional
   * now, and the gate enforces it by refusing to call a run current when
   * `origin/main` has moved past the base it recorded.
   *
   * Every claim below is re-derived from `tools/gate.mjs`, never asserted about
   * it. A page describing a refusal the code does not implement is the exact
   * defect this suite exists for, and it would read as reassurance.
   */
  const merging = read('docs/MERGING.md')
  const prTemplate = read('.github/PULL_REQUEST_TEMPLATE.md')
  ok(
    'tools/gate.mjs records the base it ran against',
    /merge-base/.test(gateSource) && /DRC_GATE_BASE\b/.test(gateSource),
    'git merge-base HEAD origin/main, overridable with DRC_GATE_BASE',
  )
  ok(
    'and refuses to call a stale run current, as its own distinct exit',
    /origin\/main is now/.test(gateSource) && /process\.exit\(3\)/.test(gateSource),
    'exit 3, "gate ok (base …) — origin/main is now …"',
  )
  /*
   * Run rather than grepped, and this one earned the distinction the hard way:
   * the first version tested `/--currency/.test(gateSource)`, which the flag's
   * own docstring satisfies. Deleting the `argv.includes('--currency')` dispatch
   * left the check green — a grep matching prose about a feature rather than the
   * feature. `DRC_GATE_NO_FETCH=1` so this asserts the dispatch, not the network.
   */
  let currencyRun
  try {
    // `--only=nonesuch` is a fuse, not a request. If the `--currency` dispatch
    // is intact it exits first and this argument is never parsed; if it has been
    // removed, the unknown-stage refusal exits 2 in milliseconds. Without it,
    // deleting the dispatch makes this suite fall through and run the entire
    // twelve-stage gate — which is what happened the first time, and a test that
    // can start a ten-minute build by accident is its own defect.
    const out = execFileSync(process.execPath, ['tools/gate.mjs', '--currency', '--only=nonesuch'], {
      encoding: 'utf8',
      env: { ...process.env, DRC_GATE_NO_FETCH: '1' },
    })
    currencyRun = { code: 0, out }
  } catch (error) {
    currencyRun = { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
  ok(
    'and the verdict is askable on its own, so all three branches can be run',
    // 0 current, 3 stale, 0 unknown. 1 or 2 means it fell through to the stage
    // machinery, which is what an absent dispatch does.
    (currencyRun.code === 0 || currencyRun.code === 3) &&
      /base [0-9a-f]{8}|could not check whether origin\/main moved/.test(currencyRun.out),
    `node tools/gate.mjs --currency → exit ${currencyRun.code}: ${currencyRun.out.trim().split('\n')[0] ?? '(no output)'}`,
  )
  ok(
    'docs/MERGING.md makes the post-rebase gate unconditional',
    /[Gg]ate after the rebase, not before/.test(merging),
    'the old "run it again if the rebase moved anything you did not write" was a judgement call',
  )
  ok(
    'and quotes the refusal the gate actually prints',
    merging.includes('origin/main is now') && merging.includes('--currency'),
  )
  ok(
    'and the PR template asks about it, since that is what a merger reads',
    prTemplate.includes('exit 3') && /[Rr]ebased on `origin\/main` \*\*first\*\*/.test(prTemplate),
  )
  // The negative control on the pair above. Both are `includes` over a long
  // document, which is satisfied by almost anything; without this, a check that
  // matched every string would read identically to one that found the sentence.
  ok(
    'control: the same reads do not find a sentence that is not there',
    !merging.includes('zzz-not-in-the-merge-ritual') && !prTemplate.includes('zzz-not-in-the-template'),
    'negative control',
  )

  // And the documents that used to send a reader to CI now send them here.
  // A protocol whose pre-merge step names a check nobody runs is worse than
  // one with no step in it, because it reads as covered.
  const plan = read('docs/PLAN_TO_1_0.md')
  ok('the plan names the local gate as the pre-merge requirement', plan.includes('npm run gate'))
  // Not `gh pr checks` outright: the phrase survives in two places on purpose
  // - trap 21, which tells a reader it now reports nothing, and increment C1's
  // record of what was actually done on 5 Sep, which is history and not an
  // instruction. What must not survive is a live instruction to WAIT on
  // checks, because waiting on nothing succeeds instantly and looks like a
  // pass.
  ok('the plan no longer tells anyone to wait on PR checks', !/gh pr checks[^\n]*--watch/.test(plan))
  // The pre-merge ritual specifically. A protocol whose gate is a command
  // nobody runs is worse than one with no gate, because it reads as covered.
  const protocol = plan.slice(plan.indexOf('## 2.'), plan.indexOf('## 3.'))
  ok('the lane protocol found its own section', protocol.length > 500, `${protocol.length} chars`)
  ok('the lane protocol names npm run gate', protocol.includes('npm run gate'))
  // RELEASE.md still names `.github/workflows` - inside the ls-tree command a
  // reader runs to confirm it is empty, which is the point of recording a
  // check rather than a claim. What must not survive is a description of a
  // release that a workflow gates and builds.
  const release = read('docs/RELEASE.md')
  ok('RELEASE.md no longer describes a workflow-gated release', !/release[.]yml|needs: ci|workflow_call/.test(release))
  ok('RELEASE.md names the local gate instead', release.includes('npm run gate'))
  ok('RELEASE.md tells a reader how to confirm there is no CI', release.includes('actions/permissions'))
}

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

// --------------------------------------------------------------------------
// K. The password claim, in both directions.
// --------------------------------------------------------------------------
// Lane N makes this app perform the account login itself
// (docs/LICH_NATIVE_LOGIN.md §5), which turned four written promises false at
// once. This section stops them being written again, and it is the clearest
// case in the file of a claim with an authority to check it against:
//
//   1. the retired sentences must be gone from every document and component;
//   2. the replacement must actually be present, word for word - or (1) is
//      satisfied just as well by saying nothing at all;
//   3. and the sentence's load-bearing half, "not stored", is checked against
//      the persistence layer rather than taken on trust.
{
  /**
   * The sentence docs/PRIVACY.md, LichLauncher.tsx and SettingsSheet.tsx share.
   *
   * It changed on 9 September 2026 with the default it describes. The previous
   * one - "held only in memory, and not stored unless you later ask for it" -
   * is in {@link RETIRED} below rather than merely deleted, because a sentence
   * that was true for three days is exactly the sentence somebody restores
   * while tidying, and it would then be a promise the code does not keep.
   */
  const TRUE_CLAIM = 'and kept in Windows Credential Manager unless you untick the box'

  /**
   * Claims that were true before the app signed players in, and are not now.
   * Each is the literal text that stood in the tree, so a match is a
   * regression rather than a near-miss.
   */
  const RETIRED = [
    'never sent anywhere by this app',
    'never passes through here',
    'never reaches this app at all',
    'never touches the password',
    'never sees your password',
    // Retired 9 Sep 2026 with the default reversal. True while the box was
    // opt-in; false the moment it shipped ticked.
    'not stored unless you later ask for it',
  ]

  // The population is every document above plus every component, because a
  // promise in the UI is read by far more people than a promise in a doc.
  const componentFiles = []
  const walkComponents = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walkComponents(p)
      else if (/\.tsx?$/.test(entry.name)) componentFiles.push(p)
    }
  }
  walkComponents('src/components')
  const population = [...DOCS, 'docs/ENGINE.md', ...componentFiles]
  ok('the password-claim scan found files to read', population.length >= 40, `${population.length} file(s)`)

  // Whitespace-flattened, because the same sentence is wrapped differently in
  // Markdown prose, in a JSX text node and in a comment - and a check that
  // could only see one of the three would be green on the two that matter.
  const flat = (s) => s.replace(/[\s*_`]+/g, ' ')
  const offenders = []
  for (const f of population) {
    const src = flat(read(f))
    for (const phrase of RETIRED) if (src.includes(phrase)) offenders.push(`${f}: "${phrase}"`)
  }
  ok('no document or component still says the app never sees the password', offenders.length === 0, offenders.join('; '))

  // The other direction. Without it, deleting the paragraph passes.
  const saysIt = population.filter((f) => flat(read(f)).includes(TRUE_CLAIM))
  ok('the true sentence is stated where the retired one stood', saysIt.length >= 3, `${saysIt.length} file(s): ${saysIt.join(', ')}`)
  // Matched as a whole section heading, anchored, rather than as a bare
  // substring anywhere in the file. Two reasons: a hostname mentioned in
  // passing is not the same as a described destination, and CodeQL's
  // js/incomplete-url-substring-sanitization rightly flags `.includes(host)`
  // - it cannot tell a documentation check from a URL check, and the anchored
  // form is the better assertion regardless.
  ok(
    'PRIVACY.md gives the account server the password goes to its own section',
    /^### `eaccess\.play\.net`$/m.test(read('docs/PRIVACY.md')),
  )

  // 3. "not stored", against the code rather than the prose. The denominator
  //    is the prefs interface's own field list: if the extractor breaks, "no
  //    password key" is exactly what it reports, and so does a clean file.
  const prefs = read('src/lib/persistence.ts')
  const fields = [...prefs.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1])
  ok('the persisted-preference extractor found fields', fields.length >= 10, `${fields.length} field(s)`)
  const SECRETISH = /pass(word|wd)?$|^pw$|secret|credential/i
  const stored = fields.filter((f) => SECRETISH.test(f))
  ok('no persisted preference is a password', stored.length === 0, stored.join(', ') || `${fields.length} field(s) checked`)

  // Positive control, on a fixture rather than on the tree: the account name
  // is stored and must not be flagged, a password field must be. The real
  // file has no `accountName` yet - N5 adds it with the sign-in screen - so
  // the control is the only thing here that can prove the matcher fires at
  // all, and without it every result above is compatible with a dead regexp.
  const fixture = 'export interface PersistedPrefs {\n  accountName: string\n  password: string\n}\n'
  const fixtureFields = [...fixture.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1])
  const fixtureFlagged = fixtureFields.filter((f) => SECRETISH.test(f))
  ok(
    'the persistence matcher catches a password field, and spares the account name',
    fixtureFields.length === 2 && fixtureFields.includes('accountName') && fixtureFlagged.join(',') === 'password',
    `fixture fields [${fixtureFields.join(', ')}], flagged [${fixtureFlagged.join(', ')}]`,
  )

  // 4. The other half of the same sentence, added with N8.
  //
  //    "Not stored unless you later ask for it" was, until N8, a promise about
  //    a feature that did not exist - which is a true sentence and an
  //    unfalsifiable one, because nothing could ask. Now that something can,
  //    the claim has two halves and both are checkable: that the store exists
  //    and is Credential Manager, and that no *other* store grew alongside it.
  const storeRs = read('src-tauri/src/credential_store.rs')
  const libRs = read('src-tauri/src/lib.rs')
  const COMMANDS = ['credential_store', 'credential_has', 'credential_forget']
  ok(
    'the three credential commands are registered',
    COMMANDS.every((c) => libRs.includes(`credential_store::${c}`)),
    COMMANDS.join(', '),
  )
  // The direction that finds things: a *fourth* command here would be a way
  // out for the password that nobody described. There is no `credential_read`
  // and there must not be, because a command's result has to be Serialize and
  // `Secret` deliberately is not.
  const declared = [...storeRs.matchAll(/#\[tauri::command\]\s*\npub fn ([a-z_]+)/g)].map((m) => m[1]).sort()
  ok(
    'the credential module exposes exactly those three and no reader',
    declared.join(',') === [...COMMANDS].sort().join(','),
    declared.join(', ') || 'none - the extractor is broken, not the file',
  )
  // "And nothing else" is a claim about code, not about prose - the module's
  // own doc comment says the words "settings file" precisely to rule one out,
  // so a substring check on the whole file would fail on the sentence that
  // makes the promise. Strip comments first, then look for a write.
  const storeCode = storeRs
    .split('#[cfg(test)]')[0]
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
  const otherStores = ['fs::write', 'File::create', 'serde_json', 'OpenOptions'].filter((w) =>
    storeCode.includes(w),
  )
  ok(
    'the store is Windows Credential Manager and nothing else',
    /Windows Credential Manager/.test(storeRs) && otherStores.length === 0,
    otherStores.join(', ') || 'no file write in the credential module',
  )
  ok(
    'that write matcher is not matching nothing',
    ['fs::write', 'File::create'].some((w) => `std::${w}(path)`.includes(w)),
  )
  // And the documents say so, in both directions: the box is off by default,
  // and there is a way to undo it. A privacy note that described only the
  // storing half would be the more comfortable one to write.
  const privacy = read('docs/PRIVACY.md').replace(/\s+/g, ' ')
  // The direction that changed. This check used to read `box is off every
  // time`; asserting the *new* default rather than deleting the check is what
  // stops the reversal being silently reversed again.
  ok('PRIVACY.md says the remember box is ticked by default', /ticked by default/.test(privacy))
  ok('PRIVACY.md says unticking it deletes what is stored', /unticking it deletes what is stored at once/.test(privacy))
  ok('PRIVACY.md says how to un-ask', /Forget control/.test(privacy))
  ok(
    'PRIVACY.md tells the reader who else on the machine could read it',
    privacy.includes('Anyone signed in to this Windows account can use it.'),
  )
  // No second store, checked against the key inventory rather than the prefs
  // interface: `persistence.ts` is one writer, and a credential could equally
  // arrive as a bare localStorage key.
  const keyNames = []
  const walkSrc = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walkSrc(p)
      else if (/\.tsx?$/.test(entry.name)) {
        for (const m of read(p).matchAll(/\b([A-Z][A-Z0-9_]*KEY) = '([^']+)'/g)) keyNames.push(m[2])
      }
    }
  }
  walkSrc('src')
  ok('the storage-key scan found keys', keyNames.length >= 15, `${keyNames.length} key(s)`)
  const secretKeys = keyNames.filter((k) => SECRETISH.test(k))
  ok('no storage key is a credential', secretKeys.length === 0, secretKeys.join(', ') || `${keyNames.length} checked`)
  ok(
    'that key matcher would catch one',
    SECRETISH.test('drc.accountPassword') && !SECRETISH.test('drc.accountName'),
  )
}


// --------------------------------------------------------------------------
// L. No user-facing string or document tells anybody to configure the retired
//    client. (N6)
// --------------------------------------------------------------------------
// The Genie route is gone: the app performs the account login itself and starts
// Lich with the result (`docs/LICH_NATIVE_LOGIN.md`). Four components and two
// documents used to print the commands for setting that client up instead, and
// deleting them is only half the job - the half a person does once. This is the
// half that holds, because an instruction for a route the app no longer takes
// reads as current advice and sends a player somewhere that cannot work.
//
// # What is in the population, and why the exclusions are not loopholes
//
// Scoped to what a *player* can reach: everything under `src/`, the shipped
// documents in `DOCS`, and `docs/BRIDGE_CONTRACT.md`. Deliberately not the
// whole tree, because four files legitimately contain these strings and a
// guard that failed on them would be telling the truth about the string while
// lying about the claim:
//
//   - `docs/LICH_NATIVE_LOGIN.md` and `docs/PLAN_TO_1_0.md` name the verbs
//     because they *record the decision to retire them*.
//   - `docs/ENGINE.md` and `docs/LIVE-STATE.md` quote `--genie` out of Lich's
//     own `login_helpers.rb`, describing what Lich's flag does. Not advice.
//   - `src-tauri/src/lich.rs` asserts `--genie` is absent from the argument
//     list; the test needs the string to test for it.
//   - `docs/DOMAIN.md` is a research log of community traffic, marked as
//     history at its section 22, kept verbatim because its value is the record.
//
// Every one of those describes the route. None of them tells a player to take
// it, which is the property this check is for.
{
  /** Instructions a player must never be given again, and why each is dead. */
  const RETIRED_INSTRUCTIONS = [
    ['#lichconnect', 'the connect command for a client this app no longer routes through'],
    ['licharguments', 'its config verb for Lich arguments'],
    ['#config lichpath', 'its config verb for the Lich path'],
    ['--genie', 'the frontend flag; it drops the streams capability the channel tabs need'],
    // The one that survived N5 in three components: they printed a comma
    // prefix for a route the app no longer takes. Lich runs headless here, so
    // the character is `;` (`main.rb:58`) - see `frontends.ts`'s `prefixFor`.
    [',companion_bridge', 'the comma-prefixed bridge command; this app is headless, so it is `;`'],
  ]

  const scanned = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(tsx?|md)$/.test(entry.name)) scanned.push(p)
    }
  }
  walk('src')
  const population = [...scanned, ...DOCS, 'docs/BRIDGE_CONTRACT.md']

  // The denominator. A walk that returned nothing finds no instructions for
  // exactly the same reason a clean tree does. Well below the real count on
  // purpose: a tripwire for an empty or truncated walk, not a file census.
  ok('the retired-instruction scan found files to read', population.length >= 100, `${population.length} file(s)`)

  /** Every hit, as `file:line: needle`, so a failure is actionable as it stands. */
  const scan = (files) => {
    const hits = []
    for (const f of files) {
      const lines = read(f).split('\n')
      for (let i = 0; i < lines.length; i++) {
        for (const [needle] of RETIRED_INSTRUCTIONS) {
          if (lines[i].includes(needle)) hits.push(`${f}:${i + 1}: ${needle}`)
        }
      }
    }
    return hits
  }

  /**
   * Files inside the scanned tree that legitimately name a needle, each with
   * the reason, because an unexplained exemption is how a real regression gets
   * waved through.
   *
   * One entry, and it arrived from N4 rather than being written with this
   * check: `frontends.ts` describes Lich's *own* argument parser - which flags
   * `determine_frontend` accepts and which only `resolve_headless_frontend`
   * honours - and `--genie` is one of the facts it is describing. That is the
   * same category as `src-tauri/src/lich.rs`, which asserts the flag is absent
   * and needs the string in order to test for it. Describing a flag is not
   * instructing a player to pass it.
   *
   * The exemption is by file and not by line, and it is checked in both
   * directions below: a file listed here that no longer contains a needle is a
   * stale exemption and fails, the same way `tools/color-token-allowlist.json`
   * refuses an entry that no longer matches.
   */
  const EXEMPT = new Map([
    [
      'src/lib/frontends.ts',
      "doc comments describing Lich's own argument parser, not instructions",
    ],
  ])
  const norm = (h) => h.replace(/\\/g, '/')
  const allHits = scan(population).map(norm)
  const exemptHit = (h) => [...EXEMPT.keys()].some((f) => h.startsWith(`${f}:`))
  const found = allHits.filter((h) => !exemptHit(h))
  ok(
    'no shipped string or document instructs the retired route',
    found.length === 0,
    found.join('; ') ||
      `${allHits.length - found.length} exempt hit(s) in ${EXEMPT.size} file(s)`
  )
  // A stale exemption is worse than none: it spends a reader's attention and
  // quietly widens the hole. Every file listed must still contain a needle.
  const staleExemptions = [...EXEMPT.keys()].filter(
    (f) => !allHits.some((h) => h.startsWith(`${f}:`))
  )
  ok(
    'every retired-instruction exemption still earns itself',
    staleExemptions.length === 0,
    staleExemptions.join(', ') || [...EXEMPT.values()].join('; ')
  )

  // The positive control, through the same `scan` the real check uses - not a
  // re-implementation of it, which would leave `scan` itself unproven. The
  // fixture carries all five needles on five lines, so a needle added to the
  // table without being added here fails the control instead of passing
  // silently.
  const FIXTURE = 'tools/fixtures/retired-instructions.md'
  const controlHits = scan([FIXTURE])
  ok(
    'control: the scan catches a fixture that does instruct it',
    controlHits.length === RETIRED_INSTRUCTIONS.length,
    `${controlHits.length}/${RETIRED_INSTRUCTIONS.length}: ${controlHits.join('; ')}`
  )
  // And that the control is reading real line numbers rather than always
  // saying 1, which is what a broken splitter would produce.
  ok(
    'control: and reports distinct line numbers',
    new Set(controlHits.map((h) => h.split(':')[1])).size === RETIRED_INSTRUCTIONS.length,
    controlHits.map((h) => h.split(':')[1]).join(',')
  )
  const clean = 'Sign in on the first screen and the app starts Lich for you.'
  ok(
    'control: and spares a line that does not',
    RETIRED_INSTRUCTIONS.every(([n]) => !clean.includes(n))
  )

  // ------------------------------------------------------------------
  // The editor, which was a whole feature rather than a string.
  // ------------------------------------------------------------------
  // N6 deleted the sheet that read and wrote a Genie install's own
  // `Config\*.cfg` files - highlights, aliases, macros, presets, substitutes,
  // gags, variables - because an editor for a program the app no longer routes
  // through is a promise it cannot keep. The strings above would not have
  // caught it: none of them appeared in that editor. So this asserts the
  // shape rather than the wording.
  //
  // `write_genie_config` no longer survives at all. **This check was turned
  // the right way up a second time on 6 Sep 2026 (Q5).** It used to assert
  // that `saveGenieConfig` had exactly one caller, the pin export - the
  // strongest thing available while a Genie write path still existed. Q5
  // deleted that path outright (`docs/PLAYER_CONFIG.md` section 8, question
  // N-c: the player's own files are app data), so the property is now the
  // stronger one the old check was approximating: **nothing in this app names
  // a Genie writer, and the module that wrapped one is gone.**
  //
  // A one-caller check left standing after the caller was deleted would pass
  // forever, including on the day somebody reintroduced the writer with one
  // caller. That is the shape of a check that cannot fail.
  //
  // **This check changed shape on 6 Sep 2026 (Q1), and the change is worth
  // reading before trusting either version.** It used to assert that
  // `src/components/config` did not exist. That was right while no config
  // editor was allowed at all, and it encoded the mechanism rather than the
  // property: the name says "no editor writes into a Genie install" and the
  // body said "no directory of that name". Lane Q builds an editor for the
  // app's *own* rules in exactly that directory, so the old body would have
  // had to be deleted to make the increment pass, which is the shape of a test
  // being edited to fit a change rather than judging it. It is turned the
  // right way up instead: the directory may exist, and nothing in it may write
  // to a Genie install.
  const configEditor = scanned
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f.startsWith('src/components/config/'))
  ok(
    'the config editor writes the app store, never a Genie install',
    configEditor.every((f) => !/saveGenieConfig|write_genie_config/.test(read(f))),
    configEditor.length ? `${configEditor.length} file(s) checked` : 'no config editor present'
  )
  ok(
    'control: the scan can see the config editor that is there',
    !existsSync('src/components/config') || configEditor.length >= 1,
    `${configEditor.length} files under src/components/config`
  )
  // `scanned` came from `join`, so it carries this platform's separator.
  // Normalise before comparing, or the check passes or fails by OS.
  const normalised = scanned.map((f) => f.replace(/\\/g, '/'))
  const hits = (needle) => normalised.filter((f) => read(f).includes(needle))
  /** Every hit as `file:line`, so a failure is actionable exactly as printed
   *  rather than sending the reader to grep a file for it. */
  const locate = (needle) => {
    const found = []
    for (const f of normalised) {
      read(f)
        .split('\n')
        .forEach((line, i) => {
          if (line.includes(needle)) found.push(`${f}:${i + 1}`)
        })
    }
    return found
  }

  const writers = locate('saveGenieConfig').concat(locate('write_genie_config'))
  ok(
    'nothing in this app writes into a Genie install',
    writers.length === 0,
    writers.join(', ') || 'nothing names a Genie writer'
  )
  ok(
    'the module that wrapped the Genie writer is gone',
    !existsSync('src/lib/genieConfigWrite.ts'),
    existsSync('src/lib/genieConfigWrite.ts') ? 'it is still there' : 'deleted'
  )
  // Control for both. An absence check over a scan that returned nothing, or
  // over a `read` that hands back empty strings, is green for the same reason
  // a clean tree is - so prove the same scan can still see a symbol that is
  // genuinely there, in the very module the writers used to live beside.
  ok(
    'control: the same scan finds the module that replaced it',
    hits('writePlayerFile').length >= 2 && existsSync('src/lib/playerFiles.ts'),
    hits('writePlayerFile').join(', ') || 'nothing names writePlayerFile'
  )

  // The read side survives, and this is what keeps it from becoming a way
  // back in: `read_genie_config` may be invoked from exactly one place, the
  // config importer. It is how a player brings years of `#highlight` lines
  // across, and it is a read - but a second invocation site appearing is how
  // a Genie route grows back, one leaf at a time.
  //
  // The needle is the invocation, not the name: half a dozen module headers
  // say `read_genie_config` while describing what they stopped doing, and
  // counting those would make this check fail on a comment.
  const CALL = "invokeTauri('read_genie_config'"
  const readers = hits(CALL)
  ok(
    'exactly one module invokes read_genie_config, and it is the config importer',
    readers.length === 1 && readers[0] === 'src/components/config/PlayerConfigPanel.tsx',
    locate(CALL).join(', ') || 'nothing invokes it'
  )
  // Positive control on a symbol that genuinely has two call sites. Without
  // it, `readers.length === 1` is equally satisfied by a counter that can
  // only ever return 0 or 1 - and the check above would then be measuring
  // its own arithmetic rather than the tree.
  //
  // The control used `exportPinsToFile(`, whose two callers were `MapPanel`
  // and `MapWindow`. Both were deleted with the map (docs/NO-3D.md), so the
  // control silently went to zero - it went red, which is the point of
  // having it: a control that had quietly become a second one-site symbol
  // would have passed while proving nothing. `openPanelWindow(` is the
  // replacement.
  //
  // "More than one", not "exactly two". The property this control needs is
  // that the counter is not stuck at 0-or-1, and pinning it to a number made
  // it a second, accidental assertion about how many places open a panel
  // window - which went red the day the icon bar became one of them, saying
  // nothing about the counter. A control that fails for reasons unconnected
  // to what it controls is a control people learn to edit rather than read.
  const manyCallers = hits('openPanelWindow(').filter((f) => f !== 'src/lib/panelWindows.ts')
  ok(
    'control: the same counter reports more than one call site when there is more than one',
    manyCallers.length > 1,
    `${manyCallers.length}: ${manyCallers.join(', ') || 'found none'}`
  )
}


// --------------------------------------------------------------------------
// M. No surviving 3D instruction anywhere an agent reads. (V7, and V3's half)
// --------------------------------------------------------------------------
// `docs/NO-3D.md` states the whole reason this check exists, in its own words:
// a surviving 3D document keeps producing the behaviour after the direction is
// gone. A session opened `THREE_D_REBUILD_HANDOFF.md`, found a document headed
// "approved direction; ready for parallel implementation", and started building
// against it long after the decision had reversed. Prose is not a tidying
// matter here. It is the failure mode, and deleting it once is the half a
// person does once.
//
// # What is in the population
//
// Everything an agent reads for direction: `docs/`, `.claude/`, `.agents/`,
// `AGENTS.md`, `CLAUDE.md`, `README.md` — plus, for V3, the Godot project's own
// config, where an `include_filter` naming three `.glb` files was a *live* 3D
// reference rather than a dead sentence about one.
//
// # Three states, and the third is where the honesty is
//
// A hit is live direction, or it is history, or it is a restatement of the
// cancellation itself. Only the first is a failure, and the other two are
// printed rather than swallowed — an allowance nobody sees is an allowance
// nobody re-reads.
//
// History is recognised four ways, in descending order of how much it excuses:
//
//   1. `docs/NO-3D.md` and `docs/verification/**`. The direction, and dated
//      records of what was run on a day. Both are history by construction.
//   2. A file-level marker in the first 40 lines: `no-3d-file-history: <why>`
//      in prose, or a top-level `"no-3d-file-history"` key in JSON. For a
//      document that is entirely a record — a completed claim, a superseded
//      design, a dated state snapshot. Capped, and every use printed.
//   3. Inside `docs/PLAN_TO_1_0.md` only, an increment or section whose own
//      block carries `superseded:`, `gone:` or the `[-]` marker. The plan
//      already has that vocabulary and §0.1 defines it; a second marker
//      meaning the same thing would be a fork of it.
//   4. An inline `no-3d-history:` or `no-3d-direction: <why>`, good for the
//      thirty lines after it. `no-3d-direction` is for prose that restates the
//      prohibition where the reader is — the plan's own header does this.
//
// Every marker's reason is mandatory. A bare `no-3d-file-history:` excuses
// nothing, which is checked below against a synthetic string rather than hoped
// for.
//
// # N of N
//
// The counts are printed and the floors asserted before any verdict, because a
// grep pointed at a directory that does not exist finds no 3D instruction for
// exactly the same reason a clean repository does. A zero is a claim about the
// instrument first.
{
  const NEEDLE =
    /\b3-?D\b|\bglb\b|\bgltf\b|\bmesh(es)?\b|\brigg(ing|ed)\b|WorldRoot|content_registry|primitive-world|geometric-kit|geometry kits?/i

  /** Roots an agent reads for direction. */
  const ROOTS = ['docs', '.claude', '.agents', 'AGENTS.md', 'CLAUDE.md', 'README.md']
  /** And V3's half: the Godot project's config, where a 3D reference is live. */
  const GODOT_CONFIG = ['godot/project.godot', 'godot/export_presets.cfg', 'godot/README.md']
  const READABLE = /\.(md|json|txt|ya?ml|godot|cfg)$/

  // Floors, well below the real counts, so a walk that returned little fails
  // instead of certifying a clean tree. They do not need touching as docs grow.
  const MIN_FILES = 60
  const MIN_HITS = 20

  // Ceilings on the allowances, the mirror of the floors. They may shrink.
  const MAX_FILE_HISTORY = 40
  const MAX_INLINE = 5

  // The optional quotes around the colon are what let one marker live in a
  // JSON record as a key (`"no-3d-file-history": "…"`) and in prose as an HTML
  // comment. Without them the JSON form never matched, and sixteen marked claim
  // files stayed red while looking marked — the marker was there, the check
  // could not see it, and nothing said which.
  const MARKER_FILE = /no-3d-file-history"?[ \t]*:[ \t]*"?(\S[^\n"]*)/i
  const MARKER_INLINE = /no-3d-(?:history|direction)"?[ \t]*:[ \t]*"?(\S[^\n"]*)/i
  const MARKER_WINDOW = 30
  const HISTORY_BLOCK = /superseded|gone:|\[-\]|no-3d-(?:history|direction):/i

  /*
   * The fifth allowance, and the one that keeps the other four from drowning in
   * markers: a sentence that names 3D *and* says it is over.
   *
   * NO-3D.md asks every document to say plainly that 3D is cancelled. Doing that
   * trips a grep for `3D` — every honest sentence about the removal does.
   * Requiring a hand-placed marker on each would put about fifty of them into
   * prose, and a marker on every second line is a marker nobody reads.
   *
   * So a line carrying a 3D noun beside a cancellation verb is counted as a
   * *statement of the cancellation* rather than as an instruction. It is not
   * silently excused: the category has its own ceiling, its own count, and a
   * per-file breakdown printed on every run, so if it starts growing somebody
   * is looking at where.
   *
   * The hole this leaves, stated rather than left to be found: "the 3D pipeline
   * was deleted; rebuild it in Godot" would pass. Nobody has written that, and
   * the markers above are what a genuinely ambiguous line should use.
   * `docs/SCENE_ART.md` is the near miss that shaped this — it read "New board
   * production follows the world-board strategy, using reusable geometry kits",
   * which is live 3D direction *linking to NO-3D.md*, and carries no
   * cancellation verb, so it is caught rather than waved through.
   */
  const CANCELLED =
    /\bcancell?ed\b|\bdelet(e|ed|es|ion)\b|\bremov(e|ed|es|al)\b|\bgone\b|\bretired?\b|\bsuperseded\b|\bno longer\b|\bnever\b|\bused to\b|\bnot 3-?D\b|\bwas the\b|\bwere the\b/i

  const walk = (p, out) => {
    if (!existsSync(p)) return out
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name).replace(/\\/g, '/')
      if (entry.isDirectory()) walk(full, out)
      else if (READABLE.test(entry.name)) out.push(full)
    }
    return out
  }
  const population = []
  for (const r of ROOTS) {
    if (!existsSync(r)) continue
    if (statSync(r).isDirectory()) walk(r, population)
    else population.push(r)
  }
  for (const f of GODOT_CONFIG) if (existsSync(f)) population.push(f)

  ok(
    'the 3D sweep found an instruction surface to read',
    population.length >= MIN_FILES,
    `${population.length} file(s) under ${ROOTS.join(', ')} + ${GODOT_CONFIG.length} Godot config file(s), floor ${MIN_FILES}`,
  )

  /** The plan's blocks: an increment bullet or a heading starts one. */
  const planBlocks = (lines) => {
    const starts = []
    for (let i = 0; i < lines.length; i++) {
      if (/^- \[[ x!~-]\] /.test(lines[i]) || /^#{2,4} /.test(lines[i])) starts.push(i)
    }
    return (index) => {
      let from = 0
      for (const s of starts) {
        if (s <= index) from = s
        else return lines.slice(from, s).join('\n')
      }
      return lines.slice(from).join('\n')
    }
  }

  const live = []
  const asHistory = []
  const asRestatement = []
  const asCancellation = []
  const fileHistoryFiles = []
  let hits = 0

  for (const file of population) {
    const text = read(file)
    const lines = text.split('\n')
    const head = lines.slice(0, 40).join('\n')
    const fileMarker = head.match(MARKER_FILE)
    const implicit =
      file === 'docs/NO-3D.md'
        ? 'the direction itself'
        : file.startsWith('docs/verification/')
          ? 'a dated record of what was run'
          : null
    const blockFor = file === 'docs/PLAN_TO_1_0.md' ? planBlocks(lines) : null

    for (let i = 0; i < lines.length; i++) {
      // `NO-3D` is a filename, not a 3D reference. Stripped before matching, or
      // every pointer at the direction reads as a violation of it.
      const line = lines[i].replace(/NO-?3D/gi, 'NOTHREED')
      if (!NEEDLE.test(line)) continue
      hits += 1
      const where = `${file}:${i + 1}`
      if (implicit) {
        asHistory.push(`${where}  ${implicit}`)
        continue
      }
      if (fileMarker) {
        asHistory.push(`${where}  file history: ${fileMarker[1].trim()}`)
        if (!fileHistoryFiles.includes(file)) fileHistoryFiles.push(file)
        continue
      }
      if (blockFor && HISTORY_BLOCK.test(blockFor(i))) {
        asHistory.push(`${where}  in a superseded/gone block`)
        continue
      }
      const near = lines.slice(Math.max(0, i - MARKER_WINDOW), i + 1).join('\n')
      const inline = near.match(MARKER_INLINE)
      if (inline) {
        asRestatement.push(`${where}  ${inline[1].trim()}`)
        continue
      }
      if (CANCELLED.test(line)) {
        asCancellation.push(where)
        continue
      }
      live.push(`${where}  ${lines[i].trim().slice(0, 150)}`)
    }
  }

  ok(
    'and it found 3D language to judge',
    hits >= MIN_HITS,
    `${hits} hit(s) across the surface, floor ${MIN_HITS} — a sweep that matched nothing would ` +
      `report a clean repo for the same reason a clean repo does`,
  )

  // The controls. Each is a synthetic string, so they hold whether or not the
  // tree happens to be clean today.
  const plantedLive = 'the 3D viewer renders the room'
  const plantedHistory = 'superseded: 2026-09-09 — 3D cancelled; the viewer is gone'
  ok(
    'control: the needle sees a planted instruction',
    NEEDLE.test(plantedLive.replace(/NO-?3D/gi, 'NOTHREED')),
    plantedLive,
  )
  ok(
    'control: and a history line is still a hit, excused by its block rather than unseen',
    NEEDLE.test(plantedHistory) && HISTORY_BLOCK.test(plantedHistory),
    'a rule that stopped matching history would also stop matching instruction',
  )
  ok(
    'control: a pointer at NO-3D.md is not itself a 3D reference',
    !NEEDLE.test('see docs/NO-3D.md for the direction'.replace(/NO-?3D/gi, 'NOTHREED')),
    'negative control',
  )
  const bare = 'no-3d-file-history:'
  const withWhy = 'no-3d-file-history: a completed claim, kept as a record'
  ok(
    'control: a marker without a reason excuses nothing',
    !MARKER_FILE.test(bare) && MARKER_FILE.exec(withWhy)?.[1].startsWith('a completed claim'),
    'the reason is what makes an allowance arguable later',
  )

  ok(
    `${fileHistoryFiles.length} file(s) marked wholly historical, at or below the ceiling of ${MAX_FILE_HISTORY}`,
    fileHistoryFiles.length <= MAX_FILE_HISTORY,
    fileHistoryFiles.length ? fileHistoryFiles.slice(0, 4).join(', ') + (fileHistoryFiles.length > 4 ? ', …' : '') : 'none',
  )
  ok(
    `${asRestatement.length} inline allowance(s), at or below the ceiling of ${MAX_INLINE}`,
    asRestatement.length <= MAX_INLINE,
    asRestatement.map((r) => r.split('  ')[0]).join(', ') || 'none',
  )
  // Printed every run, both of them, because an allowance nobody sees is one
  // nobody argues with.
  for (const r of asRestatement) console.log(`     ALLOWED marked  ${r}`)

  // The cancellation-verb category, capped and broken down by file. A ceiling
  // rather than a floor, so it can shrink freely and cannot quietly become the
  // way everything gets excused.
  const MAX_CANCELLATION = 90
  const perFile = new Map()
  for (const c of asCancellation) {
    const f = c.slice(0, c.lastIndexOf(':'))
    perFile.set(f, (perFile.get(f) ?? 0) + 1)
  }
  ok(
    `${asCancellation.length} line(s) state the cancellation rather than instruct, ceiling ${MAX_CANCELLATION}`,
    asCancellation.length <= MAX_CANCELLATION,
    [...perFile].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(', ') || 'none',
  )

  ok(
    'no live 3D instruction survives on the instruction surface',
    live.length === 0,
    `${hits} hit(s): ${asHistory.length} history, ${asRestatement.length} restatement, ${live.length} live` +
      (live.length ? ` — first: ${live[0]}` : ''),
  )
  for (const l of live.slice(0, 20)) console.log(`     LIVE 3D  ${l}`)
  if (live.length > 20) console.log(`     ...and ${live.length - 20} more`)

  // V3's half, stated separately because it is a different kind of claim: not
  // prose about 3D but a config that would *load* a model.
  const godotConfig = GODOT_CONFIG.filter((f) => existsSync(f)).map((f) => ({ f, text: read(f) }))
  const assetRefs = godotConfig.flatMap(({ f, text }) =>
    text
      .split('\n')
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /\.(glb|gltf)\b/i.test(line) && !/no-3d-history:/i.test(line))
      .map(({ line, i }) => `${f}:${i + 1}: ${line.trim().slice(0, 120)}`),
  )
  ok(
    'the Godot project config names no model file',
    godotConfig.length === GODOT_CONFIG.length && assetRefs.length === 0,
    godotConfig.length === GODOT_CONFIG.length
      ? `${godotConfig.length} config file(s) read, ${assetRefs.length} .glb/.gltf reference(s)`
      : `only ${godotConfig.length} of ${GODOT_CONFIG.length} config files exist — this checked less than it claims`,
  )
  for (const r of assetRefs) console.log(`     MODEL REF  ${r}`)
  // The control on that one, for the same reason as the include_filter parser
  // in tools/export-godot-viewer.mjs: "no .glb found" and "the pattern stopped
  // matching" are the same observation.
  ok(
    'control: the model-file pattern matches one when shown one',
    /\.(glb|gltf)\b/i.test('include_filter="kit/rock_smallA.glb"'),
    'negative result and absent instrument are otherwise identical',
  )
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
