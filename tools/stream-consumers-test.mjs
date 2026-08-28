/**
 * The consuming side of StreamCharacterState - vitals and status.
 *
 * tools/stream-state-test.mjs already covers the parsing side, thoroughly.
 * Nothing read the result: `grep -rl StreamCharacterState src/` found the
 * producer (gameStream.ts) and the type (types/stream.ts) and no consumer at
 * all. This tests the two places that now read it, src/lib/vitals.ts and
 * src/lib/situation.ts, both split out of their component files so this can
 * import them without a JSX loader.
 *
 * The precedence under test - stream wins when it has an answer, bridge is
 * the fallback - is a stated design choice (see the doc comments on both
 * functions), not an accident, so the property to assert is "stream overrides
 * when present, bridge survives when absent", checked from both directions.
 */
import { vitalsFor } from '../src/lib/vitals.ts'
import { situationFor } from '../src/lib/situation.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(58)}${detail}`)
}

const CHAR = (over = {}) => ({
  guild: 'warrior',
  vitals: { health: 80, healthMax: 100, mana: 0, manaMax: 100, fatigue: 90, fatigueMax: 100, spirit: 100, spiritMax: 100 },
  ...over,
})

console.log('-- vitalsFor: stream wins when present --')
{
  const stream = {
    health: { current: 55, max: 100 },
    stamina: { current: 20, max: 100 },
  }
  const vitals = vitalsFor(CHAR(), stream)
  const health = vitals.find((v) => v.key === 'health')
  const stamina = vitals.find((v) => v.key === 'stamina')
  const spirit = vitals.find((v) => v.key === 'spirit')

  ok('health comes from the stream, not the bridge', health.value === 55, `${health.value}`)
  ok('stamina comes from the stream too', stamina.value === 20, `${stamina.value}`)
  ok('spirit falls back to the bridge - the stream never reported it', spirit.value === 100, `${spirit.value}`)
}

console.log('\n-- vitalsFor: bridge survives when the stream has nothing --')
{
  const vitals = vitalsFor(CHAR(), undefined)
  const health = vitals.find((v) => v.key === 'health')
  ok('no stream argument at all still reads the bridge', health.value === 80, `${health.value}`)

  const vitalsEmpty = vitalsFor(CHAR(), {})
  ok('an empty stream object reads the bridge too', vitalsEmpty.find((v) => v.key === 'health').value === 80)
}

console.log('\n-- vitalsFor: concentration is always bridge-only --')
{
  // StreamVitals has no concentration key at all - DragonRealms does not send
  // it as a progressBar - so there is nothing for the stream to override even
  // if a caller somehow had a value for it.
  const withConc = CHAR({
    vitals: { ...CHAR().vitals, concentration: 200, concentrationMax: 330 },
  })
  const vitals = vitalsFor(withConc, { health: { current: 1, max: 100 } })
  const conc = vitals.find((v) => v.key === 'concentration')
  ok('concentration reads the bridge even with a stream present', conc.value === 200, `${conc.value}`)
}

console.log('\n-- vitalsFor: mana still gates on guild, unaffected by the stream --')
{
  // A Barbarian with a stream-reported mana bar of 0 must not grow a mana row
  // - the same "permanent zero is not a pool" rule the bridge path already has.
  const barbarian = CHAR({ guild: 'barbarian', vitals: { ...CHAR().vitals, mana: 0 } })
  const vitals = vitalsFor(barbarian, { mana: { current: 0, max: 100 } })
  ok('no mana row for a guild with none', !vitals.some((v) => v.key === 'mana'))
}

console.log('\n-- situationFor: stream corrects a flag the bridge missed --')
{
  const flags = situationFor([], { bleeding: 'on' })
  ok('an on indicator adds a flag the bridge never sent', flags.has('bleeding'))
}

console.log('\n-- situationFor: stream clears a flag the bridge is stale about --')
{
  const flags = situationFor(['prone'], { prone: 'off' })
  ok('an off indicator removes a stale bridge flag', !flags.has('prone'))
}

console.log('\n-- situationFor: unknown leaves the bridge standing --')
{
  const onlyBridge = situationFor(['poisoned'], { poisoned: 'unknown' })
  ok('unknown does not clear a flag the bridge reported', onlyBridge.has('poisoned'))

  const onlyStream = situationFor([], { poisoned: 'unknown' })
  ok('and does not add one the bridge never reported either', !onlyStream.has('poisoned'))
}

console.log('\n-- situationFor: flags with no matching indicator stay bridge-only --')
{
  // in_combat has no single icon behind it - nothing in `indicators` can ever
  // key on it, so it must never be silently dropped by the merge.
  const flags = situationFor(['in_combat'], { bleeding: 'on' })
  ok('an unrelated indicator does not touch a flag it has no key for', flags.has('in_combat'))
}

console.log('\n-- sabotage: breaking one function reddens only its own tests --')
{
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')

  const dir = mkdtempSync(join(tmpdir(), 'stream-consumers-sabotage-'))

  // Break vitalsFor: stream is never consulted, however present it is.
  {
    const src = readFileSync('src/lib/vitals.ts', 'utf8')
    const mutated = src.replace(
      "const s = streamVitals?.[key]",
      "const s = undefined"
    )
    if (mutated === src) throw new Error('sabotage "ignore-stream" did not change the source')
    const p = join(dir, 'vitals-mutant.ts')
    writeFileSync(p, mutated)
    const m = await import(pathToFileURL(p).href)
    const vitals = m.vitalsFor(CHAR(), { health: { current: 1, max: 100 } })
    ok(
      'sabotage lands: the stream health reading is ignored',
      vitals.find((v) => v.key === 'health').value !== 1,
      `${vitals.find((v) => v.key === 'health').value}`
    )
    // The bridge-only path (no stream arg) must still work - this mutation
    // only touches the stream branch.
    ok(
      'sabotage is scoped: the no-stream case is unaffected',
      m.vitalsFor(CHAR(), undefined).find((v) => v.key === 'health').value === 80
    )
  }

  // Break situationFor: 'off' no longer clears a flag.
  {
    const src = readFileSync('src/lib/situation.ts', 'utf8')
    const mutated = src.replace(
      "else if (state === 'off') flags.delete(key)",
      "else if (false) flags.delete(key)"
    )
    if (mutated === src) throw new Error('sabotage "no-clear" did not change the source')
    const p = join(dir, 'situation-mutant.ts')
    writeFileSync(p, mutated)
    const m = await import(pathToFileURL(p).href)
    ok(
      'sabotage lands: off no longer clears a stale flag',
      m.situationFor(['prone'], { prone: 'off' }).has('prone')
    )
    // Adding a flag must still work - this mutation only touches the 'off' arm.
    ok(
      'sabotage is scoped: on still adds a flag',
      m.situationFor([], { bleeding: 'on' }).has('bleeding')
    )
  }
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
