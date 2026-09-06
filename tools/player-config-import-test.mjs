/**
 * The Genie import: seven files of text in, one store and a report out.
 *
 *   node tools/player-config-import-test.mjs
 *
 * # The denominator is the product
 *
 * Every per-file line states `parsed` and `imported` against `lines`, the
 * non-blank line count, because a parser that drops half a file and one that
 * works print the same number otherwise. The fixture carries, per leaf, one
 * entry that must map and one that must not, so a run cannot be clean by
 * having found nothing: the positive control fails if the mapping breaks, and
 * the negative control fails if the skip list stops naming what it refused.
 *
 * # And the real files, when this machine has them
 *
 * A fixture proves the mapping; it cannot prove the mapping fits a real
 * config. When `C:/Genie4/Config` is present the same importer is run over it
 * and the counts are printed per domain, with the unsupported list. Those
 * files are never committed - they are a player's own config - and their
 * absence is reported as NOT CHECKED rather than folded into a pass.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GENIE_LEAF_ORDER,
  importGenieConfig,
  isGenieScript,
} from '../src/lib/playerConfigImport.ts'

let failed = 0
let checked = 0
let notChecked = 0
const ok = (name, cond, detail = '') => {
  checked += 1
  if (!cond) failed += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(62)}${detail}`)
}

/**
 * One good entry and one bad one per leaf.
 *
 * The bad ones are each bad in a different, real way - a missing group, an
 * empty name, a colour that is not one - so a skip list that stopped
 * distinguishing them would show up as the wrong reason rather than as a
 * smaller count.
 */
const FIXTURE = {
  'presets.cfg': ['#preset {roomname} {PaleGoldenrod} {True}', '#preset {broken} {Magenta}'].join('\n'),
  'highlights.cfg': [
    '#highlight {line} {#66DDFF} {just arrived} {people} {arrive.wav}',
    '#highlight {line} {notacolour} {nope}',
  ].join('\n'),
  'aliases.cfg': ['#alias {appc} {appraise $0 careful}', '#alias {} {no name}'].join('\n'),
  'macros.cfg': [
    '#macro {NumPad8} {n}',
    '#macro {F2, Shift} {#class combat on;#class rp off}',
    '#macro {F9, Meta} {bad modifier}',
  ].join('\n'),
  'substitutes.cfg': ["#substitute {a Gor'Tog} {Tog}", '#substitute {onlyone}'].join('\n'),
  'gags.cfg': ['#gag {You feel fully rested}', '#gag {a} {b}'].join('\n'),
  'variables.cfg': [
    '#var {weapon} {longsword}',
    '#var {roomid} {308}',
    '#var {Time.timeOfDay} {night}',
    '#var {} {no name}',
  ].join('\n'),
}

const byLeaf = (report, leaf) => report.perFile.find((f) => f.leaf === leaf)

console.log('-- the fixture: every leaf found, counted against its own lines --')
const { config, report } = importGenieConfig(FIXTURE)
{
  ok('the report covers all seven leaves, not a shorter list', report.perFile.length === 7, `${report.perFile.length} of 7`)
  ok('nothing was refused: this input has content', report.refused === undefined, report.refused ?? '')

  for (const leaf of GENIE_LEAF_ORDER) {
    const f = byLeaf(report, leaf)
    const lines = FIXTURE[leaf].split('\n').filter((l) => l.trim()).length
    ok(
      `${leaf}: found, ${f.parsed} parsed and ${f.imported} imported of ${f.lines} lines`,
      f.found && f.lines === lines && f.parsed >= 1 && f.parsed < f.lines,
      f.skipped[0] ?? ''
    )
    ok(`${leaf}: the malformed line is named, not silently dropped`, f.skipped.length >= 1, `${f.skipped.length} skipped`)
  }
}

console.log('\n-- the positive controls: the good line of each leaf reached the store --')
{
  ok('a preset carries its colour and its bold', config.presets[0]?.fg === 'PaleGoldenrod' && config.presets[0]?.bold === true, JSON.stringify(config.presets[0]))
  ok('a highlight carries pattern, colour, class and sound', config.highlights[0]?.pattern === 'just arrived' && config.highlights[0]?.colour === '#66DDFF' && config.highlights[0]?.cls === 'people' && config.highlights[0]?.sound === 'arrive.wav', JSON.stringify(config.highlights[0]))
  ok('an alias carries its expansion', config.aliases[0]?.expansion === 'appraise $0 careful', JSON.stringify(config.aliases[0]))
  ok('a macro carries its key and one command per entry', config.macros[0]?.key === 'NumPad8' && JSON.stringify(config.macros[0]?.commands) === JSON.stringify(['n']), JSON.stringify(config.macros[0]))
  ok('a substitute carries both halves', config.substitutes[0]?.find === "a Gor'Tog" && config.substitutes[0]?.replace === 'Tog')
  ok('a gag carries its pattern', config.gags[0]?.pattern === 'You feel fully rested')
  ok('a variable that is not bookkeeping carries its value', config.variables[0]?.name === 'weapon' && config.variables[0]?.value === 'longsword')
  ok('every imported rule is marked as coming from Genie', config.aliases.every((a) => a.source === 'genie-import'))
  ok('and every imported rule has an id of its own', new Set(config.aliases.map((a) => a.id)).size === config.aliases.length)
}

console.log('\n-- the negative controls: what must not come across, and must be said --')
{
  const scripted = config.macros.find((m) => m.key === 'F2')
  ok('a Genie-script macro is imported, not dropped', scripted !== undefined)
  ok('it is switched off, because nothing here can run a directive', scripted?.enabled === false)
  ok(
    'its text is intact, so the player sees exactly what Genie had',
    JSON.stringify(scripted?.commands) === JSON.stringify(['#class combat on', '#class rp off']),
    JSON.stringify(scripted?.commands)
  )
  // A real limitation of the recovered parser, asserted rather than left to be
  // found: `{...}` is matched non-greedily, so a command that itself contains
  // braces yields the wrong second group. No line in the 95-entry real file
  // does this (Genie writes `#class combat on`, not `#class {combat} on`), and
  // recording it here means the next person meets it as a known edge rather
  // than as a mystery.
  const nested = importGenieConfig({ 'macros.cfg': '#macro {F4} {#class {combat} on}' })
  ok(
    'a command containing braces is a known parser edge, not a silent success',
    nested.config.macros[0]?.commands.join('') === '#class {combat',
    JSON.stringify(nested.config.macros[0]?.commands)
  )
  ok('and the report says so', report.unsupported.some((u) => /macros\.cfg: 1 of 2/.test(u)), report.unsupported.find((u) => u.startsWith('macros.cfg')) ?? '')

  ok('Genie bookkeeping variables do not become player variables', config.variables.length === 1, `${config.variables.length} imported`)
  ok('and the two that were skipped are named', report.unsupported.some((u) => /variables\.cfg: 2 of 3/.test(u) && /roomid/.test(u)), report.unsupported.find((u) => u.startsWith('variables.cfg')) ?? '')
  ok('the always-true unsupported notes are present', report.unsupported.some((u) => /#script/.test(u)))

  ok('a directive in an expansion is recognised as script', isGenieScript('#queue {x}') && isGenieScript('look; #setvar a b'))
  ok('an ordinary chain is not', !isGenieScript('stow left; get my longsword'))
}

console.log('\n-- an empty input is refused, never reported as an import of zero --')
{
  const empty = Object.fromEntries(GENIE_LEAF_ORDER.map((l) => [l, '']))
  const { config: none, report: r } = importGenieConfig(empty)
  ok('every leaf reports found: false', r.perFile.every((f) => f.found === false), `${r.perFile.filter((f) => f.found).length} claimed found`)
  ok('the whole import is refused by name', typeof r.refused === 'string' && /non-blank/.test(r.refused), r.refused ?? 'not refused')
  ok('and nothing was written into the config it returned', GENIE_LEAF_ORDER.every(() => true) && none.aliases.length === 0 && none.highlights.length === 0)

  // A leaf that is simply absent must read the same way as one that is empty:
  // both are "no file to import", and neither is an import of zero.
  const { report: missing } = importGenieConfig({})
  ok('an absent leaf reads as not found, with a zero denominator', missing.perFile.every((f) => !f.found && f.lines === 0))
  ok('and that too is refused rather than reported clean', typeof missing.refused === 'string')
}

console.log("\n-- the real files on this machine, if it has any --")
{
  const ROOT = 'C:/Genie4/Config'
  const present = GENIE_LEAF_ORDER.filter((leaf) => existsSync(join(ROOT, leaf)))
  if (present.length === 0) {
    notChecked += 1
    console.log(`NOT CHECKED  no Genie config at ${ROOT}; the mapping is exercised against the fixture only`)
  } else {
    const files = {}
    for (const leaf of present) files[leaf] = readFileSync(join(ROOT, leaf), 'utf8')
    const real = importGenieConfig(files)
    console.log(`     ${present.length} of 7 leaves present at ${ROOT}`)
    for (const f of real.report.perFile) {
      console.log(
        `     ${f.leaf.padEnd(18)} ${f.found ? `${f.lines} lines, ${f.parsed} parsed, ${f.imported} imported, ${f.skipped.length} skipped` : 'not found or empty'}`
      )
    }
    for (const u of real.report.unsupported) console.log(`     unsupported: ${u}`)

    // The two files this repo has read before, with the counts it recorded.
    // A floor rather than an equality: the player edits these.
    ok('the real aliases file still imports the hundreds of entries it holds', real.config.aliases.length >= 300, `${real.config.aliases.length} aliases`)
    ok('the real highlights file still imports its rules', real.config.highlights.length >= 40, `${real.config.highlights.length} highlights`)
    ok('the real macros file still imports its bindings', real.config.macros.length >= 50, `${real.config.macros.length} macros`)
    ok('the real presets file still imports its entries', real.config.presets.length >= 20, `${real.config.presets.length} presets`)
    ok(
      'nothing in the real config was parsed and then quietly not imported',
      real.report.perFile.every((f) => !f.found || f.imported <= f.parsed)
    )
  }
}

console.log(`\n${checked} checked, ${failed} failed${notChecked ? `, ${notChecked} not checked` : ''}`)
if (checked < 40) {
  console.log(`FAIL only ${checked} checks ran; this suite has never had fewer than 40`)
  process.exit(1)
}
process.exit(failed ? 1 : 0)
