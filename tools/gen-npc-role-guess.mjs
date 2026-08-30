/**
 * Best-effort role+gender guess for every named NPC gathered during research,
 * so npcDefaults.ts has something to hand back even for the ~400 names
 * nobody has individually researched a role for yet.
 *
 * Per Dan (30 Aug 2026): grab what data exists, guess the rest, refine later.
 * These are cosmetic portrait buckets for fictional shopkeepers/guards, not
 * claims about a real person, so a keyword guess here is a different thing
 * from inferring a real player's gender from their name — that stays off
 * limits (see playerArt.ts). A wrong guess here just means the wrong-but-
 * plausible generic portrait shows until someone corrects the table.
 *
 *   node tools/gen-npc-role-guess.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const wishlist = JSON.parse(readFileSync('data/art/zoluren-wishlist.json', 'utf8'))
const extra = JSON.parse(readFileSync('data/art/next-500-200.json', 'utf8'))

const ROLE_RULES = [
  [/priest|cleric|exorcist|church|chapel|altar|priestess/i, 'priest'],
  [/heal|herbal|midwife|apothecary/i, 'alchemist'],
  [/chieftain|clan leader|founder|matriarch|patriarch|prominent/i, 'elder'],
  [/guard|sentry|warden|constable|defender|guardsman|garrison/i, 'warrior'],
  [/bard|concert|perform|music|ballad/i, 'bard'],
  [/monk/i, 'priest'],
  [/urchin|thief|rogue/i, 'thief'],
  [/knight|captain|baron/i, 'knight'],
  [/necromanc|undead|dark rit/i, 'necromancer'],
  [/ranger|hunt|scout|wild|kennel/i, 'ranger'],
  [/mage|wizard|sorcer|scholar|appraiser/i, 'mage'],
]
function guessRole(text) {
  for (const [re, role] of ROLE_RULES) if (re.test(text)) return role
  return 'merchant'
}

const GENDER_RULES = [
  [/\bwife\b|\bdaughter\b|matriarch|priestess|midwife|\bshe\b|\bher\b/i, 'female'],
  [/\bson\b|\bhusband\b|patriarch|\bhe\b|\bhis\b|\bhim\b/i, 'male'],
]
function fnv1a(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h
}
function guessGender(name, text) {
  for (const [re, g] of GENDER_RULES) if (re.test(text)) return g
  // No textual cue: alternate deterministically by name hash rather than
  // defaulting everyone to one sex.
  return fnv1a(name) % 2 === 0 ? 'male' : 'female'
}

const table = {}
let explicit = 0
let guessed = 0

function add(rawName, contextText, confidence) {
  const name = rawName.replace(/\s*\([^)]*\)\s*/g, '').trim()
  if (!name || table[name]) return
  const role = guessRole(contextText)
  const gender = guessGender(name, contextText)
  table[name] = { role, gender, confidence }
  if (confidence === 'guessed-from-context') explicit++
  else guessed++
}

// --- Crafting society masters: named, but only "one guild-craft society
// each" with no per-name craft recorded here, so role is a flat merchant
// guess (a guild leader running a trade) rather than context-derived. ---
for (const name of wishlist.people.crafting_society_masters.names) {
  add(name, 'guild craft master, runs a trade society', 'guessed-flat')
}

// --- Guards: role is certain from category; gender has no signal so it
// alternates. ---
for (const name of [...wishlist.people.guards.confirmed_zoluren, ...wishlist.people.guards.candidates]) {
  add(name, 'town guard sentry', 'guessed-from-context')
}

// --- Town/clan NPCs: real parenthetical role text to key off. ---
for (const town of Object.values(wishlist.people.other_towns)) {
  for (const entry of town.people ?? []) {
    add(entry, entry, 'guessed-from-context')
  }
}

// --- The 340-name Grok-priority shopkeeper list: bare names only, but the
// category note itself says "someone a player actually walks up to and
// trades with" — that is a merchant by definition, so this is as certain
// as a flat default gets. ---
for (const name of extra.npcs_likely_to_encounter.names) {
  add(name, 'standing shopkeeper', 'guessed-flat')
}

// --- Deferred/lower-priority: mostly generic-role placeholders whose own
// name carries the best context there is. ---
for (const name of extra.npcs_deferred_lower_priority.names) {
  add(name, name, 'guessed-from-context')
}

writeFileSync('data/art/npc-role-guess.json', JSON.stringify(table, null, 1))
console.log(`${Object.keys(table).length} names — ${explicit} from context, ${guessed} flat-default`)
const byRole = {}
for (const v of Object.values(table)) byRole[v.role] = (byRole[v.role] ?? 0) + 1
console.log(byRole)
