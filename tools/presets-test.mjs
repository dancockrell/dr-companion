/**
 * UI colour presets: the parser against a fixture and Dan's real 31-entry
 * corpus, then presetColours' foreground/background split. See presets.ts
 * for why this format is what it is.
 *
 *   node tools/presets-test.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { parsePresets, presetColours } from '../src/lib/presets.ts'
import { formatPresetLine } from '../src/lib/genieConfigEdit.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(56)}${detail}`)
}

console.log('-- the parser reads the format, and says what it could not --')
{
  const { entries, skipped } = parsePresets(`
# a comment, and a blank line

#preset {health} {Red, #400000} {False}
#preset {castbar} {Magenta} {True}
#preset {} {empty name} {False}
#preset {noboolean} {White} {Sorta}
#preset {tooMany} {a} {b} {c}
not a preset line at all
`)

  ok('the good ones parsed', entries.length === 2, `${entries.length} of 2`)
  ok('every bad one was reported', skipped.length === 3, `${skipped.length} skipped`)
  ok('an empty name is named', skipped.some((s) => s.includes('empty name')))
  ok('a non-boolean bold is named', skipped.some((s) => s.includes('"Sorta" is not True or False')))
  ok('a wrong group count is named', skipped.some((s) => s.includes('4 groups')))

  const castbar = entries.find((p) => p.name === 'castbar')
  ok('bold parses as a real boolean, not the string', castbar?.bold === true, JSON.stringify(castbar))
}

console.log('\n-- the real corpus, 31 presets Genie actually paints with --')
{
  const CFG = 'C:/Genie4/Config/presets.cfg'
  if (!existsSync(CFG)) {
    console.log('SKIP the shipped corpus loads'.padEnd(60) + `not at ${CFG}`)
  } else {
    const text = readFileSync(CFG, 'utf8')
    const { entries, skipped } = parsePresets(text)
    const nonBlank = text.split('\n').filter((l) => l.trim().length > 0).length

    ok('the shipped corpus loads', entries.length >= 28, `${entries.length} of ${nonBlank} non-blank lines`)
    ok('with nothing skipped', skipped.length === 0, skipped.slice(0, 2).join('; '))

    // Spot-checked against the file as read on 29 Aug 2026, not invented.
    const health = entries.find((p) => p.name === 'health')
    ok('a known two-colour entry parsed', health?.colours === 'Red, #400000', health?.colours ?? 'missing')
    const castbar = entries.find((p) => p.name === 'castbar')
    ok('a known one-colour entry parsed', castbar?.colours === 'Magenta', castbar?.colours ?? 'missing')
  }
}

console.log('\n-- presetColours splits foreground from an optional background --')
{
  const two = presetColours('Black, White')
  ok('two colours split cleanly', two.fg === 'Black' && two.bg === 'White', JSON.stringify(two))
  const one = presetColours('Magenta')
  ok('one colour has no background', one.fg === 'Magenta' && one.bg === null, JSON.stringify(one))
  const spaced = presetColours('Red,   #400000')
  ok('extra whitespace around the comma is trimmed', spaced.fg === 'Red' && spaced.bg === '#400000', JSON.stringify(spaced))
}

console.log('\n-- formatPresetLine round-trips through the real parser --')
{
  for (const p of [
    { name: 'health', colours: 'Red, #400000', bold: false },
    { name: 'castbar', colours: 'Magenta', bold: true },
  ]) {
    const line = formatPresetLine(p)
    const { entries } = parsePresets(line)
    ok(
      `round-trips: ${line}`,
      entries.length === 1 &&
        entries[0].name === p.name &&
        entries[0].colours === p.colours &&
        entries[0].bold === p.bold
    )
  }
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
