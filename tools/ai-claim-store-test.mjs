/**
 * A candidate claim must not be able to become a fact by accident.
 *
 * Three ways that happens, and each has its own section below: a claim
 * admitted on evidence nobody can read, a status that skipped the review it
 * was supposed to pass, and a module that could reach a canonical store at
 * all. The last one is checked by reading this store's own source, because a
 * rule about what a file may import is a fact about the file rather than
 * something a runtime test can observe.
 */
import { readFileSync } from 'node:fs'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { ClaimStore, canTransitionClaim, isTerminalClaim, CLAIM_KEY } = await import(
  '../src/lib/aiClaimStore.ts'
)
const { EvidenceStore } = await import('../src/lib/aiEvidenceStore.ts')
const { EventJournal } = await import('../src/lib/aiEventJournal.ts')
const { readJSON, writeJSON } = await import('../src/lib/storage.ts')

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`OK   ${what.padEnd(72)} ${detail}`)
  } else {
    fail++
    console.log(`FAIL ${what.padEnd(72)} ${detail}`)
  }
}

const NOW = '2026-09-05T12:00:00Z'
const LATER = '2026-09-05T12:05:00Z'
const PARSER = { kind: 'parser', identity: 'aiJobProducers.detectExitDivergence' }

const storage = { read: readJSON, write: writeJSON }

/** A store whose evidence really is pinned, so the happy path is not resting
 * on a resolver that says yes to everything. */
const fresh = (events = 3) => {
  store.clear()
  const journal = new EventJournal({ capacity: 100 })
  for (let i = 0; i < events; i++) journal.append('line', { i }, 1000 + i)
  const evidence = new EvidenceStore({ source: journal, capacity: 100 })
  evidence.load()
  evidence.pin(['event:1', 'event:2', 'event:3'], 'test')
  const claims = new ClaimStore({ evidence, storage })
  claims.load()
  return { claims, evidence, journal }
}

const base = (over = {}) => ({
  subject: 'room:142',
  predicate: 'exit_divergence',
  value: { diff: [{ move: 'north', inSnapshot: true, inStream: false }] },
  evidenceRefs: ['event:1'],
  producer: PARSER,
  now: NOW,
  ...over,
})

console.log('-- the record carries every field section 7 requires --')
{
  const { claims } = fresh()
  const r = claims.create(base())
  ok('created', r.ok === true, r.ok ? '' : r.reason)
  const c = r.claim
  for (const field of [
    'schemaVersion',
    'claimId',
    'subject',
    'predicate',
    'value',
    'status',
    'evidenceRefs',
    'producer',
    'confidence',
    'createdAt',
    'reviewedAt',
    'reviewer',
    'supersedes',
    'privacy',
    'licence',
  ]) {
    ok(`${field} is present`, field in c, JSON.stringify(c[field])?.slice(0, 40) ?? 'undefined')
  }
  ok('it starts as a candidate', c.status === 'candidate')
  ok('privacy defaults to private', c.privacy === 'private')
  ok('licence defaults to null, not to a guess', c.licence === null)
  ok('never reviewed is null, not a date', c.reviewedAt === null && c.reviewer === null)
  ok('the producer names an identity, not only a kind', c.producer.identity.length > 0)
  ok('a confidence of 0 survives, because ?? not ||',
    claims.create(base({ confidence: 0 })).claim.confidence === 0)
  ok('an absent confidence is null rather than invented',
    claims.create(base({})).claim.confidence === null)
}

console.log('\n-- evidence is a precondition, and both refusals are distinct --')
{
  const { claims } = fresh()
  const empty = claims.create(base({ evidenceRefs: [] }))
  ok('an empty evidence list is refused', empty.ok === false)
  ok('and the refusal says why', (empty.reason ?? '').includes('at least one'), empty.reason ?? '')

  const dangling = claims.create(base({ evidenceRefs: ['event:9999'] }))
  ok('an unresolvable ref is refused', dangling.ok === false)
  ok('and the refusal names the ref', (dangling.reason ?? '').includes('event:9999'), dangling.reason ?? '')
  ok('nothing was stored for either', claims.all().length === 0, String(claims.all().length))

  // "I could not check" is not "it is fine".
  store.clear()
  const blind = new ClaimStore({ storage })
  blind.load()
  const noResolver = blind.create(base())
  ok('with no evidence store attached, everything is refused', noResolver.ok === false)
  ok('and it says it could not check rather than that it passed',
    (noResolver.reason ?? '').includes('cannot be checked'), noResolver.reason ?? '')
}

console.log('\n-- the transition table is the contract, and terminal means terminal --')
{
  ok('candidate -> corroborated', canTransitionClaim('candidate', 'corroborated') === true)
  ok('corroborated -> accepted-local', canTransitionClaim('corroborated', 'accepted-local') === true)
  ok('candidate -> accepted-local is allowed for a one-observation claim',
    canTransitionClaim('candidate', 'accepted-local') === true)
  ok('candidate -> published is refused outright', canTransitionClaim('candidate', 'published') === false)
  ok('rejected is terminal', isTerminalClaim('rejected') && canTransitionClaim('rejected', 'candidate') === false)
  ok('retracted is terminal', isTerminalClaim('retracted'))
  ok('superseded is terminal', isTerminalClaim('superseded'))
  ok('published is terminal', isTerminalClaim('published'))

  const { claims } = fresh()
  const c = claims.create(base()).claim
  const up = claims.transition(c.claimId, 'corroborated', { now: LATER })
  ok('corroboration works', up.ok === true, up.ok ? '' : up.reason)
  const accepted = claims.transition(c.claimId, 'accepted-local', { now: LATER, reviewer: 'Dan' })
  ok('acceptance works', accepted.ok === true, accepted.ok ? '' : accepted.reason)
  ok('and it records who reviewed it', accepted.claim.reviewer === 'Dan')
  ok('and when', accepted.claim.reviewedAt === LATER)

  const again = claims.transition(c.claimId, 'rejected', { now: LATER })
  ok('an accepted claim cannot be rejected behind the reviewer’s back', again.ok === false, again.reason ?? '')
  ok('the refusal names the pair', (again.reason ?? '').includes('accepted-local -> rejected'), again.reason ?? '')
}

console.log('\n-- any non-terminal claim can be retracted --')
{
  const { claims } = fresh()
  for (const to of ['candidate', 'corroborated', 'accepted-local']) {
    const c = claims.create(base()).claim
    if (to !== 'candidate') claims.transition(c.claimId, 'corroborated', { now: LATER })
    if (to === 'accepted-local') claims.transition(c.claimId, 'accepted-local', { now: LATER })
    const r = claims.transition(c.claimId, 'retracted', { now: LATER })
    ok(`${to} can be retracted`, r.ok === true, r.ok ? '' : r.reason)
  }
}

console.log('\n-- published is refused for private, for unlicensed, and for now --')
{
  const { claims } = fresh()

  const priv = claims.create(base()).claim
  claims.transition(priv.claimId, 'accepted-local', { now: LATER, reviewer: 'Dan' })
  const p1 = claims.transition(priv.claimId, 'published', { now: LATER })
  ok('a private claim cannot be published', p1.ok === false)
  ok('and the refusal says it is private', (p1.reason ?? '').includes('private'), p1.reason ?? '')
  ok('its status did not move', claims.get(priv.claimId).status === 'accepted-local')

  const unlicensed = claims.create(base({ privacy: 'public-candidate' })).claim
  claims.transition(unlicensed.claimId, 'accepted-local', { now: LATER, reviewer: 'Dan' })
  const p2 = claims.transition(unlicensed.claimId, 'published', { now: LATER })
  ok('a claim with no licence cannot be published', p2.ok === false)
  ok('and the refusal says so', (p2.reason ?? '').includes('licence'), p2.reason ?? '')

  const ready = claims.create(base({ privacy: 'public-candidate', licence: 'CC-BY-4.0' })).claim
  claims.transition(ready.claimId, 'accepted-local', { now: LATER, reviewer: 'Dan' })
  const p3 = claims.transition(ready.claimId, 'published', { now: LATER })
  ok('and even a shareable one is refused while nothing can publish it', p3.ok === false)
  ok('the refusal says the path does not exist rather than blaming the claim',
    (p3.reason ?? '').includes('no sharing path exists'), p3.reason ?? '')
  ok('nothing reached published', claims.byStatus('published').length === 0)
}

console.log('\n-- supersession appends, and leaves the old record addressable --')
{
  const { claims } = fresh()
  const first = claims.create(base({ value: { diff: 'one' } })).claim
  const second = claims.supersede(first.claimId, base({ value: { diff: 'two' }, now: LATER }))
  ok('the replacement was created', second.ok === true, second.ok ? '' : second.reason)
  ok('it names what it replaced', second.claim.supersedes === first.claimId)
  ok('the old claim is marked superseded', claims.get(first.claimId).status === 'superseded')
  ok('the old claim is still addressable', claims.get(first.claimId) !== undefined)
  ok('and still carries its own value, unedited',
    JSON.stringify(claims.get(first.claimId).value) === JSON.stringify({ diff: 'one' }),
    JSON.stringify(claims.get(first.claimId).value))
  ok('and still carries its own evidence', claims.get(first.claimId).evidenceRefs.length === 1)
  ok('two records exist, not one edited', claims.all().length === 2)
}

console.log('\n-- a supersession cycle is refused, and the refusal names the loop --')
{
  const { claims } = fresh()
  const a = claims.create(base({ value: 'A' })).claim
  const b = claims.supersede(a.claimId, base({ value: 'B', now: LATER })).claim
  ok('B supersedes A', b.supersedes === a.claimId)

  // A is already superseded, so nothing may supersede it again: a chain with
  // two live replacements for one record has no current claim at its end.
  const twice = claims.supersede(a.claimId, base({ value: 'A again', now: LATER }))
  ok('a superseded claim cannot be superseded again', twice.ok === false, twice.ok ? 'created' : twice.reason)
  ok('and the refusal names its status', twice.ok === false && (twice.reason ?? '').includes('superseded'), twice.ok ? '' : twice.reason)

  // The direct form: hand-build a chain that closes on itself.
  const raw = readJSON(CLAIM_KEY, null)
  ok('the store persisted under its documented key', raw !== null, CLAIM_KEY)

  const c = claims.create(base({ value: 'C' })).claim
  const d = claims.supersede(c.claimId, base({ value: 'D', now: LATER })).claim
  // Force C to point at D, so superseding D by anything walks C -> D -> C.
  claims.get(c.claimId).supersedes = d.claimId
  claims.get(c.claimId).status = 'candidate'
  const looped = claims.supersede(c.claimId, base({ value: 'E', now: LATER }))
  ok('the cycle is caught', looped.ok === false, looped.ok ? 'created anyway' : looped.reason)
  ok('and the refusal draws the loop', looped.ok === false && (looped.reason ?? '').includes('->'), looped.ok ? '' : looped.reason)
  ok('and nothing was left behind', claims.all().every((x) => x.value !== 'E'))
}

console.log('\n-- superseded is not reachable by a bare status change --')
{
  const { claims } = fresh()
  const c = claims.create(base()).claim
  const r = claims.transition(c.claimId, 'superseded', { now: LATER })
  ok('refused', r.ok === false)
  ok('and it says to append the replacement instead', (r.reason ?? '').includes('appending'), r.reason ?? '')
}

console.log('\n-- claims survive a reload --')
{
  const { claims, evidence } = fresh()
  const c = claims.create(base()).claim
  const again = new ClaimStore({ evidence, storage })
  again.load()
  ok('the claim came back', again.get(c.claimId)?.subject === 'room:142')
  const next = again.create(base())
  ok('ids continue rather than colliding', next.claim.claimId !== c.claimId, next.claim.claimId)
}

console.log('\n-- the source check: this store cannot reach canonical data --')
{
  const source = readFileSync(new URL('../src/lib/aiClaimStore.ts', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^import[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1])
  ok('the source was actually read', source.length > 1000, `${source.length} bytes`)
  ok('at least one import was parsed, so the matcher works', imports.length >= 1, imports.join(', '))

  const FORBIDDEN = [
    'mapData',
    'mapPins',
    'bestiary',
    'useAppStore',
    'gameActions',
    'gameCommand',
    'gameLink',
    'persistence',
    'profiles',
  ]
  for (const banned of FORBIDDEN) {
    ok(
      `nothing imports ${banned}`,
      !imports.some((i) => i.includes(banned)),
      imports.filter((i) => i.includes(banned)).join(', ')
    )
  }
  // A positive control: the matcher can see an import that IS there, so a
  // clean list above is a fact about the file and not about the regex.
  ok('the control finds the one import there is', imports.some((i) => i.includes('aiEvidenceStore')), imports.join(', '))
  ok('and the whole import list is short enough to be worth asserting', imports.length <= 3, imports.join(', '))
}

console.log('\n-- corroboration needs evidence the claim does not already rest on --')
{
  const { claims } = fresh()
  const first = claims.create(base({ evidenceRefs: ['event:1'] })).claim
  ok('it starts as a candidate', first.status === 'candidate')

  // The failure this exists to stop: a producer that runs every second citing
  // the same observation until one sighting looks like a hundred.
  const sameRef = claims.corroborate({
    subject: 'room:142',
    predicate: 'exit_divergence',
    value: base().value,
    evidenceRefs: ['event:1'],
    now: LATER,
  })
  ok('the same ref corroborates nothing', sameRef.ok === false, sameRef.ok ? 'accepted' : sameRef.reason)
  ok('and the refusal says so', (sameRef.reason ?? '').includes('already rests on that evidence'), sameRef.reason ?? '')
  ok('the claim did not move', claims.get(first.claimId).status === 'candidate')
  ok('and gained no evidence', claims.get(first.claimId).evidenceRefs.length === 1)

  const second = claims.corroborate({
    subject: 'room:142',
    predicate: 'exit_divergence',
    value: base().value,
    evidenceRefs: ['event:2'],
    now: LATER,
  })
  ok('an independent ref corroborates', second.ok === true, second.ok ? '' : second.reason)
  ok('the claim is now corroborated', claims.get(first.claimId).status === 'corroborated')
  ok('and cites both', claims.get(first.claimId).evidenceRefs.join(',') === 'event:1,event:2',
    claims.get(first.claimId).evidenceRefs.join(','))
  ok('no second record was made', claims.all().length === 1, String(claims.all().length))

  const unresolvable = claims.corroborate({
    subject: 'room:142',
    predicate: 'exit_divergence',
    value: base().value,
    evidenceRefs: ['event:9999'],
    now: LATER,
  })
  ok('evidence that does not resolve cannot corroborate', unresolvable.ok === false, unresolvable.ok ? '' : unresolvable.reason)

  const other = claims.corroborate({
    subject: 'room:142',
    predicate: 'exit_divergence',
    value: { diff: 'something else entirely' },
    evidenceRefs: ['event:3'],
    now: LATER,
  })
  ok('a different value is a different assertion', other.ok === false, other.ok ? 'matched anyway' : other.reason)

  claims.transition(first.claimId, 'rejected', { now: LATER, reviewer: 'Dan' })
  const afterRejection = claims.corroborate({
    subject: 'room:142',
    predicate: 'exit_divergence',
    value: base().value,
    evidenceRefs: ['event:3'],
    now: LATER,
  })
  ok('a rejected claim cannot be corroborated back to life', afterRejection.ok === false,
    afterRejection.ok ? 'revived' : afterRejection.reason)
  ok('and it is still rejected', claims.get(first.claimId).status === 'rejected')
}


console.log('\n-- promotion is the one path out, and reverting it is exact --')
{
  // A pin list with a hand-made pin either side of the promoted one. The
  // failure this section exists to catch is a revert that removes the wrong
  // record, so the population has to contain records that could be removed by
  // mistake - a single-pin fixture would pass whatever the revert did.
  const pins = [
    { id: 'pin-a', roomId: 1, label: 'Home', provenance: 'player' },
    { id: 'pin-b', roomId: 2, label: 'Bank', provenance: 'player' },
  ]
  const createPin = (claim) => {
    const id = `pin-ai-${claim.claimId.replace(':', '-')}`
    pins.push({ id, roomId: 142, label: claim.predicate, provenance: 'ai-candidate' })
    return id
  }
  const deletePin = (pinId) => {
    const before = pins.length
    const at = pins.findIndex((pin) => pin.id === pinId)
    if (at >= 0) pins.splice(at, 1)
    return pins.length === before - 1
  }

  const { claims } = fresh()
  const claim = claims.create(base()).claim

  const tooEarly = claims.promote(claim.claimId, { now: LATER, createPin })
  ok('a candidate cannot be promoted', tooEarly.ok === false, tooEarly.ok ? 'promoted' : tooEarly.reason)
  ok('and nothing was created', pins.length === 2, String(pins.length))

  claims.transition(claim.claimId, 'accepted-local', { now: LATER, reviewer: 'Dan' })
  const before = JSON.stringify(pins)

  const promoted = claims.promote(claim.claimId, { now: LATER, createPin })
  ok('an accepted claim promotes', promoted.ok === true, promoted.ok ? '' : promoted.reason)
  ok('exactly one pin was added', pins.length === 3, String(pins.length))
  ok('marked as an AI candidate', pins[2].provenance === 'ai-candidate', pins[2].provenance)
  ok('and the claim records which pin', promoted.claim.promotedPinId === pins[2].id, String(promoted.claim.promotedPinId))

  const twice = claims.promote(claim.claimId, { now: LATER, createPin })
  ok('it cannot be promoted twice', twice.ok === false, twice.ok ? 'promoted again' : twice.reason)
  ok('and no second pin appeared', pins.length === 3, String(pins.length))

  const reverted = claims.revertPromotion(claim.claimId, { now: LATER, deletePin })
  ok('reverting works', reverted.ok === true, reverted.ok ? '' : reverted.reason)
  ok('the count is restored', pins.length === 2, String(pins.length))
  ok('the other pins are byte-identical', JSON.stringify(pins) === before, JSON.stringify(pins))
  ok('the claim is accepted again, not back to candidate', claims.get(claim.claimId).status === 'accepted-local')
  ok('and no longer names a pin', claims.get(claim.claimId).promotedPinId === null)

  const again = claims.revertPromotion(claim.claimId, { now: LATER, deletePin })
  ok('reverting twice is refused', again.ok === false, again.ok ? 'reverted again' : again.reason)

  // A promotion whose pin could not be made is a refusal, not a claim that
  // silently believes it has one.
  const second = claims.create(base({ value: { diff: 'other' } })).claim
  claims.transition(second.claimId, 'accepted-local', { now: LATER, reviewer: 'Dan' })
  const refused = claims.promote(second.claimId, { now: LATER, createPin: () => null })
  ok('a createPin that refuses leaves the claim unpromoted', refused.ok === false, refused.ok ? 'promoted' : refused.reason)
  ok('and the claim names no pin', claims.get(second.claimId).promotedPinId === undefined || claims.get(second.claimId).promotedPinId === null)

  // And a deletePin that removed nothing must not clear the link, or the
  // record would claim a revert that put nothing back.
  const third = claims.create(base({ value: { diff: 'third' } })).claim
  claims.transition(third.claimId, 'accepted-local', { now: LATER, reviewer: 'Dan' })
  claims.promote(third.claimId, { now: LATER, createPin })
  const failedRevert = claims.revertPromotion(third.claimId, { now: LATER, deletePin: () => false })
  ok('a delete that removed nothing is a refusal', failedRevert.ok === false, failedRevert.ok ? 'reverted' : failedRevert.reason)
  ok('and the record still points at the pin', claims.get(third.claimId).promotedPinId !== null)
}


console.log('')
const total = pass + fail
const MIN_EXPECTED = 92
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${pass} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
