/**
 * The big pass: every name gathered in zoluren-wishlist.json and
 * next-500-200.json turned into an actual Grok prompt, template-driven the
 * same way gen-grok-requests.mjs is — hand-typing ~1,600 blocks was never
 * going to happen honestly.
 *
 *   node data/art/gen-grok-mega.mjs
 *
 * Important distinction from the first 229-entry list: those were either
 * hand-researched (Elanthipedia infobox facts for ~30 named NPCs) or
 * hand-written one at a time (60 creatures). Everything here is inferred
 * from the NAME ONLY via keyword matching into a body-type bucket, then
 * assembled from the same shared phrase pools. That is an honest generic
 * archetype prompt, not a researched one — good enough to get real art for
 * a name the wiki only gave us a name for, but it is not claiming to know
 * what Elanthipedia says this creature or person actually looks like.
 *
 * Per Dan (29 Aug 2026): only the ladder creatures get 3 seed variations
 * each. NPCs and landmarks get one prompt each.
 */
import { readFileSync, writeFileSync } from "node:fs"

const wishlist = JSON.parse(readFileSync("data/art/zoluren-wishlist.json", "utf8"))
const extra = JSON.parse(readFileSync("data/art/next-500-200.json", "utf8"))

// ---------------------------------------------------------------------------
// Shared phrase pools (same shape as gen-grok-requests.mjs, kept separate
// so this file's rotation offsets don't collide with that one's).
// ---------------------------------------------------------------------------
const LIGHT = [
  "Lit by a single low warm light source just out of frame, throwing long soft shadows and catching the edge of every raised surface.",
  "Lit by cool overcast light with no hard shadows, the kind of even grey light that keeps colour true and detail readable everywhere at once.",
  "Lit from behind and slightly above, rimming the subject's edge in brightness while the front stays in soft shadow.",
  "Lit by flickering firelight from below and to one side, warm orange on the near side of every form and deep cool shadow on the far side.",
  "Lit by the flat blue-grey light of dusk, colour still holding at the horizon while everything at eye level has already gone to shadow.",
  "Lit by scattered light broken into dappled patches across the subject rather than one clean source.",
  "Lit by a pale, cold light with a faint blue cast, drawing out texture without warmth.",
  "Lit by a single close torch or lantern, small and warm against a much larger dark space, pooling tightly and fading fast at the edges.",
]
const CAMERA = [
  "Framed as a three-quarter view at a normal eye height, close enough to fill most of the frame while the setting stays legible.",
  "Framed from slightly below, a modest low angle that gives the subject presence without becoming a dramatic hero shot.",
  "Framed straight-on and centred, a plain, steady composition that reads clearly at a glance.",
  "Framed from a few steps back so the full subject and a meaningful slice of the environment both read clearly.",
  "Framed at a slight diagonal, so more than one side of the subject is visible at once.",
]
const PALETTE = [
  "The palette stays muted and naturalistic — earth tones, weathered greens and browns, with only a small accent of stronger colour so nothing competes for attention.",
  "The palette leans cool and desaturated, greys and blue-greens dominating, warmth reserved for the light source itself.",
  "The palette is warm but restrained — ochre, rust, aged browns — avoiding anything that reads as bright, saturated, or modern.",
  "The palette favours deep, slightly muddy background tones, letting the subject's own colour read as the clear focal point.",
]
const MOOD = [
  "The overall mood is quiet and unposed — a real moment, not a pose struck for a portrait.",
  "The overall mood carries a low, steady tension, as if something has just been noticed and not yet reacted to.",
  "The overall mood is weathered and unglamorous — worn, real, nothing crisp or freshly made.",
  "The overall mood is settled and confident rather than performative.",
]
const STYLE_CLOSE = [
  "Rendered as a hand-painted oil illustration in a loose, visible-brushstroke, 19th-century impressionist manner — broken colour, soft atmospheric edges, clearly painted rather than photographed. No photorealism, no photographic lighting, no lens flare. No text, no watermark, no signature, no logo, no border or frame. Nothing modern or contemporary anywhere in the frame. All figures, where present, fully and modestly clothed, nothing suggestive.",
  "Rendered as a painterly digital illustration with clearly visible brushwork and soft, broken colour rather than crisp photographic detail. Not a photograph, no camera lens effects, no glossy digital-render sheen. No text, no watermark, no signature, no logo, no border or frame. Nothing modern, contemporary, or anachronistic anywhere in the frame. All figures, where present, fully and modestly clothed.",
]
const pick = (pool, i, off) => pool[(i + off) % pool.length]
const closeOut = (i, off) =>
  [pick(LIGHT, i, off), pick(CAMERA, i, off + 3), pick(PALETTE, i, off + 5), pick(MOOD, i, off + 2), pick(STYLE_CLOSE, i, off + 1)].join(" ")

const requests = []
const seen = new Set()
function add(entry) {
  let id = entry.id
  let n = 2
  while (seen.has(id)) { id = entry.id + "-" + n; n++ }
  seen.add(id)
  requests.push({ ...entry, id })
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)

// ---------------------------------------------------------------------------
// Creature type buckets — inferred from the name, matched in this order
// (first match wins), each with several build/feature/pose/env phrasings so
// three variations of one creature and two different creatures in the same
// bucket don't read identically.
// ---------------------------------------------------------------------------
const BUCKETS = [
  { test: /zombie|skeleton|ghoul|ghost|spirit|wraith|banshee|revenant|tortured|phantom|corpse|undead|sluagh|wight|lich/i,
    build: ["grey, rotted flesh visible through torn wrappings", "bleached bone showing through cracked, papery skin", "a translucent, half-formed body that seems to drift rather than stand", "a hollow, shadow-dark form beneath tattered grave clothes"],
    feature: ["hollow eye sockets that still track movement", "a faint, cold light where the eyes should be", "clawed hands held loosely at its sides", "a jaw hanging slightly slack, as though speech is an old, half-remembered habit"],
    pose: ["lurching forward with one arm outstretched", "standing motionless until the last possible moment before moving", "crouched low, head cocked at an unnatural angle", "drifting a few inches above the ground"],
    env: ["a fog-choked graveyard at night, broken headstones leaning at odd angles", "a collapsed crypt chamber, a single shaft of light from a crack in the ceiling", "a ruined chamber open to a night sky, dust suspended in the stillness", "a narrow tomb passage, old funerary urns scattered across the floor"] },
  { test: /goblin|orc|ogre|troll|kobold|adan'f|xala'shar|dragon priest|madman|bandit|thug|cutthroat|ruffian|footpad|pirate|moneygrubber|tightwad|skinflint|pinchfist|marauder|fighter|warrior|mercenary|imp|brigand/i,
    build: ["a wiry, sinewy frame with old scars across bare arms", "a hulking, thick-muscled build under scavenged armor", "a stooped, weathered frame in patched leather", "a lean, watchful build dressed in dark practical clothing"],
    feature: ["a flat nose and uneven, jagged teeth bared in a snarl", "small deep-set eyes fixed with dull hostility", "a hood pulled low, only a sharp, knowing half-smile visible", "old war paint in bold streaks across the face"],
    pose: ["mid-charge, a notched weapon raised overhead", "crouched behind cover, watching the road below", "standing with arms crossed, weight settled evenly", "leaning against a doorframe half in shadow"],
    env: ["a muddy forest clearing littered with makeshift stakes", "a rocky outcrop above a winding trade road", "a smoke-hazed camp with a cookfire smoking in the background", "a narrow stone passage, old claw marks scored into the walls"] },
  { test: /wolf|jackal|hound|barghest/i,
    build: ["a lean, powerful frame with a raised ridge of fur along the back", "a heavy-shouldered build, breath steaming in the cold", "a rangy, half-starved frame with patchy fur"],
    feature: ["pale eyes catching the light", "ears pinned flat, lips curled back in a silent snarl", "hackles raised along the spine"],
    pose: ["standing atop a rise, head thrown back mid-howl", "crouched low, ready to spring", "loping across open ground, head lowered"],
    env: ["a snow-covered ridge at dusk, a pale moon rising", "a dense forest floor thick with fallen leaves", "a windswept hillside under a heavy grey sky"] },
  { test: /cat|cougar|bobcat|lynx|caracal|pard|panther/i,
    build: ["a lean, muscular frame built for a single fast strike", "a compact, powerful build with a low, coiled stance"],
    feature: ["a long tail curling low and steady", "ears pinned back, tail-tip flicking with tension"],
    pose: ["crouched flat on a rocky outcrop, eyes fixed on something below", "mid-stalk, one paw raised, utterly silent"],
    env: ["a sunlit rocky mountainside, a valley visible through the haze", "a shaded forest floor dappled with broken light"] },
  { test: /bear/i,
    build: ["a massive, shaggy-furred frame", "a heavy, powerful build with long curved claws visible on both forepaws"],
    feature: ["small, deep-set eyes", "a low, rumbling presence that fills the space"],
    pose: ["reared up on its hind legs, jaw open in a deep roar", "on all fours, head lowered, testing the air"],
    env: ["a torchlit cavern, old claw marks scored into the walls", "a snowy mountain clearing at dusk"] },
  { test: /snake|serpent|viper|adder|crocodile|caiman|lizard|basilisk|wyvern|drake|dragon(?!.priest)/i,
    build: ["a long, patterned body coiled tightly", "a thick, armored hide in dull mottled tones", "a sinuous, scaled form catching the light along every curve"],
    feature: ["a narrow, wedge-shaped head and vertical-slit eyes", "only the eyes and ridged back breaking the water's surface", "wings folded tight against a long, scaled back"],
    pose: ["coiled and raised in a warning strike posture", "floating motionless just beneath the surface", "perched on a rocky outcrop, wings half-spread"],
    env: ["a dry, rocky hillside under harsh midday light", "a slow, murky river beneath overhanging branches", "a jagged cliff face with storm clouds gathering"] },
  { test: /spider|wasp|ant|scorpion|beetle|moth|dyrachis|centipede/i,
    build: ["a segmented, glistening body in mottled dark chitin", "a bristled, many-legged form the size of a large dog", "an armored, plated body with a curved tail arched high"],
    feature: ["a cluster of small gleaming eyes", "mandibles held open and ready", "wings blurring with constant motion"],
    pose: ["poised at the centre of a heavy web strung between two trees", "braced low, pincers spread wide, sand kicked up around its legs", "emerging from a tunnel mouth, antennae twitching"],
    env: ["a shadowed patch of old-growth forest, thick webbing between gnarled trunks", "a sun-baked desert flat, heat shimmer on the horizon", "a damp cavern floor littered with loose rubble"] },
  { test: /gryphon|harpy|vulture|hawk|eagle|gull|geese|crow|raven(?!.npc)/i,
    build: ["ragged dark feathers over a lean, muscular frame", "a wide wingspan easily twice a person's height", "a bald, ridged head streaked with old scars"],
    feature: ["taloned hands gripping the rock tightly", "a hooked, golden beak", "wild, tangled feathers at odds with a watchful gaze"],
    pose: ["perched on a jagged cliff edge, wings half-spread for balance", "banking sharply in flight, talons drawn up beneath a powerful chest", "mid-shriek, mouth open, body arched back"],
    env: ["a windswept mountain cliff face, storm clouds on the horizon", "high above a mountain ridge, scattered clouds below", "a rocky arid hillside strewn with old bones"] },
  { test: /shark|crab|fish|eel|piranha|boa|squid|kelpie|caiman/i,
    build: ["a sleek, powerful body cutting just beneath the surface", "a thick, armored shell with two oversized claws"],
    feature: ["a dorsal fin breaking the water in a slow arc", "small stalked eyes tracking movement"],
    pose: ["circling just beneath the surface, a shadow in clearer water", "braced sideways in a defensive stance, claws raised"],
    env: ["open grey water under a low sky", "a rocky tidepool shoreline, low waves breaking against dark rock"] },
  { test: /sprite|nyad|dryad|elemental|wisp|angiswaerd|prereni|leucro|atik'et|westanuryn|shylvic|kra'hei|hele'la|arzumos|germish/i,
    build: ["a shifting, half-translucent form that seems to hold light rather than reflect it", "a bark-and-leaf body merging seamlessly with the forest around it", "a lean, scaled beast unlike anything native to ordinary woodland"],
    feature: ["eyes that seem to hold a colour no ordinary creature's do", "vines and small growth woven through where hair would be", "a faint shimmer along the edge of its form"],
    pose: ["drifting a few feet above the ground, trailing a faint light", "half-emerged from a tree trunk, one arm still fused to the bark", "coiled and watchful at the edge of a clearing"],
    env: ["a misty clearing at dusk, motes of light drifting nearby", "the base of an ancient tree, roots rising like low walls", "a shaded forest pool fed by a small waterfall"] },
  { test: /vine|tress|creeper/i,
    build: ["a coiling mass of thorned, leafy vine given sudden, deliberate motion", "a slender, root-like form woven through with small pale flowers"],
    feature: ["thorns catching what little light reaches the forest floor"],
    pose: ["coiled and tensed along a fallen log", "rising slowly from a bed of undergrowth"],
    env: ["a shaded, overgrown thicket", "a damp forest floor thick with moss"] },
  { test: /golem|gargoyle|giant\b|colossus|animated/i,
    build: ["a towering, powerfully built frame easily twice the height of a person", "rough stone and packed soil for a body, small stones trickling from its shoulders", "granite-grey hide cracking at the joints as it moves"],
    feature: ["a low, sloped brow over small deep-set eyes", "wings unfolding from what looked like solid rock a moment before"],
    pose: ["standing with both fists lowered, dust still settling around it", "perched on a ledge, one clawed hand still pressed against the stone"],
    env: ["a rocky hillside clearing with a fresh crater of disturbed earth", "a rain-streaked stone facade at night, other still statues along the roofline"] },
  { test: /hog|boar|pig/i,
    build: ["a heavyset frame with bristling dark fur along a raised ridge on its back", "a lean, mud-streaked frame with two curved yellowed tusks"],
    feature: ["small red eyes fixed forward", "tusks catching the light as it turns"],
    pose: ["mid-charge, head lowered and tusks forward", "rooting through churned earth, unconcerned"],
    env: ["a churned, muddy forest floor between dense tree trunks", "a tilled field at the edge of a cleared yard"] },
  { test: /deer|ram|antelope|bison/i,
    build: ["a lean, long-legged frame built for speed", "a heavy-shouldered frame with a thick, shaggy coat"],
    feature: ["large dark eyes, ears swivelled forward", "a set of curved horns catching the light"],
    pose: ["frozen mid-step, alert to the faintest sound", "grazing at the edge of a clearing, head low"],
    env: ["a sunlit forest clearing scattered with fallen leaves", "an open grassy plain under a wide sky"] },
  { test: /rat\b|gerbil|squirrel|badger|mole|fox/i,
    build: ["a small, quick frame with matted, patchy fur", "a low-slung body with a striped coat"],
    feature: ["prominent yellowed incisors", "sharp, watchful eyes"],
    pose: ["crouched low, back arched, mid-hiss", "skulking low along a wall, nose twitching"],
    env: ["a damp stone tunnel, a dim shaft of light from a grate above", "a refuse-choked alley between leaning buildings"] },
  { test: /.*/,
    build: ["a strange, unfamiliar build unlike any ordinary animal", "a lean, alert frame suited to whatever terrain it favours", "a heavier, powerful build built for a direct confrontation"],
    feature: ["features that mark it clearly as something out of the ordinary world", "an unsettling, watchful stillness"],
    pose: ["standing alert, focused on something just out of frame", "caught mid-motion, weight shifting toward the viewer"],
    env: ["a shadowed natural setting suited to a creature nobody civilised keeps close by", "an untouched wilderness clearing, quiet and watchful"] },
]

function bucketFor(name) {
  for (const b of BUCKETS) if (b.test.test(name)) return b
  return BUCKETS[BUCKETS.length - 1]
}

function creaturePrompt(name, variation, globalIndex) {
  const b = bucketFor(name)
  const displayName = name.replace(/\s*\(\d+\)\s*$/, "").trim()
  const build = pick(b.build, variation, 0)
  const feature = pick(b.feature, variation, 1)
  const pose = pick(b.pose, variation, 2)
  const env = pick(b.env, variation, 0)
  return `A full-body illustration of a creature known in the field as "${displayName}" — ${build}, ${feature}. It is ${pose}. The setting is ${env}. ` + closeOut(globalIndex, variation * 3)
}

// ---------------------------------------------------------------------------
// Creatures: every ladder name gathered, 3 variations each.
// ---------------------------------------------------------------------------
const allCreatureNames = new Set([
  ...wishlist.creatures.zoluren_ladder,
  ...wishlist.creatures.master_ladder_extra,
  ...(extra.creatures_from_living_and_undead_ladders?.living ?? []),
  ...(extra.creatures_from_living_and_undead_ladders?.undead ?? []),
])
let ci = 0
for (const name of allCreatureNames) {
  const base = "mob2-" + slug(name)
  for (let v = 0; v < 3; v++) {
    add({ id: base + "-v" + (v + 1), category: "creature", dest: "creatures", target: name.toLowerCase(),
      prompt: creaturePrompt(name, v, ci) })
    ci++
  }
}

// ---------------------------------------------------------------------------
// NPCs: every shopkeeper name gathered, one prompt each — race/trade/scene
// cycled for variety rather than researched (see file header).
// ---------------------------------------------------------------------------
const RACE_LOOK = [
  "a human, with features that vary naturally rather than following one template",
  "an elf, slender and fine-boned, with noticeably pointed ears",
  "a dwarf, short and powerfully stocky, with a full heavy beard",
  "a halfling, small in stature but with an adult's weathered face",
  "a gnome, small and slight, with sharply angular features",
  "a Gor'Tog, exceptionally tall and heavily built, dark green skin",
  "an S'Kra Mur, fine reptilian scales, a lizard-like snout and tail",
  "a Prydaen, a feline face covered in short fur, upright cat-like ears",
  "a Rakash, human in build but with distinctly fox-like ears",
  "a Kaldar, human in stature with a sharp, aquiline profile",
  "an Elothean, unnaturally tall and slender, pale skin, faintly luminous eyes",
]
const TRADE_FLAVOR = [
  ["a general goods trader", "standing behind a counter stacked with ordinary wares", "a modest shopfront lined with open shelves"],
  ["a smith or armorer", "standing at a workbench, tools laid out in front", "a work floor hung with half-finished metalwork"],
  ["a tailor or leatherworker", "seated at a cluttered worktable mid-stitch", "a shop hung with bolts of cloth and cut leather"],
  ["a healer or herbalist", "standing among shelves of labelled jars and bundled herbs", "a small apothecary lined with drying plants"],
  ["an innkeeper or tavernkeeper", "standing behind a worn wooden bar", "a warmly lit taproom, barrels and mugs nearby"],
  ["a jeweler or gem trader", "seated at a counter arranging a tray of fine settings", "a shop with glass display cases catching the light"],
  ["a scribe or bookseller", "standing beside shelves crowded with old volumes", "a cramped study lined floor to ceiling with books"],
  ["a cook or baker", "standing beside a hearth, flour dusting the apron", "a busy kitchen with hanging pots and fresh loaves"],
  ["a locksmith or tinker", "standing behind a counter hung with sample locks and tools", "a workbench cluttered with small mechanisms"],
  ["a farmer or provisioner", "standing beside baskets of fresh produce", "a shopfront with crates and sacks of goods"],
]
let ni = 0
const allNpcNames = [...(extra.npcs_likely_to_encounter?.names ?? []), ...(extra.npcs_deferred_lower_priority?.names ?? [])]
for (const name of allNpcNames) {
  const race = pick(RACE_LOOK, ni, 0)
  const [trade, pose, env] = TRADE_FLAVOR[ni % TRADE_FLAVOR.length]
  const gender = ni % 2 === 0 ? "man" : "woman"
  const displayName = name.replace(/\s*\(.*?\)\s*/g, "").trim()
  add({ id: "npc2-" + slug(name), category: "npc-guildleader", dest: "npcs",
    prompt: `A full-body portrait of ${displayName}, ${race}, a ${gender} working as ${trade}. They are ${pose}. The setting is ${env}. ` + closeOut(ni, 4) })
  ni++
}

// ---------------------------------------------------------------------------
// Landmarks: architecture inferred from the name, one prompt each.
// ---------------------------------------------------------------------------
const PLACE_BUCKETS = [
  { test: /keep|fortress|citadel/i, subject: "a weathered stone fortress", detail: "high crenellated walls and a heavy gatehouse", pov: "an exterior view from the approach road" },
  { test: /manor|estate|mansion|chateau|residence/i, subject: "a grand old manor house", detail: "tall mullioned windows and ivy climbing the stonework", pov: "an exterior view across a formal, slightly overgrown lawn" },
  { test: /temple|chapel|sanctorum|monastery|shrine/i, subject: "a solemn stone temple interior", detail: "tall narrow windows and a modest altar at the far end", pov: "an interior view down the central aisle" },
  { test: /bridge/i, subject: "an old stone bridge", detail: "worn paving stones and a low balustrade", pov: "a view along the span toward the far bank" },
  { test: /tower|spire|obelisk/i, subject: "a tall stone tower", detail: "narrow window slits climbing toward a peaked roof", pov: "a low-angle exterior view looking up its full height" },
  { test: /academy|university|library|hall of|hall\b/i, subject: "a grand hall lined with shelves and long tables", detail: "high vaulted ceilings and tall arched windows", pov: "an interior view down the length of the room" },
  { test: /prison|cell/i, subject: "a grim stone prison block", detail: "iron-barred doors along a narrow corridor", pov: "an interior view down a dim, echoing corridor" },
  { test: /garden|grove|oak|park/i, subject: "a quiet formal garden", detail: "trimmed hedges and a stone path winding between beds", pov: "a wide view across the grounds" },
  { test: /bazaar|market/i, subject: "a busy open-air market street", detail: "awninged stalls crowded close together", pov: "a street-level view down the row of stalls" },
  { test: /cemetery|necropolis|tomb|crypt/i, subject: "a quiet stone cemetery", detail: "rows of weathered headstones and old iron fencing", pov: "a wide view across the grounds at dusk" },
  { test: /gate\b/i, subject: "a heavy stone town gate", detail: "an arched passage flanked by guard towers", pov: "an exterior view from just outside the wall" },
  { test: /.*/, subject: "a substantial stone building", detail: "the kind of solid, lived-in architecture a real town accumulates over centuries", pov: "an exterior street-level view" },
]
function placeBucketFor(name) {
  for (const b of PLACE_BUCKETS) if (b.test.test(name)) return b
  return PLACE_BUCKETS[PLACE_BUCKETS.length - 1]
}
let li = 0
for (const name of extra.landmarks_not_yet_covered?.names ?? []) {
  const b = placeBucketFor(name)
  const displayName = name.replace(/\s*\(.*?\)\s*/g, "").trim()
  add({ id: "place2-" + slug(name), category: "landmark", dest: "grok-art",
    prompt: `${b.pov[0].toUpperCase()}${b.pov.slice(1)} of a location known as "${displayName}" — ${b.subject}, ${b.detail}. No people in frame; this is an establishing shot of the place itself. ` + closeOut(li, 6) })
  li++
}

const words = requests.reduce((s, r) => s + r.prompt.split(/\s+/).length, 0)
console.log(requests.length + " total requests, average " + Math.round(words / requests.length) + " words")
const byCat = {}
for (const r of requests) byCat[r.category] = (byCat[r.category] || 0) + 1
console.log(byCat)

writeFileSync("data/art/grok-requests-mega.json", JSON.stringify({
  instructions: "Same workflow as grok-requests.json: save each result as <id>.png/.jpg/.webp in data/art/grok-in/, run node tools/import-grok-art.mjs. Every entry here was inferred from a name only (see file header of gen-grok-mega.mjs) rather than individually researched, so these are honest generic archetypes, not wiki-sourced portraits. Creature entries carry a 'target' field naming the real creature name they're meant to represent, for matching against the local bestiary/creature-prompts.json later.",
  requests,
}, null, 1))
