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
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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
console.log(fails === 0 ? 'all passed' : `${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
