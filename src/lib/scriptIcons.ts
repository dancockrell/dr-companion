/**
 * Which icon a Lich script (or an unrecognised Python one) gets, guessed
 * from its name and summary.
 *
 * Why this exists: every one of Lich's own scripts - dr-scripts, whatever
 * else is installed - used to render as the same generic icon. Measured
 * against a real install (`C:\Ruby4Lich5\Lich5\scripts`, 234 files after the
 * `=begin`/`=end` summary fix), that is 234 identical tiles distinguished
 * only by a tooltip nobody sees until they hover every single one - the
 * opposite of "browsable." This is a best-effort fix, not a real
 * classification: it pattern-matches the name and (once summarise() has a
 * chance to read it) the summary against words the script suite actually
 * uses, and it will misjudge some and give up on others. A wrong-but-plausible
 * icon and an honest "no better guess" (the fallback) are both fine outcomes;
 * inventing false confidence is not, so the patterns below are conservative -
 * a word has to actually appear, nothing is guessed from vibes.
 *
 * A player can always override the guess - see `scriptIconOverrides.ts` -
 * so a wrong guess here costs one click to fix, not a permanently wrong tile.
 */

/**
 * The keys this module can return, and the only keys `scriptIconOverrides.ts`
 * will accept from a player's own choice - see that file's `SCRIPT_ICON_KEYS`.
 * Kept as plain strings, not `LucideIcon` components, so this file has no
 * runtime import at all and a plain Node script can test the matching logic
 * directly - the same reasoning `taskGrouping.ts`'s own header gives for why
 * it lives apart from `pythonTasks.ts`.
 *
 * A handful (`swords`, `shield`, `eye-off`, `log-out`, `repeat`) exist only
 * so the built-in tasks' own curated icons (TaskFlowPanel.tsx's
 * `BASE_ICON_KEY`) have a key at all - `inferScriptIcon` below never emits
 * them, since it has no reason to guess "hunt" or "recover" from a Lich
 * script's own name. They still belong in the picker: a player can point any
 * tile, built-in or not, at any icon in this list.
 */
export const SCRIPT_ICON_KEYS = [
  'gem',
  'sword',
  'swords',
  'shield',
  'shield-check',
  'heart-pulse',
  'stethoscope',
  'eye-off',
  'log-out',
  'repeat',
  'skull',
  'landmark',
  'coins',
  'hammer',
  'anvil',
  'flame',
  'flask-conical',
  'pickaxe',
  'trees',
  'scissors',
  'sparkles',
  'wand',
  'scroll',
  'map',
  'compass',
  'door-open',
  'eye',
  'radar',
  'activity',
  'book-open',
  'settings',
  'refresh-cw',
  'cable',
  'lock',
  'unlock',
  'key-round',
  'footprints',
  'paw-print',
  'bug',
  'fish',
  'music',
  'dice-5',
  'puzzle',
  'backpack',
  'shopping-bag',
  'file-code',
  'terminal',
] as const

export type ScriptIconKey = (typeof SCRIPT_ICON_KEYS)[number]

/** Fallback when nothing below matches - "no better guess," not a wrong one. */
const DEFAULT_ICON: ScriptIconKey = 'gem'

/**
 * Checked in order, first match wins. A pattern is a word or two actually
 * seen in dr-scripts' own names or descriptions (see the corpus this was
 * built against, `C:\Ruby4Lich5\Lich5\scripts`) - not a guess at what a
 * script *might* be called. Order matters where two patterns could both
 * match: `bankbot` should read as a bank script before it reads as "a bot,"
 * so the more specific categories are checked first, and `status-monitor`
 * is why "monitor" only appears in one list rather than two - it used to be
 * in both this file's watcher/defense category and its status category, and
 * whichever was checked first always won regardless of which word actually
 * matched.
 *
 * Anchored at the *start* of a word only (`\bstem`, no trailing `\b`), not
 * at both ends. Measured against the real corpus, that is not a stylistic
 * choice: `bankbot`, `cleric-quests` and `setupaliases` all glue a root this
 * table already knows (`bank`, `quest`, `setup`) directly to another word
 * with no separator, and a trailing `\b` after `bank` demands a boundary
 * that "bankbot" never has - the pattern matched "bank" as a script and
 * missed "bankbot" as one. A leading boundary alone still stops `outbank`
 * or `unbanked` from matching input this table was never shown a false
 * positive for, which is the actual risk a full anchor would guard against.
 */
const PATTERNS: Array<[RegExp, ScriptIconKey]> = [
  // Companion bridge itself - the one script that is this app, not a
  // Lich extra, so it earns its own icon rather than sharing "utility."
  [/companion.?bridge/, 'cable'],

  // Money and trade, before crafting - "smelt-deeds" and "sell-loot" both
  // mention selling; the money words are checked first.
  [/\b(bank|vault|crown|debt|toll|tithe|pawn)/, 'landmark'],
  [/\b(sell|trade|restock|shop|offload|clerk|appraisal|accept-sell)/, 'coins'],

  // Crafting, by material - a forge, a mine and a loom are different
  // pictures even though "craft" would cover all three.
  [/\b(smith|smelt|forge|steel|weapon.?smith)/, 'anvil'],
  [/\b(craft|tinker|make|carve|sew|weave|knackstone|locksmith)/, 'hammer'],
  [/\b(mine|mining|ore|pickaxe|dig)/, 'pickaxe'],
  [/\b(wood|lumber|forest|chop|tree)/, 'trees'],
  [/\b(herb|remed|alchemy|plant|leather|clean-)/, 'flask-conical'],
  [/\b(shear|scissors|trim)/, 'scissors'],

  // Magic and ritual - kept apart from "combat," since a summoning or an
  // enchant is not a fight even when it happens to be cast mid-one.
  [/\b(enchant|summon|invoke|glyph|rune|ritual|sigil|charge-)/, 'sparkles'],
  [/\b(cast|spell|sorcery|theurgy|magic|arcane)/, 'wand'],

  // Combat and its aftermath.
  [/\b(combat|train|hunt|kill)/, 'sword'],
  // "monitor" is deliberately absent here - see this table's own header
  // comment on `status-monitor`. A generic status/activity reader is not a
  // guard, even when the two overlap in the odd script (arenawatch does
  // both, and lands here first since "arena" itself matches nothing more
  // specific and "watch" is checked before "status" would be reached).
  [/\b(defen[cs]e|guard|watch|alert|trigger)/, 'shield-check'],
  [/\b(heal|remed|tend|rezz|first.?aid|help.?me)/, 'heart-pulse'],
  [/\b(diagnos|injur|wound|treat)/, 'stethoscope'],
  [/\b(death|corpse|shit-list|jinx)/, 'skull'],

  // Getting around and getting in.
  [/\b(map|automap|nexus|scout|discern)/, 'map'],
  [/\b(go2|get2|gate|walk|astro|path)/, 'compass'],
  [/\b(safe.?room|escort|bescort)/, 'door-open'],

  // Thieving, locks, and the things that go with them.
  [/\b(burgle|steal|thie|pilfer)/, 'unlock'],
  [/\b(lock|pick|jail)/, 'lock'],
  [/\b(key|vars|register)/, 'key-round'],

  // Companions of the non-human kind.
  [/\b(pet|companion|horse|tarantula|critter|creature|bug.?grabber|lamprey)/, 'paw-print'],
  [/\bbug/, 'bug'],
  [/\bfish/, 'fish'],

  // Bard/performance, board games, puzzles - the "just for fun" corner of
  // the suite, which reads badly as a sword or a gear icon.
  [/\b(bard|whistle|music|perform|spin)/, 'music'],
  [/\b(boggle|card|dice|game)/, 'dice-5'],
  [/\b(puzzle|labyrinth|maze|quest|shrine|pilgrimage)/, 'puzzle'],

  // Carrying things, and the log/status/reading-only corner of the suite.
  [/\b(inventory|pouch|backpack|carry|stock)/, 'backpack'],
  [/\b(loot|item|gear|equip)/, 'shopping-bag'],
  [/\b(log|journal|history|record)/, 'book-open'],
  [/\b(status|activity|profile|monitor)/, 'activity'],
  [/\b(radar|track)/, 'radar'],
  [/\b(config|setup|setting|alias|preference|schedule)/, 'settings'],
  [/\b(update|install|repository|version|sync)/, 'refresh-cw'],
  [/\b(step|footprint|athletics|outdoorsman)/, 'footprints'],
]

/** Guessed once per script - the id is stable, so a caller can (and should)
 * cache this against `name`/`summary` rather than recompute on every render
 * of a 234-tile grid. */
export function inferScriptIcon(name: string, summary: string): ScriptIconKey {
  // Underscores normalised to spaces before anything else: `_` is a `\w`
  // character in JS regex, so `create_remedies` has no `\b` at all between
  // "create" and "remedies" until this runs - measured directly against
  // that real file name, which this table missed entirely before the fix.
  const text = `${name} ${summary}`.toLowerCase().replace(/_/g, ' ')
  for (const [pattern, key] of PATTERNS) {
    if (pattern.test(text)) return key
  }
  return DEFAULT_ICON
}
