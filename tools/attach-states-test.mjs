#!/usr/bin/env node
/**
 * Every state between "nothing is connected" and "playing" has a screen, and
 * every screen has something to press. Issue #523.
 *
 *   npm run test:attach-states
 *
 * # What went wrong, and why a test of the enumeration is the right shape
 *
 * There were three screens for six situations. `App.tsx` asked `!character`
 * and rendered one panel for everything that was not the workspace, and that
 * panel asked `bridgeConnected` and rendered one of two paragraphs. An open
 * **game socket** was in neither question - the bridge and the game are
 * different connections to different ports - so a player holding a live
 * connection was shown "Nothing is connected yet", and the Attach control that
 * would have got them out lived inside the workspace they could not reach.
 * Measured on the clean VM on 9 September 2026: two established connections to
 * port 11124 at the moment the app said nothing was connected.
 *
 * A test that lists the screens it expects would have passed on that tree,
 * because the missing screen was missing from the test too. So this derives
 * both sides:
 *
 *  - the **states** from `WORKSPACE_STATES`, and separately from a walk of
 *    every combination of the four inputs, and asserts the two agree. A state
 *    that exists but is unreachable, or is reachable but unlisted, fails.
 *  - the **actions** from `workspaceScreen()`, and asserts every screen has at
 *    least one and that `WaitingForCharacter.tsx` has a branch for every
 *    action id it can be handed. An action nothing renders is a dead end
 *    wearing a name.
 *
 * The denominators are the sizes of those derivations, printed, so a run whose
 * enumeration collapsed to nothing reads as empty rather than as clean.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const {
  workspaceState,
  workspaceScreen,
  WORKSPACE_STATES,
  BothSourcesError,
} = await import('../src/lib/sessionSource.ts')

let checks = 0
let fails = 0
let skips = 0
const failed = []
function ok(what, pass, detail = '') {
  checks++
  if (pass) console.log(`OK   ${what}${detail ? `  (${detail})` : ''}`)
  else {
    fails++
    failed.push(what)
    console.log(`FAIL ${what}${detail ? `  (${detail})` : ''}`)
  }
}

// ------------------------------------- 1. the reachable states, walked not listed
console.log('\n--- every combination of the four inputs')
const bools = [false, true]
const reachable = new Set()
let cells = 0
let impossible = 0
for (const setupComplete of bools) {
  for (const bridgeMode of ['live', 'mock']) {
    for (const gameSocketOpen of bools) {
      for (const bridgeConnected of bools) {
        for (const hasCharacter of bools) {
          cells++
          const r = { setupComplete, bridgeMode, gameSocketOpen, bridgeConnected, hasCharacter }
          try {
            reachable.add(workspaceState(r))
          } catch (e) {
            // The demo with an open socket. `sessionSource` refuses it and
            // `workspaceState` inherits the refusal rather than picking one of
            // the two to believe, which is the point.
            if (e instanceof BothSourcesError) impossible++
            else throw e
          }
        }
      }
    }
  }
}
const expectedCells = 2 * 2 * 2 * 2 * 2
ok('the walk covered its own input space', cells === expectedCells, `${cells} of ${expectedCells} cells`)
ok('some cells are the impossible pair and are refused, not answered', impossible > 0,
  `${impossible} of ${cells} cells threw`)
ok('the rest all produced a state', reachable.size > 0, `${reachable.size} distinct states`)

console.log('\n--- the declared states and the reachable ones are the same set')
const declared = new Set(WORKSPACE_STATES)
ok('WORKSPACE_STATES is not empty', declared.size > 0, `${declared.size} declared`)
const unreachable = [...declared].filter((s) => !reachable.has(s))
const undeclared = [...reachable].filter((s) => !declared.has(s))
ok('every declared state is reachable', unreachable.length === 0, unreachable.join(', '))
ok('every reachable state is declared', undeclared.length === 0, undeclared.join(', '))

// The three the issue is about, named, because "the sets agree" would also be
// true of a tree that had one state and declared one state.
for (const named of ['none', 'live-waiting', 'playing']) {
  ok(`  '${named}' is one of them`, reachable.has(named))
}
// And the state that did not exist before this change: an open socket with no
// character. If this is ever folded back into 'none', #523 is back.
ok("an open socket with no character is 'live-waiting', not 'none'",
  workspaceState({
    setupComplete: true,
    bridgeMode: 'live',
    gameSocketOpen: true,
    bridgeConnected: false,
    hasCharacter: false,
  }) === 'live-waiting')
ok("  and with no socket it really is 'none' (positive control)",
  workspaceState({
    setupComplete: true,
    bridgeMode: 'live',
    gameSocketOpen: false,
    bridgeConnected: false,
    hasCharacter: false,
  }) === 'none')

// ------------------------------------------- 2. every screen has an action
console.log('\n--- every state has a screen, and every screen has something to press')
const allActions = new Set()
let screened = 0
for (const state of WORKSPACE_STATES) {
  const screen = workspaceScreen(state)
  screened++
  ok(`  ${state}: has a heading and a sentence`,
    typeof screen.heading === 'string' && screen.heading.length > 0 &&
      typeof screen.sentence === 'string' && screen.sentence.length > 0)
  ok(`  ${state}: has at least one action`, screen.actions.length > 0,
    screen.actions.join(', '))
  for (const a of screen.actions) allActions.add(a)
}
ok('a screen was derived for every declared state', screened === WORKSPACE_STATES.length,
  `${screened} of ${WORKSPACE_STATES.length}`)
ok('and the actions across them are not all one', allActions.size >= 4,
  [...allActions].sort().join(', '))

// ------------------------------- 3. the component can render every action id
console.log('\n--- the screen renders every action it can be handed')
const wfc = readFileSync(join(root, 'src/components/shared/WaitingForCharacter.tsx'), 'utf8')
ok('WaitingForCharacter renders from the enumeration', /workspaceScreen\(/.test(wfc) && /workspaceState\(/.test(wfc))
ok('  and writes no headings of its own', /\{screen\.heading\}/.test(wfc) && /\{screen\.sentence\}/.test(wfc))

/*
 * `playing` never reaches this component - App.tsx renders the workspace for
 * it - so its action is excluded rather than demanded. Named here, so the
 * exclusion is a decision on the page rather than an action quietly missing.
 */
const inThisComponent = [...allActions].filter((a) => a !== 'play')
ok('there are actions to look for', inThisComponent.length >= 4, inThisComponent.join(', '))
const unrendered = inThisComponent.filter((a) => !new RegExp(`can\\('${a}'\\)`).test(wfc))
ok('every action has a branch in the component', unrendered.length === 0, unrendered.join(', '))
// Positive control: the matcher can see a branch that IS there, so a clean
// result above is about the component and not about the regexp.
ok("  positive control: the matcher finds can('connection-help')", /can\('connection-help'\)/.test(wfc))

// ------------------------------ 4. the Attach control is mounted in every state
console.log('\n--- the Attach control is on screen wherever a socket can exist')
const appTsx = readFileSync(join(root, 'src/App.tsx'), 'utf8')
/*
 * The name of this section is the part that survives; the body has now been
 * repointed twice.
 *
 * It asked about the console row, `aria-label="Console"`, because that was the
 * mechanism by which the transcript escaped the `character` gate: the row sat
 * outside `main`, so the Attach control it contains stayed mounted with no
 * character. The play-first frame deletes that row - the transcript is the
 * workspace now, `aria-label="Text"` - so the mechanism is gone and the
 * property is not. The gate moved to the right rail, which genuinely is a
 * reading of a live character.
 *
 * Repointing rather than deleting, and saying so, because a test that goes
 * NOT CHECKED after a rename is a test that has stopped defending anything -
 * and this one exits non-zero on a skip precisely so that cannot pass quietly.
 * (CLAUDE.md section 1: read the name before the body.)
 */
const textIdx = appTsx.indexOf('aria-label="Text"')
if (textIdx < 0) {
  checks++
  skips++
  console.log(
    [
      'NOT CHECKED the text region gate',
      '     because: no element with aria-label="Text" was found in App.tsx',
      '     settle it with: grep -n aria-label=.Text. src/App.tsx',
    ].join('\n')
  )
} else {
  const region = appTsx.slice(textIdx, appTsx.indexOf('<GameChatColumn />', textIdx) + 20)
  /*
   * A *positive* gate, which is the thing that would hide the Attach control.
   * `{!character && (` inside the region is the opposite condition - the call
   * to action that shows only while there is no character - and forbidding it
   * would forbid the empty state from saying anything, so the `!` is excluded
   * deliberately rather than by accident.
   */
  ok('the text region is not gated on `character`', !/(^|[^!])character &&/.test(region), region.match(/.{0,20}character &&.{0,10}/)?.[0] ?? 'no gate of any shape')
  // Positive control: the pattern matches somewhere, so the negative above is
  // a fact about the region rather than about a regexp that matches nothing.
  ok('  positive control: that gate shape does exist elsewhere in App.tsx', /character && \(?/.test(appTsx))
  ok('the text region holds the game pane', /aria-label="Text"[\s\S]{0,2200}<GameChatColumn \/>/.test(appTsx))
  // And the other half: what IS a reading of a live character still waits for
  // one. Without this, deleting every gate in the file would pass the above.
  ok('the right rail is still gated on `character`', /showRail && character && \(/.test(appTsx))
}
const bar = readFileSync(join(root, 'src/components/room/GameChatColumn.tsx'), 'utf8')
ok('the game pane holds the connection bar', /<GameConnectionBar \/>/.test(bar))

console.log(
  `\n${checks} checked, ${fails} failed, ${skips} not checked` +
    (fails ? `\nfailed: ${failed.join(' | ')}` : '')
)
if (checks < 25) {
  console.log(`FAIL only ${checks} checks ran, fewer than this suite has. Something did not execute.`)
  process.exit(1)
}
process.exit(fails > 0 || skips > 0 ? 1 : 0)
