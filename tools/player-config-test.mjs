/**
 * The player config store: the schema, the migration, the write path, and the
 * two runtime readers that now read it instead of reading Genie's files.
 *
 *   node tools/player-config-test.mjs
 *
 * # What it asserts, and why in this shape
 *
 * **Seven domains, counted.** Every round-trip below is trivially clean
 * against a domain list that has lost an entry, because the check would simply
 * not run for the missing one. So the domain count is asserted against a floor
 * of 7 and against the list the panel renders from, and a truncated list fails
 * loudly rather than reporting a smaller clean run.
 *
 * **Three states from the migration.** `absent` and `refused` both produce
 * zero entries, and folding them together would be the exact failure this
 * repo's rule 1 is about: "you have no rules" and "you have rules I could not
 * read" must never print the same answer.
 *
 * **The runtime, driven from the store.** `paint()` and `expandAlias()` are
 * observed through `currentHighlights()`/`currentAliases()` - the functions
 * the hooks themselves return - after writing rules into localStorage. A check
 * that called the resolver directly would prove the resolver works and say
 * nothing about whether the game pane reads it.
 *
 * **Sabotage, scoped.** Each mutation must redden the cases that name the
 * property it broke, and only those; a sabotage that reddens everything means
 * the cases are entangled and are saying less than they look like.
 */
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Minimal localStorage shim, the same shape tools/storage-test.mjs uses.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const cfg = await import('../src/lib/playerConfig.ts')
const { paint } = await import('../src/lib/highlights.ts')
const { expandAlias } = await import('../src/lib/aliases.ts')
const { currentHighlights } = await import('../src/lib/useHighlights.ts')
const { currentAliases } = await import('../src/lib/useAliases.ts')

let failed = 0
let checked = 0
/** Where the sabotage mutants live, removed before the summary. */
let SABOTAGE_DIR = null
const ok = (name, cond, detail = '') => {
  checked += 1
  if (!cond) failed += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(62)}${detail}`)
}

/** One well-formed entry per domain, so the round trip has real content to
 *  lose. Every field the schema declares is set, because a round trip that
 *  only carries `id` would pass against a store that dropped the rest. */
/** Key order is not content: the store rebuilds an entry field by field on
 *  read, so compare by value with the keys sorted rather than by the exact
 *  string, or the round trip fails on a difference nobody can lose. */
const canonical = (v) =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]))
      : val
  )

const SAMPLE = {
  presets: { name: 'roomname', fg: '#F5DEB3', bg: '#101010', bold: true },
  highlights: { type: 'line', pattern: 'just arrived', colour: '#66DDFF', cls: 'people', sound: 'arrive.wav' },
  aliases: { name: 'appc', expansion: 'appraise $0 careful' },
  macros: { key: 'NumPad8', modifiers: ['Shift', 'Control'], commands: ['n', 'look'] },
  substitutes: { find: "a Gor'Tog", replace: 'Tog' },
  gags: { pattern: 'You feel fully rested' },
  variables: { name: 'weapon', value: 'longsword' },
}

console.log('-- the schema round-trips through localStorage, once per domain --')
let domainsExercised = 0
for (const domain of cfg.DOMAINS) {
  store.clear()
  cfg.resetPlayerConfigCache()
  const entry = { id: cfg.newId(domain), enabled: true, source: 'player', ...SAMPLE[domain] }
  const write = cfg.setDomain(domain, [entry])
  cfg.resetPlayerConfigCache()
  const back = cfg.loadDomain(domain)
  const same = canonical(back.entries) === canonical([entry])
  ok(
    `${domain}: written, forgotten, read back identical`,
    write.ok && same && back.status === 'current',
    same ? back.status : JSON.stringify(back.entries)
  )
  // The raw value, not the module's own reading of it: a store that kept the
  // entry only in memory would pass the line above and lose it on reload.
  const raw = JSON.parse(store.get(cfg.storageKeyFor(domain)) ?? 'null')
  ok(
    `${domain}: the stored value carries version ${cfg.PLAYER_CONFIG_VERSION}`,
    raw?.version === cfg.PLAYER_CONFIG_VERSION && raw?.entries?.length === 1,
    JSON.stringify(raw?.version)
  )
  domainsExercised += 1
}
{
  // Normalisation is a property of the store, not of the sample: two bindings
  // on one physical chord must compare equal however they were typed.
  store.clear()
  cfg.resetPlayerConfigCache()
  cfg.setDomain('macros', [{ id: 'm-1', enabled: true, source: 'player', key: 'F3', modifiers: ['Alt', 'Control'], commands: ['stow left'] }])
  cfg.resetPlayerConfigCache()
  ok(
    'modifiers come back in one order however they were written',
    canonical(cfg.domainEntries('macros')[0].modifiers) === canonical(['Control', 'Alt']),
    JSON.stringify(cfg.domainEntries('macros')[0].modifiers)
  )
}

ok(
  'all seven domains were exercised, not a shorter list',
  domainsExercised === 7 && cfg.DOMAINS.length === 7,
  `${domainsExercised} of 7`
)

console.log('\n-- the migration answers with three states, never two --')
{
  const absent = cfg.migratePlayerConfig(null, 'aliases')
  ok('an absent key is "absent" and empty', absent.status === 'absent' && absent.entries.length === 0, absent.status)
  ok('an absent key drops nothing and migrates nothing', absent.migrated === 0 && absent.dropped.length === 0)

  store.clear()
  cfg.resetPlayerConfigCache()
  // A v0 fixture: entries as the pre-store era would have written them, with
  // no id, no enabled and no source.
  const v0 = { version: 0, entries: [{ name: 'appc', expansion: 'appraise $0 careful' }, { name: 'anec', expansion: 'accuse $1 necromancy' }] }
  store.set(cfg.storageKeyFor('aliases'), JSON.stringify(v0))
  const migrated = cfg.loadDomain('aliases')
  ok('a v0 key migrates rather than being refused', migrated.status === 'migrated', migrated.status)
  ok('every v0 entry came across', migrated.entries.length === 2 && migrated.migrated === 2, `${migrated.entries.length} of 2`)
  ok('each one gained an id, enabled and a source', migrated.entries.every((e) => e.id && e.enabled === true && e.source === 'player'))
  ok('the expansion is carried, not reinvented', migrated.entries[0].expansion === 'appraise $0 careful', migrated.entries[0].expansion)
  const rewritten = JSON.parse(store.get(cfg.storageKeyFor('aliases')))
  ok('the key is rewritten at the current version, so the migration runs once', rewritten.version === cfg.PLAYER_CONFIG_VERSION, `${rewritten.version}`)

  store.clear()
  cfg.resetPlayerConfigCache()
  const newer = { version: 99, entries: [{ id: 'a-1', enabled: true, source: 'player', name: 'x', expansion: 'y' }] }
  store.set(cfg.storageKeyFor('aliases'), JSON.stringify(newer))
  const refused = cfg.loadDomain('aliases')
  ok('a newer version is refused, not half-read', refused.status === 'refused' && refused.entries.length === 0, refused.status)
  ok('and the refusal names the version it found', /\b99\b/.test(refused.why ?? ''), refused.why ?? '')
  ok(
    'a refused key is left exactly as it was, not overwritten',
    store.get(cfg.storageKeyFor('aliases')) === JSON.stringify(newer)
  )

  store.clear()
  cfg.resetPlayerConfigCache()
  store.set(cfg.storageKeyFor('gags'), JSON.stringify({ version: 1, entries: [{ id: 'g-1', enabled: true, source: 'player', pattern: 'ok' }, { id: 'g-2' }] }))
  const partial = cfg.loadDomain('gags')
  ok('an unreadable entry is dropped and named, the rest kept', partial.entries.length === 1 && partial.dropped.length === 1, partial.dropped[0] ?? '')
}

console.log('\n-- a write that fails is reported, not kept in memory --')
{
  store.clear()
  cfg.resetPlayerConfigCache()
  const good = { id: cfg.newId('gags'), enabled: true, source: 'player', pattern: 'first' }
  cfg.setDomain('gags', [good])
  const realSet = globalThis.localStorage.setItem
  globalThis.localStorage.setItem = () => {
    throw new DOMException('full', 'QuotaExceededError')
  }
  const result = cfg.setDomain('gags', [good, { id: 'g-2', enabled: true, source: 'player', pattern: 'second' }])
  globalThis.localStorage.setItem = realSet
  ok('the failure is returned rather than swallowed', result.ok === false && result.kind === 'quota', JSON.stringify(result))
  ok(
    'and the store still holds only what is actually durable',
    cfg.domainEntries('gags').length === 1,
    `${cfg.domainEntries('gags').length} in memory, 1 on disk`
  )
}

console.log('\n-- the runtime reads the store: drive it, then watch paint() and expandAlias() --')
{
  store.clear()
  cfg.resetPlayerConfigCache()
  cfg.setDomain('presets', [{ id: 'p-1', enabled: true, source: 'player', name: 'arrivals', fg: '#66DDFF', bold: false }])
  cfg.setDomain('highlights', [
    { id: 'h-1', enabled: true, source: 'player', type: 'line', pattern: 'just arrived', presetId: 'p-1' },
    { id: 'h-2', enabled: false, source: 'player', type: 'string', pattern: 'kobold', colour: '#FF5555' },
    { id: 'h-3', enabled: true, source: 'player', type: 'line', pattern: 'orphan', presetId: 'p-gone' },
  ])
  const live = currentHighlights()
  const painted = paint('Bob just arrived.', live.highlights)
  ok('a highlight typed into the store colours the line', painted.lineColour === '#66DDFF', painted.lineColour ?? 'none')
  ok('through the preset it names, not a colour typed twice', live.highlights[0].colour === '#66DDFF')
  ok('a disabled rule never reaches the painter', paint('a kobold here', live.highlights).spans.length === 0)
  ok('the note reports the denominator, not only what loaded', /of 3 highlights/.test(live.note), live.note)
  const orphan = paint('orphan line', live.highlights)
  ok('a rule naming a deleted preset still paints, in the default colour', orphan.matched.length === 1 && !orphan.lineColour, JSON.stringify(orphan.lineColour))

  cfg.setDomain('aliases', [
    { id: 'a-1', enabled: true, source: 'player', name: 'appc', expansion: 'appraise $0 careful' },
    { id: 'a-2', enabled: false, source: 'player', name: 'off', expansion: 'never fires' },
  ])
  const aliases = currentAliases()
  ok('an alias typed into the store expands', expandAlias('appc sword', aliases.aliases).text === 'appraise sword careful')
  ok('a disabled alias does not', expandAlias('off', aliases.aliases).expanded === false)
  ok('and the note counts against what is stored', /1 of 2 aliases/.test(aliases.note), aliases.note)
}

console.log('\n-- nothing reads a Genie config leaf any more except the importer --')
{
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry)) files.push(path.split('\\').join('/'))
    }
  }
  walk('src')
  ok('the scan saw the whole tree, not a fragment', files.length >= 100, `${files.length} files`)

  // The positive control: a needle that is certainly present, so a zero below
  // is a fact about the tree rather than about this scan.
  const control = files.filter((f) => readFileSync(f, 'utf8').includes('invokeTauri('))
  ok('the scan can see an invokeTauri call at all', control.length >= 3, `${control.length} files call invokeTauri`)

  const callers = files.filter((f) => /invokeTauri\(\s*'read_genie_config'/.test(readFileSync(f, 'utf8')))
  const allowed = new Set(['src/lib/playerConfigImport.ts', 'src/lib/pinsFile.ts', 'src/components/config/PlayerConfigPanel.tsx'])
  const strays = callers.filter((f) => !allowed.has(f))
  ok(
    `every read_genie_config caller is accounted for (${callers.length} of ${callers.length})`,
    strays.length === 0,
    strays.join(', ')
  )
  // Named rather than folded into the line above: `pinsFile.ts` reads the
  // *pins* file, not a config leaf, and Q5 moves it to the app's own data
  // directory. Stating it here means the allowlist cannot quietly grow.
  ok(
    'the one non-import caller reads the pins file, not a config leaf',
    !callers.includes('src/lib/pinsFile.ts') ||
      /PINS_LEAF/.test(readFileSync('src/lib/pinsFile.ts', 'utf8'))
  )
  // The mechanism, not the word: both files still *mention* the Genie leaf in
  // their headers, saying what they used to read and why they no longer do,
  // and a check that forbade the word would forbid the explanation.
  ok(
    'neither live hook invokes Tauri at all any more',
    !/invokeTauri/.test(readFileSync('src/lib/useHighlights.ts', 'utf8')) &&
      !/invokeTauri/.test(readFileSync('src/lib/useAliases.ts', 'utf8'))
  )
}

console.log('\n-- sabotage: each break reddens the case that names it, and only it --')
{
  // Inside the repo rather than in the system temp directory: a mutant of a
  // module that imports `react` has to sit where node can resolve
  // `node_modules`, and rewriting every bare specifier as well as every
  // relative one would be a second, worse copy of node's own resolver.
  const dir = mkdtempSync(join(process.cwd(), 'tools', '.sabotage-'))
  SABOTAGE_DIR = dir
  const abs = (rel) => pathToFileURL(join(process.cwd(), rel)).href

  /*
   * Line endings are normalised before the anchor is matched.
   *
   * This repo checks out CRLF on Windows, so an anchor written with plain
   * newlines matches on the working copy a session just wrote and stops
   * matching the moment git has touched the file - which is exactly what
   * happened here, one commit after these sabotages were first proved. The
   * guard below turned it into a hard abort rather than a pass, which is the
   * only reason it was a five-minute fix instead of a suite quietly asserting
   * nothing. `String.fromCharCode(13)` rather than an escape, because a
   * backslash written through a shell tool is its own trap.
   */
  const CR = String.fromCharCode(13)

  async function loadMutant(label, file, transform, rewrite = []) {
    const src = readFileSync(file, 'utf8').split(CR).join('')
    let mutated = transform(src)
    if (mutated === src) {
      throw new Error(`sabotage "${label}" did not change ${file} - the target text was not found`)
    }
    for (const [spec, rel] of rewrite) mutated = mutated.split(`'${spec}'`).join(`'${abs(rel)}'`)
    const p = join(dir, `${label}.ts`)
    writeFileSync(p, mutated)
    return import(pathToFileURL(p).href)
  }

  // (1) One domain missing from the list the store iterates.
  {
    const mod = await loadMutant(
      'six-domains',
      'src/lib/playerConfig.ts',
      (s) => s.replace("  'variables',\n]", ']'),
      [['./storage.ts', 'src/lib/storage.ts']]
    )
    ok('sabotage lands: the seven-domain floor reddens', mod.DOMAINS.length !== 7, `${mod.DOMAINS.length} domains`)
    ok(
      'sabotage is scoped: the migration still answers three ways',
      mod.migratePlayerConfig(null, 'aliases').status === 'absent' &&
        mod.migratePlayerConfig({ version: 99, entries: [] }, 'aliases').status === 'refused'
    )
  }

  // (2) The version check skipped: a newer key read as if it were current.
  {
    const mod = await loadMutant(
      'no-version-check',
      'src/lib/playerConfig.ts',
      (s) => s.replace('if (version > PLAYER_CONFIG_VERSION) {', 'if (false) {'),
      [['./storage.ts', 'src/lib/storage.ts']]
    )
    const read = mod.migratePlayerConfig(
      { version: 99, entries: [{ id: 'a-1', enabled: true, source: 'player', name: 'x', expansion: 'y' }] },
      'aliases'
    )
    ok('sabotage lands: the v99 fixture is no longer refused', read.status !== 'refused', read.status)
    ok('sabotage is scoped: the v0 fixture still migrates', mod.migratePlayerConfig({ version: 0, entries: [{ name: 'a', expansion: 'b' }] }, 'aliases').status === 'migrated')
    ok('sabotage is scoped: an absent key is still absent', mod.migratePlayerConfig(null, 'aliases').status === 'absent')
  }

  // (3) The hook pointed back at what a Genie read gives with no Tauri: an
  // empty config. This is the shape of "useHighlights reads Genie again".
  {
    const mod = await loadMutant(
      'highlights-from-genie',
      'src/lib/useHighlights.ts',
      (s) => s.replace('const cfg = loadPlayerConfig()', "const cfg = { highlights: [], presets: [] }\n  void loadPlayerConfig"),
      [
        ['./highlights.ts', 'src/lib/highlights.ts'],
        ['./playerConfig.ts', 'src/lib/playerConfig.ts'],
      ]
    )
    const live = mod.currentHighlights()
    ok(
      'sabotage lands: with the store unread, a stored highlight paints nothing',
      paint('Bob just arrived.', live.highlights).lineColour === undefined,
      `${live.highlights.length} highlights`
    )
    ok('sabotage is scoped: the store itself still holds the rule', cfg.domainEntries('highlights').length === 3)
  }
}

console.log(`\n${checked} checked, ${failed} failed`)
if (checked < 30) {
  console.log(`FAIL only ${checked} checks ran; this suite has never had fewer than 30`)
  process.exit(1)
}
process.exit(failed ? 1 : 0)
