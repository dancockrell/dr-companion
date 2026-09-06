#!/usr/bin/env node
/**
 * Substitutes and gags: applied on read, and never in the buffer.
 *
 *   node --experimental-test-module-mocks tools/line-rules-test.mjs
 *
 * # The one property everything else here serves
 *
 * A gag is a display preference. The raw buffer in `gameLink.ts` keeps every
 * line the game sent, because the transcript, the bug bundle and
 * `aiWorkerHost.ts`'s ingest all read it directly and none of them should
 * inherit somebody's decision to stop looking at "You feel fully rested". So
 * the buffer is compared **byte for byte** before and after the rules are
 * applied, not merely counted: a filter that rewrote a line in place and left
 * the count alone would pass a count.
 *
 * # Why a real link rather than calling the resolver
 *
 * Every case below drives `gameLink.ts`'s real buffer through the real
 * `game:line` handler and then reads `currentGameLines()` - the function the
 * hook itself returns. A check that called `applyLineRules` directly would
 * prove the resolver works and say nothing about whether the game pane uses
 * it, which is the half that has gone wrong in this repo before.
 *
 * # The denominator
 *
 * "The gagged line is absent" is true, and meaningless, when no lines
 * arrived. Every case that asserts an absence asserts the line count first.
 *
 * # Sabotage
 *
 * Three mutants, each of which must redden the case that names the property
 * it broke and leave the others alone; a sabotage that reddens everything
 * means the cases are entangled and are saying less than they look like. The
 * mutants are copies under `tools/.sabotage-*`; the real sources are never
 * written, and their md5s are compared at the end to prove it rather than to
 * promise it.
 */
import { mock } from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// --------------------------------------------------------------- the harness

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)

/** Handlers gameLink installs, so this file can play the part of Rust. */
const handlers = new Map()
const stub = {
  isTauri: () => true,
  listenTauri: (name, fn) => {
    handlers.set(name, fn)
    return () => handlers.delete(name)
  },
  invokeTauri: async (cmd) => {
    if (cmd === 'game_backlog') return { lines: [], dropped: 0 }
    return undefined
  },
  setAlwaysOnTop: async () => {},
  getBridgeDefaultUrl: async () => '',
}
const nodeMajor = Number(process.versions.node.split('.')[0])
mock.module('../src/lib/tauri.ts', nodeMajor >= 24 ? { exports: stub } : { namedExports: stub })

const link = await import('../src/lib/gameLink.ts')
const cfg = await import('../src/lib/playerConfig.ts')
const rules = await import('../src/lib/lineRules.ts')
const hook = await import('../src/lib/useGameLines.ts')
const { paint, segments } = await import('../src/lib/highlights.ts')

let checked = 0
let failed = 0
let SABOTAGE_DIR = null
const ok = (name, cond, detail = '') => {
  checked += 1
  if (!cond) failed += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(64)}${detail}`)
}

const NL = String.fromCharCode(10)
const settle = () => new Promise((r) => setTimeout(r, 20))

function deliver(seq, text) {
  const fn = handlers.get('game:line')
  if (!fn) throw new Error('gameLink never subscribed to game:line')
  fn({ seq, receivedAtMs: 1_700_000_000_000 + seq, text: text + NL })
}

/** The whole buffer as a string, so a rewrite in place cannot hide behind a
 *  count that did not change. */
const bufferPrint = () => JSON.stringify(link.gameLines())

function setRules({ substitutes = [], gags = [] }) {
  cfg.setDomain('substitutes', substitutes)
  cfg.setDomain('gags', gags)
  rules.resetLineRuleCache()
}

const sub = (over) => ({ id: `s-${over.find}`, enabled: true, source: 'player', replace: '', ...over })
const gag = (over) => ({ id: `g-${over.pattern}`, enabled: true, source: 'player', ...over })

const SENT = [
  "A Gor'Tog guard just arrived.",
  'You feel fully rested.',
  'A kobold guard swings a scimitar at you!',
  'Your mind is clear.',
]

console.log('line rules: substitutes and gags, applied on read')

link.subscribeGame(() => {})
await settle()
SENT.forEach((text, i) => deliver(i + 1, text))
await settle()

// ------------------------------------------------------- positive control
//
// Before reading any "the line is absent" below as a fact about the rules,
// prove the rig can carry a line at all. Without this, a broken harness and a
// working gag produce identical output.
ok('control: the rig delivered every line', link.gameLines().length === SENT.length, `${link.gameLines().length} lines`)
ok(
  'control: the text arrived intact',
  link.gameLines().map((l) => l.text).join('|') === SENT.join('|')
)

const PRISTINE = bufferPrint()

// -------------------------------------------------- an empty set is a no-op
console.log('\n-- an empty rule set changes nothing, and is not a filter that matched nothing --')
{
  setRules({})
  const shown = hook.currentGameLines()
  ok('every line is still shown', shown.length === SENT.length, `${shown.length} of ${SENT.length}`)
  ok(
    'and every one of them is unchanged',
    shown.map((l) => l.text).join('|') === SENT.join('|')
  )
  ok(
    'applyLineRules on its own is a no-op too',
    (() => {
      const r = rules.applyLineRules(SENT[0], { substitutes: [], gags: [] })
      return r.text === SENT[0] && r.gagged === false && r.matched.length === 0
    })()
  )
}

// ------------------------------------------------------------- substitutes
console.log('\n-- a substitute rewrites the displayed line and not the buffer --')
{
  setRules({ substitutes: [sub({ find: "Gor'Tog", replace: 'Tog' })] })
  const shown = hook.currentGameLines()
  ok('the line count is unchanged', shown.length === SENT.length, `${shown.length}`)
  ok('the displayed text is rewritten', shown[0].text === 'A Tog guard just arrived.', shown[0].text)
  ok('and it says which rule did it', shown[0].matched?.[0] === "s-Gor'Tog", String(shown[0].matched))
  ok('only its own substring changed', shown[2].text === SENT[2], shown[2].text)
  ok('the raw buffer is byte identical', bufferPrint() === PRISTINE)
}

// ------------------------------------------------------------------- gags
console.log('\n-- a gag hides a line from the pane and keeps it in the buffer --')
{
  setRules({ gags: [gag({ pattern: 'fully rested' })] })
  const shown = hook.currentGameLines()
  ok('the pane is one line shorter', shown.length === SENT.length - 1, `${shown.length} of ${SENT.length}`)
  ok(
    'and it is the gagged line that is gone',
    !shown.some((l) => l.text === 'You feel fully rested.')
  )
  ok(
    'the line is still in the raw buffer',
    link.gameLines().some((l) => l.text === 'You feel fully rested.')
  )
  ok('the raw buffer is byte identical', bufferPrint() === PRISTINE)

  hook.setShowGaggedLines(true)
  const withHidden = hook.currentGameLines()
  ok('the toggle brings it back', withHidden.length === SENT.length, `${withHidden.length}`)
  const back = withHidden.find((l) => l.text === 'You feel fully rested.')
  ok('and it is marked as hidden rather than looking ordinary', back?.gagged === true)
  ok('the toggle did not touch the buffer either', bufferPrint() === PRISTINE)
  hook.setShowGaggedLines(false)
}

// -------------------------------------------------------------- rule order
console.log('\n-- substitutes run first, so a gag matches what the player would read --')
{
  setRules({
    substitutes: [sub({ find: 'kobold', replace: 'wandering nuisance' })],
    gags: [gag({ pattern: 'wandering nuisance' })],
  })
  const shown = hook.currentGameLines()
  ok(
    'a gag written against the substituted text fires',
    !shown.some((l) => l.text.includes('scimitar')),
    `${shown.length} lines shown`
  )
  ok('the line count is otherwise unchanged', shown.length === SENT.length - 1, `${shown.length}`)

  // The other direction, so this is a statement about order and not about
  // whether gags work: a gag on the pre-substitution text must NOT fire.
  setRules({
    substitutes: [sub({ find: 'kobold', replace: 'wandering nuisance' })],
    gags: [gag({ pattern: 'kobold' })],
  })
  const after = hook.currentGameLines()
  ok(
    'a gag written against the original text no longer matches',
    after.length === SENT.length,
    `${after.length} of ${SENT.length}`
  )
}

// ------------------------------------------------------------- disabled rules
console.log('\n-- a rule switched off does not fire --')
{
  setRules({ gags: [gag({ pattern: 'fully rested', enabled: false })] })
  ok('the disabled gag hides nothing', hook.currentGameLines().length === SENT.length)
  setRules({ substitutes: [sub({ find: "Gor'Tog", replace: 'Tog', enabled: false })] })
  ok('the disabled substitute rewrites nothing', hook.currentGameLines()[0].text === SENT[0])
}

// ----------------------------------------------------------- regular expressions
console.log('\n-- regex rules, and the patterns that are refused before they are stored --')
{
  setRules({ substitutes: [sub({ find: '\\bguard\\b', replace: 'sentry', regex: true })] })
  const shown = hook.currentGameLines()
  ok('a regex substitute rewrites every occurrence', shown[0].text === "A Gor'Tog sentry just arrived.", shown[0].text)
  ok('and leaves a line it does not match alone', shown[1].text === SENT[1], shown[1].text)

  setRules({ gags: [gag({ pattern: '^Your mind', regex: true })] })
  ok('a regex gag hides its line', hook.currentGameLines().length === SENT.length - 1)

  ok('a literal rule is not read as a pattern', (() => {
    const r = rules.applyLineRules('cost: 5 (a+)+$ silver', {
      substitutes: [sub({ find: '(a+)+$', replace: 'X' })],
      gags: [],
    })
    return r.text === 'cost: 5 X silver'
  })())
}

console.log('\n-- an unrunnable pattern is refused at save and never reaches the pane --')
{
  const broken = rules.ruleRefusal('(unclosed', true)
  ok('a pattern that does not compile is refused', typeof broken === 'string' && broken.length > 0, String(broken))
  ok('and the refusal names the problem rather than saying "invalid"', /group|paren|\)/i.test(broken ?? ''), String(broken))

  /*
   * Was `refused with its measured time`, asserting `/took \d+ms/`. That named
   * the mechanism rather than the property, and it went red when #482 gave
   * `compilePattern` a structural half that answers before any timing and says
   * which construct is wrong - a strictly better refusal for the player to
   * read. The property is that a substitute or gag which would freeze the game
   * pane is refused with a reason naming its own pattern, and that is what is
   * asserted now. Changed deliberately, and disclosed here, because editing a
   * test to make one's own change pass is otherwise indistinguishable from this.
   *
   * The second case changed the same way and for the same reason, in #500. It
   * was `(a|\\1a)+$` refused "on its measured time", and the sentence above it
   * said a backreference's refusal "can only have come from a timing" - which
   * was true, and was the bug. An unmodelled pattern reached the probe loop
   * having derived no probes from itself, so for an *anchored* one the timing
   * was no evidence at all and it was admitted: measured through the real
   * `resolveHighlights` + `paint`, one 45-character line took 103 seconds.
   * `(a|\\1a)+$` is self-referential and cannot be widened into anything this
   * parser reads, so it is now refused by name instead, which is the property
   * that was wanted. The timing half is still proven live, by
   * `tools/pattern-analyser-break-check.mjs`: with the analyser switched off,
   * the probes alone still refuse #482's pattern.
   */
  const slow = rules.ruleRefusal('(a+)+$', true)
  ok(
    'a pattern that backtracks is refused, naming what about it is wrong',
    /\(a\+\)\+ repeats/.test(slow ?? ''),
    String(slow).slice(0, 70)
  )
  const timed = rules.ruleRefusal('(a|\\1a)+$', true)
  ok(
    'and one the analyser cannot read is refused, naming what it cannot read',
    /cannot check for safety/.test(timed ?? '') && /\\1/.test(timed ?? ''),
    String(timed).slice(0, 70)
  )

  ok('a literal of the same text is fine', rules.ruleRefusal('(a+)+$', false) === null)
  ok('an ordinary pattern is allowed', rules.ruleRefusal('\\bkobold\\s+guard\\b', true) === null)
  ok('an empty pattern is refused', rules.ruleRefusal('', true) === 'nothing to match')

  // And if one gets into storage anyway - an import, or a key written by
  // another build - the render path skips it rather than throwing per line.
  setRules({ gags: [gag({ pattern: '(unclosed', regex: true })] })
  ok(
    'a stored unrunnable gag hides nothing instead of throwing',
    hook.currentGameLines().length === SENT.length,
    `${hook.currentGameLines().length}`
  )
}

// ---------------------------------------------------- preview equals runtime
console.log('\n-- the preview and the game pane cannot disagree --')
{
  setRules({
    substitutes: [sub({ find: "Gor'Tog", replace: 'Tog' })],
    gags: [gag({ pattern: 'fully rested' })],
  })
  const live = { substitutes: cfg.domainEntries('substitutes'), gags: cfg.domainEntries('gags') }
  // What the preview computes, over the same input the pane had.
  const preview = link.gameLines().map((l) => rules.applyLineRules(l.text, live))
  const shown = hook.currentGameLines()
  const fromPreview = preview.filter((p) => !p.gagged).map((p) => p.text)
  ok('the preview has something to say', preview.some((p) => p.matched.length > 0), `${preview.length} lines`)
  ok(
    'the preview agrees with the pane, line for line',
    fromPreview.join('|') === shown.map((l) => l.text).join('|'),
    `${fromPreview.length} vs ${shown.length}`
  )

  // The property behind that agreement, checked as a property: neither the
  // panel nor the tabs may carry a matcher of their own.
  const OWN_MATCHER = /new RegExp|indexOf|\.split\(|\.replace\(/
  // Comments are stripped first. A grep that fires on the words "no matcher
  // of its own" in a file header is a check that cries wolf, and a check
  // right by accident teaches the wrong lesson. It is the code that must not
  // contain a matcher.
  const codeOf = (f) =>
    readFileSync(f, 'utf8')
      .replace(/\/\*[^]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
  const PANES = [
    'src/components/config/SubstitutesTab.tsx',
    'src/components/config/GagsTab.tsx',
    'src/components/config/LineRulePreview.tsx',
    'src/components/config/PlayerConfigPanel.tsx',
  ]
  for (const file of PANES) {
    ok(`no second matcher in ${file}`, !OWN_MATCHER.test(codeOf(file)))
  }
  ok(
    'control: that scan can see a matcher when there is one',
    OWN_MATCHER.test(codeOf('src/lib/lineRules.ts'))
  )
}

// -------------------------------------------------- highlights on top of it
console.log('\n-- a highlight paints the substituted text, not the original --')
{
  setRules({ substitutes: [sub({ find: "Gor'Tog", replace: 'Tog' })] })
  const shown = hook.currentGameLines()
  // A pattern that exists only after the substitution, so this says something
  // about the order rather than about whether paint() works.
  const highlights = [{ type: 'string', colour: '#66DDFF', pattern: 'A Tog guard', sourceLine: 0 }]
  const pieces = segments(shown[0].text, paint(shown[0].text, highlights))
  ok(
    'the highlight matches the rewritten line',
    pieces.some((p) => p.colour === '#66DDFF' && p.text === 'A Tog guard'),
    JSON.stringify(pieces.map((p) => p.text))
  )
  ok(
    'and the same highlight finds nothing in the original',
    paint(SENT[0], highlights).matched.length === 0
  )
}

// ------------------------------------------------------- the ear, not the eye
//
// Issue #484. A gag is a display preference, so it hides the line from the
// pane; it must not also silence the chime somebody bound to that line. The
// property is about *which reading* an alert consumer takes, so both halves
// are checked: the behaviour (the sound is still there to be played off the
// raw reading) and the source (the consumers that play it read raw).
console.log('\n-- a gag hides a line from the eye, not from the ear --')

/** A danger highlight on the combat line, carrying a sound. */
const DANGER_HL = [
  {
    type: 'string',
    colour: '#FF6666',
    pattern: 'swings a scimitar',
    cls: 'danger',
    sound: 'Growl.wav',
    sourceLine: 0,
  },
]
/** What GameSignals' effect would play over a given reading of the buffer. */
const soundsOver = (lines) =>
  lines.flatMap((l) => paint(l.text, DANGER_HL).matched.map((h) => h.sound).filter(Boolean))

{
  // The control first: with no rules at all, this rig can produce a sound.
  // Without it, every "the sound survived" below is also what a rig that
  // cannot paint anything would print.
  setRules({})
  ok(
    'control: the combat line carries a sound with no rules in play',
    soundsOver(hook.currentRawGameLines()).join('|') === 'Growl.wav',
    JSON.stringify(soundsOver(hook.currentRawGameLines()))
  )

  setRules({ gags: [gag({ pattern: 'kobold' })] })
  const shown = hook.currentGameLines()
  const raw = hook.currentRawGameLines()
  ok('the gag is doing something: the pane is a line shorter', shown.length === SENT.length - 1, `${shown.length} of ${SENT.length}`)
  ok('the raw reading still has every line', raw.length === SENT.length, `${raw.length} of ${SENT.length}`)
  ok(
    'a display-reading alert effect would play nothing',
    soundsOver(shown).length === 0,
    JSON.stringify(soundsOver(shown))
  )
  ok(
    'the raw-reading one still plays the chime',
    soundsOver(raw).join('|') === 'Growl.wav',
    JSON.stringify(soundsOver(raw))
  )

  // And with no gag at all: a substitute that removes the words the highlight
  // matched silences it just as completely off the display reading.
  setRules({ substitutes: [sub({ find: 'swings a scimitar', replace: 'attacks' })] })
  const subbed = hook.currentGameLines()
  ok(
    'the substitute is doing something: the matched words are gone from the pane',
    subbed.some((l) => l.text === 'A kobold guard attacks at you!'),
    JSON.stringify(subbed.map((l) => l.text))
  )
  ok(
    'a display-reading alert effect would play nothing after a substitute',
    soundsOver(subbed).length === 0,
    JSON.stringify(soundsOver(subbed))
  )
  ok(
    'the raw-reading one still plays it',
    soundsOver(hook.currentRawGameLines()).join('|') === 'Growl.wav'
  )
  ok('the raw buffer is byte identical through all of that', bufferPrint() === PRISTINE)
}

// --------------------------------------- every alert consumer reads the raw
//
// The behaviour above is only worth anything if the components that actually
// call the sound API take that reading. Derived rather than listed: the API
// names come out of `alertSound.ts`'s own exports, so a new `playX` is
// covered without anybody remembering to add it here.
console.log('\n-- every component that plays a sound reads the raw buffer --')

const SOUND_MODULE = 'src/lib/alertSound.ts'

/** The play-a-sound entry points, from the module that owns them. */
function soundApis() {
  const src = readFileSync(SOUND_MODULE, 'utf8')
  return [...src.matchAll(/export function (play[A-Za-z0-9]*)\s*\(/g)].map((m) => m[1])
}

function walkComponents(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkComponents(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/**
 * Classify one component's source. Takes the text, not the path, so the
 * sabotage below can hand it a mutant without writing to the tree.
 *
 * Matches the *import*, not the bare identifier, for the reason
 * `tools/gamelines-test.mjs` gives: a check that fires on the word "playAlert"
 * in a comment cries wolf, and a check that cries wolf gets suppressed.
 */
function classifyAlertConsumer(code, apis) {
  const imports = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs)].map((m) => ({
    named: m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()),
    from: m[2],
  }))
  const playsSound = imports.some((i) => /alertSound/.test(i.from) && i.named.some((n) => apis.includes(n)))
  const lineImports = imports.filter((i) => /useGameLines/.test(i.from)).flatMap((i) => i.named)
  return {
    playsSound,
    readsDisplay: lineImports.includes('useGameLines'),
    readsRaw: lineImports.includes('useRawGameLines'),
  }
}

{
  const apis = soundApis()
  ok('the sound API list was derived, not empty', apis.length > 0, apis.join(', '))
  ok('and it contains the one the alert effect calls', apis.includes('playAlert'), apis.join(', '))

  const files = walkComponents(join(process.cwd(), 'src', 'components'))
  ok('control: the component scan found a tree', files.length >= 20, `${files.length} files`)

  const consumers = files
    .map((f) => ({ file: f.split(sep).join('/').replace(/^.*\/src\//, 'src/'), ...classifyAlertConsumer(readFileSync(f, 'utf8'), apis) }))
    .filter((c) => c.playsSound)
  ok('control: something in this app plays a sound', consumers.length > 0, `${consumers.length} components`)

  const lineDriven = consumers.filter((c) => c.readsDisplay || c.readsRaw)
  ok(
    'control: at least one of them is driven by the game text',
    lineDriven.length > 0,
    lineDriven.map((c) => c.file).join(', ')
  )

  const onRaw = lineDriven.filter((c) => c.readsRaw && !c.readsDisplay)
  ok(
    `${onRaw.length} of ${lineDriven.length} sound-playing consumers read the raw buffer`,
    onRaw.length === lineDriven.length,
    lineDriven.map((c) => `${c.file}${c.readsRaw ? '' : ' READS THE DISPLAY LIST'}`).join(', ')
  )
}

ok('the buffer survived every case above byte for byte', bufferPrint() === PRISTINE)

// ------------------------------------------------------------------ sabotage
console.log('\n-- sabotage: each break reddens the case that names it, and only it --')

/** The files the sabotage rewrites, hashed before it runs. Checked again at
 *  the end, so "the mutants were copies" is measured rather than promised. */
const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex')
const MUTATED_SOURCES = Object.fromEntries(
  ['src/lib/lineRules.ts', 'src/lib/useGameLines.ts', 'src/lib/highlights.ts'].map((f) => [f, md5(f)])
)

{
  const dir = mkdtempSync(join(process.cwd(), 'tools', '.sabotage-'))
  SABOTAGE_DIR = dir
  const abs = (rel) => pathToFileURL(join(process.cwd(), rel)).href
  // This repo checks out CRLF on Windows, so an anchor written with plain
  // newlines stops matching the moment git has touched the file. Normalise
  // first, and make a sabotage that lands on nothing a hard abort rather than
  // a pass: a mutant identical to its source certifies nothing.
  const CR = String.fromCharCode(13)

  let mutantNo = 0
  async function loadMutant(label, file, transform, rewrite = []) {
    const src = readFileSync(file, 'utf8').split(CR).join('')
    let mutated = transform(src)
    if (mutated === src) {
      throw new Error(`sabotage "${label}" did not change ${file} - the target text was not found`)
    }
    for (const [spec, rel] of rewrite) mutated = mutated.split(`'${spec}'`).join(`'${abs(rel)}'`)
    const p = join(dir, `${label}-${++mutantNo}.ts`)
    writeFileSync(p, mutated)
    return import(pathToFileURL(p).href)
  }

  const LINE_RULES_IMPORTS = [
    ['./highlights.ts', 'src/lib/highlights.ts'],
    ['./playerConfig.ts', 'src/lib/playerConfig.ts'],
  ]

  // (1) The gag deletes from the raw buffer instead of filtering on read -
  //     the shape this whole design exists to refuse.
  {
    const mod = await loadMutant(
      'gag-deletes-from-the-buffer',
      'src/lib/useGameLines.ts',
      (s) =>
        s.replace(
          '    if (result.gagged && !show) continue',
          '    if (result.gagged && !show) { gameLines().splice(gameLines().indexOf(line), 1); continue }'
        ),
      [
        ['./gameLink.ts', 'src/lib/gameLink.ts'],
        ['./lineRules.ts', 'src/lib/lineRules.ts'],
        ['./playerConfig.ts', 'src/lib/playerConfig.ts'],
        ['./storage.ts', 'src/lib/storage.ts'],
      ]
    )
    setRules({ gags: [gag({ pattern: 'fully rested' })] })
    const before = bufferPrint()
    const shown = mod.currentGameLines()
    const after = bufferPrint()
    ok(
      'sabotage lands: the gagged line is off screen',
      !shown.some((l) => l.text === 'You feel fully rested.'),
      `${shown.length} shown`
    )
    ok(
      'sabotage caught: the raw buffer is no longer byte identical',
      after !== before,
      'the line was removed from the buffer'
    )
    ok(
      'and the check names the line that went missing',
      !link.gameLines().some((l) => l.text === 'You feel fully rested.')
    )
    // Put it back, so the rest of this run is measuring the real thing.
    link.clearGame()
    SENT.forEach((text, i) => deliver(i + 1, text))
    await settle()
    // By text, not by print: `clearGame()` does not reset the sequence
    // counter, so the restored lines carry higher `seq` values. What matters
    // for the cases after this one is that the text is all back.
    ok(
      'the buffer was restored for the cases after this one',
      link.gameLines().map((l) => l.text).join('|') === SENT.join('|'),
      `${link.gameLines().length} lines`
    )
  }

  // (2) An empty rule set gags everything instead of doing nothing.
  {
    const mod = await loadMutant(
      'empty-set-filters-to-nothing',
      'src/lib/lineRules.ts',
      (s) =>
        s.replace(
          '  return { text: out, gagged: false, matched }',
          '  return { text: out, gagged: matched.length === 0, matched }'
        ),
      LINE_RULES_IMPORTS
    )
    const empty = mod.applyLineRules(SENT[0], { substitutes: [], gags: [] })
    ok('sabotage lands: the no-op case reddens', empty.gagged === true, 'an empty set now gags')
    const matched = mod.applyLineRules(SENT[0], {
      substitutes: [sub({ find: "Gor'Tog", replace: 'Tog' })],
      gags: [],
    })
    ok(
      'sabotage is scoped: a rule that matches still rewrites and is not gagged',
      matched.text === 'A Tog guard just arrived.' && matched.gagged === false
    )
  }

  // (3) A gag switched off fires anyway.
  {
    const mod = await loadMutant(
      'disabled-gag-still-fires',
      'src/lib/lineRules.ts',
      (s) => s.replace('    if (!rule.enabled || !rule.pattern) continue', '    if (!rule.pattern) continue'),
      LINE_RULES_IMPORTS
    )
    const off = mod.applyLineRules(SENT[1], {
      substitutes: [],
      gags: [gag({ pattern: 'fully rested', enabled: false })],
    })
    ok('sabotage lands: the disabled-gag case reddens', off.gagged === true)
    const stillOff = mod.applyLineRules(SENT[0], {
      substitutes: [sub({ find: "Gor'Tog", replace: 'Tog', enabled: false })],
      gags: [],
    })
    ok(
      'sabotage is scoped: a disabled substitute is still off',
      stillOff.text === SENT[0],
      stillOff.text
    )
  }

  // (4) The alert consumer reads the display list again - issue #484 as it
  //     stood. Done on the text rather than on disk, because the classifier
  //     takes source and not a path: nothing is written, and the check that
  //     the real file is untouched at the end still means something.
  {
    const file = 'src/components/shared/GameSignals.tsx'
    const real = readFileSync(file, 'utf8')
    const mutant = real.split('useRawGameLines').join('useGameLines')
    if (mutant === real) {
      throw new Error(`sabotage "alert-consumer-reads-the-display-list" did not change ${file} - the target text was not found`)
    }
    const apis = soundApis()
    const before = classifyAlertConsumer(real, apis)
    const after = classifyAlertConsumer(mutant, apis)
    ok(
      'control: the classifier sees the real file as a raw-reading sound player',
      before.playsSound && before.readsRaw && !before.readsDisplay,
      JSON.stringify(before)
    )
    ok(
      'sabotage caught: the same classifier reddens on the display-reading mutant',
      after.playsSound && after.readsDisplay && !after.readsRaw,
      JSON.stringify(after)
    )
    // Scoped: it is the reading that changed, not whether the file plays a
    // sound at all. A mutant that stopped importing the sound API would drop
    // out of the population instead of failing, which is the check reporting
    // nothing rather than reporting a defect.
    ok('sabotage is scoped: the mutant still plays a sound', after.playsSound === true)
  }
}

if (SABOTAGE_DIR) rmSync(SABOTAGE_DIR, { recursive: true, force: true })

// The mutants were copies. Prove it rather than assert it: these three files
// must be exactly what git has, byte for byte, after a run that deliberately
// rewrote all of them.
for (const [file, before] of Object.entries(MUTATED_SOURCES)) {
  ok(`${file} is byte for byte what it was before the sabotage`, md5(file) === before, md5(file))
}

console.log(`\n${checked} checked, ${failed} failed`)
if (checked < 40) {
  console.log(`FAIL only ${checked} checks ran; this suite has never had fewer than 40`)
  process.exit(1)
}
process.exit(failed ? 1 : 0)
