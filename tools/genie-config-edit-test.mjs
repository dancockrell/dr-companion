/**
 * Line-level patching for Genie config files: format, replace, remove,
 * append - the property under test throughout is "everything not touched
 * stays byte-identical", since that's the entire reason this module exists
 * rather than regenerating a file from the parsed model. See
 * src/lib/genieConfigEdit.ts's own header.
 *
 *   node tools/genie-config-edit-test.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import {
  formatHighlightLine,
  formatAliasLine,
  hasUnsafeBraces,
  replaceLine,
  removeLine,
  appendUnderPlayerSection,
  isPlayerAddedLine,
  detectEol,
  PLAYER_SECTION_MARKER,
} from '../src/lib/genieConfigEdit.ts'
import { parseHighlights } from '../src/lib/highlights.ts'
import { parseAliases } from '../src/lib/aliases.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(64)}${detail}`)
}

console.log('-- formatting round-trips through the real parser --')
{
  const withSound = formatHighlightLine({
    type: 'line',
    colour: '#FF0000',
    pattern: 'HAS FLAGGED YOU AS IDLE',
    cls: 'alert',
    sound: 'Thunder.wav',
  })
  ok('sound line looks right', withSound === '#highlight {line} {#FF0000} {HAS FLAGGED YOU AS IDLE} {alert} {Thunder.wav}', withSound)
  const { entries: p1 } = parseHighlights(withSound)
  ok('and the parser reads it back the same', p1.length === 1 && p1[0].sound === 'Thunder.wav' && p1[0].cls === 'alert', JSON.stringify(p1[0]))

  const noSound = formatHighlightLine({ type: 'beginswith', colour: '#5C7A99', pattern: 'You also see' })
  ok('no class, no sound: three groups only', noSound === '#highlight {beginswith} {#5C7A99} {You also see}', noSound)
  const { entries: p2 } = parseHighlights(noSound)
  ok('round-trips with cls/sound both undefined', p2[0].cls === undefined && p2[0].sound === undefined)

  const clsNoSound = formatHighlightLine({ type: 'regexp', colour: '#CC9955', pattern: ' off\\.$', cls: 'danger' })
  ok('class with no sound: four groups', clsNoSound === '#highlight {regexp} {#CC9955} { off\\.$} {danger}', clsNoSound)

  const alias = formatAliasLine({ name: 'appc', expansion: 'appraise $0 careful' })
  ok('alias format matches Genie syntax exactly', alias === '#alias {appc} {appraise $0 careful}', alias)
  const { entries: pa } = parseAliases(alias)
  ok('and parses back to the same fields', pa[0]?.name === 'appc' && pa[0]?.expansion === 'appraise $0 careful')
}

console.log('\n-- a value with braces is refused before it can corrupt the file --')
{
  ok('a bare value is safe', !hasUnsafeBraces('appraise $0 careful'))
  ok('an opening brace is unsafe', hasUnsafeBraces('some {thing'))
  ok('a closing brace is unsafe', hasUnsafeBraces('some }thing'))
}

console.log('\n-- replaceLine touches only its own line --')
{
  const fixture = [
    '# a comment above',
    '#highlight {line} {#FF0000} {old pattern} {alert} {Old.wav}',
    '# a comment below',
    '',
  ].join('\n')

  const { entries } = parseHighlights(fixture)
  ok('fixture parses to one entry', entries.length === 1, `${entries.length}`)

  const edited = replaceLine(
    fixture,
    entries[0].sourceLine,
    formatHighlightLine({ type: 'line', colour: '#00FF00', pattern: 'new pattern', cls: 'alert', sound: 'New.wav' })
  )
  const editedLines = edited.split('\n')
  const fixtureLines = fixture.split('\n')
  ok('line count is unchanged', editedLines.length === fixtureLines.length, `${editedLines.length} vs ${fixtureLines.length}`)
  ok('the comment above survives untouched', editedLines[0] === fixtureLines[0])
  ok('the comment below survives untouched', editedLines[2] === fixtureLines[2])
  ok('only the target line changed', editedLines[1] !== fixtureLines[1] && editedLines[1].includes('New.wav'))

  const { entries: reparsed } = parseHighlights(edited)
  ok('re-parses to the new content', reparsed.length === 1 && reparsed[0].sound === 'New.wav' && reparsed[0].colour === '#00FF00')
}

console.log('\n-- removeLine drops exactly one line, nothing else --')
{
  const fixture = ['line0', '#highlight {line} {#FF0000} {x} {alert}', 'line2', 'line3'].join('\n')
  const { entries } = parseHighlights(fixture)
  const removed = removeLine(fixture, entries[0].sourceLine)
  ok('one fewer line', removed.split('\n').length === 3, `${removed.split('\n').length}`)
  ok('surrounding lines survive in order', removed === 'line0\nline2\nline3', JSON.stringify(removed))
}

console.log('\n-- appendUnderPlayerSection creates the section once, then just appends --')
{
  const original = '# curated file\n#highlight {line} {#FF0000} {x} {alert}\n'
  const withOne = appendUnderPlayerSection(original, formatHighlightLine({ type: 'line', colour: '#00FF00', pattern: 'mine', cls: 'people' }))
  ok('original content is a prefix of the result', withOne.startsWith(original), withOne)
  ok('the marker appears exactly once', withOne.split(PLAYER_SECTION_MARKER).length - 1 === 1)
  ok('the new line is present', withOne.includes('{mine}'))

  const withTwo = appendUnderPlayerSection(withOne, formatHighlightLine({ type: 'line', colour: '#0000FF', pattern: 'mine too', cls: 'people' }))
  ok('a second add does not duplicate the marker', withTwo.split(PLAYER_SECTION_MARKER).length - 1 === 1, `${withTwo.split(PLAYER_SECTION_MARKER).length - 1}`)
  ok('both additions are present', withTwo.includes('{mine}') && withTwo.includes('{mine too}'))

  const { entries } = parseHighlights(withTwo)
  ok('the curated entry and both additions all parse', entries.length === 3, `${entries.length}`)

  const marker0 = withOne.split('\n').findIndex((l) => l.trim() === PLAYER_SECTION_MARKER)
  ok('isPlayerAddedLine is false above the marker', !isPlayerAddedLine(withOne, 0))
  ok('isPlayerAddedLine is true for a line under it', isPlayerAddedLine(withOne, marker0 + 1))
}

console.log('\n-- CRLF files stay CRLF; LF files stay LF --')
{
  const crlf = '#highlight {line} {#FF0000} {x} {alert}\r\n# a comment\r\n'
  ok('CRLF is detected', detectEol(crlf) === '\r\n')
  const { entries } = parseHighlights(crlf)
  const edited = replaceLine(crlf, entries[0].sourceLine, '#highlight {line} {#00FF00} {y} {alert}')
  ok('the edit did not flip the file to LF', edited.includes('\r\n') && !edited.replace(/\r\n/g, '').includes('\n'), JSON.stringify(edited))

  const lf = '#highlight {line} {#FF0000} {x} {alert}\n# a comment\n'
  ok('LF stays LF after an edit', !replaceLine(lf, 0, '#highlight {line} {#00FF00} {y} {alert}').includes('\r\n'))
}

console.log('\n-- against the real curated file, an edit changes only its own line --')
{
  const CFG = 'C:/Genie4/Config/highlights.cfg'
  if (!existsSync(CFG)) {
    console.log('SKIP the real corpus round-trips cleanly'.padEnd(68) + `not at ${CFG}`)
  } else {
    const text = readFileSync(CFG, 'utf8')
    const { entries, skipped } = parseHighlights(text)
    ok('the real file still parses with nothing skipped', skipped.length === 0, skipped.slice(0, 2).join('; '))

    // Edit the first entry that carries a sound - touches a real, meaningful
    // line, not an arbitrary one.
    const target = entries.find((e) => e.sound)
    ok('there is at least one sound-bearing entry to test against', !!target)
    if (target) {
      const before = text.split(/\r\n|\n/)
      const newLine = formatHighlightLine({ ...target, pattern: `${target.pattern} (test edit)` })
      const after = replaceLine(text, target.sourceLine, newLine).split(/\r\n|\n/)

      ok('total line count is unchanged', after.length === before.length, `${after.length} vs ${before.length}`)
      let diffCount = 0
      for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) diffCount++
      ok('exactly one line differs', diffCount === 1, `${diffCount} lines differ`)
      ok('the changed line is the target line', before[target.sourceLine] !== after[target.sourceLine])
    }
  }
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
