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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = 'dist/assets'
let fails = 0

function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) fails++
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
for (const surface of ['SetupWizard', 'SettingsSheet', 'ConfigManagerSheet', 'ReportDialog', 'ScriptEditor', 'SoundControls']) {
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
let notChecked = 0

if (!existsSync(VIEWER_BUILD)) {
  // Loudly, and it must not read as a pass in the summary below. A viewer that
  // was never exported is a supported build - the beta ships with the viewer
  // disabled - but "we did not look" and "we looked and it was right" are
  // different results and folding them together is the habit this repository
  // keeps paying for.
  notChecked += 1
  console.log(`NOT CHECKED: viewer not built - ${VIEWER_BUILD} does not exist, so there is`)
  console.log('             no bundled destination to check. Export it with `npm run godot:export`')
  console.log('             (needs the godot/shared-assets submodule and a Godot 4.3 binary).')
} else {
  // The generator already refuses to emit a config whose destination viewer.rs
  // does not resolve, so that contract is not re-checked here - it is invoked,
  // and its refusal is turned into a named FAIL rather than a stack trace,
  // because a thrown child process in the middle of a suite is a result nobody
  // reads.
  let generated = true
  try {
    execFileSync(process.execPath, ['tools/build-release-config.mjs'], {
      stdio: ['ignore', 'inherit', 'pipe'],
      encoding: 'utf8',
    })
  } catch (error) {
    generated = false
    const text = String(error.stderr ?? error.message)
    // The first line of a node stack trace is the file and line, which says
    // nothing. The thrown message is the part that names the drift.
    const why = text.split('\n').find((line) => /Error:/.test(line)) ?? text.trim().split('\n')[0]
    check('the release config can be derived at all', false, why.trim())
  }
  if (generated) {
    const resources = JSON.parse(readFileSync(RELEASE_CONF, 'utf8'))?.bundle?.resources ?? {}
    const dest = resources[`../${VIEWER_BUILD}`]
    check('the exported viewer is a bundled resource', Boolean(dest), dest ?? 'no entry in the release config')
    check(
      'and it is bundled to the viewer/ folder the app searches first',
      dest === 'viewer/DRCompanionWorldViewer.exe',
      String(dest),
    )
  }
}

console.log('')
if (fails > 0) console.log(`${fails} FAILED`)
else if (notChecked > 0)
  console.log(`no failures, but ${notChecked} not checked: the viewer resource destination`)
else console.log('all passed')
process.exit(fails === 0 ? 0 : 1)
