/**
 * offClasses.ts: the plain persist/toggle logic behind the class-mute
 * toggle - Genie's own `#class off`, given a real switch. The `useOffClasses`
 * hook itself is not exercised here (no React renderer in this plain-Node
 * suite, same as useHighlights/useAliases), only the module-level functions
 * it wraps, which is where the actual behaviour lives.
 *
 *   node tools/off-classes-test.mjs
 */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { offClasses, toggleClass } = await import('../src/lib/offClasses.ts')
const { paint } = await import('../src/lib/highlights.ts')

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(60)}${detail}`)
}

console.log('-- toggling flips membership, persists, and survives a fresh read --')
{
  ok('starts empty', offClasses().size === 0, `${offClasses().size}`)
  toggleClass('danger')
  ok('toggling on adds it', offClasses().has('danger'))
  toggleClass('danger')
  ok('toggling again removes it', !offClasses().has('danger'))

  toggleClass('speech')
  toggleClass('learning')
  ok('two different classes can be off at once', offClasses().has('speech') && offClasses().has('learning'))

  const raw = localStorage.getItem('drc.off-highlight-classes.v1')
  ok('persisted as JSON', JSON.parse(raw).sort().join(',') === 'learning,speech', raw)
}

console.log('\n-- a muted class actually changes what paint() does --')
{
  const entries = [
    { type: 'line', colour: '#FF0000', pattern: 'danger word', cls: 'danger', sourceLine: 0, sound: 'Growl.wav' },
    { type: 'line', colour: '#00FF00', pattern: 'safe word', sourceLine: 1 },
  ]

  const before = paint('danger word here', entries, offClasses())
  ok('an unmuted class still colours and sounds', before.lineColour === '#FF0000' && before.sounds.includes('Growl.wav'))

  toggleClass('danger')
  const after = paint('danger word here', entries, offClasses())
  ok('a muted class gives no colour', after.lineColour === undefined, JSON.stringify(after.lineColour))
  ok('a muted class gives no sound', after.sounds.length === 0, JSON.stringify(after.sounds))

  const unaffected = paint('safe word here', entries, offClasses())
  ok('a class-less entry is unaffected by any mute', unaffected.lineColour === '#00FF00')

  toggleClass('danger') // clean up for the next block
}

console.log('\n-- a fresh module load reads what was persisted --')
{
  // Re-import isn't meaningful here (Node module cache), so this checks the
  // property the persistence is actually for: what's in storage is what a
  // second reader (a new tab, a restart) would see.
  const raw = JSON.parse(localStorage.getItem('drc.off-highlight-classes.v1') ?? '[]')
  ok('storage reflects current state after the cleanup toggle above', !raw.includes('danger'), JSON.stringify(raw))
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
