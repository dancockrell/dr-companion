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

export type NpcRole =
  | 'mage' | 'warrior' | 'knight' | 'priest' | 'alchemist' | 'elder'
  | 'merchant' | 'ranger' | 'thief' | 'bard' | 'necromancer' | 'any'

interface RoleGuess {
  role: NpcRole
  gender: 'male' | 'female'
  confidence: 'guessed-from-context' | 'guessed-flat'
}

const roleGuesses = roleGuessData as Record<string, RoleGuess>

/**
 * A best-effort role+gender for a named NPC, built from whatever research
 * data exists (data/art/zoluren-wishlist.json, next-500-200.json) via
 * tools/gen-npc-role-guess.mjs — keyword-matched where the source had
 * descriptive text, a flat "merchant" otherwise. Every entry here is a guess
 * about a fictional character's cosmetic portrait, refined over time as real
 * per-NPC research lands; it is not a claim about any real player, and the
 * caller (Puck in CombatRadar.tsx) only ever tries this for the 'people'
 * deck after a real submitted portrait has already had first refusal.
 */
export function npcRoleGuessFor(name: string): { role: NpcRole; gender: 'male' | 'female' } | undefined {
  const clean = name.replace(/^(a|an|the)\s+/i, '').trim()
  const g = roleGuesses[clean]
  return g ? { role: g.role, gender: g.gender } : undefined
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

/**
 * The default picture for an NPC of this role and gender, or nothing if the
 * basket has nothing for that combination yet — never invents a role that
 * was not actually researched.
 */
export function npcDefaultFor(role: NpcRole, gender: 'male' | 'female', seed: string): NpcDefaultSource | undefined {
  const key = `${role}-${gender}`
  const variants = pool.get(key) ?? pool.get(`any-${gender}`)
  if (!variants || variants.length === 0) return undefined
  const file = pick(variants, seed)
  return { key, url: `${BASE}${slug(role)}-${slug(gender)}/${file}` }
}
