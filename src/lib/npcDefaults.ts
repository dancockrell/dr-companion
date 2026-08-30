/**
 * The basket of defaults for a game NPC whose race/gender/role are actually
 * known facts — a guild leader, a shopkeeper, anyone researched against
 * Elanthipedia rather than a real player. See playerArt.ts's own header for
 * why this is a completely separate system from that one: a real player has
 * no knowable gender or class to default on, an NPC frequently does.
 *
 * Keyed by "<role>-<gender>", each key holding several numbered variants so
 * two different NPCs sharing a role+gender don't look identical — the same
 * "not every goblin uses the same picture" reasoning as the creature pack's
 * multi-seed renders, applied to people instead of monsters.
 */

import roleGuessData from '../data/npcRoleGuess.json'

const BASE = '/npc-defaults/'
/** The bulk GPU-rendered pool (tools/art-npcs.mjs) — 3,320 files across
 * every role x race x gender combination it covers, generated locally
 * rather than hand-picked from Grok. Museum-quality it is not; complete
 * coverage it is, which is exactly what makes it the right *fallback*: see
 * npcDefaultFor's own doc comment for why it only gets asked second. */
const BULK_BASE = '/npcs/'

export type NpcRole =
  | 'mage' | 'warrior' | 'knight' | 'priest' | 'alchemist' | 'elder'
  | 'merchant' | 'ranger' | 'thief' | 'bard' | 'necromancer' | 'any'

export type NpcRace =
  | 'human' | 'elf' | 'dwarf' | 'halfling' | 'gnome' | "gor-tog"
  | 's-kra-mur' | 'prydaen' | 'rakash' | 'kaldar' | 'elothean'

interface RoleGuess {
  role: NpcRole
  gender: 'male' | 'female'
  race: NpcRace
  confidence: 'guessed-from-context' | 'guessed-flat'
}

const roleGuesses = roleGuessData as Record<string, RoleGuess>

/**
 * A best-effort role+gender+race for a named NPC, built from whatever
 * research data exists (data/art/zoluren-wishlist.json, next-500-200.json)
 * via tools/gen-npc-role-guess.mjs — keyword-matched where the source had
 * descriptive text (including a town's own race_flavor for race), a flat
 * "merchant"/"human" otherwise. Every entry here is a guess about a
 * fictional character's cosmetic portrait, refined over time as real
 * per-NPC research lands; it is not a claim about any real player, and the
 * caller (Puck in CombatRadar.tsx) only ever tries this for the 'people'
 * deck after a real submitted portrait has already had first refusal.
 */
export function npcRoleGuessFor(name: string): { role: NpcRole; gender: 'male' | 'female'; race: NpcRace } | undefined {
  const clean = name.replace(/^(a|an|the)\s+/i, '').trim()
  const g = roleGuesses[clean]
  return g ? { role: g.role, gender: g.gender, race: g.race } : undefined
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** variant filenames actually installed, keyed by "<role>-<gender>" */
const pool = new Map<string, string[]>()

export function registerNpcDefaultManifest(entries: Record<string, string[]>): void {
  for (const [key, files] of Object.entries(entries)) pool.set(key, files)
}

export async function loadNpcDefaultManifest(url = `${BASE}manifest.json`): Promise<number> {
  try {
    const res = await fetch(url)
    if (!res.ok) return 0
    const body: unknown = await res.json()
    if (typeof body !== 'object' || body === null) return 0
    const entries = body as Record<string, unknown>
    let count = 0
    const clean: Record<string, string[]> = {}
    for (const [key, files] of Object.entries(entries)) {
      if (!Array.isArray(files)) continue
      const list = files.filter((f): f is string => typeof f === 'string')
      clean[key] = list
      count += list.length
    }
    registerNpcDefaultManifest(clean)
    return count
  } catch {
    return 0
  }
}

/** Test seam. Nothing in the app calls this. */
export function resetNpcDefaultCache(): void {
  pool.clear()
}

/** Deterministic pick so the same NPC shows the same picture every time
 * rather than reshuffling on every re-render — seeded off whatever the
 * caller has that uniquely names this NPC (their own name, if known). */
function pick<T>(list: T[], seed: string): T {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return list[(h >>> 0) % list.length]
}

export interface NpcDefaultSource {
  key: string
  url: string
}

/** Every filename the bulk pool actually has, flat — matched by the
 * "npc-<role>-<race>-<gender>-" prefix rather than parsed apart, since the
 * pool always names itself in that exact order (tools/art-npcs.mjs). */
const bulkFiles: string[] = []

export function registerBulkNpcManifest(files: Iterable<string>): void {
  bulkFiles.length = 0
  bulkFiles.push(...files)
}

export async function loadBulkNpcManifest(url = `${BULK_BASE}manifest.json`): Promise<number> {
  try {
    const res = await fetch(url)
    if (!res.ok) return 0
    const body: unknown = await res.json()
    if (!Array.isArray(body)) return 0
    const clean = body.filter((f): f is string => typeof f === 'string')
    registerBulkNpcManifest(clean)
    return clean.length
  } catch {
    return 0
  }
}

/** Test seam. Nothing in the app calls this. */
export function resetBulkNpcCache(): void {
  bulkFiles.length = 0
}

// npcDefaults' own NpcRole vocabulary was picked to match the hand-curated
// Grok pool; the bulk pool (tools/art-npcs.mjs) was built independently and
// covers a different, real-world-shopkeeper vocabulary. Rather than pretend
// they are the same set, this maps the few roles that need it onto the
// nearest bulk-pool equivalent — 'any' has no bulk equivalent at all, so it
// is left unmapped and simply finds nothing there, same as it always has.
const BULK_ROLE_ALIAS: Partial<Record<NpcRole, string>> = {
  warrior: 'guard',
  knight: 'guard',
  elder: 'noble',
  alchemist: 'herbalist',
  necromancer: 'mage',
  ranger: 'hunter',
}

function bulkNpcDefaultFor(role: NpcRole, race: NpcRace, gender: 'male' | 'female', seed: string): NpcDefaultSource | undefined {
  const bulkRole = BULK_ROLE_ALIAS[role] ?? role
  const prefix = `npc-${bulkRole}-${race}-${gender}-`
  const variants = bulkFiles.filter((f) => f.startsWith(prefix))
  if (variants.length === 0) return undefined
  const file = pick(variants, seed)
  return { key: `bulk-${bulkRole}-${race}-${gender}`, url: `${BULK_BASE}${file}` }
}

/**
 * The default picture for an NPC of this role, race and gender.
 *
 * Tries the hand-curated pool first — Grok-quality, keyed on role+gender
 * only — and only asks the bulk GPU pool (role+race+gender, 3,320 files,
 * generated locally rather than picked by hand) when that has nothing.
 * Same ordering this whole session has used for creatures: the better
 * source gets first refusal, the complete-but-plainer one is what stands
 * between a guessed NPC and no picture at all. Race is optional because
 * the hand-curated pool never tracked it; pass it when known (from
 * npcRoleGuessFor) to reach the bulk pool's fallback at all.
 */
export function npcDefaultFor(role: NpcRole, gender: 'male' | 'female', seed: string, race?: NpcRace): NpcDefaultSource | undefined {
  const key = `${role}-${gender}`
  const variants = pool.get(key) ?? pool.get(`any-${gender}`)
  if (variants && variants.length > 0) {
    const file = pick(variants, seed)
    return { key, url: `${BASE}${slug(role)}-${slug(gender)}/${file}` }
  }
  return race ? bulkNpcDefaultFor(role, race, gender, seed) : undefined
}
