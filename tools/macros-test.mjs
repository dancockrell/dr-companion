/**
 * Keyboard macros: the parser against a fixture and against Dan's real
 * 95-line corpus, then the combo-identity helpers that make duplicate-key
 * detection possible, then formatMacroLine round-tripping through the
 * parser, then sabotage. Same shape as aliases-test.mjs; see macros.ts for
 * why this format is what it is.
 *
 *   node tools/macros-test.mjs
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseMacros, comboKey, normalizeModifiers } from '../src/lib/macros.ts'
import { formatMacroLine } from '../src/lib/genieConfigEdit.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(56)}${detail}`)
}

console.log('-- the parser reads the format, and says what it could not --')
{
  const { entries, skipped } = parseMacros(`
# a comment, and a blank line

#macro {F1} {look @}
#macro {F2, Shift} {analyze}
#macro {G, Shift, Control} {@#goto @}
#macro {} {empty key}
#macro {F3} {}
#macro {F4, Xyzzy} {bad modifier}
#macro {tooMany} {a} {b}
not a macro line at all
`)

  ok('the good ones parsed', entries.length === 3, `${entries.length} of 3`)
  ok('every bad one was reported', skipped.length === 4, `${skipped.length} skipped`)
  ok('an empty key is named', skipped.some((s) => s.includes('empty key')))
  ok('an empty command is named', skipped.some((s) => s.includes('empty command')))
  ok('an unknown modifier is named', skipped.some((s) => s.includes('unknown modifier "Xyzzy"')))
  ok('a wrong group count is named', skipped.some((s) => s.includes('3 groups')))

  const g = entries.find((m) => m.key === 'G')
  ok('modifier order is preserved as parsed', JSON.stringify(g?.modifiers) === '["Shift","Control"]', JSON.stringify(g?.modifiers))
}

console.log('\n-- the real corpus, 95 macros Dan actually presses --')
{
  const CFG = 'C:/Genie4/Config/macros.cfg'
  if (!existsSync(CFG)) {
    console.log('SKIP the shipped corpus loads'.padEnd(60) + `not at ${CFG}`)
  } else {
    const text = readFileSync(CFG, 'utf8')
    const { entries, skipped } = parseMacros(text)
    const nonBlank = text.split('\n').filter((l) => l.trim().length > 0).length

    ok('the shipped corpus loads', entries.length >= 90, `${entries.length} of ${nonBlank} non-blank lines`)
    ok('with nothing skipped', skipped.length === 0, skipped.slice(0, 2).join('; '))

    // Spot-checked against the file as read on 29 Aug 2026, not invented.
    const escape = entries.find((m) => m.key === 'Escape' && m.modifiers.length === 0)
    ok(
      'a known plain entry parsed with its real command',
      escape?.command === '#queue clear;#script abort all',
      escape?.command ?? 'missing'
    )
    const f2shift = entries.find((m) => m.key === 'F2' && m.modifiers.includes('Shift'))
    ok('a known modified entry parsed', f2shift?.command === 'analyze', f2shift?.command ?? 'missing')
    const triple = entries.find((m) => m.key === 'G' && m.modifiers.length === 2)
    ok(
      'a triple-field entry (key + 2 modifiers) parsed',
      triple?.modifiers.includes('Shift') && triple?.modifiers.includes('Control'),
      JSON.stringify(triple?.modifiers)
    )
  }
}

console.log('\n-- normalizeModifiers puts every combo in one canonical order --')
{
  ok('already-ordered stays put', JSON.stringify(normalizeModifiers(['Shift', 'Control'])) === '["Shift","Control"]')
  ok('reversed input still comes out canonical', JSON.stringify(normalizeModifiers(['Control', 'Shift'])) === '["Shift","Control"]')
  ok('all three in a random order', JSON.stringify(normalizeModifiers(['Alt', 'Shift', 'Control'])) === '["Shift","Control","Alt"]')
  ok('empty stays empty', JSON.stringify(normalizeModifiers([])) === '[]')
}

console.log('\n-- comboKey treats a combo as one identity regardless of typed order --')
{
  ok(
    'same physical combo, different typed order, same identity',
    comboKey('G', ['Shift', 'Control']) === comboKey('G', ['Control', 'Shift'])
  )
  ok('a different key is a different identity', comboKey('F1', []) !== comboKey('F2', []))
  ok('the same key with vs without a modifier is different', comboKey('F1', []) !== comboKey('F1', ['Shift']))
}

console.log('\n-- formatMacroLine round-trips through the real parser --')
{
  for (const m of [
    { key: 'F1', modifiers: [], command: 'look @' },
    { key: 'F2', modifiers: ['Shift'], command: 'analyze' },
    { key: 'G', modifiers: ['Shift', 'Control'], command: '@#goto @' },
  ]) {
    const line = formatMacroLine(m)
    const { entries } = parseMacros(line)
    ok(`round-trips: ${line}`, entries.length === 1 && entries[0].key === m.key && entries[0].command === m.command && JSON.stringify(entries[0].modifiers) === JSON.stringify(m.modifiers))
  }
}

console.log('\n-- sabotage: breaking one thing reddens only what depends on it --')
{
  const SRC = readFileSync('src/lib/macros.ts', 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'macros-sabotage-'))
  const tauriUrl = pathToFileURL(join(process.cwd(), 'src/lib/tauri.ts')).href

  async function loadMutant(label, transform) {
    const mutated = transform(SRC).replace("from './tauri.ts'", `from '${tauriUrl}'`)
    if (mutated === SRC) {
      throw new Error(`sabotage "${label}" did not change the source - the target text was not found`)
    }
    const p = join(dir, `${label}.ts`)
    writeFileSync(p, mutated)
    return import(pathToFileURL(p).href)
  }

  // Break modifier validation: accept anything as a modifier.
  {
    const mod = await loadMutant('no-modifier-check', (s) =>
      s.replace(
        'const badModifier = modifiers.find((m) => !MODIFIER_ORDER.includes(m))',
        'const badModifier = undefined'
      )
    )
    const { entries, skipped } = mod.parseMacros('#macro {F1, NotAModifier} {look @}')
    ok('sabotage lands: a bad modifier is no longer refused', entries.length === 1 && skipped.length === 0, `${entries.length} entries, ${skipped.length} skipped`)
    // comboKey/normalizeModifiers were not touched by this mutation.
    ok('sabotage is scoped: normalizeModifiers is unaffected', JSON.stringify(mod.normalizeModifiers(['Alt', 'Shift'])) === '["Shift","Alt"]')
  }

  // Break combo identity: stop normalizing order before comparing.
  {
    const mod = await loadMutant('no-normalize', (s) =>
      s.replace(
        'return `${key}+${normalizeModifiers(modifiers).join(\'+\')}`',
        'return `${key}+${modifiers.join(\'+\')}`'
      )
    )
    ok(
      'sabotage lands: reordered modifiers no longer compare equal',
      mod.comboKey('G', ['Shift', 'Control']) !== mod.comboKey('G', ['Control', 'Shift'])
    )
    // Parsing itself was not touched.
    const { entries } = mod.parseMacros('#macro {F1} {look @}')
    ok('sabotage is scoped: parsing is unaffected', entries.length === 1)
  }
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
