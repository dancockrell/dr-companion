/**
 * 2D art is gone. Anything that still reaches for it fails here, loudly.
 *
 * # Why this throws instead of degrading
 *
 * > "I would rather throw an error than keep 2d because throwing errors gets
 * > fixed while janky solutions are hard to find." — Dan, 3 Sep 2026
 *
 * The tempting alternative — a grey placeholder sprite, a `null` return, a
 * silent `catch` — produces a client that *works*. It just quietly shows
 * nothing where a creature should be, and nobody finds out until a player
 * mentions it six months later, if ever. A thrown error with a call site in
 * the stack is a work item somebody closes this week.
 *
 * This is the same rule the domain model already enforces from two other
 * directions, and it is worth stating once in a place people will read:
 *
 * **Absent and loud beats present and wrong.**
 *
 * It is why `Sourced<T>` carries an epoch and a stale read yields nothing
 * rather than an old value. It is why the stale-link watch was a bug worth
 * fixing rather than tolerating. It is why an adapter that does not declare a
 * capability is *unavailable* rather than defaulted to something sensible.
 * Never serve something plausible in place of something true.
 *
 * # This file is scaffolding, and is supposed to disappear
 *
 * Every call site below is something the rewrite owes. When the last one is
 * gone, delete this file. `tools/removed-2d-test.mjs` enumerates the sites and
 * prints them as a to-do list, so the count is visible rather than something
 * that has to be remembered.
 */

/** What the rewrite owes at this call site. Shown in the error. */
export interface Removed2DSite {
  /** Where this is, in words a person can grep for. */
  site: string
  /** What should exist here instead. */
  owes: string
}

function message({ site, owes }: Removed2DSite): string {
  return (
    `2D ART REMOVED — ${site}\n` +
    `  This path still expects raster art that no longer exists.\n` +
    `  What the rewrite owes here: ${owes}\n` +
    `  See docs/INTERFACE-KNOWLEDGE.md and docs/AUDIO-PLAN.md for the rebuild.\n` +
    `  This is deliberate. Do not restore the art; build the replacement.`
  )
}

/**
 * Fail at a non-rendering call site.
 *
 * Never returns. The `never` return type is load-bearing: it lets a caller
 * write `const x = removed2D(...)` in a position that needs a value, so a
 * consumer can be marked broken without inventing a fake value to satisfy the
 * type checker — which is precisely the "janky solution" being designed out.
 */
export function removed2D(site: Removed2DSite): never {
  throw new Error(message(site))
}

/**
 * Build a render-site failure with its message baked in.
 *
 * Accepts and ignores whatever props the old component took, so a call site is
 * marked broken by changing one import line rather than by editing JSX that is
 * about to be deleted anyway. The props are ignored, not defaulted — nothing
 * here tries to be useful.
 *
 * Throws during render. React surfaces it through the nearest error boundary
 * (`PanelBoundary` already exists), so the failure is contained to the panel
 * that asked for art rather than blanking the client — visibly broken, saying
 * why, while the rest of the app stays usable enough to fix it in.
 */
function removedComponent(site: string, owes: string) {
  return function RemovedComponent(_props: Record<string, unknown>): never {
    throw new Error(message({ site, owes }))
  }
}

/* ------------------------------------------------------------------------ */
/* The list of what the rewrite owes. Each entry is one live call site.      */
/* Delete an entry when its replacement lands. Delete the file at zero.      */
/* ------------------------------------------------------------------------ */

/** `CreatureCard` — the picture on a room/combat creature card. */
export const CreatureArt = removedComponent(
  'CreatureCard → creature portrait',
  'a 3D creature representation, or a card design that is honestly text-only. ' +
    'See docs/INTERFACE-KNOWLEDGE.md §6 for what the card must show and in ' +
    'what order — that ranking survives the art going away.'
)

/** `RoomScene` — the backdrop behind the room column. */
export const RoomBackdrop = removedComponent(
  'RoomScene → room backdrop',
  'the Godot 3D world view, which is what replaced this. Until a world is ' +
    'present the room column should render text only — per the shipping ' +
    'thesis, no 3D world is the normal case, not the error case.'
)

/** `DashboardLayout` — the player portrait in the dashboard header. */
export const Portrait = removedComponent(
  'DashboardLayout → player portrait',
  'either a 3D character view or no portrait at all. A player has no ' +
    'knowable race/gender to default from, which is why this was always the ' +
    'weakest of the art systems.'
)

/** `CombatRadar` — player markers on the radar. */
export const PlayerArt = removedComponent(
  'CombatRadar → player marker art',
  'a vector/iconographic marker. INTERFACE-KNOWLEDGE.md §2 applies: encode ' +
    'identity in shape and position, not in a bitmap.'
)

/* --- non-render call sites: same rule, function form ---------------------- */

/*
 * These are typed `any`, deliberately, and it is the one place in this file
 * that looks like a compromise.
 *
 * `removed2D()` is correctly typed `never` — it does not return. But a call
 * site that destructures the old result (`const { race, sex } = playerProfileFor(x)`)
 * will not typecheck against `never`, and the goal here is a *runtime* throw
 * at a live path, not a compile error that stops the whole client building.
 * A compile error blocks the rewrite; a runtime throw drives it.
 *
 * `any` buys exactly that: every consumer still compiles, and the first one
 * that actually runs explodes with a message naming itself. When the call site
 * is rewritten, its entry here is deleted and the `any` goes with it.
 */


/** `CombatRadar` — resolving a player's marker image. */
export const playerArtFor = (..._a: unknown[]): any =>
  removed2D({
    site: 'CombatRadar → playerArtFor()',
    owes: 'a vector marker resolved from player identity, not a bitmap lookup.',
  })

/** `CombatRadar` — the race/gender default when a player has no own art. */
export const playerDefaultArtFor = (..._a: unknown[]): any =>
  removed2D({
    site: 'CombatRadar → playerDefaultArtFor()',
    owes:
      'nothing, probably. This defaulted a real player to a guessed race and ' +
      'gender — inventing an attribute the game never stated, which is the ' +
      'exact "plausible instead of true" this project now refuses.',
  })

/** `CombatRadar` — a player's stored art profile. */
export const playerProfileFor = (..._a: unknown[]): any =>
  removed2D({
    site: 'CombatRadar → playerProfileFor()',
    owes: 'a player-identity record with no art in it, if one is still wanted.',
  })

/** `CombatRadar` — recording a missing image so it is not re-requested. */
export const notePlayerArtMissing = (..._a: unknown[]): any =>
  removed2D({
    site: 'CombatRadar → notePlayerArtMissing()',
    owes: 'nothing. Bookkeeping for an art cache that no longer exists.',
  })

/** `roomText` — a curated Grok room scene for a zone/room. */
export const grokRoomScene = (..._a: unknown[]): any =>
  removed2D({
    site: 'roomText → grokRoomScene()',
    owes:
      'nothing here. Room imagery is the Godot world now, and the text column ' +
      'should render text alone when no world is loaded.',
  })

/** `roomText` — the procedural room-scene fingerprint. */
export const roomScenePattern = (..._a: unknown[]): any =>
  removed2D({
    site: 'roomText → roomScenePattern()',
    owes:
      'nothing here. The fingerprint existed so 17,750 unrendered rooms did ' +
      'not look broken while art was generated. There is no art queue now.',
  })

/** `MapCanvas` — decorative stamps layered on the map. */
export const MapStampLayer = removedComponent(
  'MapCanvas → decorative map stamps',
  'nothing, most likely. These were decoration on a map whose real value is ' +
    'the 17,750-room topology. Confirm the decision, then delete the call site.'
)
