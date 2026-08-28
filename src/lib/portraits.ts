/**
 * Portraits: what exists, what a character picked, and what we would suggest.
 *
 * Three ways a slot gets filled, in order of preference:
 *
 *   1. The player chose one, or uploaded their own. Always wins.
 *   2. We suggest from the character's LOOK, which knows their race and sex
 *      and often their hair, eyes, skin and build.
 *   3. Race and sex alone, which is the floor and still better than a grey
 *      rectangle.
 *
 * The generated set is one portrait per race per sex. That is a starting
 * point, not a likeness: nobody's character is the default Elf. The point is
 * that a new character meets a face rather than an empty box, and can replace
 * it in one click.
 */
import { suggestPortraits, type PortraitMeta } from './lookMatch'
import { readJSON, writeJSON } from './storage'

const KEY = 'drc.portrait.v1'

/** Filenames are slugged the same way the renderer writes them. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

let installed: string[] = []

/**
 * What is on disk. Fetched once, and absent is normal rather than an error:
 * the pack is generated over many hours and an empty manifest simply means
 * the placeholder is still the right answer.
 */
export async function loadPortraitManifest(): Promise<void> {
  try {
    const res = await fetch('/portraits/manifest.json')
    if (!res.ok) return
    installed = (await res.json()) as string[]
  } catch {
    // No pack installed. Silence is correct.
  }
}

/** Every portrait we actually have, described well enough to rank. */
export function catalogue(): PortraitMeta[] {
  return installed
    .map((file) => {
      // "elothean-female.webp" -> race, sex
      const stem = file.replace(/\.webp$/i, '')
      const sex = stem.endsWith('-female') ? 'female' : stem.endsWith('-male') ? 'male' : null
      if (!sex) return null
      const race = stem.slice(0, stem.lastIndexOf('-')).replace(/-/g, ' ')
      return { key: stem, race, sex } as PortraitMeta
    })
    .filter((x): x is PortraitMeta => x !== null)
}

export const portraitUrl = (key: string) => `/portraits/${key}.webp`

/** What this character chose, if anything. Keyed by name so alts differ. */
export function chosenFor(character: string): string | null {
  const all = readJSON<Record<string, string>>(KEY, {})
  return all[character] ?? null
}

export function choose(character: string, key: string): void {
  const all = readJSON<Record<string, string>>(KEY, {})
  all[character] = key
  writeJSON(KEY, all)
}

/**
 * The portrait to show right now.
 *
 * A chosen one wins outright. Otherwise the LOOK is read, and failing that
 * race and sex alone. Returns null when nothing is installed, which the
 * placeholder handles.
 */
export function portraitFor(opts: {
  character: string
  look?: string
  race?: string
  sex?: 'male' | 'female'
}): string | null {
  const chosen = chosenFor(opts.character)
  if (chosen) return chosen

  const all = catalogue()
  if (!all.length) return null

  if (opts.look) {
    const best = suggestPortraits(opts.look, all, 1)[0]
    if (best) return best.portrait.key
  }

  if (opts.race) {
    // Compared on letters alone. The filename slug drops apostrophes, so
    // Gor'Tog is stored as gor-tog and read back as "gor tog", which never
    // equals the race name the game reports. Four of the eleven races carry
    // an apostrophe, so this silently lost more than a third of them.
    const plain = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '')
    const want = plain(opts.race)
    const match =
      all.find((p) => plain(p.race) === want && (!opts.sex || p.sex === opts.sex)) ??
      all.find((p) => plain(p.race) === want)
    if (match) return match.key
  }

  return null
}
