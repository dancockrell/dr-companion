/**
 * A real player's own submitted portrait, keyed by character name.
 *
 * Deliberately separate from creatureArt.ts even though the shape is
 * identical, because the two answer different questions and must never be
 * allowed to collide: creatureArt is "does the bestiary have art for this
 * noun", playerArt is "did this specific person submit their own picture".
 * A player named after a creature (or a creature sharing a player's name,
 * which DragonRealms does not prevent) must never accidentally borrow the
 * other's art — separate manifests, separate folders, separate lookup.
 *
 * The game's room stream supplies only a name. Race and sex therefore come
 * from the public, character-owned profile alongside the art manifest. That
 * profile gives every published character an honest race/sex default without
 * pretending those details were inferred from a name.
 */

const BASE = '/player-art/'
const REPOSITORY_BASE =
  'https://raw.githubusercontent.com/dancockrell/dr-companion/main/public/player-art/'
import { npcDefaultFor, type NpcRace, type NpcRole } from './npcDefaults'
import { genericPortraitFor, portraitUrl, slug as portraitSlug } from './portraits'

const slug = (s: string) =>
  s.toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

export function playerArtFile(name: string): string {
  return slug(name)
}

export function playerArtUrl(name: string): string {
  return `${BASE}${playerArtFile(name)}.webp`
}

const known = new Map<string, string | false>()
export interface PlayerArtProfile {
  race?: string
  sex?: 'male' | 'female'
  /** DragonRealms guild; this is the class dimension used to select a
   * role-appropriate default when the shared portrait pool covers it. */
  guild?: string
}

const profiles = new Map<string, PlayerArtProfile>()

export function registerPlayerArtManifest(names: Iterable<string>, base = BASE): void {
  for (const n of names) {
    const file = playerArtFile(n.replace(/\.webp$/i, ''))
    known.set(file, `${base}${file}.webp`)
  }
}

function registerProfiles(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  for (const [name, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue
    const item = value as { race?: unknown; sex?: unknown; guild?: unknown; class?: unknown }
    profiles.set(playerArtFile(name), {
      ...(typeof item.race === 'string' ? { race: item.race } : {}),
      ...(item.sex === 'male' || item.sex === 'female' ? { sex: item.sex } : {}),
      ...(typeof item.guild === 'string' ? { guild: item.guild } : typeof item.class === 'string' ? { guild: item.class } : {}),
    })
  }
}

async function loadSource(base: string): Promise<number> {
  const nonce = `?loaded=${Date.now()}`
  try {
    const res = await fetch(`${base}manifest.json${nonce}`, { cache: 'no-store' })
    if (!res.ok) return 0
    const body: unknown = await res.json()
    if (!Array.isArray(body)) return 0
    const clean = body.filter((k): k is string => typeof k === 'string')
    registerPlayerArtManifest(clean, base)
    try {
      const profileRes = await fetch(`${base}profiles.json${nonce}`, { cache: 'no-store' })
      if (profileRes.ok) registerProfiles(await profileRes.json())
    } catch {
      // A manifest without profile metadata is still useful custom art.
    }
    return clean.length
  } catch {
    return 0
  }
}

/**
 * Refresh character-owned art on every client start. GitHub is authoritative
 * so a merged player contribution reaches installed clients without waiting
 * for a new installer; the bundled folder remains the offline fallback.
 */
export async function loadPlayerArtManifest(): Promise<number> {
  const remote = await loadSource(REPOSITORY_BASE)
  const count = remote > 0 ? remote : await loadSource(BASE)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('dr-player-art-updated'))
  return count
}

export function notePlayerArtLoaded(name: string): void {
  known.set(playerArtFile(name), playerArtUrl(name))
}

export function notePlayerArtMissing(name: string): void {
  known.set(playerArtFile(name), false)
}

/** Test seam. Nothing in the app calls this. */
export function resetPlayerArtCache(): void {
  known.clear()
  profiles.clear()
}

export function playerProfileFor(name: string): PlayerArtProfile | undefined {
  return profiles.get(playerArtFile(name))
}

const GUILD_ROLE: Array<[RegExp, NpcRole]> = [
  [/barbarian|warrior mage/i, 'warrior'],
  [/paladin/i, 'knight'],
  [/cleric|empath/i, 'priest'],
  [/moon mage/i, 'mage'],
  [/ranger/i, 'ranger'],
  [/thief/i, 'thief'],
  [/bard/i, 'bard'],
  [/necromancer/i, 'necromancer'],
  [/trader/i, 'merchant'],
]

const asRace = (race?: string): NpcRace | undefined => {
  const clean = race?.toLowerCase().replace(/[^a-z]+/g, '-')?.replace(/^-|-$/g, '')
  const races: NpcRace[] = ['human', 'elf', 'dwarf', 'halfling', 'gnome', 'gor-tog', 's-kra-mur', 'prydaen', 'rakash', 'kaldar', 'elothean']
  return races.find((candidate) => candidate === clean)
}

/** Never returns a letter. Known race/sex/guild selects the closest shared
 * role portrait; race/sex alone selects the bundled racial portrait; truly
 * incomplete public metadata gets a stable diverse default until maintained. */
export function playerDefaultArtFor(name: string): PlayerArtSource {
  const profile = playerProfileFor(name)
  const sex = profile?.sex
  const race = asRace(profile?.race)
  const role = profile?.guild ? GUILD_ROLE.find(([pattern]) => pattern.test(profile.guild!))?.[1] : undefined
  const classDefault = role && race && sex ? npcDefaultFor(role, sex, name, race) : undefined
  if (classDefault) {
    return { name, url: classDefault.url, description: `${profile!.race} ${profile!.guild} ${sex} default` }
  }
  if (race && sex) {
    return { name, url: portraitUrl(`${portraitSlug(race)}-${sex}`), description: `${profile!.race} ${sex} default` }
  }
  return {
    name,
    url: portraitUrl(genericPortraitFor(name)),
    description: 'Generic default portrait — public race, guild, or gender profile is incomplete',
  }
}

export interface PlayerArtSource {
  name: string
  url: string
  description?: string
}

/** The picture to draw for this exact person, or nothing. See artFor's own doc comment. */
export function playerArtFor(name: string): PlayerArtSource | undefined {
  const url = known.get(playerArtFile(name))
  return typeof url === 'string' ? { name, url, description: 'Character-owned portrait' } : undefined
}
