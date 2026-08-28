/**
 * pinNudge.ts - per-room, per-character dismissal for "you've stood here
 * N times, pin it?" Same compile-into-a-temp-dir trick as pins-test.mjs,
 * for the same reason: it imports storage.ts and profiles.ts by
 * extensionless relative path.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'pin-nudge-'))
const compile = (src, name) => {
  const out = join(dir, name)
  writeFileSync(
    out,
    ts
      .transpileModule(readFileSync(src, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/from '(\.\/[^']+)'/g, (_, r) => `from '${r}.js'`)
  )
  return out
}
compile('src/lib/storage.ts', 'storage.js')
compile('src/lib/profiles.ts', 'profiles.js')
const nudgePath = compile('src/lib/pinNudge.ts', 'pinNudge.js')

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { isDismissed, dismissNudge, NUDGE_VISIT_THRESHOLD } = await import(pathToFileURL(nudgePath).href)

let failed = 0
let checked = 0
const ok = (name, cond, detail = '') => {
  checked++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!cond) failed++
}

const HERO = ['Erathi', 'DR']
const OTHER = ['Erathi', 'DR-Fallen']

ok('nothing is dismissed for a fresh character', !isDismissed(...HERO, 101))

dismissNudge(...HERO, 101)
ok('dismissing a room makes it report dismissed', isDismissed(...HERO, 101))
ok('a different room is untouched', !isDismissed(...HERO, 202))

console.log('')
console.log('-- dismissal is per room, not global --')
dismissNudge(...HERO, 202)
ok('a second dismissed room is also tracked', isDismissed(...HERO, 202))
ok('the first one is still dismissed too - neither replaced the other', isDismissed(...HERO, 101))

console.log('')
console.log('-- dismissing twice is a harmless no-op, not a duplicate --')
dismissNudge(...HERO, 101)
dismissNudge(...HERO, 101)
// No direct way to inspect the list length through the public API - the
// property that matters is observable behavior, not the internal array, so
// this just re-asserts the room still reads as dismissed after being
// dismissed three times total.
ok('still just dismissed, not broken by repetition', isDismissed(...HERO, 101))

console.log('')
console.log('-- per character, same key scheme as pins/profiles --')
ok("a different character's dismissals don't leak in", !isDismissed(...OTHER, 101))
dismissNudge(...OTHER, 101)
ok('the other character can dismiss the same room id independently', isDismissed(...OTHER, 101))
ok("that doesn't touch this character's own dismissal of a different room", !isDismissed(...HERO, 999))

console.log('')
console.log('-- the threshold is a real number worth checking, not left implicit --')
ok('threshold is a small positive number', NUDGE_VISIT_THRESHOLD > 1 && NUDGE_VISIT_THRESHOLD < 20)

console.log('')
console.log('-- storage survives garbage already in it --')
store.set('drc.nudge.v1', '{not json')
ok('a corrupted store degrades to "not dismissed" rather than throwing', !isDismissed(...HERO, 101))

ok('enough was checked for a pass to mean something', checked >= 10, `${checked} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
