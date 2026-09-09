#!/usr/bin/env node
/**
 * gap-survey (2026-09-09): measure, for each player-facing capability, whether
 * the client (a) can SEND a command for it, (b) PARSES the game's reply into
 * state, and (c) SHOWS it in a panel.
 *
 * Not a gate stage. A one-shot instrument for docs/GAP-2026-09-09.md, kept in
 * the tree so the survey's numbers can be re-derived rather than believed.
 *
 * Every probe carries a positive control: a needle known to be present in the
 * same population. A probe whose control misses prints CONTROL-FAILED and the
 * run exits 1, because a zero from a broken grep and a zero from an absent
 * feature are the same zero (CLAUDE.md section 1).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (e === 'node_modules' || e === '.git') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const srcFiles = walk(join(ROOT, 'src')).filter((p) => /\.(ts|tsx)$/.test(p))
const srcText = new Map(srcFiles.map((p) => [p, readFileSync(p, 'utf8')]))
const lic = readFileSync(join(ROOT, 'lich-scripts', 'companion_bridge.lic'), 'utf8')

if (srcFiles.length < 200) {
  console.error(`CONTROL-FAILED: only ${srcFiles.length} source files found; expected 200+`)
  process.exit(1)
}
if (lic.length < 50000) {
  console.error(`CONTROL-FAILED: companion_bridge.lic is ${lic.length} bytes; expected 50k+`)
  process.exit(1)
}

const hitsIn = (re) => srcFiles.filter((p) => re.test(srcText.get(p)))
const licHits = (re) => (lic.match(re) || []).length

/**
 * The XML-stream parser is the *other* place a game fact can be turned into
 * state, and a capability fed from the stream reads as parse=0 against the
 * bridge alone. Counted separately rather than merged, because which source a
 * fact comes from is exactly the distinction `src/types/stream.ts` exists to
 * keep (`Sourced<T>`), and collapsing it here would hide it.
 */
const streamSrc = readFileSync(join(ROOT, 'src', 'lib', 'gameStream.ts'), 'utf8')
  + readFileSync(join(ROOT, 'src', 'types', 'stream.ts'), 'utf8')
const streamHits = (re) => (streamSrc.match(re) || []).length

/** capability, send-side needle, parse-side needle (bridge), show-side needle (components) */
const PROBES = [
  ['combat: attack/target', /\battack\b/i, /\btarget\b/, /roomCombatants|BattleActionBar/],
  ['wounds and injuries', /\bwounds?\b/i, /\binjuries\b/, /\binjuries\b/],
  ['stance (read back)', /stance (defensive|guarded|offensive)/i, /\bstance\b/, /character\.stance|\.stance\b/],
  ['roundtime', /\broundtime\b/i, /\broundtime\b/, /RoundtimeMeter/],
  ['skills / experience / mindstate', /\bexp\b/i, /\bmindstate\b/, /MindstateBoard|character\.skills/],
  ['spells: active list', /\bprep\b/i, /\bspells\b/, /ActiveSpell|character\.spells/],
  ['spells: prep/cast state machine', /\bcast\b/i, /prep_state|castState|spellPrep/, /SpellPanel|PrepPanel/],
  ['inventory and containers', /\binventory\b/i, /\bcontainers\b/, /InventoryPanel/],
  ['encumbrance', /\bencumbrance\b/i, /\bencumbrance\b/, /encumbrance/],
  ['travel / rooms / exits', /\bgo2\b|\btravel\b/i, /\bexits\b/, /ExitButtons/],
  ['communication: channels', /\bthoughts\b/i, /pushStream|popStream/, /StreamTabs/],
  ['communication: group', /\bgroup\b/i, /groupMembers/, /groupMembers/],
  ['tasks and bounties', /\bbount(y|ies)\b|\btaskmaster\b/i, /\bbount(y|ies)\b|\btask_state\b/, /BountyPanel|TaskPanel/],
  ['money and wealth', /\bwealth\b/i, /\bcoins?\b|\bsilver\b|\bwealth\b/, /WealthPanel|character\.coins/],
  ['shops and selling', /\bsell\b/i, /\bshop\b|\bstock\b/, /ShopPanel|character\.shop/],
  ['crafting', /\bcraft\b/i, /\brecipe\b|\bcrafting\b/, /CraftingPanel/],
  ['character sheet / stats', /\binfo\b/i, /\bstats\b/, /StatsPanel/],
  ['death and recovery', /\bdepart\b/i, /\bdead\b|\bfavors\b/, /DeathPanel|character\.favors/],
  ['scripts and automation', /start_script/, /list_scripts/, /ScriptLibraryPanel/],
  ['sound', /alertSound|ambientSound/, /\bsound\b/, /SoundControls/],
]

let controlFailed = false
const rows = []
for (const [name, send, parse, show] of PROBES) {
  const sendN = hitsIn(send).length
  const g = new RegExp(parse.source, parse.flags.includes('g') ? parse.flags : parse.flags + 'g')
  const parseN = licHits(g)
  const streamN = streamHits(new RegExp(g.source, g.flags))
  const showN = hitsIn(show).length
  rows.push({ name, sendN, parseN, streamN, showN })
}

// Positive controls: needles known present in each population.
const ctlSend = hitsIn(/useAppStore/).length
const ctlParse = licHits(/\bvitals\b/g)
const ctlShow = hitsIn(/InventoryPanel/).length
console.log(`controls: src files=${srcFiles.length} useAppStore=${ctlSend} lic vitals=${ctlParse} InventoryPanel=${ctlShow}`)
for (const [label, v] of [['send', ctlSend], ['parse', ctlParse], ['show', ctlShow]]) {
  if (v < 1) {
    console.error(`CONTROL-FAILED: ${label}-side control matched nothing; this instrument is broken, not the repo`)
    controlFailed = true
  }
}
// Negative control: a needle that must NOT be present anywhere.
if (hitsIn(/zzz_no_such_symbol_zzz/).length !== 0 || licHits(/zzz_no_such_symbol_zzz/g) !== 0) {
  console.error('CONTROL-FAILED: the negative control matched; the matcher is not discriminating')
  controlFailed = true
}
if (controlFailed) process.exit(1)

console.log('')
console.log('capability'.padEnd(36), 'send', 'bridge', 'stream', 'show')
for (const r of rows) {
  console.log(r.name.padEnd(36), String(r.sendN).padStart(4), String(r.parseN).padStart(6), String(r.streamN).padStart(6), String(r.showN).padStart(4))
}
console.log('')
const unread = rows.filter((r) => r.parseN === 0 && r.streamN === 0)
console.log(`${rows.length} capabilities probed; ${rows.filter((r) => r.showN === 0).length} with no showing component; ${unread.length} the client never reads back: ${unread.map((r) => r.name).join(', ')}`)
