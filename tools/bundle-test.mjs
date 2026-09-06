/**
 * Checks the production bundle can actually reach the native layer.
 *
 *   npm run build && node tools/bundle-test.mjs
 *
 * Why this exists.
 *
 * The Tauri API used to be imported through `new Function('m', 'return
 * import(m)')`, to keep a web build from needing the package. Vite cannot see
 * a specifier hidden in a string, so it never bundled it, and a browser cannot
 * resolve a bare specifier by itself. Under `npm run dev` it worked, because
 * the dev server resolves those on request. In every packaged build every
 * native command failed.
 *
 * The app shipped that way and looked fine. Detection returned nothing, the
 * setup screen read nothing as "nothing required", and printed "Ready".
 *
 * Nothing in tsc, eslint or `cargo check` can catch that: it is only wrong at
 * runtime, only in a real build, and only because of a string. So the built
 * output gets read directly.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = 'dist/assets'
let fails = 0
let notChecked = 0

// Three states, not two. `ok === 'unknown'` means the check could not be
// carried out - an input that is not there, a construct the reader does not
// model - and it prints NOT CHECKED rather than either colour. Folding that
// into a pass is where a suite starts lying: an absent result and a negative
// one are indistinguishable unless they are made to print differently, and it
// is the absent one that looks like success. `tools/run-tests.mjs` reads the
// words NOT CHECKED out of this output and refuses to say "all passed" over a
// suite that printed them.
function check(label, ok, detail = '') {
  const tag = ok === 'unknown' ? 'NOT CHECKED' : ok ? 'OK  ' : 'FAIL'
  console.log(`${tag} ${label}${detail ? `: ${detail}` : ''}`)
  if (ok === 'unknown') notChecked++
  else if (!ok) fails++
}

let files
try {
  files = readdirSync(DIST).filter((f) => f.endsWith('.js'))
} catch {
  console.log(`FAIL no ${DIST}. Run "npm run build" first.`)
  process.exit(1)
}
const bundle = files.map((f) => readFileSync(join(DIST, f), 'utf8')).join('\n')

console.log('-- bundle report and startup budgets --')
const sizes = files.map((file) => {
  const bytes = statSync(join(DIST, file)).size
  const gzip = gzipSync(readFileSync(join(DIST, file))).length
  return { file, bytes, gzip }
}).sort((a, b) => b.bytes - a.bytes)
const main = sizes.find(({ file }) => /^index-[^.]+\.js$/.test(file))
const total = sizes.reduce((sum, file) => sum + file.bytes, 0)
for (const file of sizes.slice(0, 10)) {
  console.log(`${file.file.padEnd(42)} ${(file.bytes / 1024).toFixed(1).padStart(8)} KiB raw  ${(file.gzip / 1024).toFixed(1).padStart(7)} KiB gzip`)
}
console.log(`total JavaScript: ${(total / 1024).toFixed(1)} KiB raw`)
check('a startup entry chunk was identified', Boolean(main))
// Budgets bumped 2026-09-02 alongside lucide-react 0.511.0 -> 1.37.0 (this
// PR) - re-measured at 1,784,679 / 437,359 bytes with every icon this app
// actually imports unchanged, confirmed by isolating lucide-react alone
// (install just that bump on top of the prior lockfile: same numbers).
// The increase is lucide-react's own per-icon asset weight in the new
// major version, not a regression in this app's code. Same tight-headroom
// convention as the numbers they replace.
check('startup entry stays below the measured 1.8 MB raw budget', Boolean(main && main.bytes <= 1_800_000), main ? `${main.bytes} bytes` : 'missing')
check('startup entry stays below the measured 445 kB gzip budget', Boolean(main && main.gzip <= 445_000), main ? `${main.gzip} bytes` : 'missing')
// `ConfigManagerSheet` was in this list until N6 deleted the Genie config
// editor. Dropped rather than kept as a name that can never match: a surface
// that does not exist cannot fail to be code-split, so leaving it here would
// have turned a real budget check into one permanent red line nobody could
// clear, which is the same wasted attention as a check that cannot fail.
for (const surface of ['SetupWizard', 'SettingsSheet', 'ReportDialog', 'ScriptEditor', 'SoundControls']) {
  check(`${surface} remains an asynchronous chunk`, sizes.some(({ file }) => file.startsWith(`${surface}-`)))
}

console.log('')

console.log('-- the native API must be bundled, not left as a bare specifier --')

// The check is simply: does the specifier appear at all?
//
// When Vite resolves the import it inlines the module and the string vanishes
// — verified, a correct build contains zero occurrences of "@tauri-apps". If
// the text is still there, something is planning to resolve it at runtime, and
// a browser cannot.
//
// The first version of this check looked for `import("@tauri-apps/...")` and
// would have missed the actual bug, because minification had rewritten the
// call to `n("@tauri-apps/api/core")` through the Function-built importer. The
// failure demonstration below is what caught that.
const bare = [...bundle.matchAll(/.{0,30}@tauri-apps\/[^`'"]*.{0,10}/g)]
check(
  'the specifier is resolved away, not left for the browser',
  bare.length === 0,
  bare.length ? bare.slice(0, 2).map((m) => m[0]).join(' | ') : ''
)

// The Function-constructor trick is the specific thing that hid it. Catch the
// pattern itself, so a future "clever" reintroduction fails here and not on a
// user's machine.
check(
  'no dynamic import through new Function',
  !/new Function\(\s*[`'"]m[`'"]\s*,\s*[`'"]return import\(m\)[`'"]/.test(bundle)
)

// And the positive check: the real thing has to be in there. `invoke` posts to
// this global; if the package were missing entirely, so would this string be.
check(
  'the Tauri invoke path is present in the bundle',
  bundle.includes('__TAURI_INTERNALS__') && /invoke/.test(bundle)
)

console.log('')
console.log('-- and the checks can fail, shown against the bundle that shipped --')

// Verbatim from the minified output of the broken build. A check that has
// never been seen to fail is a check nobody should trust, and this one guards
// a bug whose entire symptom was looking fine.
const SHIPPED_BROKEN = 'const n=new Function(`m`,`return import(m)`);' +
  'try{return await(await n(`@tauri-apps/api/core`)).invoke(e,t)}catch(r){' +
  'console.warn(`Tauri invoke failed`,e,r);return}'

check(
  'the specifier check matches the real broken output',
  /@tauri-apps\//.test(SHIPPED_BROKEN)
)
check(
  'the new Function check matches the real broken output',
  /new Function\(\s*[`'"]m[`'"]\s*,\s*[`'"]return import\(m\)[`'"]/.test(
    SHIPPED_BROKEN
  )
)

console.log('')
console.log('-- the exported viewer, and where the installer puts it --')

// The bug this guards has no error message anywhere. The installer bundles the
// viewer to one path and `viewer::viewer_candidates` looks for it at another,
// so the app reports "not built yet" while the exe is sitting in the install
// directory. Nothing fails, nothing logs, and there is no string to grep.
//
// The destination is read out of the release config this repository actually
// builds installers from, rather than restated here from memory: a second
// spelling of the path is the very drift being checked for.
const VIEWER_BUILD = 'godot/build/DRCompanionWorldViewer.exe'
const RELEASE_CONF = 'src-tauri/tauri.release.conf.json'

// This branch used to be skipped outright on any machine without a Godot
// export - which is every developer machine and most CI jobs, so the check
// that stops the installer bundling the viewer where `viewer.rs` never looks
// had, in practice, never run.
//
// It does not need a real export. The generator decides whether to emit the
// viewer entry purely on whether a file exists at the viewer path, and the
// entry it emits is a pair of constants, so a stand-in file exercises the
// exact mapping that ships. `DRC_VIEWER_EXE` moves only the existence probe
// and `--out` keeps the result out of the checked-in config, so nothing
// fabricated is written into `godot/build/` or `src-tauri/` where another
// session or a real `tauri build` could pick it up.
//
// What this does NOT prove, said plainly rather than left to be assumed: that
// Godot can export a viewer, or that the exported binary runs. That is
// `test:godot`'s job and `npm run godot:export`'s. This proves that when a
// viewer exists, the release config carries it to `viewer/`.
const realViewer = existsSync(VIEWER_BUILD)
const scratch = realViewer ? null : mkdtempSync(join(tmpdir(), 'drc-bundle-'))
// `standIn` is null when a real export is present, rather than aliasing
// VIEWER_BUILD: an alias makes this an `existsSync(p)` followed by a write to
// the same `p`, which is check-then-act on a path somebody else could have
// created in between, and CodeQL flagged exactly that (js/file-system-race,
// high). It is written with an exclusive-create descriptor for the same
// reason - `mkdtempSync` has just made the directory, so an EEXIST here means
// something is wrong and should throw rather than be overwritten.
const standIn = scratch ? join(scratch, 'DRCompanionWorldViewer.exe') : null
if (standIn) {
  const fd = openSync(standIn, 'wx')
  try {
    writeFileSync(fd, 'not a real viewer; a stand-in for the existence probe\n')
  } finally {
    closeSync(fd)
  }
}
const generatedConf = scratch ? join(scratch, 'tauri.release.conf.json') : RELEASE_CONF

// The generator already refuses to emit a config whose destination viewer.rs
// does not resolve, so that contract is not re-checked here - it is invoked,
// and its refusal is turned into a named FAIL rather than a stack trace,
// because a thrown child process in the middle of a suite is a result nobody
// reads.
let generated = true
try {
  execFileSync(
    process.execPath,
    realViewer
      ? ['tools/build-release-config.mjs']
      : ['tools/build-release-config.mjs', '--out', generatedConf],
    {
      stdio: ['ignore', 'inherit', 'pipe'],
      encoding: 'utf8',
      env: realViewer ? process.env : { ...process.env, DRC_VIEWER_EXE: standIn },
    }
  )
} catch (error) {
  generated = false
  const text = String(error.stderr ?? error.message)
  // The first line of a node stack trace is the file and line, which says
  // nothing. The thrown message is the part that names the drift.
  const why = text.split('\n').find((line) => /Error:/.test(line)) ?? text.trim().split('\n')[0]
  check('the release config can be derived at all', false, why.trim())
}
if (generated) {
  const how = realViewer
    ? `a real export at ${VIEWER_BUILD}`
    : `a stand-in at ${standIn} (DRC_VIEWER_EXE); this checks the mapping, not that Godot can export`
  const resources = JSON.parse(readFileSync(generatedConf, 'utf8'))?.bundle?.resources ?? {}
  const baseCount = Object.keys(JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))?.bundle?.resources ?? {}).length
  // Count the fragile thing. "More than zero resources" is true whether or not
  // the probe found a viewer - the base config's own entries are always there
  // - so a broken override would look exactly like a moved destination, and
  // the two checks below would go red for a reason nobody could tell apart.
  // The number that actually disappears is the +1.
  check(
    'the generator found a viewer, so there is a viewer entry to judge',
    Object.keys(resources).length === baseCount + 1,
    `${Object.keys(resources).length} resources against ${baseCount} in the base config, from ${how}`
  )
  const dest = resources[`../${VIEWER_BUILD}`]
  check('the exported viewer is a bundled resource', Boolean(dest), dest ?? 'no entry in the release config')
  check(
    'and it is bundled to the viewer/ folder the app searches first',
    dest === 'viewer/DRCompanionWorldViewer.exe',
    String(dest),
  )
}
if (scratch) rmSync(scratch, { recursive: true, force: true })

console.log('')
console.log('-- who Windows will say published this --')

const TAURI_CONF = 'src-tauri/tauri.conf.json'
const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'))

// Settings -> Apps on the clean VM listed the app as "DR Companion / 0.1.1 /
// github / 211 MB" (docs/verification/first-run-2026-09-05.md, Defect 4).
//
// Nobody typed "github". With `bundle.publisher` unset, Tauri falls back to
// the second segment of the bundle identifier, and this identifier is
// `io.github.dancockrell.dr-companion`. So the publisher every user sees was
// an accident of where the code is hosted - and in the config an absent value
// and a deliberate one look identical, which is why this is checked here
// rather than left as a field somebody might notice.
//
// The value to refuse is computed from the identifier rather than written out
// as the string "github": if the identifier changes, the fallback changes with
// it, and a literal would go on guarding the old one.
const derivedPublisher = String(conf?.identifier ?? '').split('.')[1] ?? ''
check(
  'the identifier still has a second segment, so there is a fallback to refuse',
  Boolean(derivedPublisher),
  `identifier ${conf?.identifier ?? 'MISSING'} - Tauri would fall back to "${derivedPublisher}"`,
)
check(
  'bundle.publisher is set explicitly',
  typeof conf?.bundle?.publisher === 'string' && conf.bundle.publisher.trim().length > 0,
  conf?.bundle?.publisher === undefined
    ? `unset, so Windows shows "${derivedPublisher}", derived from the identifier`
    : String(conf.bundle.publisher),
)
check(
  'and it is a name, not the identifier segment Tauri would have used',
  Boolean(derivedPublisher) && conf?.bundle?.publisher !== derivedPublisher,
  String(conf?.bundle?.publisher),
)

// The saboteur. Those two checks are new, and a check nobody has seen fail is
// a check nobody should trust. The first mutation is the exact state that
// shipped - the key absent. The second is what it would degrade to if somebody
// "filled in" the value Windows was already showing. Both are applied to a
// parsed copy and never to the file; the md5 either side says that rather than
// promising it.
{
  const publisherIsSet = (bundle) =>
    typeof bundle?.publisher === 'string' && bundle.publisher.trim().length > 0
  const publisherIsNotDerived = (bundle) =>
    Boolean(derivedPublisher) && bundle?.publisher !== derivedPublisher

  const beforeMd5 = createHash('md5').update(readFileSync(TAURI_CONF)).digest('hex')

  const unset = { ...conf.bundle }
  delete unset.publisher
  check(
    'the sabotage changed something - publisher was actually removed from the copy',
    'publisher' in conf.bundle && !('publisher' in unset),
  )
  check(
    'with bundle.publisher unset, the "set explicitly" check goes red',
    publisherIsSet(unset) === false,
  )
  check(
    'and with it set to the identifier segment, the "not derived" check goes red',
    publisherIsNotDerived({ ...conf.bundle, publisher: derivedPublisher }) === false,
    `publisher = "${derivedPublisher}"`,
  )
  // Which of the two catches which is worth stating, because they do not
  // overlap: `undefined !== "github"` is true, so the unset case is invisible
  // to the second check and only the first one sees it.
  check(
    'the unset case is caught only by the first check, so both are needed',
    publisherIsNotDerived(unset) === true,
  )
  check(
    'the config file on disk is unchanged by this test',
    createHash('md5').update(readFileSync(TAURI_CONF)).digest('hex') === beforeMd5,
    beforeMd5,
  )
}

console.log('')
console.log('-- the uninstaller cleanup hook, and the paths it deletes --')

// F8 found that neither uninstall path removed the two loopback bearer tokens:
// Tauri's "Delete the application data" checkbox only reaches
// `$LOCALAPPDATA\<bundle id>`, and this app deliberately keeps its runtime
// files somewhere else. src-tauri/installer-hooks.nsh closes that, and the
// closing depends on a folder name and four file names being spelled the same
// in NSIS as they are in Rust.
//
// That is two files answering one question, so it is checked rather than
// commented. The failure it prevents is silent in the worst way: if setup.rs
// renames the folder, the hook goes on deleting a path nobody writes to any
// more and the uninstaller keeps reporting success while leaving live
// credentials on disk.
//
// Backslashes are stripped from the hook text before matching, and never typed
// here: a path separator that has to survive JS escaping and a regex is two
// chances to write a check that silently matches nothing.
const HOOKS_NSH = 'src-tauri/installer-hooks.nsh'
// TAURI_CONF and `conf` are read once, in the publisher section above.

const hookPath = conf?.bundle?.windows?.nsis?.installerHooks
check(
  'tauri.conf.json wires an installer hook file',
  hookPath === 'installer-hooks.nsh',
  hookPath ?? 'bundle.windows.nsis.installerHooks is unset, so nothing below runs at uninstall time',
)
check(`and ${HOOKS_NSH} exists`, existsSync(HOOKS_NSH))

if (existsSync(HOOKS_NSH)) {
  // Backslashes become forward slashes, and CRLF becomes LF. The second half
  // is not cosmetic: this repo is a CRLF checkout, and a per-line
  // `replace(/;.*$/, '')` silently does nothing against it, because JS `.`
  // does not match `\r` and `$` without `/m` is the end of the whole string.
  // Comment stripping was therefore a no-op on every line of the real hook
  // while passing on every `\n`-joined fixture - the walk read comments as
  // statements and a trailing comment would have ridden along inside a
  // condition. Normalising once, here, is cheaper than getting the regex
  // right in three places.
  const nsh = readFileSync(HOOKS_NSH, 'utf8')
    .split(String.fromCharCode(92))
    .join('/')
    .split('\r\n')
    .join('\n')
  const setupRs = readFileSync('src-tauri/src/setup.rs', 'utf8')

  // The folder, taken from the Rust that builds it rather than restated here.
  const folder = /\.join\("(DR Companion[^"]*)"\)/.exec(setupRs)?.[1]
  check(
    'setup.rs still names an app data folder the hook can be checked against',
    Boolean(folder),
    folder ?? 'no .join("DR Companion...") found in setup.rs',
  )
  if (folder) {
    const sameFolder = nsh.includes(`$LOCALAPPDATA/${folder}/`)
    check(
      `and the hook deletes from that same folder (${folder})`,
      sameFolder,
      // Only on failure: a detail printed beside OK reads as a finding.
      sameFolder
        ? ''
        : nsh.includes('$LOCALAPPDATA/')
          ? 'the hook names a different folder'
          : 'the hook names no LOCALAPPDATA path',
    )
  }

  // The four credential files, each read out of the Rust module that writes it.
  const credentials = [
    ['src-tauri/src/presentation_bridge.rs', 'TOKEN_FILE'],
    ['src-tauri/src/presentation_bridge.rs', 'PORT_FILE'],
    ['src-tauri/src/script_api.rs', 'TOKEN_FILE'],
    ['src-tauri/src/script_api.rs', 'PORT_FILE'],
  ].map(([file, name]) => {
    const source = readFileSync(file, 'utf8')
    const value = new RegExp(`const ${name}: &str = "([^"]+)"`).exec(source)?.[1]
    return { file, name, value }
  })

  // The denominator, and it is the number that goes to zero when the mechanism
  // breaks: if these regexes stop matching, every check below would pass
  // vacuously against `undefined`.
  const found = credentials.filter((c) => c.value).length
  check(
    'all four bridge credential filenames were read out of the Rust',
    found === 4,
    `${found} of 4 - ` +
      credentials.map((c) => `${c.name}@${c.file.split('/').pop()}=${c.value ?? 'NOT FOUND'}`).join(', '),
  )
  if (found === 4) {
    for (const { value } of credentials) {
      check(`the uninstall hook deletes ${value}`, nsh.includes(`/${value}"`))
    }
  }

  // The one thing it must never do. `DR Companion Data` can hold the player's
  // own portraits and whole Lich and Genie installs (custom_portraits.rs:21,
  // setup.rs:406 and :796), which is the entire reason app_data_dir() is not
  // the install directory in the first place.
  //
  // Checked as a class rather than as the one path that was on somebody's mind.
  // The first version of this matched a single literal - `RMDir /r` on the data
  // folder itself - and a `RMDir /r` aimed one level down, at
  // `.../DR Companion Data/portraits`, went straight through it green. So did
  // `.../DR Companion Data/lich`, `.../DR Companion Data/*`, and the same exact
  // path written with a trailing separator. Every one of those destroys exactly
  // the user data the check exists to protect, and each was invisible to a
  // check written against the instance.
  //
  // The property is the other way round: every recursive delete in this file
  // must name the one directory the app owns as replaceable cache. That is
  // `downloads_dir()` in setup.rs - `app_data_dir().join("downloads")` - read
  // out of the Rust for the same reason the folder name above is, so a rename
  // there cannot leave a stale permission sitting here. Anything else is
  // reported by name.
  const cacheDir = /fn downloads_dir\(\)[\s\S]{0,200}?app_data_dir\(\)\.join\("([^"]+)"\)/.exec(setupRs)?.[1]
  check(
    'setup.rs still names the one directory a recursive delete may target',
    Boolean(cacheDir),
    cacheDir ?? 'no downloads_dir() -> app_data_dir().join("...") found in setup.rs',
  )

  const dataRoot = `$LOCALAPPDATA/${folder ?? 'DR Companion Data'}`
  /**
   * Every path a `RMDir /r` in this text is aimed at, with any trailing
   * separator dropped so `"…/DR Companion Data/"` cannot read as a different
   * path from `"…/DR Companion Data"`.
   *
   * Takes already-normalised text (forward slashes), so no separator has to
   * survive JS escaping and a regex on its way into this file.
   */
  //
  // Comment lines are dropped first. The hook explains itself by quoting the
  // very line the generated installer.nsi runs, and a check that reads prose as
  // code both miscounts (it reported three recursive deletes where the hook has
  // two) and would go red the day somebody writes down, in a comment, the
  // deletion they are explaining why they did not do.
  const recursiveTargets = (text) =>
    [...text
      .split('\n')
      .filter((line) => !/^\s*;/.test(line))
      .join('\n')
      .matchAll(/RMDir\s+\/r\s+"([^"]*)"/gi)].map((m) => m[1].replace(/\/+$/, ''))

  // The second admissible target, added 6 Sep 2026. It is not under
  // `DR Companion Data` at all: it is `$LOCALAPPDATA\<bundle id>`, the WebView2
  // profile, which is the folder Tauri's own `Section Uninstall` already
  // deletes under this checkbox and which the hook now re-deletes until it is
  // actually gone (docs/verification/uninstall-2026-09-06.md). Nothing the user
  // authored lives there - it is the browser profile the app creates on first
  // start - and the delete is only reachable with the box ticked, which the
  // structural walk further down is what actually proves.
  //
  // It is admitted as the NSIS define, spelled `${BUNDLEID}`, and never as the
  // identifier itself. Writing the id out would be a second spelling of a value
  // that already lives in tauri.conf.json, and a rename there would leave the
  // hook recursively deleting a directory nobody writes to while the real
  // profile survived - which is this whole section's failure mode wearing a new
  // path. The literal form is a refusal below, so it cannot creep back in.
  const bundleDirToken = '$LOCALAPPDATA/${BUNDLEID}'
  const allowed = cacheDir ? [`${dataRoot}/${cacheDir}`, bundleDirToken] : []
  const strayRecursive = (text) => recursiveTargets(text).filter((p) => !allowed.includes(p))

  // The instrument before it is trusted to clear the real file. A matcher that
  // stopped matching would report an empty stray list, which is the same output
  // as a hook that is clean.
  const admitted = allowed.map((p) => `RMDir /r "${p}"`).join('\n')
  const refusals = [
    ['the data folder itself', `RMDir /r "${dataRoot}"`],
    ['the data folder with a trailing separator', `RMDir /r "${dataRoot}/"`],
    ["the player's own portraits", `RMDir /r "${dataRoot}/portraits"`],
    ['a whole Lich install', `RMDir /r "${dataRoot}/lich"`],
    ['everything in the data folder', `RMDir /r "${dataRoot}/*"`],
    // The bundle-id folder is admissible; these three spellings of it are not.
    ['the bundle id written out instead of the define', `RMDir /r "$LOCALAPPDATA/${conf.identifier}"`],
    ['the whole of LOCALAPPDATA', 'RMDir /r "$LOCALAPPDATA"'],
    ['the roaming bundle-id folder, which Tauri already owns', 'RMDir /r "$APPDATA/${BUNDLEID}"'],
  ]
  check(
    'the recursive-delete matcher finds the deletes the hook is allowed',
    cacheDir ? recursiveTargets(admitted).length === allowed.length && strayRecursive(admitted).length === 0 : false,
    cacheDir ? `positive control: ${allowed.join(', ')}` : 'skipped: no cache directory was read out of setup.rs',
  )
  for (const [what, line] of refusals) {
    check(
      `and it refuses a recursive delete of ${what}`,
      strayRecursive(line).length === 1,
      `negative control: ${line}`,
    )
  }

  const stray = strayRecursive(nsh)
  check(
    'and the hook recursively deletes nothing but those two',
    stray.length === 0,
    stray.length
      ? `${stray.join(', ')} - RMDir /r there takes the user's portraits, Lich and Genie with it`
      : `${recursiveTargets(nsh).length} recursive delete(s), all of them in ${allowed.join(' / ')}`,
  )

  // ---- the retry that makes the checkbox finish its own deletion ----------
  //
  // The hook also re-runs Tauri's `RmDir /r "$LOCALAPPDATA\<bundle id>"` until
  // the WebView2 profile is actually gone, because the first attempt races the
  // `msedgewebview2.exe` children that outlive the killed app, and `RmDir /r`
  // skips what it cannot delete without a word
  // (docs/verification/uninstall-2026-09-06.md).
  //
  // What matters about that line is not that it exists but which guards it
  // sits inside: a recursive delete of the WebView2 profile is correct under
  // the checkbox and is destruction of the user's own browser profile without
  // it. Grepping a few lines of context around it answers a different
  // question, because NSIS puts no bound on how far away the `${If}` is - so
  // the guards are read structurally, by walking LogicLib nesting, and the
  // walk is then run against a deliberately unguarded copy.
  // ---- the walk itself, before anything is read through it ---------------
  //
  // The walk is the instrument every guard answer below is read through, and
  // the hook is one sample it happens to get right. These are the shapes it
  // has to get right in general, written as `.nsh` fixtures rather than
  // files, and each asserts which conditions are *guaranteed* where a
  // statement sits - never which tokens happen to appear nearby, which is the
  // thing the old walk was really answering.
  const marks = (source) => {
    const { scoped, unknown } = nshWalk(source)
    const found = {}
    for (const { line, frames } of scoped) {
      const m = /^MARK\s+(\S+)/.exec(line)
      if (m) found[m[1]] = guaranteedConditions(frames).sort()
    }
    return { found, unknown }
  }
  const walkFixtures = [
    ['a plain ${If}', ['${If} $A = 1', '  MARK inside', '${EndIf}', 'MARK after'], { inside: ['$A = 1'], after: [] }],
    [
      'an ${If} with an ${Else}',
      ['${If} $A = 1', '  MARK then', '${Else}', '  MARK otherwise', '${EndIf}'],
      { then: ['$A = 1'], otherwise: [] },
    ],
    [
      'an ${If}/${ElseIf}/${Else} chain',
      ['${If} $A = 1', '  MARK a', '${ElseIf} $B = 1', '  MARK b', '${Else}', '  MARK c', '${EndIf}'],
      { a: ['$A = 1'], b: ['$B = 1'], c: [] },
    ],
    [
      'an ${If} nested inside an ${If}',
      ['${If} $A = 1', '  ${If} $B = 1', '    MARK both', '  ${EndIf}', '  MARK outer', '${EndIf}'],
      { both: ['$A = 1', '$B = 1'], outer: ['$A = 1'] },
    ],
    [
      'an ${If} nested inside an ${Else}',
      [
        '${If} $A = 1',
        '  MARK then',
        '${Else}',
        '  ${If} $B = 1',
        '    MARK inner',
        '  ${EndIf}',
        '  MARK outer',
        '${EndIf}',
      ],
      { then: ['$A = 1'], inner: ['$B = 1'], outer: [] },
    ],
    [
      'an ${AndIf} chain',
      ['${If} $A = 1', '${AndIf} $B = 1', '  MARK both', '${EndIf}'],
      { both: ['$A = 1', '$B = 1'] },
    ],
    [
      'an ${OrIf} chain, where neither disjunct is guaranteed on its own',
      ['${If} $A = 1', '${OrIf} $B = 1', '  MARK either', '${EndIf}'],
      { either: [] },
    ],
    [
      'an ${OrIf} chain where one condition is in every disjunct',
      ['${If} $A = 1', '${AndIf} $C = 1', '${OrIf} $A = 1', '${AndIf} $D = 1', '  MARK a', '${EndIf}'],
      { a: ['$A = 1'] },
    ],
    [
      'trailing comments on the branch and the statement',
      ['${If} $A = 1 ; because', '  MARK inside ; here', '${EndIf}'],
      { inside: ['$A = 1'] },
    ],
  ]
  for (const [name, source, expected] of walkFixtures) {
    const { found, unknown } = marks(source.join('\n'))
    const want = Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, [...v].sort()]))
    const same =
      Object.keys(want).length === Object.keys(found).length &&
      Object.entries(want).every(([k, v]) => JSON.stringify(found[k]) === JSON.stringify(v))
    check(
      `the walk reads ${name}`,
      unknown.length === 0 && same,
      unknown.length
        ? `unexpectedly undetermined: ${unknown.map((u) => u.why).join('; ')}`
        : `got ${JSON.stringify(found)} / wanted ${JSON.stringify(want)}`,
    )
  }

  // Its own regression: the fixtures above are `\n`-joined and the real hook
  // is a CRLF checkout, so a comment strip that only works on `\n` passes
  // every fixture and does nothing to the file the checks are actually about.
  check(
    'the walk strips comments from CRLF lines as well as LF ones',
    marks(['${If} $A = 1 ; why', '  MARK inside ; here', '${EndIf}'].join('\r\n')).found.inside?.join() ===
      '$A = 1',
    JSON.stringify(marks(['${If} $A = 1 ; why', '  MARK inside ; here', '${EndIf}'].join('\r\n')).found),
  )

  // And the three states, because two of them are not enough. A construct the
  // walk does not model must not be read as "no guard here" or as "guarded" -
  // both are answers it has not earned.
  const undeterminedFixtures = [
    ['an unmodelled block construct', ['${Unless} $A = 1', '  MARK x', '${EndUnless}'], 'Unless'],
    ['an ${If} that is never closed', ['${If} $A = 1', '  MARK x'], 'left open'],
    ['an ${EndIf} with nothing open', ['MARK x', '${EndIf}'], 'no open'],
    ['an ${Else} after an ${Else}', ['${If} $A = 1', '${Else}', '${Else}', '${EndIf}'], 'after an'],
    ['an ${AndIf} inside an ${Else}', ['${If} $A = 1', '${Else}', '${AndIf} $B = 1', '${EndIf}'], 'inside an'],
  ]
  for (const [name, source, needle] of undeterminedFixtures) {
    const { unknown } = nshWalk(source.join('\n'))
    check(
      `the walk refuses to answer over ${name}`,
      unknown.length > 0 && unknown.some((u) => u.why.includes(needle)),
      unknown.map((u) => u.why).join('; ') ||
        'the walk answered anyway, so an unmodelled construct would pass silently',
    )
  }
  const undeterminedRows = nshGuardChecks(
    ['${Select} $A', '  RMDir /r "$LOCALAPPDATA/x"', '${EndSelect}'].join('\n'),
  )
  check(
    // Deliberately not spelling the two words the runner scans for: this line
    // is a check that passes, and `run-tests.mjs` reads them out of any line
    // to decide a suite skipped part of its job. A label that says them would
    // file this suite as partial on every clean run, which is a false skip
    // report - and a skip list that cries wolf gets skimmed on the day the
    // hook really does carry a construct the walk cannot read.
    'and an unmodelled construct leaves the guard answers undetermined rather than green',
    undeterminedRows.length > 0 &&
      undeterminedRows.every(([, ok]) => ok !== true) &&
      undeterminedRows.filter(([, ok]) => ok === 'unknown').length >= 2,
    undeterminedRows.map(([label, ok]) => `${label} = ${ok}`).join(' | '),
  )

  // ---- the shared registers ----------------------------------------------
  //
  // `$R0`-`$R9` belong to whoever is running, and this macro is inserted into
  // Tauri's own `Section Uninstall`. Anything the hook writes there has to be
  // put back. The generated installer.nsi never touches `$R7` today - the
  // command that establishes that is recorded in the hook, beside the
  // register it is about - so the Push/Pop is belt and braces, and that is
  // the point of it: it stops the answer depending on a bundler version
  // nobody is going to re-check.
  const registerBalance = (text) => {
    const lines = text.split('\n').map((l) => l.replace(/\r/g, '').replace(/;.*$/, '').trim())
    const written = new Set()
    for (const l of lines) {
      const m = /^(?:StrCpy|IntOp|IntFmt|StrLen|ReadEnvStr|ReadRegStr|ReadINIStr|GetFullPathName)\s+(\$R\d)\b/i.exec(l)
      if (m) written.add(m[1])
    }
    return [...written].map((reg) => {
      const uses = lines.map((l, i) => [l, i]).filter(([l]) => l.includes(reg)).map(([, i]) => i)
      const first = lines[uses[0]]
      const last = lines[uses[uses.length - 1]]
      return { reg, ok: first === `Push ${reg}` && last === `Pop ${reg}`, first, last }
    })
  }
  const balance = registerBalance(nsh)
  check(
    'every shared $R register the hook writes is pushed before its first use and popped after its last',
    balance.length > 0 && balance.every((b) => b.ok),
    balance.length
      ? balance.map((b) => `${b.reg}: first "${b.first}", last "${b.last}"`).join(' | ')
      : 'no $R register is written at all - which is not the hook that exists, so this saw nothing',
  )
  const unsaved = registerBalance(['StrCpy $R7 0', 'IntOp $R7 $R7 + 1'].join('\n'))
  const saved = registerBalance(['Push $R7', 'StrCpy $R7 0', 'Pop $R7'].join('\n'))
  check(
    'and that check goes red on a register written without being saved',
    unsaved.length === 1 && !unsaved[0].ok && saved.length === 1 && saved[0].ok,
    'negative control: an unwrapped StrCpy $R7 / positive control: the same wrapped',
  )

  for (const [label, ok, detail] of nshGuardChecks(nsh)) check(label, ok, detail)

  // The saboteur. That walk is the newest code in this file and the only part
  // of it with no history of being right, so a green line from it means
  // nothing until it has been seen to go red. This lifts the checkbox guard -
  // the exact mutation that would ship a recursive delete of somebody's
  // browser profile into every uninstall.
  //
  // The condition is *rewritten*, not deleted. Deleting the `${If}` line
  // orphans its `${EndIf}` and the walk then goes red on the nesting instead,
  // which is a different failure wearing the same colour: it would pass this
  // suite while proving nothing about whether guards are read at all. So the
  // sabotage keeps the structure intact and changes only what the condition
  // says, and the assertion below names which lines must go red and which
  // must stay green.
  //
  // It is applied to a string, never to the file, so there is no window in
  // which a real hook on disk is broken and nothing to restore. The md5
  // either side says that rather than promising it.
  const md5 = (s) => createHash('md5').update(s).digest('hex')
  const beforeMd5 = md5(readFileSync(HOOKS_NSH))
  const unguarded = nsh.replace(/\$DeleteAppDataCheckboxState\s*=\s*1/g, '$UpdateMode <> 1')
  check(
    'the sabotage changed something - the checkbox condition was actually rewritten',
    unguarded !== nsh && !/\$DeleteAppDataCheckboxState/.test(unguarded),
    unguarded === nsh
      ? 'nothing matched, so the check below proves nothing'
      : '',
  )
  const sabotaged = nshGuardChecks(unguarded)
  const red = sabotaged.filter(([, ok]) => ok !== true).map(([label]) => label)
  const expectedRed = sabotaged
    .map(([label]) => label)
    .filter((label) => label.endsWith('is behind the checkbox'))
  check(
    'and exactly the checkbox-guard checks go red on it',
    // Counted against the recursive deletes actually in the hook rather than
    // against a hard-coded 2. The literal was what caught the `${Else}`
    // saboteur below when it was first tried, and it caught it for the wrong
    // reason: a third delete appearing is an incidental count change, and the
    // guard inversion it was hiding was reported green throughout.
    expectedRed.length === recursiveTargets(nsh).length &&
      expectedRed.length > 0 &&
      red.length === expectedRed.length &&
      expectedRed.every((label) => red.includes(label)),
    `red: ${red.join('; ') || 'nothing'} / expected: ${expectedRed.join('; ') || 'nothing'}`,
  )
  check(
    'while the nesting walk itself stays green, so the red above is about guards',
    sabotaged.some(([label, ok]) => ok === true && label.startsWith('the LogicLib nesting')),
  )

  // The second and third saboteurs, and they are the ones this walk was
  // rewritten for. Both put a recursive delete of the WebView2 profile in a
  // branch that runs when the checkbox is *clear*, keeping the nesting
  // balanced so the failure cannot arrive as a parse error wearing the same
  // colour. The old walk called both of them "behind the checkbox".
  //
  // Applied to a string, never to the file on disk, so there is no window in
  // which a real hook is broken; the md5 below says that rather than
  // promising it.
  const injectBranch = (branchLine) => {
    const lines = nsh.split('\n')
    const at = lines.findIndex((l) => /RMDir\s+\/r\s+"[^"]*\/downloads"/i.test(l))
    if (at < 0) return null
    lines.splice(at + 1, 0, branchLine, `      RMDir /r "${bundleDirToken}"`)
    return { text: lines.join('\n'), injectedLineNo: at + 3 }
  }
  for (const [what, branchLine] of [
    ['an ${Else} branch', '    ${Else}'],
    ['an ${ElseIf} branch', '    ${ElseIf} $PassiveMode = 1'],
  ]) {
    const injected = injectBranch(branchLine)
    check(
      `the ${what} saboteur was injected`,
      Boolean(injected),
      injected
        ? `a delete of ${bundleDirToken} now sits at line ${injected.injectedLineNo}`
        : 'the downloads delete was not found, so nothing below proves anything',
    )
    if (!injected) continue
    const rows = nshGuardChecks(injected.text)
    const checkboxRows = rows.filter(([label]) => label.endsWith('is behind the checkbox'))
    const redRows = checkboxRows.filter(([, ok]) => ok !== true).map(([label]) => label)
    check(
      `a recursive delete of the WebView2 profile inside ${what} is not reported as behind the checkbox`,
      checkboxRows.length === recursiveTargets(nsh).length + 1 &&
        redRows.length === 1 &&
        redRows[0].startsWith(`line ${injected.injectedLineNo}:`) &&
        redRows[0].includes(bundleDirToken),
      `${checkboxRows.length} deletes seen, red: ${redRows.join('; ') || 'nothing - the walk would have shipped it'}`,
    )
    check(
      `and the nesting walk stays green over ${what}, so that red is about guards`,
      rows.some(([label, ok]) => ok === true && label.startsWith('the LogicLib nesting')),
    )
  }
  check(
    'the hook file on disk is unchanged by this test',
    md5(readFileSync(HOOKS_NSH)) === beforeMd5,
    beforeMd5,
  )
}

/**
 * The LogicLib walk: for every statement in an `.nsh`, which conditions are
 * *guaranteed true* where it sits.
 *
 * NSIS puts no bound on how far away a statement's `${If}` is, so the guards
 * around a `RMDir /r` cannot be read by grepping a few lines of context. They
 * have to be read structurally, and "guaranteed" is the whole of it.
 *
 * The version this replaces modelled only `${If}`, `${AndIf}`, `${OrIf}` and
 * `${EndIf}`. `${Else}` and `${ElseIf}` fell through as ordinary statements,
 * so the frame stayed on the stack unchanged and everything in an else branch
 * was tagged with the condition it is the negation of. An independent review
 * of #372 put `RMDir /r "$LOCALAPPDATA\${BUNDLEID}"` - a recursive delete of
 * the user's WebView2 browser profile - inside the `${Else}` of the checkbox
 * guard, and this walk reported it "is behind the checkbox". Green, on a hook
 * that deletes the profile precisely when the box is clear. The suite exited
 * 1, but on a hard-coded count of how many deletes there were, which is an
 * incidental assertion catching an incidental change; the inversion itself
 * was reported as correct.
 *
 * The model now:
 *
 * - a frame's conditions are a disjunction of conjunctions. `${If} A`
 *   `${AndIf} B` `${OrIf} C` is `[[A, B], [C]]`, and a condition counts as
 *   guaranteed only if it appears in *every* group - so `${OrIf}` stops
 *   licensing a claim about either disjunct on its own.
 * - `${Else}` replaces the frame's conditions with nothing at all. An else
 *   branch guarantees no positive condition of its own `${If}`, which is
 *   exactly the claim that was being made falsely.
 * - `${ElseIf} C` replaces them with `[[C]]`. The negations of the earlier
 *   branches hold there too and are dropped, because dropping them only ever
 *   weakens what is claimed.
 * - a nested `${If}` in either branch pushes its own frame, so an inner
 *   condition is guaranteed inside an else branch even though the outer one
 *   is not.
 *
 * Anything else opening a line with `${Something}` - `${Unless}`,
 * `${Select}`, `${Switch}`, a macro this walk has never seen - is not guessed
 * at, and neither is an unbalanced block. Both go in `unknown`, and every
 * guard answer downstream then reports NOT CHECKED naming the line rather
 * than passing. A walk that cannot say which branch a statement is in has to
 * say so: "nothing is wrong" and "I could not tell" are different results,
 * and it is the second one that goes silent.
 *
 * `text` is the hook with backslashes already turned into forward slashes.
 */
function nshWalk(text) {
  const stack = []
  const scoped = []
  const unknown = []
  let lineNo = 0
  for (const raw of text.split('\n')) {
    lineNo++
    // `\r` first: `.` does not match it and `$` is the end of the whole
    // string, so on a CRLF line the comment strip below is a silent no-op.
    const line = raw.replace(/\r/g, '').replace(/;.*$/, '').trim()
    if (!line) continue
    const macro = /^\$\{([A-Za-z]+)\}/.exec(line)?.[1]
    const condition = line.replace(/^\$\{[A-Za-z]+\}\s*/, '').trim()
    const top = stack[stack.length - 1]
    const cannot = (why) => unknown.push({ lineNo, line, why })

    if (macro === 'If') {
      stack.push({ or: [[condition]], opened: line })
    } else if (macro === 'AndIf' || macro === 'OrIf') {
      if (!top) cannot(`\${${macro}} with no open \${If}`)
      else if (top.or === null) cannot(`\${${macro}} inside an \${Else} branch`)
      else if (macro === 'AndIf') top.or[top.or.length - 1].push(condition)
      else top.or.push([condition])
    } else if (macro === 'Else' || macro === 'ElseIf') {
      if (!top) cannot(`\${${macro}} with no open \${If}`)
      else if (top.or === null) cannot(`\${${macro}} after an \${Else}`)
      else top.or = macro === 'Else' ? null : [[condition]]
    } else if (macro === 'EndIf') {
      if (!top) cannot('${EndIf} with no open ${If}')
      else stack.pop()
    } else if (macro) {
      cannot(`\${${macro}} is a block construct this walk does not model`)
    } else {
      scoped.push({
        line,
        lineNo,
        frames: stack.map((f) => (f.or === null ? null : f.or.map((group) => group.slice()))),
      })
    }
  }
  for (const frame of stack) unknown.push({ lineNo: 0, line: frame.opened, why: 'left open at end of file' })
  return { scoped, unknown }
}

/**
 * The conditions guaranteed true where a statement sits: one that appears in
 * every OR-group of some enclosing frame. A `null` frame is an else branch
 * and contributes nothing, which is the point.
 */
function guaranteedConditions(frames) {
  const out = []
  for (const or of frames) {
    if (!or || or.length === 0) continue
    for (const cond of or[0]) {
      if (or.every((group) => group.includes(cond))) out.push(cond)
    }
  }
  return out
}

/** Human-readable form of the same frames, for the detail line only. */
function describeFrames(frames) {
  return (
    frames
      .map((or) => (or === null ? '${Else} branch' : or.map((g) => g.join(' ${AndIf} ')).join(' ${OrIf} ')))
      .join(' / ') || 'no enclosing condition at all'
  )
}

/**
 * The guard checks, as a function so the same walk can be pointed at
 * sabotaged copies. Returns `[label, ok, detail]` triples - `ok` is `true`,
 * `false`, or the string `'unknown'` - rather than calling `check` itself, so
 * a sabotage run can read its results instead of printing them.
 *
 * `text` is the hook with backslashes already turned into forward slashes.
 */
function nshGuardChecks(text) {
  const results = []
  const say = (label, ok, detail = '') => results.push([label, ok, detail])

  const { scoped, unknown } = nshWalk(text)
  const undetermined = unknown.length > 0
  const why = unknown
    .map((u) => `${u.lineNo ? `line ${u.lineNo}` : 'end of file'}: ${u.why} (${u.line})`)
    .join('; ')

  // The denominator, and it is the number that goes to zero when the walk
  // breaks: with a broken parser every "is it guarded" answer below would be
  // a statement about this function rather than about the hook.
  say(
    'the LogicLib nesting in the hook parses and balances',
    undetermined ? 'unknown' : scoped.length > 10,
    undetermined
      ? `the walk could not place every statement - ${why}`
      : `${scoped.length} statements read, every block opened and closed`,
  )

  const destructive = scoped.filter(({ line }) => /^RMDir\s+\/r\s/i.test(line))
  say(
    'the walk found every recursive delete in the hook',
    destructive.length >= 2,
    `${destructive.length} found: ${destructive.map((d) => `line ${d.lineNo} ${d.line}`).join(' | ')}`,
  )
  for (const { line, lineNo, frames } of destructive) {
    // The line number is part of the label because two of these can be the
    // same text - the hook deletes the WebView2 profile in one place and the
    // `${Else}` saboteur adds a second - and a set comparison over duplicate
    // labels cannot say which one went red.
    const named = `line ${lineNo}: ${line.replace(/\s+/g, ' ')}`
    const guaranteed = guaranteedConditions(frames)
    const under = (re) => guaranteed.some((c) => re.test(c))
    const detail = undetermined ? `the walk could not place this line - ${why}` : describeFrames(frames)
    say(
      `${named} is behind the checkbox`,
      undetermined ? 'unknown' : under(/\$DeleteAppDataCheckboxState\s*=\s*1/),
      detail,
    )
    say(
      `${named} is behind the update guard`,
      undetermined ? 'unknown' : under(/\$UpdateMode\s*<>\s*1/),
      detail,
    )
  }

  // And the retry has to be bounded. An unbounded one hangs the uninstall on
  // a handle that is never released.
  const limit = /IntCmp\s+\$R7\s+(\d+)\s/.exec(text)?.[1]
  say(
    'the retry loop is bounded, by a limit short enough to wait out',
    Boolean(limit) && Number(limit) > 0 && Number(limit) <= 40,
    limit ? `${limit} attempts, 500 ms apart` : 'no IntCmp bound on the retry counter',
  )
  return results
}

console.log('')
if (fails > 0) console.log(`${fails} FAILED${notChecked > 0 ? `, and ${notChecked} thing(s) NOT CHECKED` : ''}`)
else if (notChecked > 0) console.log(`no failures, but ${notChecked} thing(s) NOT CHECKED`)
else console.log('all passed')
process.exit(fails === 0 ? 0 : 1)
