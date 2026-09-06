/**
 * Key macros: the dry run sends nothing, the real fire sends everything, and
 * the same key does not do two things at once.
 *
 *   node tools/macro-dry-run-test.mjs
 *
 * # Why the control matters more than the check
 *
 * The check this suite exists for is "a dry run records zero calls against a
 * fake `sendGame`". Zero is also what an unwired harness records, what a
 * harness that built the wrong object records, and what a harness whose import
 * failed would record if anything swallowed the error. So every zero-call
 * assertion here is paired, in the same run, with a real fire through the same
 * function that must record exactly the macro's command count in order. One
 * without the other is a claim about the instrument, not about the code.
 *
 * # And the sabotage has to reach the line
 *
 * Two mutants below, each checked against the *named* checks it should redden
 * and the ones it must not: pointing the dry run at the send path reddens the
 * zero-call pair and nothing else, and removing the in-flight claim reddens
 * the double-press case and nothing else. A sabotage that reddens everything
 * would mean these checks are entangled and are saying less than they look
 * like.
 */
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  runMacroCommands,
  resolveKeybinding,
  chordLabel,
  macroEnableRefusal,
  plannedCommandRefusal,
} from '../src/lib/keybindings.ts'
import { aliasEnableRefusal, expandAlias } from '../src/lib/aliases.ts'

let checked = 0
let failed = 0
const ok = (name, cond, detail = '') => {
  checked += 1
  if (!cond) failed += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(62)}${detail}`)
}

/** A macro with more than one command, so "sent nothing" and "sent one thing"
 *  cannot be confused, and with an order that is not alphabetical. */
const WALK = ['stand', 'go gate', 'look']

const spy = () => {
  const sent = []
  return { sent, send: (command) => sent.push(command) }
}

console.log('-- the dry run, and the real fire that proves the spy works --')
{
  const dry = spy()
  const plan = runMacroCommands(WALK, { send: dry.send, dryRun: true })
  ok('a dry run sends nothing at all', dry.sent.length === 0, `${dry.sent.length} sends`)
  ok('and still says exactly what would go out, in order', JSON.stringify(plan.plan) === JSON.stringify(WALK), plan.plan.join(' | '))
  ok('it reports itself as a dry run rather than as a refusal', plan.dryRun === true && plan.refused === null && plan.sent.length === 0)

  // The control, in the same run and through the same function. Without it the
  // three checks above pass against a `send` nothing could ever have called.
  const real = spy()
  const fired = runMacroCommands(WALK, { send: real.send })
  ok('the positive control: a real fire sends every command', real.sent.length === WALK.length, `${real.sent.length} of ${WALK.length}`)
  ok('in the macro’s own order', JSON.stringify(real.sent) === JSON.stringify(WALK), real.sent.join(' | '))
  ok('and reports what it sent', JSON.stringify(fired.sent) === JSON.stringify(WALK) && fired.dryRun === false)
}

console.log('\n-- the dry run shows what the lane would receive, not the raw text --')
{
  // Aliases and variables resolve before the lane sees anything, so a dry run
  // that showed the stored text would be showing the player something the game
  // will never be sent.
  const expand = (c) => c.replace('$shop', 'the pawnshop')
  const dry = spy()
  const plan = runMacroCommands(['go $shop', 'buy bread'], { send: dry.send, expand, dryRun: true })
  ok('the plan is expanded', plan.plan[0] === 'go the pawnshop', plan.plan[0])
  ok('and expanding still sent nothing', dry.sent.length === 0, `${dry.sent.length} sends`)

  const real = spy()
  runMacroCommands(['go $shop', 'buy bread'], { send: real.send, expand })
  ok('the control: a real fire sends the expanded text', real.sent[0] === 'go the pawnshop', real.sent[0])

  const blanks = spy()
  runMacroCommands(['  ', 'stand', ''], { send: blanks.send })
  ok('blank lines are not sent as empty commands', JSON.stringify(blanks.sent) === JSON.stringify(['stand']), blanks.sent.join('|'))
}

console.log('\n-- the in-flight gate: one press, one macro --')
{
  // The gate `macroFlight.ts` owns, modelled here by the same contract
  // `claimMacroSend` has: a reason string when it may not run, null when it
  // may. `macroFlight.ts` itself pulls in the whole app store (Vite-only
  // `import.meta.glob`) and cannot be imported here; `tools/macroguard-test.mjs`
  // is where that gate's own timing is proved.
  let claims = 0
  const claim = () => (claims++ === 0 ? null : 'A macro is still running.')
  const s = spy()
  const first = runMacroCommands(WALK, { send: s.send, claim })
  const second = runMacroCommands(WALK, { send: s.send, claim })
  ok('the first press sends', first.sent.length === WALK.length, `${first.sent.length}`)
  ok('the second press is refused while the first is in flight', second.sent.length === 0 && second.refused !== null, String(second.refused))
  ok('and the wire saw only the first press', s.sent.length === WALK.length, `${s.sent.length} of ${WALK.length}`)

  // A dry run must not spend the slot either: showing a player what a macro
  // would do should not stop them then doing it.
  let dryClaims = 0
  const dryClaim = () => {
    dryClaims += 1
    return null
  }
  runMacroCommands(WALK, { send: () => {}, claim: dryClaim, dryRun: true })
  ok('a dry run does not claim the in-flight slot', dryClaims === 0, `${dryClaims} claims`)
}

console.log('\n-- the chooser: a player binding beats the built-in, which stays reachable --')
{
  const macro = {
    id: 'mac-1',
    enabled: true,
    source: 'player',
    key: 'NumPad8',
    modifiers: [],
    commands: ['stand', 'north'],
  }
  // The wrong answer is available on purpose: NumPad8 is a *built-in* movement
  // key, so this is a chooser with two candidates rather than one.
  const built = resolveKeybinding({ key: '8', code: 'Numpad8' }, false)
  ok('with nothing configured, NumPad8 still walks north', built?.kind === 'game' && built.command === 'n', JSON.stringify(built))

  const chosen = resolveKeybinding({ key: '8', code: 'Numpad8' }, false, [macro])
  ok('the player’s macro wins that same chord', chosen?.kind === 'macro' && chosen.id === 'mac-1', JSON.stringify(chosen))
  ok('and carries the commands, in order', JSON.stringify(chosen?.commands) === JSON.stringify(['stand', 'north']))

  // The built-in has to remain reachable through its own default, which is the
  // half a "player wins" check on one key cannot see.
  const others = [
    ['Numpad2', 's'],
    ['Numpad4', 'w'],
    ['Numpad6', 'e'],
    ['F2', 'health'],
  ]
  const stillBuiltIn = others.filter(([code, command]) => {
    const r = resolveKeybinding({ key: code, code }, false, [macro])
    return r?.kind === 'game' && r.command === command
  })
  ok('every other built-in still resolves with a macro table present', stillBuiltIn.length === others.length, `${stillBuiltIn.length} of ${others.length}`)

  const modified = resolveKeybinding({ key: '8', code: 'Numpad8', ctrlKey: true }, false, [macro])
  ok('a modifier makes it a different chord, so the built-in answers', modified?.kind === 'game' && modified.command === 'n', JSON.stringify(modified))

  const off = resolveKeybinding({ key: '8', code: 'Numpad8' }, false, [{ ...macro, enabled: false }])
  ok('a switched-off macro loses to the built-in rather than swallowing the key', off?.kind === 'game' && off.command === 'n', JSON.stringify(off))

  const scripted = { ...macro, commands: ['#queue {north}'] }
  ok('a scripted macro is refused by name', (macroEnableRefusal(scripted) ?? '').includes('#queue'), String(macroEnableRefusal(scripted)))
  const scriptedResolution = resolveKeybinding({ key: '8', code: 'Numpad8' }, false, [scripted])
  ok('and cannot fire even marked enabled', scriptedResolution?.kind === 'game', JSON.stringify(scriptedResolution))

  ok('one chord, one spelling', chordLabel('NumPad8', ['Alt', 'Shift']) === 'Shift+Alt+NumPad8', chordLabel('NumPad8', ['Alt', 'Shift']))

  const blocked = resolveKeybinding({ key: '8', code: 'Numpad8' }, true, [macro])
  ok('a foreground panel still owns the key', blocked === null, JSON.stringify(blocked))
}

console.log('\n-- the real fire goes through the lane, with source macro --')
{
  // The consuming side. `runMacroCommands` takes its `send`, so nothing in this
  // file can tell which one the app passes it - and a macro sent with the wrong
  // source, or through a second path with its own gate, is the fork the lane
  // exists to prevent.
  const app = readFileSync('src/App.tsx', 'utf8')
  const wired = /runMacroCommands\(commands, \{[\s\S]{0,400}?requestGameAction\([\s\S]{0,120}?'macro'\)/.test(app)
  ok('App.tsx fires a macro through requestGameAction with source macro', wired, wired ? '' : 'no wiring found')
  ok('and claims the shared in-flight slot', /claim:\s*\(\)\s*=>\s*claimMacroSend\(\)\.reason/.test(app))
  ok('and reads the player’s bindings live', /macros:\s*\(\)\s*=>\s*loadPlayerConfig\(\)\.macros/.test(app))

  const flight = readFileSync('src/lib/macroFlight.ts', 'utf8')
  ok('there is one gate, and requestMacro uses the same claim', /export function claimMacroSend/.test(flight) && /const verdict = claimMacroSend\(\)/.test(flight))

  const tab = readFileSync('src/components/config/MacrosTab.tsx', 'utf8')
  ok('the tab’s dry run calls the one run function with dryRun', /runMacroCommands\([\s\S]{0,300}?dryRun: true/.test(tab))
  ok('and hands it a send that throws, so a silent send is impossible', /throw new Error\('a dry run must not send anything'\)/.test(tab))
}

// -------------------------------------------------------------------- #485
//
// Variable expansion happens after the enable guard and before the lane's
// validation, so both ends were judging text that is not what gets sent. Two
// halves, one predicate: the dry run shows what the lane would accept, and the
// fire re-asks the same question because a variable can be edited after the
// macro was switched on.
const NL = String.fromCharCode(10)
/** The real thing, not a stub: the same expander the app hands the runner. */
const VARS = new Map([
  ['shop', 'bank;withdraw 5000 coins'],
  ['nl', `go bank${NL}sell all`],
  ['s', '#queue clear'],
  ['ok', 'the pawnshop'],
])
const CLEAN = new Map([['s', 'the pawnshop']])
const expandWith = (variables) => (c) => expandAlias(c, [], { variables }).text

console.log('\n-- the dry run shows the plan the lane would accept, not the one it would throw away --')
{
  // The control first. An "everything is refused" result is also what a broken
  // predicate produces, so a clean macro must come back with nothing to say.
  const clean = runMacroCommands(['go $ok', 'buy bread'], {
    send: () => { throw new Error('a dry run must not send anything') },
    expand: expandWith(VARS),
    variables: VARS,
    dryRun: true,
  })
  ok('control: a clean macro plans two commands', clean.plan.length === 2, clean.plan.join(' | '))
  ok('control: and none of them is refused', clean.planRefusals.every((r) => r === null), JSON.stringify(clean.planRefusals))

  const dry = spy()
  const plan = runMacroCommands(['go $shop', 'stow $nl'], {
    send: dry.send,
    expand: expandWith(VARS),
    variables: VARS,
    dryRun: true,
  })
  ok('the plan is still expanded, as before', plan.plan[0] === 'go bank;withdraw 5000 coins', plan.plan[0])
  ok('and it says nothing was sent', dry.sent.length === 0, `${dry.sent.length} sends`)
  ok(
    'the separator the lane refuses is marked, with the lane’s own reason',
    /command separator/.test(plan.planRefusals[0] ?? ''),
    String(plan.planRefusals[0])
  )
  ok(
    'so is the newline a variable smuggled in',
    /one line|control characters/.test(plan.planRefusals[1] ?? ''),
    String(plan.planRefusals[1])
  )
  ok('every refusal names the command it belongs to', plan.planRefusals.every((r, i) => r === null || r.includes(plan.plan[i])))

  // And the same commands really are refused by the lane, so this is the lane's
  // answer and not a second opinion that happens to agree with it today.
  const real = spy()
  const fired = runMacroCommands(['go $shop'], { send: real.send, expand: expandWith(VARS), variables: VARS })
  ok('a real fire of the same macro sends nothing', real.sent.length === 0, `${real.sent.length} sends`)
  ok('and reports the refusal rather than failing silently', fired.refused !== null, String(fired.refused))
}

console.log('\n-- a variable cannot smuggle Genie script past the enable guard --')
{
  // The issue's own example. The stored text carries no `#`, so the guard as it
  // stood said yes and `go #queue clear` went to DragonRealms as literal text.
  const rule = { key: 'F6', commands: ['go $s'] }
  ok(
    'the guard refuses it once it can see the variables',
    (macroEnableRefusal(rule, { variables: VARS }) ?? '').includes('#queue clear'),
    String(macroEnableRefusal(rule, { variables: VARS }))
  )
  ok(
    'and names the variable to edit, not just the command',
    (macroEnableRefusal(rule, { variables: VARS }) ?? '').includes('$s'),
    String(macroEnableRefusal(rule, { variables: VARS }))
  )
  ok(
    'control: the same macro with a harmless value may be switched on',
    macroEnableRefusal(rule, { variables: CLEAN }) === null,
    String(macroEnableRefusal(rule, { variables: CLEAN }))
  )
  ok(
    'a command that is only a variable is caught too',
    macroEnableRefusal({ key: 'F7', commands: ['$s'] }, { variables: VARS }) !== null
  )
  ok(
    'and the alias guard gives the same answer for the same text',
    aliasEnableRefusal({ name: 'g', expansion: 'go $s' }, { variables: VARS }) !== null,
    String(aliasEnableRefusal({ name: 'g', expansion: 'go $s' }, { variables: VARS }))
  )
  ok(
    'control: a plainly scripted rule is still refused with no table at all',
    macroEnableRefusal({ key: 'F8', commands: ['#queue {north}'] }) !== null
  )
}

console.log('\n-- and the fire re-asks, because a variable can change after enabling --')
{
  // Enabled while `$s` was harmless, fired after it was edited. Nothing re-runs
  // the enable guard in between, so the runner has to ask again.
  const rule = { key: 'F6', commands: ['go $s'] }
  ok('it was switched on legitimately', macroEnableRefusal(rule, { variables: CLEAN }) === null)

  // The positive control, and it is the one that makes the zero below mean
  // something: the same macro, same runner, harmless value, really does send.
  const good = spy()
  const sent = runMacroCommands(rule.commands, {
    send: good.send,
    expand: expandWith(CLEAN),
    variables: CLEAN,
  })
  ok('control: with the harmless value it sends', good.sent.length === 1 && good.sent[0] === 'go the pawnshop', good.sent.join('|'))
  ok('control: and reports no refusal', sent.refused === null, String(sent.refused))

  const after = spy()
  const blocked = runMacroCommands(rule.commands, {
    send: after.send,
    expand: expandWith(VARS),
    variables: VARS,
  })
  ok('with the edited value the lane sees nothing at all', after.sent.length === 0, `${after.sent.length} sends`)
  ok('and the refusal names the script', /#queue clear/.test(blocked.refused ?? ''), String(blocked.refused))
  ok('the slot was not spent on a macro that could not go', blocked.plan.length === 1 && blocked.sent.length === 0)

  // The predicate on its own, at the boundary the lane actually enforces.
  ok('plannedCommandRefusal passes an ordinary command', plannedCommandRefusal('go bank') === null)
  ok('and refuses a bare directive with no variables involved', plannedCommandRefusal('#queue clear') !== null)
}

console.log('\n-- sabotage: each break reddens its own check and not the others --')
{
  const SRC = readFileSync('src/lib/keybindings.ts', 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'macro-sabotage-'))
  // Every relative import, not just the one this file used to have: a mutant
  // that fails to resolve `./aliases.ts` throws on import, and an import that
  // throws is indistinguishable from a sabotage that landed.
  const absolutise = (text) =>
    text.replace(/from '\.\/([A-Za-z0-9_.-]+\.ts)'/g, (_, file) =>
      `from '${pathToFileURL(join(process.cwd(), 'src/lib', file)).href}'`
    )

  async function loadMutant(label, transform) {
    const mutated = absolutise(transform(SRC))
    if (mutated === absolutise(SRC)) {
      throw new Error(`sabotage "${label}" changed nothing - the target text was not found, so this run proves nothing`)
    }
    const p = join(dir, `${label}.ts`)
    writeFileSync(p, mutated)
    return import(pathToFileURL(p).href)
  }

  // (1) Point the dry run at the real send path.
  {
    const mod = await loadMutant('dry-run-sends', (s) =>
      s.replace(
        "if (opts.dryRun === true) return { plan, planRefusals, sent: [], refused: null, dryRun: true }",
        "if (false) return { plan, planRefusals, sent: [], refused: null, dryRun: true }"
      )
    )
    const dry = spy()
    mod.runMacroCommands(WALK, { send: dry.send, dryRun: true })
    ok('sabotage lands: the dry run now sends', dry.sent.length === WALK.length, `${dry.sent.length} sends`)
    // Scoped: the chooser is a different function and must be untouched.
    const chosen = mod.resolveKeybinding({ key: '8', code: 'Numpad8' }, false, [
      { id: 'm', enabled: true, source: 'player', key: 'NumPad8', modifiers: [], commands: ['north'] },
    ])
    ok('sabotage is scoped: the chooser still prefers the player', chosen?.kind === 'macro')
  }

  // (2) Drop the in-flight gate.
  {
    const mod = await loadMutant('no-gate', (s) =>
      s.replace('const refused = opts.claim ? opts.claim() : null', 'const refused = null')
    )
    let claims = 0
    const claim = () => (claims++ === 0 ? null : 'A macro is still running.')
    const s2 = spy()
    mod.runMacroCommands(WALK, { send: s2.send, claim })
    mod.runMacroCommands(WALK, { send: s2.send, claim })
    ok('sabotage lands: a double press now sends twice', s2.sent.length === WALK.length * 2, `${s2.sent.length} sends`)
    // Scoped: the dry run is a different branch and must still send nothing.
    const dry = spy()
    mod.runMacroCommands(WALK, { send: dry.send, dryRun: true })
    ok('sabotage is scoped: the dry run still sends nothing', dry.sent.length === 0, `${dry.sent.length} sends`)
  }

  // (3) Make the player binding lose to the built-in.
  {
    const mod = await loadMutant('builtin-wins', (s) =>
      s.replace('if (macro) return { kind: \'macro\', id: macro.id, commands: [...macro.commands] }', '')
    )
    const chosen = mod.resolveKeybinding({ key: '8', code: 'Numpad8' }, false, [
      { id: 'm', enabled: true, source: 'player', key: 'NumPad8', modifiers: [], commands: ['north'] },
    ])
    ok('sabotage lands: the built-in now wins the bound chord', chosen?.kind === 'game', JSON.stringify(chosen))
    const dry = spy()
    mod.runMacroCommands(WALK, { send: dry.send, dryRun: true })
    ok('sabotage is scoped: the dry run is unaffected', dry.sent.length === 0, `${dry.sent.length} sends`)
  }

  // (4) Delete the built-in fallback, which is the other half of the chooser:
  // a player who has configured nothing must still walk with the NumPad.
  {
    const mod = await loadMutant('no-builtin', (s) =>
      s.replace('const command = GAME_KEYS[e.code]', 'const command = undefined')
    )
    const built = mod.resolveKeybinding({ key: '8', code: 'Numpad8' }, false)
    ok('sabotage lands: an unconfigured player no longer walks with NumPad', built === null || built.kind !== 'game', JSON.stringify(built))
    const chosen = mod.resolveKeybinding({ key: '8', code: 'Numpad8' }, false, [
      { id: 'm', enabled: true, source: 'player', key: 'NumPad8', modifiers: [], commands: ['north'] },
    ])
    ok('sabotage is scoped: a bound chord still fires its macro', chosen?.kind === 'macro')
  }

  // (5) Drop the fire-time re-judge, which is #485's second half: the enable
  //     guard alone cannot see a variable edited after the macro was enabled.
  {
    const mod = await loadMutant('no-fire-time-refusal', (s) =>
      s.replace('  const blocked = planRefusals.findIndex((why) => why !== null)', '  const blocked = -1')
    )
    const s5 = spy()
    mod.runMacroCommands(['go $s'], { send: s5.send, expand: expandWith(VARS), variables: VARS })
    ok(
      'sabotage lands: the smuggled directive reaches the send path again',
      s5.sent.length === 1 && s5.sent[0] === 'go #queue clear',
      s5.sent.join('|')
    )
    // Scoped: the plan is still computed, so this is the *gate* that went and
    // not the predicate - a mutant that broke both would say less than it looks
    // like it does.
    const dry5 = mod.runMacroCommands(['go $s'], {
      send: () => {},
      expand: expandWith(VARS),
      variables: VARS,
      dryRun: true,
    })
    ok('sabotage is scoped: the dry run still marks it', dry5.planRefusals[0] !== null, String(dry5.planRefusals[0]))
  }

  // (6) Make the enable guard judge the stored text again, which is #485's
  //     first half exactly as it stood.
  {
    const mod = await loadMutant('enable-guard-judges-stored-text', (s) =>
      s.replace(
        '    const { expanded, why } = scriptRefusalFor(command, opts)',
        '    const { expanded, why } = scriptRefusalFor(command, {})'
      )
    )
    ok(
      'sabotage lands: the variable-carried directive passes the enable guard',
      mod.macroEnableRefusal({ key: 'F6', commands: ['go $s'] }, { variables: VARS }) === null
    )
    ok(
      'sabotage is scoped: a plainly scripted command is still refused',
      mod.macroEnableRefusal({ key: 'F6', commands: ['#queue {north}'] }) !== null
    )
    // And the fire-time half is untouched, which is the point of having two.
    const s6 = spy()
    mod.runMacroCommands(['go $s'], { send: s6.send, expand: expandWith(VARS), variables: VARS })
    ok('sabotage is scoped: the runner still refuses to send it', s6.sent.length === 0, `${s6.sent.length} sends`)
  }
}

// The floor, set well below the real count: a truncated or half-imported run
// that checked four things and found nothing wrong must not read as a pass.
if (checked < 30) {
  console.log(`\nFAIL only ${checked} checks ran; this suite has more than that, so something did not execute`)
  failed += 1
}

console.log(failed ? `\n${failed} failed of ${checked} checked` : `\nall passed, ${checked} checked`)
process.exit(failed ? 1 : 0)
