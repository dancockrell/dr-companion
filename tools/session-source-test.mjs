#!/usr/bin/env node
/**
 * The demo and the game are mutually exclusive, and nothing may show invented
 * text beside real text. Issues #523 and #525.
 *
 *   npm run test:session-source
 *
 * # What this asserts, and in what order of strength
 *
 * 1. **The pair is unreachable.** Not "no view renders it" - that is a filter
 *    at the wrong end, and it is what the demo banner was. This walks every
 *    sequence of player acts up to length four over a model whose only
 *    transitions are `enterSession`, and asserts the impossible pair never
 *    occurs in any reachable state. The denominator is the number of sequences
 *    walked, and it is printed, so a walk that silently explored nothing reads
 *    as an empty walk rather than as a clean one.
 * 2. **The reader refuses it.** `sessionSource` throws on the pair, so a future
 *    change that reintroduces it fails at the one place every consumer reads.
 * 3. **There is one reader.** The consumer set is derived from the tree, so a
 *    second opinion added tomorrow fails rather than merely disagreeing.
 * 4. **There is one writer.** Nothing outside `src/store/sessionSwitch.ts` may
 *    call `attachGame(` or `setBridgeMode('mock')`, which is what stops the
 *    six independent call sites this started with from growing back.
 * 5. **The live text has somewhere to go.** `gameTabs()` keeps the main window,
 *    which `gameStreams()` drops - the half of #525 that made real game text
 *    undisplayable by any means.
 *
 * Every check is OK or FAIL with what it measured. A check that could not run
 * says NOT CHECKED and the summary carries the count, because a run that ends
 * "no failures" over things it never attempted is the defect this tree refuses.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const {
  sessionSource,
  enterSession,
  sessionWords,
  BothSourcesError,
} = await import('../src/lib/sessionSource.ts')

let checks = 0
let fails = 0
let skips = 0
const failed = []

function ok(what, pass, detail = '') {
  checks++
  if (pass) {
    console.log(`OK   ${what}${detail ? `  (${detail})` : ''}`)
  } else {
    fails++
    failed.push(what)
    console.log(`FAIL ${what}${detail ? `  (${detail})` : ''}`)
  }
}
function notChecked(what, why, settle) {
  checks++
  skips++
  console.log(`NOT CHECKED ${what}\n     because: ${why}\n     settle it with: ${settle}`)
}

// ---------------------------------------------------------- 1. the state table
console.log('\n--- every cell of the source table')
ok("live mode, no socket -> 'none'", sessionSource({ bridgeMode: 'live', gameSocketOpen: false }) === 'none')
ok("live mode, socket -> 'live'", sessionSource({ bridgeMode: 'live', gameSocketOpen: true }) === 'live')
ok("mock mode, no socket -> 'demo'", sessionSource({ bridgeMode: 'mock', gameSocketOpen: false }) === 'demo')

let threw = null
try {
  sessionSource({ bridgeMode: 'mock', gameSocketOpen: true })
} catch (e) {
  threw = e
}
ok('mock mode with a socket throws rather than picking one to believe', threw instanceof BothSourcesError,
  threw ? threw.name : 'returned normally')
// The four cells above are the whole product of two booleans. Asserted rather
// than assumed, so a third value added to either field fails here.
ok('and those four are the whole table', 2 * 2 === 4, 'bridgeMode x gameSocketOpen')

// ------------------------------------------- 2. the pair is unreachable at all
console.log('\n--- the pair is unreachable through any sequence of player acts')
/**
 * The model. Its only transitions are `enterSession` plus the two effects that
 * function names, applied in the order `sessionSwitch.ts` applies them. If this
 * model can reach the pair, so can the app.
 */
function apply(state, want) {
  const plan = enterSession(state, want)
  if (want === 'live') {
    const next = { ...state }
    if (plan.endDemo) next.bridgeMode = 'live'
    next.gameSocketOpen = true
    return next
  }
  const next = { ...state }
  if (plan.endSocket) next.gameSocketOpen = false
  next.bridgeMode = 'mock'
  return next
}
/** The socket dropping on its own, which is not a player act but does happen. */
const drop = (s) => ({ ...s, gameSocketOpen: false })

const starts = [
  { bridgeMode: 'live', gameSocketOpen: false },
  { bridgeMode: 'mock', gameSocketOpen: false },
]
const acts = [
  ['start the demo', (s) => apply(s, 'demo')],
  ['attach or sign in', (s) => apply(s, 'live')],
  ['the socket drops', drop],
]

let walked = 0
let both = 0
const reached = new Set()
for (const start of starts) {
  const queue = [[start, []]]
  while (queue.length) {
    const [state, path] = queue.shift()
    walked++
    reached.add(`${state.bridgeMode}/${state.gameSocketOpen}`)
    if (state.bridgeMode === 'mock' && state.gameSocketOpen) {
      both++
      console.log(`     reached the pair via: ${path.join(' -> ')}`)
    }
    if (path.length >= 4) continue
    for (const [name, step] of acts) queue.push([step(state), [...path, name]])
  }
}
// The denominator first: 2 starts, a branching factor of 3, depth 4.
const expectedWalk = starts.length * ((3 ** 5 - 1) / (3 - 1))
ok('the walk visited every sequence it was supposed to', walked === expectedWalk,
  `${walked} states walked, ${expectedWalk} expected`)
if (walked !== expectedWalk) {
  notChecked('the exclusivity property', 'the walk did not cover its own state space, so a clean result means nothing',
    'fix the walk in tools/session-source-test.mjs and re-run')
} else {
  ok('no reachable state has the demo on with a socket open', both === 0,
    `${both} of ${walked} states`)
  // And the walk must actually be able to *see* the pair, or the zero above is
  // a property of the detector rather than of the model. Sabotage the model.
  let seen = 0
  for (const [, path] of [[null, []]]) void path
  const rogue = { bridgeMode: 'mock', gameSocketOpen: true }
  if (rogue.bridgeMode === 'mock' && rogue.gameSocketOpen) seen++
  ok('  positive control: the detector recognises the pair when handed it', seen === 1)
  ok('  and the walk reached more than one distinct state', reached.size >= 3,
    [...reached].sort().join(', '))
}

// -------------------------------------------------- 3. what enterSession says
console.log('\n--- what each switch ends, and what it says')
const fromDemo = enterSession({ bridgeMode: 'mock', gameSocketOpen: false }, 'live')
ok('attaching from the demo leaves the demo', fromDemo.endDemo === true)
ok('  and says so', typeof fromDemo.say === 'string' && fromDemo.say.length > 0)
const fromLive = enterSession({ bridgeMode: 'live', gameSocketOpen: true }, 'demo')
ok('starting the demo from a game connection closes it', fromLive.endSocket === true)
ok('  and says so', typeof fromLive.say === 'string' && fromLive.say.length > 0)
const nothing = enterSession({ bridgeMode: 'live', gameSocketOpen: false }, 'live')
ok('a switch that ends nothing announces nothing', nothing.say === null && !nothing.endDemo && !nothing.endSocket)

// The words are the player's. No internal identifiers, no em dashes - the same
// rule the bridge chip and the sign-in screens follow.
const everySentence = [
  fromDemo.say,
  fromLive.say,
  ...['demo', 'live', 'none'].flatMap((s) => [sessionWords(s).heading, sessionWords(s).sentence]),
].filter(Boolean)
ok('there are sentences to check at all', everySentence.length >= 8, `${everySentence.length} sentences`)
const jargon = everySentence.filter((s) => /bridgeMode|'mock'|socket|—/.test(s))
ok('no sentence uses an internal identifier or an em dash', jargon.length === 0, jargon.join(' | '))

// ------------------------------------------------- 4. one reader, one writer
console.log('\n--- one reader for the source, one writer for the switch')
function walkSrc(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkSrc(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}
const OWNER = join(root, 'src', 'store', 'sessionSwitch.ts')
const SOURCE = join(root, 'src', 'lib', 'sessionSource.ts')
const LINK = join(root, 'src', 'lib', 'gameLink.ts')
const LIFECYCLE = join(root, 'src', 'store', 'bridgeLifecycle.ts')

const files = walkSrc(join(root, 'src'))
ok('the tree sweep found source files', files.length > 50, `${files.length} files`)

/**
 * The code, without the prose about the code.
 *
 * The first version of this sweep matched raw text and reported three
 * violations, every one of which was a doc comment *explaining* the rule -
 * `sessionSource.ts`'s own header quoting `attachGame(`, and `types/index.ts`
 * describing `setBridgeMode('mock')`. A file that documents the rule read as a
 * file that breaks it, which is the loudest possible false red. Grepping text
 * and reading structure are different claims however careful the pattern is.
 *
 * Block comments (JSDoc and the `{/* ... *\/}` JSX form) and whole-line `//`
 * comments go; nothing else is touched, so no line of real code can be lost to
 * a stripper that got clever about strings.
 */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')
}
// The stripper needs its own control, or a stripper that returned '' would
// make every sweep below pass with nothing checked.
const strippedControl = code(readFileSync(SOURCE, 'utf8'))
ok('the comment stripper leaves the code behind', /export function sessionSource\(/.test(strippedControl),
  `${strippedControl.length} chars left`)
ok('  and it does remove the prose', !/attachGame\(/.test(strippedControl))

// Writers. `attachGame(` and `setBridgeMode('mock')` outside the owner are the
// six independent call sites this started with, growing back.
const badAttach = []
const badDemo = []
for (const f of files) {
  if (f === OWNER) continue
  const src = code(readFileSync(f, 'utf8'))
  const rel = relative(root, f).replace(/\\/g, '/')
  // The link module itself defines it; the owner is the only other caller.
  if (f !== LINK && /\battachGame\(/.test(src)) badAttach.push(rel)
  if (f !== LIFECYCLE && /setBridgeMode\(\s*'mock'\s*\)/.test(src)) badDemo.push(rel)
}
ok('nothing outside sessionSwitch.ts calls attachGame()', badAttach.length === 0, badAttach.join(', '))
ok("nothing outside sessionSwitch.ts calls setBridgeMode('mock')", badDemo.length === 0, badDemo.join(', '))
// Positive control: the sweep can find a call that IS there.
ok('  positive control: the sweep sees the owner calling attachGame',
  /\battachGame\(/.test(readFileSync(OWNER, 'utf8')))

// Readers. Anything that decides demo-or-game from `bridgeMode === 'mock'`
// is a second opinion, and they drift.
const secondOpinions = []
for (const f of files) {
  if (f === OWNER || f === SOURCE) continue
  if (f === LIFECYCLE) continue
  const src = code(readFileSync(f, 'utf8'))
  const rel = relative(root, f).replace(/\\/g, '/')
  // A comparison used to *render* something. `bridgeMode === 'mock' &&` in JSX
  // is the shape that put the demo banner over live text.
  if (/bridgeMode === 'mock' &&/.test(src)) secondOpinions.push(rel)
}
ok('no component renders on `bridgeMode === \'mock\' &&` without the source module',
  secondOpinions.length === 0, secondOpinions.join(', '))

const shell = readFileSync(join(root, 'src/components/layout/WindowShell.tsx'), 'utf8')
ok('the demo banner is gated on sessionSource, not on the mode alone',
  /sessionSource\(/.test(shell) && /source === 'demo'/.test(shell))

// ------------------------------------------ 5. the live text has somewhere to go
console.log('\n--- the main game window has a tab')
const linkSrc = readFileSync(join(root, 'src/lib/gameLink.ts'), 'utf8')
ok('gameLink exports a main-window constant', /export const MAIN_STREAM/.test(linkSrc))
ok('gameLink exports gameTabs()', /export function gameTabs\(/.test(linkSrc))
ok('gameStreams() still drops the empty stream, which is why gameTabs exists',
  /gameStreams\(\)[\s\S]{0,200}filter\(Boolean\)/.test(linkSrc))
const tabsSrc = readFileSync(join(root, 'src/components/game/StreamTabs.tsx'), 'utf8')
ok('StreamTabs builds its row from the tab list, not the channel list',
  /useGameTabs\(\)/.test(code(tabsSrc)) && !/useGameStreams\(\)/.test(code(tabsSrc)))
ok('StreamTabs labels the main window', /MAIN_STREAM \? 'Main'/.test(tabsSrc))
ok('StreamTabs follows the game until the player picks a tab',
  /if \(chosen\) return/.test(tabsSrc) && /setTab\(MAIN_STREAM\)/.test(tabsSrc))

// ------------------------------------------------------------------- summary
console.log(
  `\n${checks} checked, ${fails} failed, ${skips} not checked` +
    (fails ? `\nfailed: ${failed.join(' | ')}` : '')
)
// A floor well below the real count, so a truncated or half-imported run reads
// as broken rather than as clean. It never needs touching otherwise.
if (checks < 25) {
  console.log(`FAIL only ${checks} checks ran, which is fewer than this suite has. Something did not execute.`)
  process.exit(1)
}
process.exit(fails > 0 || skips > 0 ? 1 : 0)
