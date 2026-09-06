/**
 * The whole player config as one document: export, import, merge, and the file.
 *
 *   node tools/player-config-transfer-test.mjs
 *
 * # Where the seam is
 *
 * At `window.__TAURI_INTERNALS__.invoke`, which is the actual boundary to the
 * Rust process. Everything above it is the shipping code - `tauri.ts`'s own
 * `isTauri`/`invokeTauri`, `playerFiles.ts`, `playerConfigTransfer.ts` - so a
 * caller that stopped passing `expectedPrevious` reddens here rather than
 * passing against a stub of itself. Below the seam is a faithful fake of
 * `src-tauri/src/player_files.rs` against a temp directory; the Rust side's own
 * guarantees (atomic rename, backup once, the compare-and-swap, the leaf
 * refusal) are `cargo test player_files`.
 *
 * # What each block is for
 *
 * **Seven domains, populated, counted.** A round trip is trivially clean
 * against a domain the fixture never filled, so every domain carries entries,
 * the per-domain count is printed, and the total is asserted against a floor.
 * The denominator is what disappears when the mechanism breaks.
 *
 * **Byte-identical, not merely equivalent.** Export, import into an empty
 * store, export again, compare the strings. A comparison of parsed objects
 * would pass against an exporter whose key order wandered, and the file is
 * meant to be readable and diffable by a person.
 *
 * **One refused entry costs one entry.** The case that matters is not that a
 * bad rule is refused - it is that the other six domains still import, and
 * that the refusal names the domain and the id. A parser that gave up on the
 * document would satisfy "the bad rule did not get in" perfectly.
 *
 * **The counts sum to the file.** `added + updated + unchanged + refused`
 * against `inFile`, per domain. A report that does not add up is how a rule
 * goes missing while the screen says the import worked.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------- the seam --
const appData = mkdtempSync(join(tmpdir(), 'q6-appdata-'))
/** Every command that crossed the boundary, in order. */
const invoked = []
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (cmd, args) => {
      invoked.push(`${cmd}:${args?.leaf ?? ''}`)
      const target = join(appData, args.leaf)
      const current = existsSync(target) ? readFileSync(target, 'utf8') : null
      if (cmd === 'read_player_file') {
        // One-shot stale answer: the only way to put the shipping export on
        // the losing side of the race without poking the writer.
        const stale = globalThis.__q6StaleRead
        if (stale !== undefined) {
          globalThis.__q6StaleRead = undefined
          return { path: target, text: stale, found: true, note: '' }
        }
        return {
          path: target,
          text: current ?? '',
          found: current !== null,
          note: current === null ? `No ${args.leaf} saved yet.` : '',
        }
      }
      if (cmd === 'write_player_file') {
        if (args.expectedPrevious !== undefined && (current ?? '') !== args.expectedPrevious) {
          throw new Error(
            `${args.leaf} changed since this window last read it - another window of this app, or a text editor, has written to it since.`
          )
        }
        if (current !== null && !existsSync(`${target}.bak`)) writeFileSync(`${target}.bak`, current)
        writeFileSync(target, args.text)
        return { path: target, backedUp: existsSync(`${target}.bak`) }
      }
      throw new Error(`unstubbed command ${cmd}`)
    },
  },
}

const held = new Map()
globalThis.localStorage = {
  getItem: (k) => (held.has(k) ? held.get(k) : null),
  setItem: (k, v) => held.set(k, String(v)),
  removeItem: (k) => held.delete(k),
}

const cfg = await import('../src/lib/playerConfig.ts')
const tr = await import('../src/lib/playerConfigTransfer.ts')
const hl = await import('../src/lib/highlights.ts')

let checked = 0
let failed = 0
const ok = (name, cond, detail = '') => {
  checked += 1
  if (!cond) failed += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(66)}${detail}`)
}

/** Three entries in every one of the seven domains, so nothing here is clean
 *  because it was empty. Every field the schema declares is set. */
const FIXTURE = {
  presets: [
    { name: 'roomname', fg: '#F5DEB3', bg: '#101010', bold: true },
    { name: 'speech', fg: 'cyan', bold: false },
    { name: 'danger', fg: '#FF4444', bold: true, cls: 'combat' },
  ],
  highlights: [
    { type: 'line', pattern: 'just arrived', colour: '#66DDFF', cls: 'people', sound: 'arrive.wav' },
    { type: 'string', pattern: 'kobold', presetId: 'p-01' },
    { type: 'regexp', pattern: '^You feel [a-z]+', colour: '#AAAAAA' },
  ],
  aliases: [
    { name: 'appc', expansion: 'appraise $0 careful' },
    { name: 'sk', expansion: 'skin;get my knife' },
    // Already off, because that is the only state the Aliases editor will
    // store a Genie-script rule in. A fixture carrying it switched *on* would
    // make the byte-identical round trip fail for a real reason - the import
    // would switch it off - and that case has its own check below, on a
    // hand-edited document rather than on one this app wrote.
    { name: 'scripted', expansion: '#queue add stand', enabled: false },
  ],
  macros: [
    { key: 'NumPad8', modifiers: [], commands: ['n'] },
    { key: 'F3', modifiers: ['Control'], commands: ['stow left', 'get my longsword'] },
    { key: 'F4', modifiers: ['Shift', 'Alt'], commands: ['look', 'exp'] },
  ],
  substitutes: [
    { find: "a Gor'Tog", replace: 'Tog' },
    { find: 'an? (large|small) ', replace: '', regex: true },
    { find: 'the Crossing', replace: 'Crossing' },
  ],
  gags: [
    { pattern: 'You feel fully rested' },
    { pattern: '^\\s*$', regex: true },
    { pattern: 'The wind blows' },
  ],
  variables: [
    { name: 'weapon', value: 'longsword' },
    { name: 'shop', value: 'the pawnshop' },
    { name: 'patient', value: 'nobody' },
  ],
}

function seed(extra = {}) {
  held.clear()
  cfg.resetPlayerConfigCache()
  let n = 0
  for (const domain of cfg.DOMAINS) {
    const entries = [...FIXTURE[domain], ...(extra[domain] ?? [])].map((e, i) => ({
      id: `${domain.slice(0, 3)}-${String(i).padStart(2, '0')}`,
      enabled: true,
      source: 'player',
      ...e,
    }))
    cfg.setDomain(domain, entries)
    n += entries.length
  }
  cfg.resetPlayerConfigCache()
  return n
}

console.log('-- the fixture fills every domain, and says how full --')
const seeded = seed()
ok('seven domains, from the list the panel renders from', cfg.DOMAINS.length === 7, `${cfg.DOMAINS.length}`)
let populated = 0
for (const domain of cfg.DOMAINS) {
  const n = cfg.domainEntries(domain).length
  if (n > 0) populated += 1
  console.log(`     ${domain.padEnd(12)} ${n} entries`)
}
ok('every one of the seven is populated', populated === 7, `${populated} of 7`)
ok('and the fixture is not a token one', seeded >= 21, `${seeded} entries`)

console.log('\n-- export, import, export: the same bytes --')
const text1 = tr.serializePlayerConfig(tr.exportPlayerConfig())
ok('the export carries the version and the provenance', /"version": 1/.test(text1) && /"provenance": "player"/.test(text1))
{
  const doc = JSON.parse(text1)
  // Named before counted. A domain missing from the document made the count
  // below throw, and a suite that crashes prints no FAIL line - so a dropped
  // domain and a clean run looked identical. This says which one is gone.
  const missing = cfg.DOMAINS.filter((d) => !Array.isArray(doc[d]))
  ok('the document names every one of the seven domains', missing.length === 0, missing.join(', ') || 'none missing')
  let all = 0
  for (const domain of cfg.DOMAINS) all += Array.isArray(doc[domain]) ? doc[domain].length : 0
  ok('and every domain, with every entry', all === seeded, `${all} of ${seeded}`)
}
held.clear()
cfg.resetPlayerConfigCache()
const round = tr.previewPlayerConfigImportText(text1, 'update', cfg.emptyPlayerConfig())
ok('an empty store imports the document', round.ok === true, round.ok ? '' : round.reason)
if (round.ok) {
  const write = tr.applyPlayerConfigImport(round.config)
  ok('and it saves, all seven keys', write.ok === true, JSON.stringify(write.failures))
  const text2 = tr.serializePlayerConfig(tr.exportPlayerConfig())
  ok('the second export is byte-identical to the first', text1 === text2, `${text1.length} vs ${text2.length} bytes`)
  const stored = JSON.parse(globalThis.localStorage.getItem(cfg.storageKeyFor('aliases')) ?? 'null')
  ok('and it really went to storage, not only to memory', stored?.entries?.length === 3, JSON.stringify(stored?.entries?.length))
  const short = cfg.DOMAINS.filter((d) => cfg.domainEntries(d).length !== FIXTURE[d].length)
  ok(
    'every domain came back with the entries it went out with',
    short.length === 0,
    short.map((d) => `${d} ${cfg.domainEntries(d).length}/${FIXTURE[d].length}`).join(', ') || 'all seven'
  )
  ok('nothing this app wrote is switched off on the way back in', round.report.disabled.length === 0, JSON.stringify(round.report.disabled))
}

console.log('\n-- a hand-edited document: script is kept and switched off, as the editor would --')
{
  const doc = JSON.parse(text1)
  doc.aliases.find((a) => a.name === 'scripted').enabled = true
  doc.macros.push({ id: 'mac-99', enabled: true, source: 'player', key: 'F8', modifiers: [], commands: ['#setvar x 1'] })
  const out = tr.previewPlayerConfigImport(doc, 'update', cfg.emptyPlayerConfig())
  ok('the document is admitted', out.ok === true, out.ok ? '' : out.reason)
  if (out.ok) {
    ok('the scripted alias is reported as kept and off', out.report.disabled.some((d) => d.domain === 'aliases' && /Genie script/.test(d.why)), JSON.stringify(out.report.disabled))
    ok('and the scripted macro too', out.report.disabled.some((d) => d.domain === 'macros' && d.id === 'mac-99'))
    ok('neither is refused - the text is kept, it simply does not fire', out.report.refused.length === 0, JSON.stringify(out.report.refused))
    ok('and both are really in the result, switched off', out.config.aliases.find((a) => a.name === 'scripted')?.enabled === false && out.config.macros.find((m) => m.id === 'mac-99')?.enabled === false)
  }
}

console.log('\n-- the counts add up to the file, per domain --')
if (round.ok) {
  const r = round.report
  let mismatched = []
  for (const domain of cfg.DOMAINS) {
    const refused = r.refused.filter((x) => x.domain === domain).length
    const total = r.added[domain] + r.updated[domain] + r.unchanged[domain] + refused
    if (total !== r.inFile[domain]) mismatched.push(`${domain} ${total}/${r.inFile[domain]}`)
  }
  ok('added + updated + unchanged + refused equals what the file held', mismatched.length === 0, mismatched.join(', '))
  ok(
    'control: the denominator is not zero, so the sum means something',
    cfg.DOMAINS.every((d) => r.inFile[d] > 0),
    JSON.stringify(r.inFile)
  )
}

console.log('\n-- a tampered version is refused, naming it --')
{
  const tampered = JSON.parse(text1)
  tampered.version = 99
  const out = tr.previewPlayerConfigImport(tampered, 'update', cfg.emptyPlayerConfig())
  ok('a version this build cannot read is refused', out.ok === false)
  ok('and the refusal names the version it saw', out.ok === false && /99/.test(out.reason), out.ok ? '' : out.reason)
  const noProv = JSON.parse(text1)
  delete noProv.provenance
  const p = tr.previewPlayerConfigImport(noProv, 'update', cfg.emptyPlayerConfig())
  ok('a document with no provenance is refused, naming it', p.ok === false && /provenance/.test(p.reason), p.ok ? '' : p.reason)
  const control = tr.previewPlayerConfigImport(JSON.parse(text1), 'update', cfg.emptyPlayerConfig())
  ok('control: the untampered document is still admitted', control.ok === true, control.ok ? '' : control.reason)
}

console.log('\n-- one bad entry costs one entry, and is named --')
{
  const doc = JSON.parse(text1)
  // A pattern the highlights editor itself refuses (Q2's compilePattern), on a
  // rule that is otherwise well formed - so this exercises the editor's rule
  // rather than the store's shape check.
  doc.highlights.push({ id: 'hig-bad', enabled: true, source: 'player', type: 'regexp', pattern: 'a(', colour: '#FF0000' })
  // And one the Variables editor refuses: Genie's own bookkeeping.
  doc.variables.push({ id: 'var-bad', enabled: true, source: 'player', name: 'roomid', value: '1234' })
  const out = tr.previewPlayerConfigImport(doc, 'update', cfg.emptyPlayerConfig())
  ok('the document is still imported', out.ok === true, out.ok ? '' : out.reason)
  if (out.ok) {
    const r = out.report
    const bad = r.refused.find((x) => x.id === 'hig-bad')
    ok('the bad highlight is refused, naming its domain and its id', bad?.domain === 'highlights', JSON.stringify(bad))
    ok('and the reason is the editor’s own, not a generic one', /Unterminated group|Invalid regular expression/.test(bad?.why ?? ''), bad?.why)
    const reserved = r.refused.find((x) => x.id === 'var-bad')
    ok('a Genie bookkeeping variable is refused by name', reserved?.domain === 'variables' && /roomid/.test(reserved.why), JSON.stringify(reserved))
    let others = 0
    for (const domain of cfg.DOMAINS) {
      if (domain === 'highlights' || domain === 'variables') continue
      if (r.added[domain] === 3) others += 1
    }
    ok('the other five domains import in full', others === 5, `${others} of 5`)
    ok('and the two spoiled domains keep their three good rules', r.added.highlights === 3 && r.added.variables === 3, `${r.added.highlights}/${r.added.variables}`)
    ok('the counts still add up with refusals in them', cfg.DOMAINS.every((d) => r.added[d] + r.updated[d] + r.unchanged[d] + r.refused.filter((x) => x.domain === d).length === r.inFile[d]))
  }
}

console.log('\n-- update, replace all, and what each does to a rule the file lacks --')
{
  const extra = {
    presets: [{ name: 'mine only', fg: '#00FF00', bold: false }],
    highlights: [{ type: 'string', pattern: 'mine only', colour: '#00FF00' }],
    aliases: [{ name: 'mineonly', expansion: 'smile' }],
    macros: [{ key: 'F9', modifiers: [], commands: ['mine only'] }],
    substitutes: [{ find: 'mine only', replace: 'x' }],
    gags: [{ pattern: 'mine only' }],
    variables: [{ name: 'mineonly', value: 'x' }],
  }
  seed(extra)
  const before = cfg.loadPlayerConfig()
  ok('the local store has a rule the document does not', before.aliases.some((a) => a.name === 'mineonly'))

  const plain = tr.previewPlayerConfigImport(JSON.parse(text1), 'update', before)
  ok('a plain import removes nothing', plain.ok && cfg.DOMAINS.every((d) => plain.report.removed[d] === 0))
  ok('and the local-only rule is still there', plain.ok && plain.config.aliases.some((a) => a.name === 'mineonly'))
  ok('while the document’s own rules are unchanged, not re-added', plain.ok && plain.report.unchanged.aliases === 3, plain.ok ? `${plain.report.unchanged.aliases}` : '')

  const replaced = tr.previewPlayerConfigImport(JSON.parse(text1), 'replace-all', before)
  ok('replace all removes what the file lacks', replaced.ok && cfg.DOMAINS.every((d) => replaced.report.removed[d] === 1), replaced.ok ? JSON.stringify(replaced.report.removed) : '')
  ok('and the local-only rule is gone', replaced.ok && !replaced.config.aliases.some((a) => a.name === 'mineonly'))
  ok('but nothing the file carries was lost', replaced.ok && replaced.config.aliases.length === 3, replaced.ok ? `${replaced.config.aliases.length}` : '')
  {
    const incoming = tr.parsePlayerConfigDocument(JSON.parse(text1))
    const going = incoming.ok ? tr.wouldRemove(before, incoming.parsed.config) : { aliases: [] }
    ok('and the panel can name what would go before it goes', going.aliases.includes('mineonly'), JSON.stringify(going.aliases))
    ok('control: it does not name a rule the document does carry', !going.aliases.includes('appc'), JSON.stringify(going.aliases))
  }

  // An edited rule: same identity, different body. `update` takes it, keeping
  // the local id; `keep-mine` leaves it alone.
  const edited = JSON.parse(text1)
  edited.aliases[0].expansion = 'appraise $0 quick'
  const upd = tr.previewPlayerConfigImport(edited, 'update', before)
  ok('update rewrites a rule whose body changed', upd.ok && upd.report.updated.aliases === 1, upd.ok ? `${upd.report.updated.aliases}` : '')
  ok('keeping the local id', upd.ok && upd.config.aliases.find((a) => a.name === 'appc')?.id === before.aliases.find((a) => a.name === 'appc')?.id)
  const keep = tr.previewPlayerConfigImport(edited, 'keep-mine', before)
  ok('keep-mine leaves it alone and counts it unchanged', keep.ok && keep.report.updated.aliases === 0 && keep.report.unchanged.aliases === 3)
}

console.log('\n-- a replace-all that takes a preset out from under its highlights (#490) --')
{
  /*
   * The case that bites is a partial document: one carrying the player's
   * highlights and not their presets, or carrying presets under different
   * ids. `wouldRemove` reports identities per domain and nothing crosses
   * between them, so the presets went and the highlights that named them
   * stayed, silently changing colour, with every number in the report adding
   * up correctly.
   *
   * Not data loss - `resolveHighlights` resolves a dangling presetId to the
   * default colour and says so - which is exactly why nothing louder would
   * ever have caught it.
   */
  const current = cfg.emptyPlayerConfig()
  current.presets = [{ id: 'p1', enabled: true, source: 'player', name: 'speech', fg: '#F5DEB3' }]
  current.highlights = [
    { id: 'h9', enabled: true, source: 'player', type: 'string', pattern: 'says,', presetId: 'p1' },
    { id: 'h8', enabled: true, source: 'player', type: 'string', pattern: 'whispers,', presetId: 'p1' },
  ]

  const partial = {
    ...cfg.emptyPlayerConfig(),
    version: cfg.PLAYER_CONFIG_VERSION,
    provenance: 'a friend',
    highlights: current.highlights,
  }

  const preview = tr.previewPlayerConfigImport(partial, 'replace-all', current)
  ok('the preview reads', preview.ok, preview.ok ? '' : preview.reason)
  ok('the preset is on its way out', preview.ok && preview.report.removed.presets === 1, preview.ok ? `${preview.report.removed.presets}` : '')
  ok('and the highlights that name it survive', preview.ok && preview.config.highlights.length === 2)

  const orphans = preview.ok ? preview.report.orphaned : []
  ok('the report warns about them', orphans.length === 1, JSON.stringify(orphans.map((o) => o.presetId)))
  ok('counting the highlights, not the presets', tr.orphanCount(orphans) === 2, `${tr.orphanCount(orphans)}`)
  // Named, not counted. "2 highlights would lose their preset" is a fact
  // nobody can act on, and finding those two by hand is the work the warning
  // is supposed to save - the same reason `refuseDeletingPreset` lists them.
  ok(
    'and naming each rule rather than counting them',
    orphans.length === 1 && orphans[0].highlights.map((h) => h.pattern).join(',') === 'says,,whispers,',
    JSON.stringify(orphans[0]?.highlights?.map((h) => h.pattern))
  )
  ok('under the name the player knows the preset by', orphans[0]?.presetName === 'speech', orphans[0]?.presetName)

  /*
   * The warning is the editor's own sentence, unedited. Asserted by
   * comparing the two strings rather than by reading the import: two wordings
   * of one situation drift the first time either is improved, and this is the
   * check that would redden if somebody wrote a second one here.
   */
  const editor = hl.refuseDeletingPreset({ id: 'p1', name: 'speech' }, preview.ok ? preview.config.highlights : [])
  ok('and it is the editor\'s own wording, not a second one', !editor.ok && orphans[0]?.why === editor.why, orphans[0]?.why)

  // Controls, both directions. A warning that fires on everything carries as
  // little information as one that never fires.
  const whole = { ...cfg.emptyPlayerConfig(), version: cfg.PLAYER_CONFIG_VERSION, provenance: 'a friend', presets: current.presets, highlights: current.highlights }
  const kept = tr.previewPlayerConfigImport(whole, 'replace-all', current)
  ok('control: a document carrying the presets orphans nothing', kept.ok && kept.report.orphaned.length === 0, kept.ok ? JSON.stringify(kept.report.orphaned) : '')
  const update = tr.previewPlayerConfigImport(partial, 'update', current)
  ok('control: update removes nothing, so it orphans nothing', update.ok && update.report.orphaned.length === 0, update.ok ? JSON.stringify(update.report.orphaned) : '')

  // The panel has to read the field, or the warning has moved from one place
  // nobody looks to another. One grep, and it is the step this class of
  // defect is always missing.
  const panel = readFileSync('src/components/config/ExportImportTab.tsx', 'utf8')
  ok('the panel reads report.orphaned', /report\.orphaned/.test(panel))
  ok('and warns before a replace-all rather than only after it', /confirming && pendingOrphans/.test(panel))
}

console.log('\n-- the file, and two windows of this app --')
{
  seed()
  const first = await tr.exportPlayerConfigToFile()
  ok('the export lands in the app data folder', first.path === join(appData, tr.PLAYER_CONFIG_LEAF), first.path)
  ok('and the file is really there - the call is not trusted for it', existsSync(join(appData, tr.PLAYER_CONFIG_LEAF)))
  ok('a first export has nothing to back up', first.backedUp === false, String(first.backedUp))

  const onDisk = readFileSync(join(appData, tr.PLAYER_CONFIG_LEAF), 'utf8')
  ok('what is on disk is what the exporter produced', onDisk === tr.serializePlayerConfig(tr.exportPlayerConfig()), `${onDisk.length} bytes`)

  const read = await tr.readPlayerConfigFile()
  ok('and reading it back finds it', read.found === true && read.text === onDisk)
  const back = tr.previewPlayerConfigImportText(read.text, 'update', cfg.emptyPlayerConfig())
  ok('the file round-trips through the reader', back.ok === true, back.ok ? '' : back.reason)

  // Window B holds a view taken before window A wrote.
  const windowBsView = onDisk
  cfg.setDomain('aliases', [{ id: 'a-A', enabled: true, source: 'player', name: 'windowA', expansion: 'was here' }])
  let refusal = ''
  try {
    await tr.exportPlayerConfigToFile()
  } catch (e) {
    refusal = String(e)
  }
  ok('the window that re-read before writing goes through', refusal === '', refusal)
  ok('and its rules are the ones on disk', readFileSync(join(appData, tr.PLAYER_CONFIG_LEAF), 'utf8').includes('windowA'))

  cfg.setDomain('aliases', [{ id: 'a-B', enabled: true, source: 'player', name: 'windowB', expansion: 'was here' }])
  globalThis.__q6StaleRead = windowBsView
  let clobbered = ''
  try {
    await tr.exportPlayerConfigToFile()
  } catch (e) {
    clobbered = String(e)
  }
  ok('a second window exporting from a stale view is refused', /changed since this window last read it/.test(clobbered), clobbered || 'it was allowed to write')
  ok('and the refusal names the file', clobbered.includes(tr.PLAYER_CONFIG_LEAF), clobbered)
  const after = readFileSync(join(appData, tr.PLAYER_CONFIG_LEAF), 'utf8')
  ok("the other window's export is still on disk", after.includes('windowA'))
  ok("and window B's rules did not reach the file", !after.includes('windowB'))
  await tr.exportPlayerConfigToFile()
  ok('control: window B succeeds once it has re-read - a refusal is recoverable', readFileSync(join(appData, tr.PLAYER_CONFIG_LEAF), 'utf8').includes('windowB'))

  // Read off the shipping module rather than inferred from the fake: a fake
  // that only refuses when handed an expectation cannot tell "the caller
  // passed a good one" from "the caller passed none".
  const shipped = readFileSync('src/lib/playerConfigTransfer.ts', 'utf8')
  ok(
    'the export passes expectedPrevious, so two windows cannot clobber each other',
    /writePlayerFile\(\s*PLAYER_CONFIG_LEAF,\s*text,\s*[^)]+\)/.test(shipped),
    shipped.match(/writePlayerFile\([^)]*\)/s)?.[0]?.replace(/\s+/g, ' ') ?? 'no writePlayerFile call found'
  )
  ok(
    'and nothing here writes a file by any other route',
    !/invokeTauri\(\s*['"]write/.test(shipped) && !/genieConfig/i.test(shipped),
    'one writer'
  )
  ok(
    'control: the spy recorded the calls that were made',
    invoked.filter((c) => c.startsWith('write_player_file:')).length >= 3 &&
      invoked.some((c) => c === `read_player_file:${tr.PLAYER_CONFIG_LEAF}`),
    `${invoked.length} calls`
  )
}

console.log('\n-- the one validator: the transfer asks the editors, it does not answer for them --')
{
  const src = readFileSync('src/lib/playerConfigTransfer.ts', 'utf8')
  for (const needle of ['compilePattern', 'ruleRefusal', 'isGenieScript', 'isBookkeepingVariable', 'migratePlayerConfig']) {
    ok(`it calls ${needle} rather than restating it`, src.includes(needle))
  }
  ok(
    'and it defines no RegExp of its own to judge a player pattern',
    !/new RegExp\(/.test(src),
    (src.match(/new RegExp\([^)]*\)/) ?? ['none'])[0]
  )
  ok(
    'the envelope is read by the shared reader, so the scene export cannot drift from it',
    /readEnvelope/.test(src) && /readEnvelope/.test(readFileSync('src/lib/sceneOverrides.ts', 'utf8'))
  )
}

console.log(`\n${checked} checked, ${failed} failed`)
if (checked < 45) {
  console.log(`FAIL only ${checked} checks ran; this suite has never had fewer than 45`)
  process.exit(1)
}
process.exit(failed ? 1 : 0)
