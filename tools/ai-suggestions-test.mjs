/**
 * The confirmation gate: the one place a model-authored command can become a
 * command the game runs.
 *
 * Every other AI module in this repo is tested for the property that it
 * *cannot* reach `gameActions.ts`. This one can, deliberately, and so it is
 * the only file where that property has to be replaced by something stronger
 * than "it does not import the thing".
 *
 * # What is asserted, and why in this shape
 *
 * The cases below assert **properties of the boundary**, never the mechanism
 * that implements them. "An unconfirmed suggestion never reaches the outbound
 * write" survives a rewrite of how confirmation is represented; "requestExecution
 * checks status first" does not, and a test written that way would have to be
 * edited by whoever changes the code, which is the one moment you want a test
 * to be an independent witness.
 *
 * The sink is a spy rather than the real `requestGameAction`, and every case
 * that must not send asserts the spy was never called - not that the function
 * returned `ok:false`. A refusal that returns a failure *after* sending would
 * pass a test that only read the return value.
 *
 * # The clock and the state version are injected
 *
 * Both are read through `deps`, so expiry is exercised by moving a number
 * rather than by sleeping, and a stale state version is exercised without a
 * store. `src/lib/stateVersion.ts` - the real owner of that number - is
 * imported and tested directly further down, so nothing here depends on a
 * fixture agreeing with the app about what the version means.
 *
 * Run: node --experimental-strip-types tools/ai-suggestions-test.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  SuggestionStore,
  canTransitionSuggestion,
  defaultCommandPolicy,
  COMMAND_TYPES,
  OBSERVATION_COMMAND_TYPES,
  TERMINAL_SUGGESTION_STATUSES,
} from '../src/lib/aiSuggestions.ts'
import { validateGameActionCommand } from '../src/lib/gameCommand.ts'
import { suggestionCardView } from '../src/lib/suggestionCardView.ts'
import {
  bumpStateVersion,
  currentStateVersion,
  onStateVersionChange,
  versionedSetter,
} from '../src/lib/stateVersion.ts'

let pass = 0
let fail = 0

function ok(what, cond, detail) {
  if (cond) {
    pass += 1
    console.log(`OK   ${what}`)
  } else {
    fail += 1
    console.log(`FAIL ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
  }
}

/**
 * A store with a spy sink, a movable clock and a movable state version.
 *
 * `sent` records the exact arguments the boundary was handed. Nothing else in
 * this file is allowed to conclude that a command was or was not sent.
 */
function harness(options = {}) {
  const sent = []
  const clock = { now: options.now ?? 1_000_000 }
  const state = { version: options.stateVersion ?? 7 }
  const paused = { value: options.paused ?? false }
  const store = new SuggestionStore({
    send: (command, label) => {
      sent.push([command, label])
      if (options.sendThrows) throw new Error('the game connection rejected the command')
    },
    now: () => clock.now,
    stateVersion: () => state.version,
    isPaused: () => paused.value,
    policy: options.policy,
  })
  return { store, sent, clock, state, paused }
}

/** The command every happy-path case uses. Double-spaced and mixed-case on
 * purpose: a gate that normalised anything would change this string, and the
 * happy-path case asserts byte equality against it. */
const COMMAND = 'look  IRON   Chest'

function propose(h, overrides = {}) {
  return h.store.create({
    exactCommand: COMMAND,
    commandType: 'look',
    basedOnStateVersion: h.state.version,
    expiresAt: h.clock.now + 30_000,
    evidenceRefs: ['event:41'],
    ...overrides,
  })
}

/* ------------------------------------------------------------------ */
/* 0 - the harness can actually observe a send                         */
/* ------------------------------------------------------------------ */

console.log('-- the spy sink records a send, so "nothing was sent" can fail --')
{
  // Without this, every "the write was not called" case below would pass
  // against a harness whose sink was never wired to anything.
  const h = harness()
  const created = propose(h)
  ok('a valid observation suggestion is accepted', created.ok === true, created.reason)
  const result = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id,
    commandText: COMMAND,
  })
  ok('the control confirmation was accepted', result.ok === true, result.reason)
  ok('and the spy recorded exactly one send', h.sent.length === 1, JSON.stringify(h.sent))
}

/* ------------------------------------------------------------------ */
/* 1 - the data model                                                  */
/* ------------------------------------------------------------------ */

console.log('\n-- a proposal the boundary could not send is refused as data --')
{
  const h = harness()
  const separator = propose(h, { exactCommand: 'look chest;go north' })
  ok('a command separator is refused at creation', separator.ok === false)
  ok('and nothing was sent while refusing it', h.sent.length === 0)

  const empty = propose(h, { exactCommand: '   ' })
  ok('an empty command is refused', empty.ok === false)

  const long = propose(h, { exactCommand: `look ${'x'.repeat(200)}` })
  ok('an over-long command is refused', long.ok === false)

  const control = propose(h, { exactCommand: 'look chest\nlook table' })
  ok('an embedded newline is refused', control.ok === false)
}

console.log('\n-- the card cannot be handed a string that reads as something else --')
{
  // #401: `look my ring <U+202E>rob the bank` was accepted at creation, so the
  // card rendered `look my ring knab eht bor` while `textContent` still
  // equalled `exactCommand`. The panel was honest; the string was not. The
  // property asserted here is not about markup - it is that no such string can
  // reach the store, so there is nothing for a card to render. Built from code
  // points rather than pasted, so the case survives any editor or tool.
  const RTLO = String.fromCodePoint(0x202e)
  const DECEPTIVE = [
    ['U+202E', 0x202e, 'right-to-left override'],
    ['U+200B', 0x200b, 'zero width space'],
    ['U+2066', 0x2066, 'left-to-right isolate'],
    ['U+00AD', 0x00ad, 'soft hyphen'],
    ['U+200D', 0x200d, 'zero width joiner'],
    ['U+2028', 0x2028, 'line separator'],
    ['U+E000', 0xe000, 'private use'],
    ['U+0430', 0x0430, 'cyrillic homoglyph of a'],
  ]
  for (const [label, code, name] of DECEPTIVE) {
    const h = harness()
    const created = propose(h, {
      exactCommand: `look my ring ${String.fromCodePoint(code)}rob the bank`,
    })
    ok(`${label} (${name}) is refused at creation`, created.ok === false, created.reason)
    ok(`${label} refusal says why, in words a card can show`,
      created.ok === false && typeof created.reason === 'string' &&
      created.reason.includes(label) && /cannot carry/.test(created.reason),
      created.reason)
    ok(`${label} leaves nothing for a card to render`,
      h.store.all().length === 0 && h.store.live() === null)
    ok(`${label} sent nothing while refusing`, h.sent.length === 0)
  }

  // The general form, so a future acceptance path cannot slip past the table
  // above: whatever the store holds, the boundary would still send unchanged.
  const h = harness()
  propose(h, { exactCommand: `look my ring ${RTLO}rob the bank` })
  propose(h, { exactCommand: 'look iron chest' })
  ok('one of those two was recorded, so the sweep below has something to check',
    h.store.all().length === 1, `${h.store.all().length} stored`)
  const unsendable = h.store.all().filter((s) => {
    try {
      return validateGameActionCommand(s.exactCommand) !== s.exactCommand
    } catch {
      return true
    }
  })
  ok('every stored suggestion carries a command the boundary would still send',
    unsendable.length === 0, unsendable.map((s) => s.exactCommand).join(', '))
}

console.log('\n-- a declared type that disagrees with the command is refused --')
{
  const h = harness()
  const lying = propose(h, { commandType: 'look', exactCommand: 'sell my ring' })
  ok('a "look" suggestion carrying a sale is refused', lying.ok === false, lying.reason)
  ok('and nothing was sent', h.sent.length === 0)
  const honest = propose(h, { commandType: 'look', exactCommand: 'look chest' })
  ok('a "look" suggestion carrying a look is accepted', honest.ok === true, honest.reason)
}

console.log('\n-- provenance, expiry and the state version are required at creation --')
{
  ok('no evidence is refused', harness().store.create({
    exactCommand: 'look chest', commandType: 'look', basedOnStateVersion: 7,
    expiresAt: 1_030_000, evidenceRefs: [],
  }).ok === false)

  const h = harness()
  ok('an expiry already past is refused',
    propose(h, { expiresAt: h.clock.now - 1 }).ok === false)
  ok('a non-numeric state version is refused',
    propose(h, { basedOnStateVersion: Number.NaN }).ok === false)
}

console.log('\n-- one pending proposal at a time --')
{
  const h = harness()
  ok('the first is accepted', propose(h).ok === true)
  const second = propose(h, { exactCommand: 'look table' })
  ok('a second while one is pending is refused', second.ok === false, second.reason)
  ok('and creating it sent nothing', h.sent.length === 0)
}

console.log('\n-- the status table --')
{
  ok('pending may be confirmed', canTransitionSuggestion('pending', 'confirmed'))
  ok('pending may expire', canTransitionSuggestion('pending', 'expired'))
  ok('pending may be rejected', canTransitionSuggestion('pending', 'rejected'))
  ok('confirmed may await a result', canTransitionSuggestion('confirmed', 'awaiting_result'))
  ok('awaiting_result may resolve', canTransitionSuggestion('awaiting_result', 'resolved'))
  ok('an expired suggestion may not be confirmed', !canTransitionSuggestion('expired', 'confirmed'))
  ok('a rejected suggestion may not be confirmed', !canTransitionSuggestion('rejected', 'confirmed'))
  ok('a resolved suggestion may not be re-sent', !canTransitionSuggestion('resolved', 'awaiting_result'))
  ok('an expired one may not be resurrected as pending', !canTransitionSuggestion('expired', 'pending'))
  for (const status of TERMINAL_SUGGESTION_STATUSES) {
    ok(`${status} is terminal in the table too`,
      ['expired', 'rejected', 'resolved'].includes(status) &&
      !canTransitionSuggestion(status, 'confirmed'))
  }
}

/* ------------------------------------------------------------------ */
/* 2 - the gate: what may reach the outbound write                     */
/* ------------------------------------------------------------------ */

console.log('\n-- PROPERTY: an unconfirmed suggestion never reaches the outbound write --')
{
  const h = harness()
  const created = propose(h)
  // Everything a client does to a suggestion short of confirming it.
  h.store.live()
  h.store.sweepExpired()
  h.store.all()
  h.store.byStatus('pending')
  h.store.onStateVersion(h.state.version)
  h.store.dismiss(created.suggestion.id)
  ok('reading, sweeping and dismissing a suggestion sends nothing',
    h.sent.length === 0, JSON.stringify(h.sent))
  ok('and the dismissed one is rejected', h.store.get(created.suggestion.id).status === 'rejected')

  const h2 = harness()
  const other = propose(h2)
  const wrongId = h2.store.requestExecution('suggestion:999', {
    suggestionId: 'suggestion:999', commandText: COMMAND,
  })
  ok('confirming an id that does not exist is refused', wrongId.ok === false)
  const mismatchedId = h2.store.requestExecution(other.suggestion.id, {
    suggestionId: 'suggestion:999', commandText: COMMAND,
  })
  ok('a confirmation naming a different suggestion is refused', mismatchedId.ok === false)
  ok('neither reached the outbound write', h2.sent.length === 0, JSON.stringify(h2.sent))
}

console.log('\n-- PROPERTY: a confirmed-but-expired suggestion is rejected and the write is not called --')
{
  const h = harness()
  const created = propose(h)
  // One millisecond past the deadline, and a perfect confirmation.
  h.clock.now = created.suggestion.expiresAt + 1
  const result = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id, commandText: COMMAND,
  })
  ok('an expired suggestion is refused', result.ok === false, result.reason)
  ok('the outbound write was never called', h.sent.length === 0, JSON.stringify(h.sent))
  ok('and the record says expired', h.store.get(created.suggestion.id).status === 'expired')
}

console.log('\n-- PROPERTY: a stale state version is rejected --')
{
  const h = harness()
  const created = propose(h)
  // The world moved. Nothing tells the store: `onStateVersion` is deliberately
  // NOT called, because the guarantee has to hold on the receiving side of the
  // confirmation and not depend on any notification having arrived.
  h.state.version += 1
  const result = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id, commandText: COMMAND,
  })
  ok('a suggestion based on a version that has moved is refused', result.ok === false, result.reason)
  ok('the outbound write was never called', h.sent.length === 0, JSON.stringify(h.sent))
  ok('and it is settled rather than left offerable',
    h.store.get(created.suggestion.id).status === 'rejected')
}

console.log('\n-- PROPERTY: an altered command is refused --')
{
  for (const altered of [
    COMMAND.trim().replace(/\s+/g, ' '), // tidied
    COMMAND.toLowerCase(), // re-cased
    `${COMMAND} `, // one trailing space
    'look chest', // a summary of it
  ]) {
    const h = harness()
    const created = propose(h)
    const result = h.store.requestExecution(created.suggestion.id, {
      suggestionId: created.suggestion.id, commandText: altered,
    })
    ok(`confirming “${altered}” instead of the exact command is refused`, result.ok === false)
    ok('and nothing was sent', h.sent.length === 0, JSON.stringify(h.sent))
    ok('the suggestion stays pending, so the player can still confirm the real one',
      h.store.get(created.suggestion.id).status === 'pending')
  }
}

console.log('\n-- PROPERTY: confirming sends the exact string, once --')
{
  const h = harness()
  const created = propose(h)
  const result = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id, commandText: COMMAND,
  })
  ok('the confirmation is accepted', result.ok === true, result.reason)
  ok('the outbound write was called exactly once', h.sent.length === 1, JSON.stringify(h.sent))
  ok('with the suggested command, byte for byte',
    h.sent[0][0] === COMMAND, JSON.stringify(h.sent[0]))
  ok('and with the command the record still holds',
    h.sent[0][0] === created.suggestion.exactCommand)
  ok('the suggestion is now awaiting the game’s own answer',
    h.store.get(created.suggestion.id).status === 'awaiting_result')

  const again = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id, commandText: COMMAND,
  })
  ok('confirming the same suggestion twice is refused', again.ok === false, again.reason)
  ok('and did not send it a second time', h.sent.length === 1, JSON.stringify(h.sent))
}

console.log('\n-- PROPERTY: a second command while one awaits its result is refused --')
{
  const h = harness()
  const first = propose(h)
  h.store.requestExecution(first.suggestion.id, {
    suggestionId: first.suggestion.id, commandText: COMMAND,
  })
  ok('the first is awaiting a result',
    h.store.get(first.suggestion.id).status === 'awaiting_result')

  const second = propose(h, { exactCommand: 'look table' })
  ok('a second proposal may be recorded while the first awaits', second.ok === true, second.reason)
  const result = h.store.requestExecution(second.suggestion.id, {
    suggestionId: second.suggestion.id, commandText: 'look table',
  })
  ok('but confirming it is refused while one is in flight', result.ok === false, result.reason)
  ok('so the outbound write was still called only once', h.sent.length === 1, JSON.stringify(h.sent))
}

console.log('\n-- PROPERTY: the command policy refuses a consequential command even with a perfect confirmation --')
{
  const h = harness()
  const created = propose(h, { commandType: 'movement', exactCommand: 'go bank' })
  ok('a movement proposal may be recorded', created.ok === true, created.reason)
  const result = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id, commandText: 'go bank',
  })
  ok('and is refused by the policy', result.ok === false, result.reason)
  ok('with nothing sent', h.sent.length === 0, JSON.stringify(h.sent))

  ok('the shipped policy admits observation commands',
    OBSERVATION_COMMAND_TYPES.every((t) => defaultCommandPolicy.allows(t, { paused: false }).ok))
  ok('and refuses every other declared type',
    COMMAND_TYPES.filter((t) => !OBSERVATION_COMMAND_TYPES.includes(t))
      .every((t) => defaultCommandPolicy.allows(t, { paused: false }).ok === false))
}

console.log('\n-- PROPERTY: paused refuses, because the Rust gate does not cover this path --')
{
  // src-tauri/src/pause.rs: "The gate is in the script-API dispatch path only;
  // game_link::game_send called from the frontend is untouched." A confirmed
  // suggestion goes out through gameActions.ts, so Pause has to be asked here
  // or it is not asked at all.
  const h = harness({ paused: true })
  const created = propose(h)
  const result = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id, commandText: COMMAND,
  })
  ok('a perfect confirmation is refused while automation is paused', result.ok === false, result.reason)
  ok('and nothing was sent', h.sent.length === 0, JSON.stringify(h.sent))
  ok('the shipped policy refuses an observation command while paused',
    defaultCommandPolicy.allows('look', { paused: true }).ok === false)
}

console.log('\n-- PROPERTY: the kill switch rejects every pending suggestion --')
{
  const h = harness()
  const created = propose(h)
  const cancelled = h.store.cancelAll()
  ok('Stop rejected the pending suggestion', cancelled === 1)
  ok('its status is rejected', h.store.get(created.suggestion.id).status === 'rejected')
  ok('and it says why', /stopped/.test(h.store.get(created.suggestion.id).reason ?? ''))
  const after = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id, commandText: COMMAND,
  })
  ok('confirming it after Stop is refused', after.ok === false, after.reason)
  ok('and sends nothing', h.sent.length === 0, JSON.stringify(h.sent))

  // A command already on the wire is not recalled, and the record must not
  // claim it was. Stop kills task processes; it cannot unsend a sent line.
  const h2 = harness()
  const sentOne = propose(h2)
  h2.store.requestExecution(sentOne.suggestion.id, {
    suggestionId: sentOne.suggestion.id, commandText: COMMAND,
  })
  ok('Stop does not claim to have recalled a command already sent',
    h2.store.cancelAll() === 0 &&
    h2.store.get(sentOne.suggestion.id).status === 'awaiting_result')
}

console.log('\n-- PROPERTY: the model never marks its own proposal successful --')
{
  const h = harness()
  const created = propose(h)
  h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id, commandText: COMMAND,
  })
  ok('nothing about sending it resolved it',
    h.store.get(created.suggestion.id).status === 'awaiting_result')
  h.store.onStateVersion(h.state.version + 1)
  ok('the authoritative state moving is what resolves it',
    h.store.get(created.suggestion.id).status === 'resolved')
}

console.log('\n-- a boundary that throws leaves a record, and does not retry --')
{
  const h = harness({ sendThrows: true })
  const created = propose(h)
  const result = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id, commandText: COMMAND,
  })
  ok('the refusal is reported rather than thrown', result.ok === false, result.reason)
  ok('the boundary was attempted exactly once', h.sent.length === 1)
  ok('and the suggestion is rejected, not left awaiting a result that cannot come',
    h.store.get(created.suggestion.id).status === 'rejected')
}

console.log('\n-- expiry is a fact about the clock, not about who looked --')
{
  const h = harness()
  const created = propose(h)
  h.clock.now = created.suggestion.expiresAt + 1
  ok('live() will not offer an expired suggestion', h.store.live() === null)
  ok('and expiring it is recorded', h.store.get(created.suggestion.id).status === 'expired')

  const h2 = harness()
  const stale = propose(h2)
  h2.clock.now = stale.suggestion.expiresAt + 1
  // Nothing polled. The gate expires it itself.
  const result = h2.store.requestExecution(stale.suggestion.id, {
    suggestionId: stale.suggestion.id, commandText: COMMAND,
  })
  ok('a client that never polled still cannot confirm an expired suggestion', result.ok === false)
  ok('and sent nothing', h2.sent.length === 0)
}

console.log('\n-- a pending proposal whose basis moved stops being offered --')
{
  const h = harness()
  const created = propose(h)
  h.store.onStateVersion(h.state.version + 1)
  ok('it is rejected once the world has moved',
    h.store.get(created.suggestion.id).status === 'rejected')
  ok('and nothing was sent', h.sent.length === 0)
}

/* ------------------------------------------------------------------ */
/* 3 - the state version, at its owner                                 */
/* ------------------------------------------------------------------ */

console.log('\n-- src/lib/stateVersion.ts owns the number the gate compares --')
{
  const before = currentStateVersion()
  const seen = []
  const off = onStateVersionChange((v) => seen.push(v))
  const next = bumpStateVersion()
  ok('a bump returns the new version', next === before + 1, `${before} -> ${next}`)
  ok('and the reader agrees with it', currentStateVersion() === next)
  ok('subscribers were told exactly once', seen.length === 1 && seen[0] === next, JSON.stringify(seen))
  off()
  bumpStateVersion()
  ok('an unsubscribed listener hears nothing more', seen.length === 1, JSON.stringify(seen))

  const thrower = onStateVersionChange(() => { throw new Error('bad subscriber') })
  const survivors = []
  const off2 = onStateVersionChange((v) => survivors.push(v))
  bumpStateVersion()
  ok('a subscriber that throws does not stop the next one hearing about it',
    survivors.length === 1, JSON.stringify(survivors))
  thrower()
  off2()
}

/* ------------------------------------------------------------------ */
/* 4 - one path to the game, as a fact about the source                */
/* ------------------------------------------------------------------ */

const AI_DIR = 'src/lib'
const aiModules = readdirSync(AI_DIR)
  .filter((name) => /^ai[A-Z].*\.ts$/.test(name))
  .map((name) => `${AI_DIR}/${name}`)

console.log('\n-- the sweep can see what it is looking for --')
{
  // A zero is a claim about the instrument first. If this list is empty or
  // missing the file everybody knows is in it, every count below means nothing.
  ok(`the ai* sweep found modules to read (${aiModules.length})`, aiModules.length >= 10,
    aiModules.join(', '))
  ok('and it includes the worker, which is known to be one',
    aiModules.includes('src/lib/aiWorker.ts'))
  ok('and the gate itself', aiModules.includes('src/lib/aiSuggestions.ts'))
}

console.log('\n-- exactly one ai* module can reach the command path --')
{
  const reaching = aiModules.filter((file) =>
    /from '\.\/gameActions(\.ts)?'/.test(readFileSync(file, 'utf8')))
  ok('one and only one, and it is the gate',
    reaching.length === 1 && reaching[0] === 'src/lib/aiSuggestions.ts',
    reaching.join(', ') || 'none')

  const sending = aiModules.filter((file) => {
    const src = readFileSync(file, 'utf8')
    return /\b(sendGame|sendGameAction|requestGameAction|game_send)\b/.test(src)
  })
  ok('and only the gate names a send surface at all',
    sending.length === 1 && sending[0] === 'src/lib/aiSuggestions.ts',
    sending.join(', ') || 'none')
}

console.log('\n-- inside the gate, one call site --')
{
  const src = readFileSync('src/lib/aiSuggestions.ts', 'utf8')
  const calls = src.match(/requestGameAction\(/g) ?? []
  ok('requestGameAction is called exactly once', calls.length === 1, `${calls.length} call(s)`)
  // The source argument is pinned along with the call. The outbound command
  // lane (src-tauri/src/command_gate.rs) orders by it, and 'ai-suggestion'
  // sits below the player and below every UI source - so a confirmed model
  // proposal can never leave ahead of something a person just typed. Widening
  // this to ignore the third argument would let that label be changed to
  // 'player' with nothing saying so.
  ok('and that call is inside the wiring of the single store, labelled ai-suggestion',
    /send: \(command, label\) => requestGameAction\(command, label, 'ai-suggestion'\)/.test(src))
  const sends = src.match(/this\.deps\.send\(/g) ?? []
  ok('the store hands the boundary a command in exactly one method',
    sends.length === 1, `${sends.length} site(s)`)
  ok('and that method is the gate',
    /requestExecution\([\s\S]*?this\.deps\.send\(/.test(src))
  ok('the gate does not import the app store, so it loads without Vite',
    !/from '\.\.\/store\/useAppStore/.test(src))
}

console.log('\n-- exactly one store is constructed in the app --')
{
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name).split('\\').join('/')
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk('src')
  ok(`the src sweep read a believable number of files (${files.length})`, files.length >= 100)

  const constructing = files.filter((f) => /new SuggestionStore\(/.test(readFileSync(f, 'utf8')))
  ok('only aiSuggestions.ts constructs a SuggestionStore',
    constructing.length === 1 && constructing[0] === 'src/lib/aiSuggestions.ts',
    constructing.join(', ') || 'none')

  // Guards the UI half of this increment before it exists: a panel that
  // reached the command path itself would be a second route, and the whole
  // safety argument is that there is one.
  const aiComponents = files.filter((f) => /\/Ai[A-Z][^/]*\.tsx$/.test(f))
  ok(`the AI component sweep found components (${aiComponents.length})`, aiComponents.length >= 1,
    aiComponents.join(', '))
  const sendingComponents = aiComponents.filter((f) =>
    /\b(sendGame|sendGameAction|requestGameAction)\b/.test(readFileSync(f, 'utf8')))
  ok('no AI panel reaches the command path directly',
    sendingComponents.length === 0, sendingComponents.join(', '))

  // And the one write path the wrapper cannot cover, swept here because this
  // block already has the file list.
  //
  // `zustand`'s `create` hands the initialiser the same setter it also exposes
  // on the hook, so `useAppStore.setState({ character })` writes an
  // authoritative key and bumps nothing. Measured rather than reasoned, with a
  // wrapper of the same shape as `versionedSetter`: one bump for a write
  // through a store action, none for the identical write through `setState`,
  // and the field updated both times.
  //
  // The `rawSet` count further down cannot see this one. It reads
  // `useAppStore.ts`, and this bypass is spelled anywhere but there. The
  // wrapper exists because "bump it when you write these" stops holding at the
  // sixth write site, and `setState` is how the sixth one arrives.
  const storeBypass = /\buseAppStore\s*\.\s*setState\s*\(/
  ok('the store-bypass matcher fires on the line it is looking for',
    storeBypass.test('useAppStore.setState({ character: null })'),
    'positive control: that write reaches zustand past versionedSetter')
  ok('and not on the supported ways to reach the store',
    !storeBypass.test('useAppStore.getState().character') && !storeBypass.test('const [s, setState] = useState()'),
    'negative control')
  const bypassing = files.filter((f) => f !== 'src/store/useAppStore.ts' && storeBypass.test(readFileSync(f, 'utf8')))
  ok('nothing writes the store through useAppStore.setState, which would skip the version bump',
    bypassing.length === 0,
    bypassing.join(', ') || `${files.length} files swept; write through a store action so versionedSetter sees it`)
}

console.log('\n-- the card confirms the record, not what is on the screen --')
{
  const PANEL = 'src/components/shared/AiWorkerPanel.tsx'
  ok(existsSync(PANEL), `${PANEL} exists`)
  const panel = readFileSync(PANEL, 'utf8')

  ok('it reads the one store rather than building another',
    /suggestionStore\(\)/.test(panel) && !/new SuggestionStore\(/.test(panel))
  ok('the command is rendered in monospace, unwrapped and untidied',
    /font-mono/.test(panel) && /whitespace-pre/.test(panel) &&
    /\{suggestion\.exactCommand\}/.test(panel))
  // The confirmation carries the string from the record. If it were read back
  // out of the DOM, or retyped here, the player could be confirming something
  // other than what they read - and the gate's byte comparison would be
  // comparing the panel against itself.
  // Terminated on purpose. `/commandText: suggestion\.exactCommand/` alone is
  // a prefix match, so it stays green against
  // `suggestion.exactCommand.trim().replace(...)` - a panel that tidies the
  // string before confirming it, which is precisely the defect this line
  // exists to catch. Found by sabotaging it; the check went green and the
  // sabotage proved the check, not the code.
  ok('Confirm hands back the command text from the record, untouched',
    /commandText: suggestion\.exactCommand,\s*\r?\n/.test(panel))
  ok('and it names the suggestion it is confirming',
    /suggestionId: suggestion\.id/.test(panel))
  ok('Dismiss goes through the store too', /store\.dismiss\(suggestion\.id/.test(panel))
  ok('the expiry is on screen', /expiresAt - Date\.now\(\)/.test(panel))
  ok('and a refusal is shown rather than swallowed',
    /Not sent:/.test(panel) && /result\.ok \? null : /.test(panel))

  // #399. This used to read `{refusal && ...}` against a bare string in local
  // state, which is how one suggestion's refusal came to be rendered under the
  // next one's command. The property is that the panel cannot draw a refusal
  // it has not checked the id of, and the only way to keep that true is for it
  // to have no unchecked string to draw: the state is keyed, and what reaches
  // the paragraph is the view's answer.
  ok('the refusal the panel holds is keyed to a suggestion',
    /useState<KeyedRefusal \| null>/.test(panel) &&
    /\{ suggestionId: suggestion\.id, reason: /.test(panel))
  ok('and what it renders is the checked one, not the raw state',
    /\{view\.refusal && /.test(panel) && !/\{refusal && /.test(panel))
  ok('the card asks the view what to draw rather than deciding itself',
    /suggestionCardView\(\{/.test(panel) && /lastSettled: store\.lastSettled\(\)/.test(panel))

  // #403. The worker has always known why a proposal did not become a card.
  // A field with no reader says nothing, so the reader is the property.
  ok('the panel says why a proposed command never appeared',
    /status\.suggestionRefused/.test(panel) &&
    /The model proposed a command that was not admitted/.test(panel))

  // The panel must not decide anything the gate decides. If it compared the
  // state version or the clock itself, a green panel would stop meaning the
  // gate agreed - and the checks in this file, which render nothing, would
  // have stopped covering what a player actually experiences.
  ok('the panel does not compare state versions itself',
    !/basedOnStateVersion/.test(panel))
  ok('and it names no command policy of its own',
    !/OBSERVATION_COMMAND_TYPES|commandPolicy|defaultCommandPolicy/.test(panel))
}

console.log('\n-- the worker can record a proposal and cannot send one --')
{
  const worker = readFileSync('src/lib/aiWorker.ts', 'utf8')
  ok('the live-review schema carries at most one command',
    /suggestion\?: \{/.test(worker))
  ok('the worker holds a structural port, not the store',
    !/from '\.\/aiSuggestions/.test(worker))
  ok('and the port admits only create',
    /suggestions\?: \{\s*create\(/.test(worker))
  ok('a proposal is pinned to the version the caller handed in',
    /basedOnStateVersion: deps\.stateVersion \?\? 0/.test(worker))
  ok('with ?? rather than ||, because version 0 is a real value',
    !/deps\.stateVersion \|\| /.test(worker))

  const host = readFileSync('src/lib/aiWorkerHost.ts', 'utf8')
  ok('the host wires the one store into the turn', /suggestions: suggestionStore\(\)/.test(host))
  ok('and reads the version from its owner rather than the mirror',
    /stateVersion: currentStateVersion\(\)/.test(host))
  ok('the host still names no send surface',
    !/\b(sendGame|requestGameAction|game_send)\b/.test(host))
}

console.log('\n-- a write bumps the version by its shape, not by its caller --')
{
  // These were three regexes over `useAppStore.ts` until #370: they asserted
  // that the bump was *spelled* a particular way, which is why removing the
  // whole feature could turn them red while every behavioural check stayed
  // green. The wrapper now lives in `stateVersion.ts` — importable without a
  // Vite build — so the property can be run instead of grepped.
  const wrote = []
  const state = { character: null, mapHere: null }
  const set = versionedSetter((patch) => wrote.push(patch), () => state)

  const bumpsFor = (patch) => {
    const before = currentStateVersion()
    set(patch)
    return currentStateVersion() - before
  }

  ok('a write carrying character bumps the version', bumpsFor({ character: { id: 1 } }) === 1)
  ok('a write carrying mapHere bumps the version', bumpsFor({ mapHere: { room: 2 } }) === 1)
  ok('a write carrying both bumps it once, not twice',
    bumpsFor({ character: { id: 3 }, mapHere: { room: 4 } }) === 1)
  ok('an authoritative key set to null still counts as a statement',
    bumpsFor({ character: null }) === 1)
  ok('a write carrying neither does not bump it',
    bumpsFor({ gameLines: ['a line'], settingsOpen: true }) === 0)
  ok('an empty write does not bump it', bumpsFor({}) === 0)

  // The functional form is how `bridgeMessageHandler` writes, so the wrapper
  // has to resolve it before deciding rather than after.
  ok('a functional update carrying character bumps it',
    bumpsFor(() => ({ character: { id: 5 } })) === 1)
  ok('a functional update carrying neither does not',
    bumpsFor(() => ({ gameLines: [] })) === 0)

  // The mirror is gone (#370): the wrapper counts writes, it does not add to
  // them. A store field would be a second answer to a question with one owner.
  ok('the patch reaches the store untouched',
    wrote.every((patch) => !('stateVersion' in patch)),
    JSON.stringify(wrote.find((patch) => 'stateVersion' in patch)))
  ok('every write reached the store, bumped or not', wrote.length === 8, `${wrote.length}`)

  // A subscriber is the supported way for a component to re-render on it, and
  // it is what the removed mirror was justified by. It has to actually fire.
  let heard = 0
  const off = onStateVersionChange(() => { heard += 1 })
  set({ character: { id: 6 } })
  set({ gameLines: [] })
  off()
  set({ character: { id: 7 } })
  ok('a subscriber hears authoritative writes and only those, until it unsubscribes',
    heard === 1, `${heard}`)

  // Structural, and deliberately so: the store cannot be imported outside a
  // Vite build, so "no write reaches zustand past the wrapper" has no runtime
  // form here. Three `rawSet` occurrences would mean somebody had written
  // state past it, which is the bypass the wrapper exists to prevent.
  const src = readFileSync('src/store/useAppStore.ts', 'utf8')
  const raw = src.match(/\brawSet\b/g) ?? []
  ok('the unwrapped setter appears only where it is wrapped', raw.length === 2, `${raw.length} use(s)`)
  ok('every store helper is handed the wrapped setter',
    /const set = versionedSetter<AppState>\(rawSet, get\)/.test(src))
}

console.log('\n-- Stop reaches the gate without the kill switch importing it --')
{
  const flowStop = readFileSync('src/lib/flowStop.ts', 'utf8')
  ok('flowStop publishes a Stop signal', /export const onStopAll = stopAll\.on/.test(flowStop))
  ok('requestStopAll fires it', /stopAll\.request\(\)/.test(flowStop))
  ok('flowStop imports no ai module', !/from '\.\/ai[A-Z]/.test(flowStop))
  ok('and exposes the pause state the gate has to ask about',
    /export function isAutomationPaused\(\)/.test(flowStop))

  const gate = readFileSync('src/lib/aiSuggestions.ts', 'utf8')
  ok('the gate subscribes to Stop', /onStopAll\(\(\) => \{[\s\S]{0,80}cancelAll\(\)/.test(gate))
  ok('and asks flowStop whether automation is paused',
    /isPaused: \(\) => isAutomationPaused\(\)/.test(gate))
}

/* ------------------------------------------------------------------ */
/* 5 - a refusal is shown with the suggestion it is about (#399)       */
/* ------------------------------------------------------------------ */

/**
 * The card's rendering decision, run without a DOM.
 *
 * These are properties of what a player sees, asserted against the real store
 * rather than a fixture: "after an expired confirm the card explains THAT
 * suggestion", "a fresh proposal carries no older refusal". The panel is a
 * renderer of `suggestionCardView`'s answer, which is why the answer is what
 * gets tested here - and the browser check recorded in `docs/verification/` is
 * what holds the panel to drawing it.
 *
 * Before #399 the first two of these were false in the shipped app: the two
 * refusals that matter settle the suggestion, `live()` went null in the same
 * commit as the sentence, and the card's `if (!suggestion) return null` fired
 * before the sentence painted - which then showed up under the next proposal.
 */
console.log('\n-- a refusal is shown with the suggestion it refers to --')
{
  // The instrument first: a refusal keyed to the live suggestion must be
  // drawn, or every "it is not shown" case below passes against a view that
  // never shows anything.
  const control = suggestionCardView({
    live: { id: 'suggestion:1', exactCommand: 'look chest', status: 'pending' },
    lastSettled: null,
    refusal: { suggestionId: 'suggestion:1', reason: 'automation is paused' },
  })
  ok('positive control: a refusal naming the live suggestion is drawn',
    control.kind === 'offer' && control.refusal === 'automation is paused',
    JSON.stringify(control))

  // a. expiry - the refusal a player most needs, and the one that used to
  // vanish because the store settles the suggestion that produced it.
  const h = harness()
  const created = propose(h)
  h.clock.now += 31_000
  const refused = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id,
    commandText: COMMAND,
  })
  ok('an expired confirmation is refused', refused.ok === false, refused.reason)
  ok('and the store no longer offers it', h.store.live() === null)
  const expiredView = suggestionCardView({
    live: h.store.live(),
    lastSettled: h.store.lastSettled(),
    refusal: { suggestionId: created.suggestion.id, reason: refused.reason },
  })
  ok('the card still draws something rather than vanishing',
    expiredView.kind === 'settled', expiredView.kind)
  ok('and it is the suggestion the refusal is about',
    expiredView.suggestion?.id === created.suggestion.id, expiredView.suggestion?.id)
  ok('with the reason on it', expiredView.refusal === refused.reason, expiredView.refusal)

  // b. the state moved - the other settling refusal, same property.
  const h2 = harness()
  const created2 = propose(h2)
  h2.state.version += 1
  const stale = h2.store.requestExecution(created2.suggestion.id, {
    suggestionId: created2.suggestion.id,
    commandText: COMMAND,
  })
  ok('a stale-version confirmation is refused', stale.ok === false, stale.reason)
  ok('and nothing was sent', h2.sent.length === 0, JSON.stringify(h2.sent))
  const staleView = suggestionCardView({
    live: h2.store.live(),
    lastSettled: h2.store.lastSettled(),
    refusal: { suggestionId: created2.suggestion.id, reason: stale.reason },
  })
  ok('the card explains that one too',
    staleView.kind === 'settled' && staleView.suggestion?.id === created2.suggestion.id &&
    staleView.refusal === stale.reason,
    JSON.stringify(staleView))

  // c. a new proposal wears no older refusal. This is the measured half of
  // #399: a valid card with 60 seconds on the clock and another suggestion's
  // red line underneath it.
  h2.state.version += 1
  const fresh = h2.store.create({
    exactCommand: 'look table',
    commandType: 'look',
    basedOnStateVersion: h2.state.version,
    expiresAt: h2.clock.now + 60_000,
    evidenceRefs: ['event:42'],
  })
  ok('a second suggestion can be proposed once the first is settled',
    fresh.ok === true, fresh.reason)
  ok('the two are different records', fresh.suggestion.id !== created2.suggestion.id)
  const freshView = suggestionCardView({
    live: h2.store.live(),
    lastSettled: h2.store.lastSettled(),
    refusal: { suggestionId: created2.suggestion.id, reason: stale.reason },
  })
  ok('the new card is offered', freshView.kind === 'offer', freshView.kind)
  ok('it is the new suggestion', freshView.suggestion?.id === fresh.suggestion.id)
  ok('and it carries no refusal at all', freshView.refusal === null, freshView.refusal)

  // d. the general property, stated without a store: a refusal never renders
  // beside a suggestion it does not name, whichever slot that suggestion is in.
  const mismatchedOffer = suggestionCardView({
    live: { id: 'suggestion:9', exactCommand: 'look table', status: 'pending' },
    lastSettled: { id: 'suggestion:8', exactCommand: 'look chest', status: 'rejected' },
    refusal: { suggestionId: 'suggestion:8', reason: 'the state it was based on is no longer current' },
  })
  ok('a refusal for another suggestion is not drawn on a live one',
    mismatchedOffer.kind === 'offer' && mismatchedOffer.refusal === null,
    JSON.stringify(mismatchedOffer))
  const mismatchedSettled = suggestionCardView({
    live: null,
    lastSettled: { id: 'suggestion:9', exactCommand: 'look table', status: 'rejected' },
    refusal: { suggestionId: 'suggestion:8', reason: 'the state it was based on is no longer current' },
  })
  ok('nor on a settled one it does not name',
    mismatchedSettled.kind === 'none', JSON.stringify(mismatchedSettled))
  ok('and with nothing anywhere, there is no card',
    suggestionCardView({ live: null, lastSettled: null, refusal: null }).kind === 'none')

  // e. dismissed means dismissed: clearing the refusal takes the card away
  // rather than leaving a permanent record of an old failure on screen.
  ok('a settled card with its refusal cleared shows nothing',
    suggestionCardView({
      live: null,
      lastSettled: h2.store.lastSettled(),
      refusal: null,
    }).kind === 'none')
}

console.log('\n-- lastSettled names the record a refusal can be shown against --')
{
  const h = harness()
  ok('a store that has settled nothing has no settled record', h.store.lastSettled() === null)
  const created = propose(h)
  ok('a pending suggestion is not a settled one', h.store.lastSettled() === null,
    JSON.stringify(h.store.lastSettled()))

  const sent = h.store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id,
    commandText: COMMAND,
  })
  ok('the happy path is still the happy path', sent.ok === true, sent.reason)
  ok('and a command awaiting its result is not settled either',
    h.store.lastSettled() === null, JSON.stringify(h.store.lastSettled()))

  h.store.onStateVersion(h.state.version + 1)
  ok('the game answering settles it', h.store.lastSettled()?.status === 'resolved',
    h.store.lastSettled()?.status)
  ok('and it is the record that was sent',
    h.store.lastSettled()?.id === created.suggestion.id)

  // The most recent one, not the first: a panel showing an older settled
  // record beside a newer refusal would be #399 again by another route.
  const second = h.store.create({
    exactCommand: 'look table',
    commandType: 'look',
    basedOnStateVersion: h.state.version,
    expiresAt: h.clock.now + 30_000,
    evidenceRefs: ['event:42'],
  })
  h.store.dismiss(second.suggestion.id, 'dismissed by the player')
  ok('a later settlement replaces an earlier one',
    h.store.lastSettled()?.id === second.suggestion.id, h.store.lastSettled()?.id)
  ok('carrying the reason it ended with',
    h.store.lastSettled()?.reason === 'dismissed by the player', h.store.lastSettled()?.reason)
  ok('and it is terminal, so there is nothing left to do with it',
    TERMINAL_SUGGESTION_STATUSES.includes(h.store.lastSettled()?.status))
}

console.log('\n-- the suite is registered where a suite has to be registered --')
{
  ok('package.json runs it',
    /"test:ai-suggestions":/.test(readFileSync('package.json', 'utf8')))
  ok('tools/test-suites.json lists it',
    JSON.parse(readFileSync('tools/test-suites.json', 'utf8')).includes('test:ai-suggestions'))
  ok('the module it tests exists', existsSync('src/lib/aiSuggestions.ts'))
}

console.log('')
const total = pass + fail
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 60
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `total`, not `pass`. The denominator has to be the number of checks that
// ran, or it shrinks by one for every failure and the line quietly reports a
// smaller suite on exactly the run where you most want to know the size did
// not change. Clean and one-assertion-broken must print the same number here;
// only `failed` moves.
console.log(`${total} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
