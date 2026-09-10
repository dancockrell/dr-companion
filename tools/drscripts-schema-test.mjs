/**
 * dr-scripts settings schema: the derivation against synthetic fixtures,
 * then against the real installed `base.yaml` (skipped where that file does
 * not exist — see `aliases-test.mjs` for the same pattern against a real
 * config file), then the two properties the increment names explicitly:
 * a broken anchor must fail loudly with a line, and an empty derivation
 * must fail rather than produce an empty form. Last, a source sabotage of
 * the floor check itself, restored and hash-verified, per
 * `docs/PLAN_TO_1_0.md` §0.5.
 *
 *   node tools/drscripts-schema-test.mjs
 *
 * See src/lib/drScriptsSchema.ts for why merge keys and a Ruby-specific
 * scalar tag are the actual hard part here.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  deriveSchema,
  deriveSchemaFromYaml,
  parseOneFile,
} from '../src/lib/drScriptsSchema.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(64)}${detail}`)
}

console.log('-- basic derivation: types are inferred, not invented --')
{
  const text = `
hometown: Crossing
t2_startup_delay: 0
t2_burgle_every_block: false
t2_no_kill: []
training_list:
  - one
  - two
favor_town:
`
  const r = deriveSchemaFromYaml(text, 'fixture.yaml')
  ok('parses ok', r.ok === true)
  if (r.ok) {
    ok('found every top-level key', r.count === 6, `${r.count} of 6`)
    const byKey = Object.fromEntries(r.settings.map((s) => [s.key, s]))
    ok('string setting typed string', byKey.hometown?.type === 'string')
    ok('integer setting typed number', byKey.t2_startup_delay?.type === 'number')
    ok('boolean setting typed boolean', byKey.t2_burgle_every_block?.type === 'boolean')
    ok('empty list typed list, sample 0', byKey.t2_no_kill?.type === 'list' && byKey.t2_no_kill?.sampleSize === 0)
    ok('string list typed list, sample 2', byKey.training_list?.type === 'list' && byKey.training_list?.sampleSize === 2)
    ok('unset setting typed null', byKey.favor_town?.type === 'null')
    ok('every source attributed to the one file', Object.values(r.sources).every((f) => f === 'fixture.yaml'))
  }
}

console.log('\n-- the herb-entry shape: a list of records, fields unioned --')
{
  const text = `
herbs:
  - name: kelp
    size: small
    stackable: true
    room: 42
    price: 10
    quantity: 5
  - name: moss
    size: medium
    room: 43
    price: 8
`
  const r = deriveSchemaFromYaml(text, 'fixture.yaml')
  ok('parses ok', r.ok === true)
  if (r.ok) {
    const herbs = r.settings.find((s) => s.key === 'herbs')
    ok('herbs is a list-of-records', herbs?.type === 'list-of-records')
    ok('sampled both entries', herbs?.sampleSize === 2)
    const fieldNames = (herbs?.fields ?? []).map((f) => f.key).sort()
    ok(
      'fields are the union of both entries, not just the first',
      JSON.stringify(fieldNames) === JSON.stringify(['name', 'price', 'quantity', 'room', 'size', 'stackable']),
      fieldNames.join(',')
    )
    const price = herbs?.fields?.find((f) => f.key === 'price')
    ok('a shared field is typed from whichever entry has it', price?.type === 'number')
  }
}

console.log('\n-- merge keys: js-yaml\'s default schema does NOT resolve `<<`, YAML11_SCHEMA does --')
{
  const text = `
defaults: &d
  price: 10
  room: 5
herbs:
  - <<: *d
    name: kelp
  - <<: *d
    name: moss
    price: 12
`
  const r = deriveSchemaFromYaml(text, 'fixture.yaml')
  ok('parses ok', r.ok === true)
  if (r.ok) {
    const herbs = r.settings.find((s) => s.key === 'herbs')
    const kelp = herbs?.default?.[0]
    const moss = herbs?.default?.[1]
    ok('merged fields present on the first entry', kelp?.price === 10 && kelp?.room === 5 && kelp?.name === 'kelp')
    ok(
      'an entry\'s own key overrides the merged value, not the other way round',
      moss?.price === 12 && moss?.room === 5,
      JSON.stringify(moss)
    )
    const fieldNames = (herbs?.fields ?? []).map((f) => f.key).sort()
    ok(
      'the merged-in fields appear in the schema, not just the literal ones',
      JSON.stringify(fieldNames) === JSON.stringify(['name', 'price', 'room']),
      fieldNames.join(',')
    )
  }
}

console.log('\n-- a Ruby-specific scalar tag does not take the whole file down --')
{
  const text = `
pattern_hues_no_use_rooms:
  - 1900
  - !ruby/regexp '/^(?:First )?Provincial Bank,/'
`
  const r = deriveSchemaFromYaml(text, 'fixture.yaml')
  ok('parses ok despite the ruby tag', r.ok === true)
  if (r.ok) {
    const field = r.settings.find((s) => s.key === 'pattern_hues_no_use_rooms')
    ok('the setting is still in the schema', field?.type === 'list' && field?.sampleSize === 2)
    ok(
      'the ruby tag is kept as readable text, not the internal wrapper',
      field?.default?.[1] === '!ruby/regexp /^(?:First )?Provincial Bank,/',
      JSON.stringify(field?.default)
    )
  }
}

console.log('\n-- anchors do not cross files --')
{
  const fileA = { name: 'base.yaml', text: 'x: &shared\n  q: 1\n' }
  const fileB = { name: 'Kenstrom-setup.yaml', text: 'y: *shared\n' }

  const oneFile = parseOneFile(fileA)
  ok('file A parses fine alone (it defines its own anchor)', oneFile.ok === true)

  const layered = deriveSchema([fileA, fileB])
  ok('layering both files fails', layered.ok === false)
  if (!layered.ok) {
    ok('the failure names the file that used the alias, not the one that defined it', layered.file === 'Kenstrom-setup.yaml')
    ok('the failure is an undefined-alias error, not something else', /alias/i.test(layered.error), layered.error)
  }
}

console.log('\n-- later files win, per Yaml.files_for\'s own load order --')
{
  const base = { name: 'base.yaml', text: 'hometown: Crossing\nfavor_town: Crossing\n' }
  const setup = { name: 'Kenstrom-setup.yaml', text: 'hometown: "Wehnimer\'s Landing"\n' }
  const r = deriveSchema([base, setup])
  ok('parses ok', r.ok === true)
  if (r.ok) {
    const hometown = r.settings.find((s) => s.key === 'hometown')
    ok('the later file\'s value wins', hometown?.default === "Wehnimer's Landing")
    ok('the earlier-only setting survives', r.settings.some((s) => s.key === 'favor_town'))
    ok('sources say which file each effective value came from', r.sources.hometown === 'Kenstrom-setup.yaml' && r.sources.favor_town === 'base.yaml')
  }
}

console.log('\n-- sabotage: a broken anchor reports the line, not a schema missing a branch --')
{
  const text = `
a: 1
b:
  <<: *missing
  c: 2
`
  const r = deriveSchemaFromYaml(text, 'broken.yaml')
  ok('the derivation fails rather than silently dropping the branch', r.ok === false)
  if (!r.ok) {
    ok('the file is named', r.file === 'broken.yaml')
    ok('a line is reported', typeof r.line === 'number' && r.line > 0, String(r.line))
    ok('the reported line is the one with the bad alias', r.line === 4, String(r.line))
    ok('the error names the alias problem', /alias/i.test(r.error), r.error)
  }
}

console.log('\n-- the floor: parsing cleanly to nothing is a failure, not an empty form --')
{
  const empty = deriveSchemaFromYaml('', 'empty.yaml')
  ok('an empty file fails', empty.ok === false)

  const onlyComments = deriveSchemaFromYaml('# nothing but comments\n---\n', 'comments.yaml')
  ok('a file with no real settings fails', onlyComments.ok === false)

  const noFiles = deriveSchema([])
  ok('deriving from zero files fails', noFiles.ok === false)

  const notAMap = deriveSchemaFromYaml('- one\n- two\n', 'list.yaml')
  ok('a top-level list is not a settings file', notAMap.ok === false)
}

console.log('\n-- the real, installed base.yaml --')
{
  const CANDIDATES = [
    process.env.DRC_LICH_SCRIPTS_DIR ? `${process.env.DRC_LICH_SCRIPTS_DIR}/profiles/base.yaml` : null,
    'C:/Ruby4Lich5/Lich5/scripts/profiles/base.yaml',
  ].filter(Boolean)
  const path = CANDIDATES.find((p) => existsSync(p))

  if (!path) {
    console.log('SKIP the installed base.yaml derives a real schema'.padEnd(68) + `not found in ${CANDIDATES.join(', ')}`)
  } else {
    const text = readFileSync(path, 'utf8')
    const r = deriveSchemaFromYaml(text, 'base.yaml')
    ok('the installed base.yaml parses', r.ok === true, r.ok ? '' : `${r.error} (${r.line}:${r.column})`)
    if (r.ok) {
      // The fragile denominator: this is well over 600 on the copy read
      // 2026-09-10, and a broken derivation reads as a small number here,
      // not as this test failing to run at all.
      ok('found a realistic number of settings', r.count > 200, `${r.count} settings from ${path}`)
      console.log(`     (${r.count} settings derived from the real, installed ${path})`)
    }
  }
}

console.log('\n-- sabotage the floor check itself, then restore it (plan §0.5) --')
{
  const SRC = new URL('../src/lib/drScriptsSchema.ts', import.meta.url)
  const before = readFileSync(SRC, 'utf8')
  const beforeHash = createHash('md5').update(before).digest('hex')

  const needle = 'if (settings.length < MIN_SETTINGS) {'
  if (!before.includes(needle)) {
    ok('the floor check line was found to sabotage', false, 'source changed shape — update the needle')
  } else {
    const sabotaged = before.replace(needle, 'if (false) {')
    writeFileSync(SRC, sabotaged)
    try {
      // Fresh process, so the edited source is what actually loads —
      // re-importing the same URL in this process would hit the module cache.
      const { execFileSync } = await import('node:child_process')
      // An empty *string* never reaches the floor check at all — js-yaml
      // refuses "expected a document, but the input is empty" first, which
      // would make this sabotage look like it did nothing. An empty
      // *mapping* (`{}`) parses cleanly and only the floor check rejects it,
      // so it is the fixture that actually exercises the sabotaged line.
      let redOnEmptyMap = false
      try {
        execFileSync(
          process.execPath,
          ['--experimental-strip-types', '-e', `
            import('${SRC.href}').then((m) => {
              const r = m.deriveSchemaFromYaml('{}\\n', 'emptymap.yaml')
              process.exit(r.ok ? 1 : 0)
            })
          `],
          { stdio: 'pipe' }
        )
        redOnEmptyMap = false // exit 0: still correctly rejecting — sabotage did not land
      } catch {
        redOnEmptyMap = true // exit 1: the sabotaged build now calls an empty mapping "ok"
      }
      ok('sabotaging the floor check makes an empty mapping report "ok" (test went red)', redOnEmptyMap)
    } finally {
      writeFileSync(SRC, before)
      const afterHash = createHash('md5').update(readFileSync(SRC, 'utf8')).digest('hex')
      ok('source restored byte-for-byte', afterHash === beforeHash, `${beforeHash} vs ${afterHash}`)
    }
  }
}

console.log(`\n${failed === 0 ? 'all passed' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
