/**
 * Command aliases: the parser against Dan's real config, and the expander
 * against the properties it has to hold — not the mechanism, the property.
 * See src/lib/aliases.ts for why the format and the positional-argument
 * semantics are what they are.
 *
 *   node tools/aliases-test.mjs
 *
 * Three sections. The parser against a small fixture and then against the
 * real 356-line corpus (denominator asserted both times — a parser that
 * silently drops most of a file and one that works look identical if all you
 * print is "N loaded"). The expander against synthetic tables, one property
 * per block. Then sabotage: three single-line breaks to the source, each
 * checked against the *named* tests it should redden — if breaking one thing
 * reddens everything, the tests are entangled and are saying less than they
 * look like.
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseAliases, expandAlias } from '../src/lib/aliases.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(56)}${detail}`)
}

console.log('-- the parser reads the format, and says what it could not --')
{
  const { entries, skipped } = parseAliases(`
# a comment, and a blank line

#alias {appc} {appraise $0 careful}
#alias {anec} {accuse $1 necromancy}
#alias {} {empty name}
#alias {onearg} {}
#alias {tooMany} {a} {b} {c}
not an alias line at all
`)

  ok('the good ones parsed', entries.length === 2, `${entries.length} of 2`)
  ok('every bad one was reported', skipped.length === 3, `${skipped.length} skipped`)
  ok('an empty name is named', skipped.some((s) => s.includes('empty alias name')))
  ok('an empty expansion is named', skipped.some((s) => s.includes('empty expansion')))
  ok('a wrong group count is named', skipped.some((s) => s.includes('4 groups')))
}

console.log('\n-- the real corpus, 356 lines Dan actually types --')
{
  const CFG = 'C:/Genie4/Config/aliases.cfg'
  if (!existsSync(CFG)) {
    console.log('SKIP the shipped corpus loads'.padEnd(60) + `not at ${CFG}`)
  } else {
    const text = readFileSync(CFG, 'utf8')
    const { entries, skipped } = parseAliases(text)
    const nonBlank = text.split('\n').filter((l) => l.trim().length > 0).length

    // The fragile denominator: every assertion below is trivially true
    // against an empty entry list, which is what a broken parser produces.
    ok(
      'the shipped corpus loads',
      entries.length >= 300,
      `${entries.length} of ${nonBlank} non-blank lines`
    )
    ok('with nothing skipped', skipped.length === 0, skipped.slice(0, 2).join('; '))

    // Spot-checked against the file as read on 28 Aug 2026, not invented.
    const appc = entries.find((a) => a.name === 'appc')
    ok('a known entry parsed with its real expansion', appc?.expansion === 'appraise $0 careful', appc?.expansion ?? 'missing')
  }
}

console.log('\n-- an undefined word passes through unchanged --')
{
  const table = [{ name: 'appc', expansion: 'appraise $0 careful' }]
  const r = expandAlias('look my backpack', table)
  ok('the line is untouched', r.text === 'look my backpack', r.text)
  ok('expanded is false', r.expanded === false)
  ok('chain is empty', r.chain.length === 0, `${r.chain.length}`)
}

console.log('\n-- typing a defined alias sends the expansion --')
{
  const table = [
    { name: 'appc', expansion: 'appraise $0 careful' },
    { name: 'anec', expansion: 'accuse $1 necromancy' },
  ]

  const whole = expandAlias('appc my silver sword', table)
  ok('$0 is the whole remainder', whole.text === 'appraise my silver sword careful', whole.text)
  ok('expanded is true', whole.expanded === true)
  ok('the chain names the alias', whole.chain[0] === 'appc', whole.chain.join(','))

  const word = expandAlias('anec Bob Smith', table)
  ok('$1 is one word, not the remainder', word.text === 'accuse Bob necromancy', word.text)

  const noArgs = expandAlias('anec', table)
  ok('a missing positional substitutes empty', noArgs.text === 'accuse  necromancy', JSON.stringify(noArgs.text))

  ok('matching is case-insensitive on the name', expandAlias('APPC sword', table).text === 'appraise sword careful')
}

console.log('\n-- multi-command expansions and $variables pass through whole --')
{
  const table = [
    { name: 'askg', expansion: 'ask guard about $0;ask guard about $0' },
    { name: 'apc', expansion: 'appraise $0 $preposition $shop careful' },
  ]
  const chain = expandAlias('askg the murder', table)
  ok(
    'the ; is not split, the game handles it',
    chain.text === 'ask guard about the murder;ask guard about the murder',
    chain.text
  )

  const withVar = expandAlias('apc ring', table)
  ok(
    '$preposition/$shop are Genie variables, not args - left alone',
    withVar.text === 'appraise ring $preposition $shop careful',
    withVar.text
  )
}

console.log('\n-- a self-referential alias terminates and says why --')
{
  const cycle = [
    { name: 'a', expansion: 'b go' },
    { name: 'b', expansion: 'a go' },
  ]
  const r = expandAlias('a', cycle, 8)
  ok('it stops rather than looping forever', r.capped === true)
  ok('both names are in the reported chain', r.chain.includes('a') && r.chain.includes('b'), r.chain.join(','))

  // A long chain that never repeats should hit the depth cap on its own
  // number, not the cycle path - a different reason to stop, and the two
  // must not be confused with each other.
  const long = Array.from({ length: 12 }, (_, i) => ({
    name: `s${i}`,
    expansion: i < 11 ? `s${i + 1}` : 'finally done',
  }))
  const deep = expandAlias('s0', long, 8)
  ok('a long non-cyclic chain also caps rather than running away', deep.capped === true)
  ok('it stopped at the configured depth, not before', deep.chain.length === 8, `${deep.chain.length}`)

  const short = expandAlias('s0', long, 20)
  ok('given enough depth the same chain finishes cleanly', short.capped === false && short.text === 'finally done', JSON.stringify(short))
}

console.log('\n-- sabotage: breaking one thing reddens only what depends on it --')
{
  const SRC = readFileSync('src/lib/aliases.ts', 'utf8')
  const dir = mkdtempSync(join(tmpdir(), 'aliases-sabotage-'))
  // The mutant lives outside src/lib, so its relative import of tauri.ts
  // would not resolve - point it at the real file's absolute path instead of
  // also copying tauri.ts in, which would risk testing a stale copy of it.
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

  // Break positional substitution: $N always becomes empty, regardless of N.
  {
    const mod = await loadMutant('no-positionals', (s) =>
      s.replace(
        "return i === 0 ? rest : (args[i - 1] ?? '')",
        "return ''"
      )
    )
    const table = [{ name: 'appc', expansion: 'appraise $0 careful' }]
    const r = mod.expandAlias('appc my sword', table)
    ok('sabotage lands: $0 no longer substitutes', r.text !== 'appraise my sword careful', r.text)
    // The parser was not touched by this mutation, so it must still be sound.
    const { entries } = mod.parseAliases('#alias {x} {y}')
    ok('sabotage is scoped: parsing is unaffected', entries.length === 1, `${entries.length}`)
  }

  // Break cycle detection: never treat a repeat name as a cycle.
  {
    const mod = await loadMutant('no-cycle-check', (s) =>
      s.replace('if (chain.includes(matched)) {', 'if (false && chain.includes(matched)) {')
    )
    const cycle = [
      { name: 'a', expansion: 'b go' },
      { name: 'b', expansion: 'a go' },
    ]
    const r = mod.expandAlias('a', cycle, 8)
    // It still has to stop - maxDepth is a separate, untouched guard - but it
    // now runs the entire budget rather than catching the repeat early.
    ok('sabotage lands: the cycle is not caught early', r.chain.length === 8, `${r.chain.length}`)
    // Substitution itself was not touched.
    const table = [{ name: 'appc', expansion: 'appraise $0 careful' }]
    ok('sabotage is scoped: substitution is unaffected', mod.expandAlias('appc x', table).text === 'appraise x careful')
  }

  // Break "unknown word passes through" by removing the early return that
  // makes it true: with the guard gone, an unmatched word falls through to
  // `alias.expansion` on an undefined alias rather than passing the line
  // back untouched.
  {
    const mod = await loadMutant('always-matches', (s) =>
      s.replace(
        'if (!alias) return { text: line, matched: null }',
        'if (false) return { text: line, matched: null }'
      )
    )
    let threwOrWrong = false
    try {
      const r = mod.expandAlias('look my backpack', [])
      threwOrWrong = r.expanded !== false
    } catch {
      threwOrWrong = true
    }
    ok('sabotage lands: an undefined word no longer passes through cleanly', threwOrWrong)
  }
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
