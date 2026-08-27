/**
 * Nothing subscribes to a buffer that is mutated in place.
 *
 * `useSyncExternalStore` compares snapshots with Object.is. A getter that
 * returns the same array every time is therefore a subscription that never
 * fires, and it fails in the worst available way: silently, and only for the
 * components that depend on it alone.
 *
 * That is not hypothetical here. `gameLines()` returns the module's `buffer`,
 * which grows by `push`. The game pane subscribed to it and appeared to work,
 * because it also subscribes to `gameState()`, which is rebuilt on every chunk
 * and dragged the re-render along behind it. The channel tabs subscribed only
 * to the lines. Measured in the running desktop app: 924 lines received, the
 * text of the thoughts, death and talk channels all visibly on screen, and the
 * tab row still reading "no channels yet".
 *
 * Every unit test passed throughout, because they call the parser directly and
 * nothing in this repo renders a component. So the check is a static one: the
 * snapshot argument must be a getter that returns something new when the data
 * changes, and `gameLines` is not one.
 *
 * This does not prove a component re-renders. It forecloses the one way we
 * already know it silently does not, which is what a check is for.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let fails = 0
let checked = 0
const ok = (label, cond, detail = '') => {
  checked++
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(52)}${detail}`)
}

/** Getters that hand back a mutable module-level value rather than a fresh one. */
const UNSTABLE = ['gameLines', 'gameLinesFrom', 'gameStreams']

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(p)
  }
  return out
}

/**
 * Every `useSyncExternalStore(...)` call, with its arguments.
 *
 * Text matching, and it is worth being honest about the limit: a call split
 * across lines in an unusual way could be missed. It is checked against a file
 * known to contain one, below, so a matcher that has stopped matching anything
 * says so instead of reporting a clean sweep.
 */
function calls(text) {
  const out = []
  const re = /useSyncExternalStore\s*\(([^)]*)\)/gs
  let m
  while ((m = re.exec(text))) out.push(m[1].replace(/\s+/g, ' ').trim())
  return out
}

const files = sources('src')
ok('there are sources to check', files.length > 20, `${files.length} files`)

let found = 0
const bad = []
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const args of calls(text)) {
    found++
    const parts = args.split(',').map((s) => s.trim())
    // The snapshot is the second argument, the server snapshot the third.
    for (const part of parts.slice(1)) {
      if (UNSTABLE.includes(part)) bad.push(`${f}: useSyncExternalStore(..., ${part}, ...)`)
    }
  }
}

// The denominator. Zero calls found and zero bad ones look identical, and the
// matcher going stale is far more likely than every component dropping its
// subscription on the same day.
ok('the matcher still finds subscriptions', found >= 3, `${found} calls`)
ok(
  'none of them subscribe to a mutated buffer',
  bad.length === 0,
  bad.length ? '\n     ' + bad.join('\n     ') : ''
)

console.log('\n-- and the check can fail, shown against the code it was written for --')
{
  // The exact line that shipped, so the assertion above is demonstrably
  // load-bearing rather than a sweep that would pass over anything.
  const wasShipped = 'const lines = useSyncExternalStore(subscribeGame, gameLines, gameLines)'
  const args = calls(wasShipped)
  ok('the matcher finds it', args.length === 1, JSON.stringify(args))
  ok(
    'and it is rejected',
    args[0]
      ?.split(',')
      .map((s) => s.trim())
      .slice(1)
      .some((p) => UNSTABLE.includes(p)) === true
  )
}

const ran = checked
ok('enough was checked for a pass to mean something', ran >= 5, `${ran} assertions`)

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
