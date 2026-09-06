/**
 * The highlight engine, against the corpus it has to run and the text it has
 * to run on.
 *
 * Two things are being asserted and they are different claims:
 *
 *   1. The parser reads Genie's format. Cheap, and a config that fails to load
 *      fails loudly.
 *   2. **Real observed game lines get the colour they were written for.** That
 *      is the one that matters, and it is the same lesson dr-genie-settings
 *      learned the hard way: "the pattern is in the file" and "the pattern
 *      matches the line" are different claims, and a config that fires on
 *      nothing passes every check that only reads the file.
 *
 * The lines below were captured off the wire on 27 Aug 2026. Invented game
 * text would encode what somebody assumed DragonRealms looks like, which is
 * exactly how a GemStone mindstate ladder ended up in a DragonRealms config.
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { parseHighlights, paint, segments } from '../src/lib/highlights.ts'

let failed = 0
let checked = 0
const unchecked = []
/** Where the sabotage mutants live, removed before the summary. */
let SABOTAGE_DIR = null
const ok = (name, cond, detail = '') => {
  checked++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(50)}${detail}`)
}
const skip = (name, why) => {
  unchecked.push(name)
  console.log(`SKIP ${name.padEnd(50)}${why}`)
}

console.log('-- buffered history is fenced before alert playback --')
{
  const signals = readFileSync('src/components/shared/GameSignals.tsx', 'utf8')
  const historyFence = signals.indexOf('This effect must stay before the playback effect')
  const playback = signals.indexOf('const fresh = lines.filter')
  ok('the highlight-load history fence exists', historyFence >= 0)
  ok('the history fence is declared before playback', historyFence < playback)
}

console.log('-- the parser reads the format, and says what it could not --')
{
  const { entries, skipped } = parseHighlights(`
# a comment, and a blank line

#highlight {line} {#FF0000} {HAS FLAGGED YOU AS IDLE} {alert} {Help.wav}
#highlight {string} {#66DDFF} {just arrived} {people}
#highlight {beginswith} {#5C7A99} {Obvious paths:} {room}
#highlight {regexp} {#4499BB} { (?:east|west)\\.$} {people}
#highlight {nonsense} {#FF0000} {x} {y}
#highlight {line} {red} {x} {y}
#highlight {line} {#FF0000} {} {y}
#highlight {regexp} {#FF0000} {([unclosed} {y}
`)

  ok('the good ones parsed', entries.length === 4, `${entries.length} of 4`)
  ok('every bad one was reported', skipped.length === 4, `${skipped.length} skipped`)
  ok('an unknown type is named', skipped.some((s) => s.includes('nonsense')))
  ok('a bad colour is named', skipped.some((s) => s.includes('not a colour')))
  ok('an empty pattern is named', skipped.some((s) => s.includes('empty pattern')))

  // The one Genie itself gets wrong: it drops a malformed regexp in silence,
  // so the alert you thought you had never fires and nothing tells you.
  ok('a regexp that will not compile is named', skipped.some((s) => s.includes('([unclosed')))
}

console.log('\n-- line and string are different, which is most of the point --')
{
  const { entries } = parseHighlights(`
#highlight {line} {#FF0000} {bleeding} {wounds}
#highlight {string} {#66DDFF} {black lynx} {people}
`)

  const whole = paint('You are bleeding from a wound.', entries)
  ok('line claims the whole line', whole.lineColour === '#FF0000', whole.lineColour ?? 'none')
  ok('and adds no substring span', whole.spans.length === 0, `${whole.spans.length}`)

  const part = paint('You notice as a black lynx pads into the area.', entries)
  ok('string does not claim the line', part.lineColour === undefined, part.lineColour ?? 'none')
  ok('string colours just the match', part.spans.length === 1, `${part.spans.length} spans`)

  const cut = segments('You notice as a black lynx pads into the area.', part)
  ok('the line is cut into three', cut.length === 3, `${cut.length} pieces`)
  ok('the middle piece is the creature', cut[1]?.text === 'black lynx', cut[1]?.text ?? '')
  ok(
    'and rejoining gives the line back',
    cut.map((c) => c.text).join('') === 'You notice as a black lynx pads into the area.'
  )
}

console.log('\n-- beginswith survives the indentation the game actually uses --')
{
  const { entries } = parseHighlights('#highlight {beginswith} {#7FB069} {Performance} {learning}')
  // The experience window indents every row. A beginswith that failed on that
  // would be a rule nobody could ever make work.
  const p = paint('     Performance:      5 07% perusing       (2/34)', entries)
  ok('an indented row still matches', p.lineColour === '#7FB069', p.lineColour ?? 'none')
}

console.log('\n-- classes switch off, the way #class people off does --')
{
  const { entries } = parseHighlights('#highlight {line} {#66DDFF} {just arrived} {people}')
  ok('on by default', paint('Wipsy just arrived.', entries).lineColour === '#66DDFF')
  ok(
    'and off when the class is off',
    paint('Wipsy just arrived.', entries, new Set(['people'])).lineColour === undefined
  )
}

console.log('\n-- overlapping spans cannot duplicate the text --')
{
  // Two entries matching overlapping stretches. Rendered naively this produces
  // crossing spans and the text comes out twice, which is the kind of bug that
  // looks like the game sent something strange.
  const { entries } = parseHighlights(`
#highlight {string} {#FF0000} {black lynx pads} {a}
#highlight {string} {#00FF00} {lynx pads into} {b}
`)
  const line = 'a black lynx pads into the area'
  const p = paint(line, entries)
  ok('overlaps are resolved to one', p.spans.length === 1, `${p.spans.length}`)
  ok('and the text is intact', segments(line, p).map((s) => s.text).join('') === line)
}

console.log('\n-- the real corpus, against the real lines it was written for --')
{
  const CFG = 'C:/Users/Admin/dev/dr-genie-settings/Config/highlights.cfg'
  if (!existsSync(CFG)) {
    // Not a pass. The instrument is missing and the summary has to say so.
    skip('the shipped corpus loads', `not at ${CFG}`)
    skip('every observed line gets a colour', 'no corpus to run')
  } else {
    const { entries, skipped } = parseHighlights(readFileSync(CFG, 'utf8'))

    // The fragile denominator: every assertion below is trivially true against
    // an empty entry list, which is what a broken parser produces.
    ok('the shipped corpus loads', entries.length >= 40, `${entries.length} entries`)
    ok('with nothing skipped', skipped.length === 0, skipped.slice(0, 2).join('; '))

    const OBSERVED = [
      ['GENIE HAS FLAGGED YOU AS IDLE, PLEASE RESPOND!', 'idle warning'],
      ['Wipsy just arrived.', 'player arrives'],
      ['Commoner Brommoner hobbles east.', 'player leaves, odd verb'],
      ['A shaggy mutt bounds into the area.', 'creature arrives'],
      ['The black lynx pads off.', 'creature leaves'],
      ['     Performance:      5 07% perusing       (2/34)', 'an experience row'],
      ['You feel fully attuned to the mana streams again.', 'mana'],
      ['Obvious paths: east, south, west.', 'room block'],
      ['You are relaxed and your mind has entered a light state of rest.', 'resting'],
      ['The armor on your head makes playing your cocobolo txistu more difficult.', 'the helm'],
    ]

    const bare = OBSERVED.filter(([line]) => {
      const p = paint(line, entries)
      return p.lineColour === undefined && p.spans.length === 0
    })
    ok(
      'every observed line gets a colour',
      bare.length === 0,
      bare.length ? bare.map(([, why]) => why).join(', ') : `${OBSERVED.length} lines`
    )

    // The alerts that cost a session have to reach the ear, not just the eye.
    const idle = paint('GENIE HAS FLAGGED YOU AS IDLE, PLEASE RESPOND!', entries)
    ok('the idle warning still makes a sound', idle.sounds.length > 0, idle.sounds.join(', '))

    // And the line that fires several times a minute must not.
    const mana = paint('You feel fully attuned to the mana streams again.', entries)
    ok('the most frequent line stays silent', mana.sounds.length === 0, mana.sounds.join(', '))
  }
}

// --- a pattern that compiles is not a pattern that is safe to run ----------

// `paint()` runs per rendered line and GamePane keeps 400 in the DOM, so a
// pattern that backtracks does not make the client slow, it makes it stop.
// Measured before the guard existed: `(\w+\s?)+$` - which reads as "a run of
// words to the end of the line", and which somebody would plausibly write -
// did not finish in thirty seconds against one ordinary room description.
console.log('\n-- patterns that backtrack are refused at load, not at render --')

const cfg = (p) => `#highlight {regexp} {#FF0000} {${p}}`
const load = (p) => parseHighlights(cfg(p))
const refused = (p) => load(p).entries.length === 0

// `ok` prints its third argument whether or not the check passed, so these
// say what happened rather than what failure would have looked like.
for (const p of ['(a+)+$', '(\\w+\\s?)+$', '(\\s*\\w+\\s*)+!', '([A-Za-z]+\\s*)+X', '(\\d+)+$']) {
  const { skipped } = load(p)
  ok(`refuses /${p}/`, refused(p), skipped[0]?.match(/took \d+ms/)?.[0] ?? 'was loaded')
}

// The floor, and it is the half that matters. A guard that refuses everything
// would pass every check above and silently disable highlighting altogether -
// which looks exactly like a clean run.
for (const p of [
  '\\bkobold\\s+guard\\b',
  '([A-Za-z]+ )+\\.',
  '(\\w+\\s+)+of the (\\w+\\s*)+$',
  '\\d+ silver',
  '^\\d+ of \\d+',
  'You feel \\w+',
  'Wipsy|Phemius',
]) {
  ok(`still loads /${p}/`, !refused(p), refused(p) ? 'wrongly refused' : 'ok')
}

// And the refusal has to say why, or the user sees a highlight quietly missing
// with nothing to act on.
const why = parseHighlights(cfg('(a+)+$')).skipped[0] ?? ''
ok('the refusal explains itself', /ms on a .*probe/.test(why), why.slice(0, 80))


// --- Q2: the editor, the store behind it, and the preview -----------------

/*
 * Everything above this line is the engine reading a Genie file. Everything
 * below is the editor: the store round trip, the two refusals the editor owns,
 * and the property that the preview is the game pane rather than a second
 * implementation of it.
 *
 * The store is driven through the same functions the tabs call - `addEntry`,
 * `updateEntry`, `removeEntry` - and observed through `currentHighlights()`,
 * which is what `useHighlights()` returns. A check that called
 * `resolveHighlights` directly would prove the resolver works and say nothing
 * about whether the game pane reads it.
 */

// Minimal localStorage shim, the same shape tools/storage-test.mjs uses. It
// has to exist before playerConfig.ts is imported, which is why these imports
// are down here and dynamic rather than at the top of the file.
const memory = new Map()
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
}

const store = await import('../src/lib/playerConfig.ts')
const hl = await import('../src/lib/highlights.ts')
const { currentHighlights } = await import('../src/lib/useHighlights.ts')

const rule = (fields) => ({
  id: fields.id ?? store.newId('highlights'),
  enabled: true,
  source: 'player',
  ...fields,
})

const fresh = () => {
  memory.clear()
  store.resetPlayerConfigCache()
}

console.log('\n-- a rule added in the editor reaches the renderer, with no Genie install --')
{
  fresh()
  // Nothing has ever read a Genie file in this process: there is no Tauri, no
  // `read_genie_config`, and the store starts empty. This is the machine the
  // whole lane exists for.
  ok('nothing is stored to begin with', currentHighlights().highlights.length === 0)

  const added = rule({ type: 'line', pattern: 'just arrived', colour: '#66DDFF' })
  ok('addEntry writes', store.addEntry('highlights', added).ok)

  const live = currentHighlights().highlights
  ok('the runtime sees it without a reload', live.length === 1, `${live.length}`)
  ok(
    'and the line it was written for is coloured',
    paint('Wipsy just arrived.', live).lineColour === '#66DDFF',
    paint('Wipsy just arrived.', live).lineColour ?? 'none'
  )

  store.updateEntry('highlights', added.id, { pattern: 'wanders in', colour: '#FF0000' })
  const edited = currentHighlights().highlights
  ok(
    'an edit changes what matches, not only what is stored',
    paint('Wipsy just arrived.', edited).lineColour === undefined &&
      paint('A kobold wanders in.', edited).lineColour === '#FF0000',
    paint('A kobold wanders in.', edited).lineColour ?? 'none'
  )

  store.updateEntry('highlights', added.id, { enabled: false })
  ok(
    'a rule switched off is absent from the resolver, not merely unmatched',
    currentHighlights().highlights.length === 0,
    `${currentHighlights().highlights.length} live`
  )
  ok(
    'and it is reported as refused rather than vanishing',
    hl.resolveHighlights(store.loadPlayerConfig()).refused.some((r) => r.id === added.id)
  )

  store.updateEntry('highlights', added.id, { enabled: true })
  store.removeEntry('highlights', added.id)
  ok('remove takes it out of the store', store.domainEntries('highlights').length === 0)
  ok('and out of the renderer', currentHighlights().highlights.length === 0)
}

console.log('\n-- a preset in use cannot be deleted without naming what uses it --')
{
  fresh()
  const preset = {
    id: 'pre-arrivals',
    enabled: true,
    source: 'player',
    name: 'arrivals',
    fg: '#66DDFF',
    bold: false,
  }
  store.setDomain('presets', [preset])
  const users = [
    rule({ type: 'line', pattern: 'just arrived', presetId: preset.id }),
    rule({ type: 'string', pattern: 'black lynx', presetId: preset.id }),
    rule({ type: 'line', pattern: 'wanders in', colour: '#FF0000' }),
  ]
  store.setDomain('highlights', users)

  const verdict = hl.refuseDeletingPreset(preset, store.domainEntries('highlights'))
  ok('deleting it is refused', verdict.ok === false)
  ok('the refusal counts them', verdict.ok === false && verdict.users.length === 2, verdict.why)
  // The count and the rules, because "2 highlights use it" is a fact nobody
  // can act on without going and finding the two by hand.
  ok('the count is in the message', verdict.ok === false && verdict.why.includes('2 highlights'))
  ok(
    'and every rule is named in it',
    verdict.ok === false &&
      verdict.why.includes('just arrived') &&
      verdict.why.includes('black lynx')
  )
  ok(
    'the rule that does not use it is not named',
    verdict.ok === false && !verdict.why.includes('wanders in')
  )

  // The floor. A refusal that fires for every preset would pass every line
  // above and make the tab useless, which looks exactly like a clean run.
  const unused = { id: 'pre-unused', enabled: true, source: 'player', name: 'spare', fg: '#111111', bold: false }
  ok('a preset nothing uses is deletable', hl.refuseDeletingPreset(unused, store.domainEntries('highlights')).ok === true)

  // And the backstop behind the refusal: a dangling reference does not vanish.
  store.setDomain('presets', [])
  const { entries, refused } = hl.resolveHighlights(store.loadPlayerConfig())
  ok('a rule naming a deleted preset still renders', entries.length === 3, `${entries.length} of 3`)
  ok(
    'in the default colour',
    entries.filter((e) => e.colour === '').length === 2,
    entries.map((e) => e.colour || 'default').join(' ')
  )
  ok(
    'and it appears in refused, naming the preset',
    refused.length === 2 && refused.every((r) => r.why.includes('pre-arrivals')),
    refused.map((r) => r.why).join(' | ')
  )
}

console.log('\n-- an invalid pattern is refused at save, and never reaches paint() --')
{
  fresh()
  // The gate: what the editor calls before every write. Two states, and the
  // second carries the reason, because a rule refused without one is a rule
  // the player cannot fix.
  const unclosed = hl.compilePattern('regexp', '([unclosed')
  ok('an unclosed group is refused', unclosed.ok === false)
  ok(
    'and the refusal names the error',
    unclosed.ok === false && unclosed.why.length > 0,
    unclosed.ok === false ? unclosed.why : ''
  )
  const slow = hl.compilePattern('regexp', '(a+)+$')
  ok('a pattern that backtracks is refused', slow.ok === false)
  ok(
    'with its measured time',
    slow.ok === false && /took \d+ms on a .*probe/.test(slow.why),
    slow.ok === false ? slow.why.slice(0, 60) : ''
  )
  // The floor again: a gate that refuses everything would pass both.
  ok('an ordinary pattern passes the gate', hl.compilePattern('regexp', '\\bkobold\\b').ok === true)
  ok('a non-regexp pattern passes it too', hl.compilePattern('line', '([unclosed').ok === true)
  ok('an empty pattern does not', hl.compilePattern('line', '').ok === false)

  /*
   * The property, which is not "the editor validates" but "the runtime never
   * sees an invalid rule". So the store is handed one directly - the state a
   * corrupted key, a hand-edited localStorage or a future import bug would
   * produce - and the runtime is observed.
   */
  store.setDomain('highlights', [
    rule({ type: 'regexp', pattern: '([unclosed', colour: '#FF0000' }),
    rule({ type: 'line', pattern: 'just arrived', colour: '#66DDFF' }),
  ])
  const live = currentHighlights().highlights
  ok('the broken rule is not handed to the renderer', live.length === 1, `${live.length} of 2`)
  let threw = null
  try {
    paint('Wipsy just arrived.', live)
  } catch (e) {
    threw = e
  }
  ok('and paint() runs rather than throwing', threw === null, threw ? String(threw) : 'no throw')
  ok(
    'the refusal says which rule and why',
    hl.resolveHighlights(store.loadPlayerConfig()).refused.length === 1,
    hl.resolveHighlights(store.loadPlayerConfig()).refused[0]?.why ?? ''
  )
}

console.log('\n-- the preview is the game pane, not a second implementation of it --')
{
  const tab = readFileSync('src/components/config/HighlightsTab.tsx', 'utf8')
  const engine = readFileSync('src/lib/highlights.ts', 'utf8')
  const count = (text, needle) => text.split(needle).length - 1

  /*
   * The check Q2's `verify:` names. A grep for zero is worth nothing on its
   * own - a typo in the needle, a file read from the wrong path, and it says
   * zero for the same reason it would say zero if the rule were kept. So each
   * needle is counted in `highlights.ts` first, where it must be non-zero.
   */
  for (const needle of ['RegExp', 'indexOf']) {
    ok(
      `positive control: "${needle}" is present in highlights.ts`,
      count(engine, needle) > 0,
      `${count(engine, needle)}`
    )
    ok(
      `the tab has no "${needle}" of its own`,
      count(tab, needle) === 0,
      `${count(tab, needle)}`
    )
  }
  ok('nor a .test( of its own', count(tab, '.test(') === 0, `${count(tab, '.test(')}`)

  // Absence is half the claim. The other half is that it calls the real ones.
  ok('it imports paint from the engine', tab.includes('paint,'))
  ok('it renders through HighlightedText', tab.includes('<HighlightedText'))
  ok('and it takes its lines from useGameLines', tab.includes('useGameLines()'))
  ok('it prints the denominator beside the count', tab.includes('previewLines.length'))

  /*
   * And the functional half: the preview's own sample, run through `paint()`
   * exactly as the tab runs it. The sample lives in `highlights.ts` rather
   * than in the tab precisely so this can read the same array the screen is
   * showing instead of a copy that could drift.
   */
  fresh()
  store.setDomain('highlights', [
    rule({ type: 'beginswith', pattern: 'Obvious paths:', colour: '#5C7A99' }),
    rule({ type: 'string', pattern: 'black lynx', colour: '#66DDFF' }),
  ])
  const live = currentHighlights().highlights
  const hits = hl.HIGHLIGHT_PREVIEW_SAMPLE.filter((text) => {
    const painted = paint(text, live, new Set())
    return painted.lineColour !== undefined || painted.spans.length > 0
  })
  ok('the sample is real game text, six lines of it', hl.HIGHLIGHT_PREVIEW_SAMPLE.length === 6, `${hl.HIGHLIGHT_PREVIEW_SAMPLE.length}`)
  ok('two of the six match these two rules', hits.length === 2, `${hits.length} of ${hl.HIGHLIGHT_PREVIEW_SAMPLE.length}`)
  ok(
    'the whole-line rule claims its line',
    paint(hl.HIGHLIGHT_PREVIEW_SAMPLE[0], live, new Set()).lineColour === '#5C7A99'
  )
  ok(
    'and the substring rule claims only its substring',
    paint(hl.HIGHLIGHT_PREVIEW_SAMPLE[1], live, new Set()).spans.length === 1 &&
      paint(hl.HIGHLIGHT_PREVIEW_SAMPLE[1], live, new Set()).lineColour === undefined
  )
}

console.log('\n-- sabotage: each break reddens the case that names it, and only it --')
{
  const dir = mkdtempSync(join(process.cwd(), 'tools', '.sabotage-'))
  SABOTAGE_DIR = dir
  const abs = (rel) => pathToFileURL(join(process.cwd(), rel)).href

  /*
   * Line endings are normalised before the anchor is matched. This repo checks
   * out CRLF on Windows, so an anchor written with plain newlines matches on a
   * working copy a session just wrote and stops matching the moment git has
   * touched the file. `String.fromCharCode(13)` rather than an escape, because
   * a backslash written through a shell tool is its own trap.
   */
  const CR = String.fromCharCode(13)

  /*
   * Nothing on disk is modified. Every mutant is a copy in a scratch directory
   * that is removed at the end, and the two files under test are hashed before
   * and after the whole run so "the working tree is unchanged" is a check
   * rather than a promise - six lanes are editing this repo at once.
   */
  const WATCHED = ['src/lib/highlights.ts', 'src/components/config/HighlightsTab.tsx']
  const hashes = WATCHED.map((f) => createHash('md5').update(readFileSync(f)).digest('hex'))

  async function loadMutant(label, file, transform, rewrite = []) {
    const src = readFileSync(file, 'utf8').split(CR).join('')
    const mutated0 = transform(src)
    if (mutated0 === src) {
      throw new Error(`sabotage "${label}" did not change ${file} - the target text was not found`)
    }
    let mutated = mutated0
    for (const [spec, rel] of rewrite) mutated = mutated.split(`'${spec}'`).join(`'${abs(rel)}'`)
    const p = join(dir, `${label}.ts`)
    writeFileSync(p, mutated)
    return import(pathToFileURL(p).href)
  }

  // (1) The gate lets everything through.
  {
    const mod = await loadMutant('gate-open', 'src/lib/highlights.ts', (s) =>
      s.replace(
        "  if (!pattern) return { ok: false, why: 'empty pattern' }",
        '  if (pattern !== undefined) return { ok: true }'
      )
    )
    ok(
      'sabotage lands: an unclosed group is no longer refused at save',
      mod.compilePattern('regexp', '([unclosed').ok === true
    )
    ok(
      'sabotage lands: a backtracking pattern is no longer refused either',
      mod.compilePattern('regexp', '(a+)+$').ok === true
    )
    // One gate, one function, by design - so the runtime backstop goes with
    // it, and the second half of the property ("never reaches paint()") is
    // broken too. Asserted rather than assumed: a sabotage whose blast radius
    // is guessed at is a sabotage nobody has looked at.
    const cfg2 = {
      presets: [],
      highlights: [{ id: 'h1', enabled: true, type: 'regexp', pattern: '([unclosed', colour: '#FF0000' }],
    }
    ok(
      'sabotage lands: the broken rule now reaches the renderer',
      mod.resolveHighlights(cfg2).entries.length === 1 && mod.resolveHighlights(cfg2).refused.length === 0
    )
    ok(
      'sabotage is scoped: a good Genie config still parses',
      mod.parseHighlights('#highlight {line} {#FF0000} {bleeding} {wounds}').entries.length === 1
    )
    ok(
      'sabotage is scoped: a switched-off rule is still dropped',
      mod.resolveHighlights({
        presets: [],
        highlights: [{ id: 'h3', enabled: false, type: 'line', pattern: 'x', colour: '#FF0000' }],
      }).entries.length === 0
    )
  }

  // (2) The preview grows a matcher of its own.
  {
    const tabSrc = readFileSync('src/components/config/HighlightsTab.tsx', 'utf8')
    const withMatcher = tabSrc.replace(
      'const hits = previewLines.filter((text) => {',
      'const hits = previewLines.filter((text) => {\n    if (new RegExp(rule.pattern).exec(text)) return true'
    )
    if (withMatcher === tabSrc) {
      throw new Error('sabotage "own-matcher" did not change HighlightsTab.tsx - the anchor was not found')
    }
    const count = (text, needle) => text.split(needle).length - 1
    ok('sabotage lands: the grep the verify names now finds one', count(withMatcher, 'RegExp') === 1, `${count(withMatcher, 'RegExp')}`)
    ok('sabotage is scoped: the real file is still clean', count(tabSrc, 'RegExp') === 0, `${count(tabSrc, 'RegExp')}`)
  }

  // (3) The refused list is dropped on the floor.
  {
    const mod = await loadMutant('no-refusals', 'src/lib/highlights.ts', (s) =>
      s.replace('  return { entries, refused }\n}', '  return { entries, refused: [] }\n}')
    )
    const cfg3 = {
      presets: [],
      highlights: [{ id: 'h2', enabled: true, type: 'line', pattern: 'x', presetId: 'gone' }],
    }
    ok(
      'sabotage lands: the deleted-preset case no longer names the rule',
      mod.resolveHighlights(cfg3).refused.length === 0
    )
    ok(
      'sabotage is scoped: the rule still renders in the default colour',
      mod.resolveHighlights(cfg3).entries.length === 1 &&
        mod.resolveHighlights(cfg3).entries[0].colour === ''
    )
  }

  // (4) The hook stops reading the store, the way it read Genie before Q1.
  {
    const mod = await loadMutant(
      'no-store',
      'src/lib/useHighlights.ts',
      (s) => s.replace('  const cfg = loadPlayerConfig()', '  const cfg = { highlights: [], presets: [] }'),
      [
        ['./highlights.ts', 'src/lib/highlights.ts'],
        ['./playerConfig.ts', 'src/lib/playerConfig.ts'],
      ]
    )
    fresh()
    store.setDomain('highlights', [rule({ type: 'line', pattern: 'just arrived', colour: '#66DDFF' })])
    ok(
      'sabotage lands: with the store unread, a machine with no Genie has no highlights',
      mod.currentHighlights().highlights.length === 0,
      `${mod.currentHighlights().highlights.length}`
    )
    ok('sabotage is scoped: the real hook still has it', currentHighlights().highlights.length === 1)
  }

  const after = WATCHED.map((f) => createHash('md5').update(readFileSync(f)).digest('hex'))
  WATCHED.forEach((f, i) => {
    ok(`${f} is byte for byte what it was`, hashes[i] === after[i], after[i])
  })
}

if (SABOTAGE_DIR) rmSync(SABOTAGE_DIR, { recursive: true, force: true })

/*
 * The floor. A truncated run - an import that threw, a block that never
 * executed - prints no failures for the same reason a clean one does, so the
 * number of checks is asserted rather than reported. Set below the real count
 * so it catches an empty run and never needs touching otherwise.
 */
console.log(`\n${checked} checked, ${failed} failed`)
if (checked < 60) {
  console.log(`FAIL only ${checked} checks ran; this suite has never had fewer than 60`)
  process.exit(1)
}

console.log(
  failed
    ? `\n${failed} failed`
    : unchecked.length
      ? `\nno failures, but ${unchecked.length} not checked: ${unchecked.join(', ')}`
      : '\nall passed'
)
process.exit(failed ? 1 : 0)
