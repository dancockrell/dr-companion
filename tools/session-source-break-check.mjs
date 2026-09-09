#!/usr/bin/env node
/**
 * Prove that `session-source-test.mjs` and `attach-states-test.mjs` can go red,
 * and that each sabotage reddens the checks it aims at and no others.
 *
 *   npm run test:session-source-break
 *
 * # Why this file exists at all
 *
 * A green suite over an invariant is worth nothing until somebody has watched
 * it fail. Both suites above are mostly sweeps over source text, and a sweep
 * whose pattern stops matching returns "no violations" - byte-identical to a
 * tree with no violations in it. That is the defect they were written to catch,
 * pointed at themselves.
 *
 * # How it works, and the two ways this kind of harness lies
 *
 * Damage is applied to a **byte copy** of the whole tree under a scratch
 * directory, never to the tracked files. Six sessions edit this repo; a
 * negative suite that breaks a real file and leaves it broken is worse than
 * having no negative suite.
 *
 * The two failure modes it guards against in itself:
 *
 *  1. **A sabotage that changed nothing** reads as "this check is not needed"
 *     when it means "the edit missed". Every case asserts its own edit landed -
 *     the file's bytes changed - and aborts naming the case if it did not.
 *  2. **A sabotage that reddens more than it aimed at** means the checks are
 *     entangled and the suite says less than it appears to. So each case
 *     declares the exact check names it must redden, and a case that reddens a
 *     check it did not name fails just as loudly as one that reddens none.
 *
 * And before any of that: the copied tree must pass **undamaged**. Without
 * that gate a copy whose imports do not resolve reddens every check in every
 * case, and the run reads as nine successful sabotages.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SUITES = {
  session: 'tools/session-source-test.mjs',
  states: 'tools/attach-states-test.mjs',
}

const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex')

/**
 * An anchor written with newlines, rewritten to whatever the file uses.
 *
 * This tree is checked out CRLF. A multi-line anchor built with plain newlines
 * matches nothing in it, the edit silently misses, and the case reports "the
 * sabotage matched nothing" - which is the guard above working exactly as
 * intended, and it took one run to see why. Detect the ending rather than
 * promising to remember it (working agreements, section 17).
 */
const CRLF = String.fromCharCode(13, 10)
const LF = String.fromCharCode(10)
const eol = (src, anchor) => (src.includes(CRLF) ? anchor.split(LF).join(CRLF) : anchor)

/** Copy only what the two suites read. A whole-tree copy is 200MB of node_modules. */
function stage() {
  const dir = mkdtempSync(join(tmpdir(), 'drc-session-break-'))
  for (const part of ['src', 'tools']) {
    cpSync(join(root, part), join(dir, part), { recursive: true })
  }
  for (const f of ['package.json', 'tsconfig.json']) {
    if (existsSync(join(root, f))) cpSync(join(root, f), join(dir, f))
  }
  return dir
}

/** Run one suite in the staged tree and return the set of check names that failed. */
function run(dir, suite) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', join(dir, SUITES[suite])],
    { cwd: dir, encoding: 'utf8' }
  )
  const out = `${r.stdout}${r.stderr}`
  const red = new Set()
  for (const line of out.split('\n')) {
    const m = /^FAIL\s+(.*?)(?:\s{2}\(|$)/.exec(line.trim())
    if (m) red.add(m[1].trim())
    if (/^NOT CHECKED\s+(.*)$/.test(line.trim())) red.add(`NOT CHECKED ${RegExp.$1.trim()}`)
  }
  return { red, code: r.status, out }
}

/**
 * The cases. `edit` returns the damaged text or null when it could not find
 * what it meant to damage; `reddens` is the exact set of check names that must
 * go red, and nothing else may.
 */
const CASES = [
  {
    name: 'the source module stops refusing the impossible pair',
    suite: 'session',
    file: 'src/lib/sessionSource.ts',
    edit: (s) =>
      s.includes('if (r.gameSocketOpen) throw new BothSourcesError()')
        ? s.replace('if (r.gameSocketOpen) throw new BothSourcesError()', 'if (false) throw new BothSourcesError()')
        : null,
    reddens: ['mock mode with a socket throws rather than picking one to believe'],
  },
  {
    name: 'attaching no longer leaves the demo',
    suite: 'session',
    file: 'src/lib/sessionSource.ts',
    edit: (s) =>
      s.includes("const endDemo = from.bridgeMode === 'mock'")
        ? s.replace("const endDemo = from.bridgeMode === 'mock'", 'const endDemo = false')
        : null,
    // The walk must find the pair, and the sentence that announced it goes too.
    reddens: [
      'no reachable state has the demo on with a socket open',
      'attaching from the demo leaves the demo',
      '  and says so',
      'there are sentences to check at all',
    ],
  },
  {
    name: 'a second call site starts attaching on its own again',
    suite: 'session',
    file: 'src/components/game/GameConnectionBar.tsx',
    edit: (s) =>
      s.includes('useAppStore.getState().connectToGame(Number(port))')
        ? s.replace('useAppStore.getState().connectToGame(Number(port))', 'attachGame(Number(port))')
        : null,
    reddens: ['nothing outside sessionSwitch.ts calls attachGame()'],
  },
  {
    name: 'the demo banner reads the mode again instead of the source',
    suite: 'session',
    file: 'src/components/layout/WindowShell.tsx',
    edit: (s) =>
      s.includes("source === 'demo' && <DemoBanner")
        ? s.replace("source === 'demo' && <DemoBanner", "bridgeMode === 'mock' && <DemoBanner")
        : null,
    reddens: [
      "no component renders on `bridgeMode === 'mock' &&` without the source module",
      'the demo banner is gated on sessionSource, not on the mode alone',
    ],
  },
  {
    name: 'the tab row drops the main game window again',
    suite: 'session',
    file: 'src/lib/gameLink.ts',
    edit: (s) =>
      s.includes('return hasMainStream() ? [MAIN_STREAM, ...named] : named')
        ? s.replace('return hasMainStream() ? [MAIN_STREAM, ...named] : named', 'return named')
        : null,
    // The sweep is over source text, so removing the behaviour without removing
    // the export reddens nothing here. That is honest and it is why the *probe*
    // measures this one against a real socket. What must still go red is the
    // pane reading the wrong list, so this case damages that instead.
    reddens: [],
    expectNoRed: true,
  },
  {
    name: 'the pane builds its row from the channel list again',
    suite: 'session',
    file: 'src/components/game/StreamTabs.tsx',
    edit: (s) =>
      s.includes('const streams = useGameTabs()')
        ? s.replace('const streams = useGameTabs()', 'const streams = useGameStreams()')
        : null,
    reddens: ['StreamTabs builds its row from the tab list, not the channel list'],
  },
  {
    name: 'an open socket with no character folds back into "nothing connected"',
    suite: 'states',
    file: 'src/lib/sessionSource.ts',
    edit: (s) =>
      s.includes("if (source === 'live') return 'live-waiting'")
        ? s.replace("if (source === 'live') return 'live-waiting'", "if (source === 'live') return 'none'")
        : null,
    reddens: [
      'every declared state is reachable',
      "an open socket with no character is 'live-waiting', not 'none'",
      "  'live-waiting' is one of them",
    ],
  },
  {
    name: 'a screen loses its last action',
    suite: 'states',
    file: 'src/lib/sessionSource.ts',
    edit: (s) =>
      s.includes("actions: ['bridge-command', 'attach', 'connection-help']")
        ? s.replace("actions: ['bridge-command', 'attach', 'connection-help']", 'actions: []')
        : null,
    /*
     * Only the one check. `bridge-command` and `attach` still appear in other
     * screens, so emptying this one does not orphan an action id - which is
     * the honest scope of this sabotage and worth stating rather than
     * declaring a second check that cannot go red.
     */
    reddens: ['  live-waiting: has at least one action'],
  },
  {
    name: 'the text region is gated on `character` again',
    suite: 'states',
    file: 'src/App.tsx',
    /*
     * Repointed with the check it drives. This case used to gate the console
     * row, which was how the transcript escaped the `character` gate before
     * the play-first frame; that row is gone and the transcript is the
     * workspace, so the sabotage now puts a positive `character` gate inside
     * the text region instead. Same bug (#523), same red line, different
     * mechanism - and the case aborts rather than passing if it stops
     * matching, which is what caught the rename in the first place.
     *
     * One line and no newline in the needle, so CRLF cannot silently make it
     * match nothing.
     */
    edit: (s) => {
      const anchor = ' aria-label="Text">'
      if (!s.includes(anchor)) return null
      return s.replace(anchor, `${anchor}{character && null}`)
    },
    reddens: ['the text region is not gated on `character`'],
  },
]

// ------------------------------------------------------------------ the run
let failures = 0
const dir = stage()
console.log(`staged a byte copy at ${dir}`)

try {
  // The gate that has to come first: the copy must be green undamaged, or
  // every red below is the copy being broken rather than a sabotage landing.
  let baselineOk = true
  for (const suite of Object.keys(SUITES)) {
    const base = run(dir, suite)
    if (base.code !== 0 || base.red.size > 0) {
      baselineOk = false
      console.log(`FAIL the undamaged copy does not pass ${SUITES[suite]} (exit ${base.code})`)
      console.log(base.out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'))
      failures++
    } else {
      console.log(`OK   the undamaged copy passes ${SUITES[suite]}`)
    }
  }
  if (!baselineOk) {
    console.log('\nABORT: nothing below can be interpreted while the copy is red.')
    process.exit(1)
  }

  for (const c of CASES) {
    const path = join(dir, c.file)
    const original = readFileSync(path, 'utf8')
    const before = md5(path)
    const damaged = c.edit(original)

    // A sabotage that changed nothing must abort naming itself, never pass.
    // It is the exact shape of "the check is not needed" meaning "the edit
    // missed", and it has cost this machine an afternoon before.
    if (damaged === null || damaged === original) {
      console.log(`FAIL [${c.name}] the sabotage matched nothing, so this case tested nothing`)
      failures++
      continue
    }
    writeFileSync(path, damaged)
    if (md5(path) === before) {
      console.log(`FAIL [${c.name}] the file's bytes did not change after writing the damage`)
      failures++
      writeFileSync(path, original)
      continue
    }

    const { red } = run(dir, c.suite)
    writeFileSync(path, original)
    // Restore verified by hash, not by having written it. These are copies,
    // but a case that leaves the copy damaged poisons every case after it.
    if (md5(path) !== before) {
      console.log(`FAIL [${c.name}] the restore did not put the file back`)
      failures++
      break
    }

    /*
     * Compared trimmed on both sides. The suites indent a sub-check's name by
     * two spaces for readability, and the FAIL parser collapses the whitespace
     * after `FAIL`, so a declared "  and says so" and a parsed "and says so"
     * are the same check. Matching them raw reported the same string as both
     * missing and extra, which is a defect in this harness that reads exactly
     * like an entangled suite.
     */
    const want = new Set(c.reddens.map((r) => r.trim()))
    const got = new Set([...red].map((r) => r.trim()))
    const missing = [...want].filter((r) => !got.has(r))
    const extra = [...got].filter((r) => !want.has(r))

    if (c.expectNoRed) {
      // A declared blind spot, asserted rather than left implicit. If this
      // ever starts reddening, the note above it is stale and should go.
      if (red.size === 0) console.log(`OK   [${c.name}] reddens nothing, as declared - see the note on this case`)
      else {
        console.log(`FAIL [${c.name}] was declared a blind spot and now reddens: ${[...red].join(' | ')}`)
        failures++
      }
      continue
    }

    if (missing.length === 0 && extra.length === 0) {
      console.log(`OK   [${c.name}] reddened exactly ${want.size}: ${[...want].join(' | ')}`)
    } else {
      failures++
      console.log(`FAIL [${c.name}]`)
      if (missing.length) console.log(`     did not redden: ${missing.join(' | ')}`)
      if (extra.length) console.log(`     also reddened:  ${extra.join(' | ')}`)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
  console.log('scratch copy removed')
}

// A floor on the number of cases, so a truncated list reads as truncated.
if (CASES.length < 8) {
  console.log(`FAIL only ${CASES.length} sabotages are declared, fewer than this harness had.`)
  process.exit(1)
}
console.log(`\n${CASES.length} sabotages, ${failures} failed`)
process.exit(failures > 0 ? 1 : 0)
