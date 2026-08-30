/**
 * Where a creature's picture lives, and whether there is one yet.
 *
 * The art pack (DESIGN.md S4) is generated centrally and arrives as a folder
 * of WebP files, so for most of this app's life the honest answer here is
 * "not yet". That answer has to be free: cards redraw on every room update,
 * which in a fight is several times a second, and a lookup that touched the
 * disk or the network would turn a missing picture into a stutter. One
 * manifest is fetched at startup and everything after that is a map read.
 *
 * The key precedence is copied from bestiary.ts rather than invented, and must
 * stay copied. The pack is generated from the same wiki entries the lore comes
 * from, so a card that resolved its text off `rock troll` and its picture off
 * `troll` would be showing one creature's traits beside another's portrait.
 */

/** Served from the app root; the pack unpacks into it. */
const BASE = '/creatures/'

const normalise = (s: string) =>
  s.toLowerCase().replace(/^(a|an|the|some)\s+/, '').replace(/[^a-z\s'-]/g, '').trim()

/**
 * The keys to try, in order, exactly as loreFor tries them.
 *
 * The middle one exists because the game writes a corpse as `a kobold which
 * appears dead` and no wiki entry, and therefore no image, is ever named that.
 */
export function artKeys(name: string, noun: string): string[] {
  const exact = normalise(name)
  const trimmed = exact.replace(/\s+which appears dead$/, '')
  return [...new Set([exact, trimmed, noun])].filter(Boolean)
}

/**
 * The filename a key is stored under.
 *
 * Copied from the slug in tools/art-run.mjs, which is what actually names the
 * rendered files. Two spellings of the same rule is a bug waiting to happen,
 * but the alternative is the runtime importing a build tool, so the rule is
 * duplicated here and both copies are asserted by tools/creature-art-test.mjs.
 *
 * Slugged rather than percent-encoded because these become real files on a
 * player's disk, and a folder of names with spaces and apostrophes in them is
 * a support ticket on Windows.
 */
export function artFile(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

export function artUrl(key: string): string {
  return `${BASE}${artFile(key)}.webp`
}

/** Keyed by filename, so a manifest may list either keys or the files. */
const known = new Map<string, boolean>()

/**
 * Declare the pack's contents, once, when it is installed.
 *
 * The card asks the manifest rather than asking the image, which is the whole
 * reason the manifest exists. Letting a card render an `<img>` and find out
 * from the 404 works, but it means a room of eight unpictured creatures fires
 * eight failing requests every time the room changes, each one a console error
 * and a frame of empty box before the placeholder appears. One list, fetched
 * once, replaces all of that with a map lookup.
 *
 * Entries may be creature names or the filenames themselves; both are put
 * through the same slug, so the pack can list whichever it has to hand.
 */
export function registerArtManifest(keys: Iterable<string>): void {
  for (const key of keys) known.set(artFile(key.replace(/\.webp$/i, '')), true)
}

/**
 * Fetch the installed pack's manifest. Called once per window at startup.
 *
 * Absent is the expected answer until the pack ships, so a failure here is not
 * an error and is not reported as one. It just means every card draws its
 * silhouette instead, which is a state the cards are built for.
 */
export async function loadArtManifest(url = `${BASE}manifest.json`): Promise<number> {
  try {
    const res = await fetch(url)
    if (!res.ok) return 0
    const body: unknown = await res.json()
    const keys = Array.isArray(body) ? body : (body as { creatures?: unknown }).creatures
    if (!Array.isArray(keys)) return 0
    const clean = keys.filter((k): k is string => typeof k === 'string')
    registerArtManifest(clean)
    return clean.length
  } catch {
    return 0
  }
}

/**
 * The wiki disambiguates same-named creatures as "Rock troll (1)", "Rock
 * troll (2)"; bestiary-index.mjs collapses those to one lore entry keyed on
 * the bare name (loreFor has no way to tell which variant the game meant),
 * but the art pack still renders one file per wiki page, so it ships as
 * rock-troll-1.webp / rock-troll-2.webp with no bare rock-troll.webp at all.
 * A lookup that only ever tries the bare slug finds nothing for every one of
 * these — confirmed against the manifest: over a hundred installed files
 * across ~45 creature names, all unreachable — so real art already on disk
 * was rendering as a silhouette. Trying "-1" through "-6" after the bare
 * slug fails is what actually reaches them. Always the same variant for a
 * given name (not randomised per encounter): artFor has no per-instance
 * seed to vary on without a wider API change, and a stable wrong-ish pick
 * beats a coin-flip that makes two renders of the same fight look different
 * for no reason.
 */
const MAX_VARIANT_SUFFIX = 6

/** The actual manifest-known filename a key currently resolves to — bare
 * slug first, then its numbered variants — or undefined if none are known
 * good. Kept separate from `key` (which stays the semantic name callers and
 * tests reason about) so a decode failure can blacklist the one file that
 * actually failed rather than a name nothing was ever filed under. */
function resolvedFile(key: string): string | undefined {
  const bare = artFile(key)
  if (known.get(bare) === true) return bare
  for (let n = 1; n <= MAX_VARIANT_SUFFIX; n++) {
    const variant = `${bare}-${n}`
    if (known.get(variant) === true) return variant
  }
  return undefined
}

/**
 * Record what a load attempt proved, so no key is ever tried twice.
 *
 * Resolves to whichever file this key currently points at (bare or a
 * numbered variant) before recording, so a broken rock-troll-1.webp marks
 * *that* file missing and the next lookup moves on to rock-troll-2.webp
 * rather than retrying the same file forever or wrongly blacklisting a bare
 * slug nothing was ever filed under.
 */
export function noteArtLoaded(key: string): void {
  known.set(resolvedFile(key) ?? artFile(key), true)
}

export function noteArtMissing(key: string): void {
  known.set(resolvedFile(key) ?? artFile(key), false)
}

/** Test seam. Nothing in the app calls this. */
export function resetArtCache(): void {
  known.clear()
}

export interface CreatureArtSource {
  key: string
  url: string
}

/**
 * The picture to draw for this creature, or nothing.
 *
 * Nothing is the answer until the pack is installed, and that is the point:
 * the card never guesses at a URL, so it never renders an image that will
 * fail. A manifest can still name a file that will not decode, which is what
 * noteArtMissing is for.
 */
export function artFor(name: string, noun: string): CreatureArtSource | undefined {
  for (const key of artKeys(name, noun)) {
    const file = resolvedFile(key)
    if (file) return { key, url: `${BASE}${file}.webp` }
  }
  return undefined
}

/** True only when a file is known to exist, never when one merely might. */
export function hasArt(name: string, noun: string): boolean {
  return artKeys(name, noun).some((key) => resolvedFile(key) !== undefined)
}
