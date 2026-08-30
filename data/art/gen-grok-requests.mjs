/**
 * Builds data/art/grok-requests.json at scale from small curated tables —
 * the same reason art-npcs.mjs builds 4,950 local prompts from a handful of
 * race/role arrays rather than 4,950 hand-typed blocks.
 *
 *   node data/art/gen-grok-requests.mjs
 *
 * Every prompt is written fresh for this file — none of it draws on
 * Elanthipedia lore text or any other source. Each one runs to roughly 300
 * words on purpose (Dan, 29 Aug 2026: short prompts "would have gotten
 * junk") and says explicitly, in full sentences, what the pose is, what the
 * materials and their wear look like, where the light is coming from, how
 * the shot is framed, what the palette leans toward, and what to avoid —
 * not a comma-separated tag list standing in for those decisions. The
 * shared closing blocks (light/camera/palette/mood/style) are pools of
 * several distinct phrasings rotated by index rather than one fixed
 * paragraph repeated 200 times, so two neighbouring requests do not read as
 * the same request with the noun swapped.
 *
 * Double-quoted strings throughout, deliberately — the first version of
 * this file used single quotes around prose full of ordinary English
 * apostrophes (frame's edge, world's), which is exactly what a single-quote
 * delimiter cannot survive without escaping every one of them by hand. That
 * version could not even be parsed to fix automatically, because once the
 * quoting is wrong there is no way to tell "this apostrophe ends the
 * string" from "this apostrophe is part of the word" — the source is
 * genuinely ambiguous, not just broken. Double quotes sidestep the whole
 * problem: nothing written here contains a literal double-quote character.
 */
import { writeFileSync } from "node:fs"

// ---------------------------------------------------------------------------
// Shared phrase pools. Picked deterministically per entry (by index) so a
// re-run is reproducible, and offset differently per pool so two categories
// never land on the same combination at the same index.
// ---------------------------------------------------------------------------
const LIGHT = [
  "Lit by a single low warm light source just out of frame, throwing long soft shadows across the scene and catching the edge of every raised surface.",
  "Lit by cool overcast daylight with no hard shadows, the kind of even grey light that keeps colour true and detail readable everywhere at once.",
  "Lit from behind and slightly above by a shaft of light breaking through cloud or canopy, rimming the subject's edge in brightness while the front stays in soft shadow.",
  "Lit by flickering firelight from below and to one side, warm orange on the near side of every form and deep cool shadow on the far side.",
  "Lit by the flat blue-grey light of dusk, the sky still holding colour at the horizon while everything at eye level has already gone to shadow.",
  "Lit by scattered daylight filtering through leaves or lattice, breaking the light into dappled patches across the subject rather than one clean source.",
  "Lit by a pale, cold light with a faint blue cast, as if from an overcast sky reflected off stone or water, drawing out texture without warmth.",
  "Lit by a single close torch or lantern, small and warm against a much larger dark space, so the light pools tightly around the subject and fades fast at the edges.",
]

const CAMERA = [
  "Framed as a three-quarter view from a normal standing eye height, close enough that the subject fills most of the frame but the setting around them is still legible.",
  "Framed from slightly below, a modest low angle that gives the subject presence and weight without becoming a dramatic hero shot.",
  "Framed straight-on and centred, a plain, steady composition that reads clearly at a glance and does not rely on an unusual angle to be interesting.",
  "Framed from a few steps back so the full figure and a meaningful slice of the environment both read clearly, neither cropped tight nor lost in the background.",
  "Framed at a slight diagonal, the subject turned partway from the camera so both a side profile and a three-quarter face are visible at once.",
]

const PALETTE = [
  "The palette stays muted and naturalistic throughout — earth tones, weathered greens and browns, with only one or two small accents of stronger colour so nothing competes for attention.",
  "The palette leans cool and desaturated, greys and blue-greens dominating, with warmth reserved for the light source itself rather than the materials.",
  "The palette is warm but restrained — ochre, rust, and aged leather browns — avoiding anything that reads as bright, saturated, or modern.",
  "The palette favours deep, slightly muddy tones throughout the background, letting whatever warm or pale tone is on the subject read as the clear focal point.",
]

const MOOD = [
  "The overall mood is quiet and lived-in — this is a real moment in an ordinary day, not a dramatic pose struck for a portrait.",
  "The overall mood carries a low, steady tension, as if the subject has just noticed something and has not yet decided how to react.",
  "The overall mood is weathered and unglamorous — worn materials, tired posture where appropriate, nothing crisp or freshly made.",
  "The overall mood is quietly imposing — the subject is settled and confident in the space, not posturing for a viewer.",
]

const STYLE_CLOSE = [
  "Rendered as a hand-painted oil illustration in a loose, visible-brushstroke, 19th-century impressionist manner — broken colour, soft atmospheric edges, and clearly painted rather than photographed. No photorealism, no photographic lighting, no lens flare, no depth-of-field blur of the kind a camera produces. No text, no watermark, no signature, no logo, no border or frame around the image, no modern or contemporary objects, clothing, or architecture of any kind. All figures fully clothed, nothing suggestive, no cleavage, no exposed skin beyond hands, face and neck.",
  "Rendered as a painterly digital illustration with clearly visible brushwork and soft, broken colour rather than crisp photographic detail. Not a photograph, not photorealistic, no camera lens effects, no glossy digital-render sheen. No text, no watermark, no signature, no logo, no border or frame. Nothing modern, contemporary, electronic, or anachronistic anywhere in the frame. All figures fully and modestly clothed, nothing suggestive or revealing.",
]

function pick(pool, index, offset) {
  return pool[(index + offset) % pool.length]
}

function closeOut(index, offset) {
  return [
    pick(LIGHT, index, offset),
    pick(CAMERA, index, offset + 3),
    pick(PALETTE, index, offset + 5),
    pick(MOOD, index, offset + 2),
    pick(STYLE_CLOSE, index, offset + 1),
  ].join(" ")
}

const requests = []
const seen = new Set()
function add(entry) {
  if (seen.has(entry.id)) throw new Error("duplicate id " + entry.id)
  seen.add(entry.id)
  requests.push(entry)
}

// ---------------------------------------------------------------------------
// Fixes — the two clearest local failures, described in more explicit,
// corrective detail than any other entry, since these exist specifically to
// hold a trait the local pipeline kept losing.
// ---------------------------------------------------------------------------
add({ id: "fix-elothean-scholar", category: "fix", dest: "npcs", prompt:
  "A full-body portrait of an Elothean, a fantasy elf-like race whose single defining trait is being unnaturally tall and slender — noticeably taller and more slender than a human even when standing among ordinary furniture, with pale, almost bloodless skin and eyes that carry a faint, subtle luminous quality, as though lit softly from within rather than glowing brightly. This is the trait a previous local render lost entirely, so it needs to be visibly, unmistakably present: the height and slenderness should be obvious from the proportions alone, and the eyes should have a quiet inner light even in a still, candlelit room. The Elothean is dressed as a scholar in a long dark robe with wide sleeves, a leather satchel of scrolls slung across one shoulder, and ink-stained fingers on one hand resting against the spine of an open book. They stand in a cramped, floor-to-ceiling study, surrounded by tall wooden shelves crowded with old books, loose scrolls, and a few small brass instruments, one tall arched window behind them letting in weak grey daylight that mixes with the warm light of a desk candle in the foreground. Their expression is thoughtful and a little distant, mid-read, one eyebrow slightly raised as though something in the text has caught their attention. " + closeOut(0, 0) })
add({ id: "fix-elothean-wanderer", category: "fix", dest: "npcs", prompt:
  "A full-body portrait of an Elothean, a fantasy elf-like race whose single defining trait is being unnaturally tall and slender, taller and more slender in proportion than a human figure standing in the same open landscape, with pale skin and eyes carrying a faint, believable inner luminosity rather than a bright glow. A previous local render of exactly this scene lost the trait entirely and drifted toward an ordinary-looking woman in a plain outdoor photograph, so the height, slenderness, and quietly luminous eyes need to be unmistakable even against a wide, undetailed background. The Elothean wears a heavy, travel-worn cloak over layered plain clothing, mud at the hem, a canvas pack with a bedroll strapped across the back, and a walking stick in one hand worn smooth from long use. They stand on an open dirt road at dusk, rolling countryside stretching out behind them, a distant tree line silhouetted against a fading orange-to-purple sky, the road rutted with old cart tracks and a low stone marker just visible at the frame's edge. Their posture is tired but steady, weight settled on the walking stick, head turned slightly as if looking back the way they came rather than posing for the viewer. " + closeOut(1, 0) })
add({ id: "fix-outdoor-farmer", category: "fix", dest: "npcs", prompt:
  "A full-body portrait of a weathered human farmer, sun-darkened skin with deep creases at the eyes from years of squinting into daylight, rough calloused hands, and simple homespun work clothes — a loose linen shirt with the sleeves rolled and pushed up past the elbow, patched wool trousers, and heavy boots caked with dried mud at the sole and ankle. One hand rests on a wooden fence post, the other holds a simple curved sickle loosely at their side, blade catching a little light. They stand at the edge of a tilled field, dark turned earth in furrows stretching away behind them, a low thatched-roof farmhouse with a crooked chimney visible in the middle distance, a few scattered chickens pecking near a fence, and a wooden cart with one wheel leaning against a stack of hay bales off to one side. Their expression is plain and unposed, looking slightly past the viewer toward the field itself, mouth set in the neutral line of someone mid-task rather than someone being painted. This exact scene rendered flat and photographic in an earlier local attempt, so the emphasis here is on visible, deliberate brushwork and painted atmosphere rather than crisp photographic detail. " + closeOut(2, 0) })
add({ id: "fix-outdoor-pilgrim", category: "fix", dest: "npcs", prompt:
  "A full-body portrait of a dusty pilgrim, road-worn and travel-thin, wearing a simple hooded grey-brown robe belted at the waist with rope, the hem frayed and pale with dust, and sturdy sandals over wrapped cloth leggings. They carry a tall wooden walking staff planted firmly in the dirt, a small wooden holy symbol on a leather cord at their throat, and a modest waterskin slung across one shoulder. They stand partway along a dirt road that winds up and away from the viewer toward a small stone shrine visible in the distance, its simple archway just catching the light, with low scrubby bushes and a scattering of loose stones along the roadside, and a single weathered wooden signpost leaning at an angle a little further up the path. Their expression is calm and resolved, eyes fixed on the distant shrine rather than the viewer, shoulders a little stooped from distance already walked. An earlier local render of this same scene came out as flat outdoor photography rather than an illustration, so the brief here leans hard on visible, painterly brushwork and atmospheric depth rather than sharp photographic focus. " + closeOut(3, 0) })

// ---------------------------------------------------------------------------
// Creatures — common/early archetypes. Each gets a genuine physical
// description (size, texture, anatomy), a specific pose and expression, and
// a distinct environment with concrete foreground/background elements.
// ---------------------------------------------------------------------------
const CREATURES = [
  ["rat", "a large sewer rat, roughly the size of a small dog, with matted greasy grey-brown fur, a long bald scarred tail, and prominent yellowed incisors", "crouched low with its back arched, front paws braced against a broken cobblestone, head turned sharply toward the viewer mid-hiss", "a damp stone sewer tunnel, shallow standing water reflecting a dim shaft of light from a grate above, refuse and broken crates piled against one wall"],
  ["kobold", "a small reptilian kobold, roughly child-sized, with mottled brown-green scaled skin, a narrow snout, and small backward-curving horns", "crouched defensively behind a crude wooden shield, a notched spear held low and angled forward, tail flicking with tension", "a narrow torchlit tunnel with rough-hewn stone walls, a guttering wall-mounted torch throwing orange light, a pile of scavenged bones and broken pottery in one corner"],
  ["goblin-warrior", "a wiry green-skinned goblin warrior, hunched and sinewy, with a flat nose, jagged uneven teeth, and old scars across one cheek", "mid-charge, a notched short sword raised overhead in both hands, face twisted in a snarl, one foot forward in an unbalanced lunging stride", "a muddy forest clearing littered with makeshift stakes and scavenged weapons, a crude banner of stitched hides on a leaning pole in the background"],
  ["goblin-shaman", "a hunched, older goblin shaman, thinner and more stooped than a warrior, draped in strings of small bones, feathers, and carved wooden talismans", "standing with one clawed hand raised, holding a crooked wooden staff wrapped in binding cord, a faint crackle of crude magic gathering at its tip", "the mouth of a shallow cave lit by a low fire, ritual markings scratched into the surrounding stone, a scattering of animal skulls arranged at the fire's edge"],
  ["goblin-archer", "a lean goblin archer, quicker and lighter-framed than a warrior, in patched leather with a bandolier of crudely fletched arrows across the chest", "crouched behind a fallen log, a short recurved bow drawn halfway, one eye narrowed as it sights along the arrow", "the edge of a rocky outcrop overlooking a narrow forest trail, scrubby underbrush for cover, a thin trail of smoke rising from an unseen camp below"],
  ["wild-boar", "a heavyset wild boar, bristling dark brown fur along a raised ridge on its back, small red eyes, and two curved yellowed tusks jutting from its lower jaw", "mid-charge, head lowered and tusks forward, mud kicking up from its trotters, powerful shoulders bunched with momentum", "a churned, muddy forest floor between dense tree trunks, dappled light breaking through the canopy, a scattering of fallen leaves kicked into the air"],
  ["giant-spider", "a giant forest spider roughly the size of a large dog, coarse black bristled legs, a bulbous striped abdomen, and a cluster of small gleaming eyes", "poised at the centre of a heavy web strung between two trees, front legs raised, sensing a disturbance at the web's edge", "a shadowed patch of old-growth forest, thick webbing strung between gnarled trunks, a few desiccated husks of previous prey still wrapped in silk nearby"],
  ["brigand", "a scarred human brigand, broad-shouldered and rough-shaven, wearing mismatched scavenged leather and a single dented pauldron over one shoulder", "crouched behind a boulder at a roadside ambush point, a short sword drawn and held low, eyes fixed on an unseen target down the road", "a narrow forest road with dense undergrowth pressing in on both sides, a fallen tree partially blocking the path, wagon-wheel ruts visible in the dirt"],
  ["bandit-archer", "a hooded bandit archer, lean and watchful, in dark practical leathers with a scarf pulled up over the lower face against dust and recognition", "kneeling on a rocky outcrop, a longbow drawn to the cheek, string vibrating slightly with tension, eyes tracking a target below", "a windswept hillside overlooking a winding trade road, scattered loose scree underfoot, a distant caravan just visible as small shapes on the road below"],
  ["skeleton-warrior", "an animated skeleton warrior, bones yellowed and cracked with age, wearing rusted, dented plate armor still strapped loosely over the ribcage", "standing braced in a fighting stance, a notched longsword held two-handed, empty eye sockets somehow fixed intently forward", "a collapsed crypt chamber, broken stone sarcophagi lining the walls, a single shaft of torchlight from a crack in the ceiling above"],
  ["skeleton-archer", "an animated skeleton archer, bones bleached pale, a tattered leather quiver of brittle arrows slung across its back on cracked straps", "standing with a bow drawn, the bowstring frayed but taut, joints angled at slightly unnatural rigid points as it takes aim", "a shadowed tomb antechamber, dust hanging visibly in a single beam of light, broken funerary urns scattered across the floor"],
  ["restless-ghost", "a translucent restless spirit, half-formed and constantly shifting at the edges, wearing the pale remains of burial clothes that drift as though underwater", "drifting a few inches above the floor, one arm reaching slowly toward something unseen, expression caught between sorrow and confusion", "a ruined chamber with a collapsed ceiling open to a night sky, cold pale blue-white light emanating faintly from the spirit itself, dust motes suspended in stillness"],
  ["banshee", "a wailing banshee, gaunt and hollow-cheeked, with wild trailing hair that moves as though caught in a wind no one else feels, wrapped in a torn burial shroud", "frozen mid-wail, mouth open, one clawed hand raised as though warding something away, body arched back slightly", "a cold stone burial chamber lit by pale unnatural light with no visible source, frost creeping across the nearby stone in delicate branching patterns"],
  ["zombie", "a shambling zombie, grey-green rotted flesh visible through tears in tattered grave clothes, jaw hanging slack, one arm bent at a wrong angle", "lurching forward with both arms outstretched, one foot dragging, head tilted unnaturally to one side", "a fog-choked graveyard at night, broken headstones leaning at angles, a half-open grave with loose dirt piled beside it in the foreground"],
  ["ghoul", "a crouched feral ghoul, gaunt and sinewy with grey mottled skin stretched tight over a hunched frame, elongated clawed fingers, and hollow sunken eyes", "crouched low on all fours at the mouth of a crypt, head cocked, sniffing the air, muscles coiled as if about to spring", "a narrow crypt entrance choked with roots and rubble, faint moonlight filtering down a broken stairwell, scattered bones half-buried in loose soil"],
  ["orc-raider", "a muscular orc raider, grey-green skin marked with crude war paint in bold streaks, tusks jutting from the lower jaw, wearing a spiked leather harness over the shoulders and chest", "mid-swing, a heavy curved axe raised overhead in both hands, weight shifted forward into the strike, face contorted in a battle roar", "a smoke-hazed battlefield edge with a burning wagon in the middle distance, scorched earth and scattered debris underfoot"],
  ["orc-brute", "a hulking orc brute, noticeably larger and thicker than a raider, scarred hide beneath a crude harness of stitched leather, knuckles scraping near the ground", "standing with a massive tree-trunk club resting on one shoulder, head lowered, small eyes fixed on the viewer with dull hostility", "the entrance to a crude war-camp palisade of sharpened logs, a cookfire smoking in the background, crude banners of stitched hide hanging limp"],
  ["ogre", "a towering ogre, easily twice the height of a person, thick gray-green hide loose over slab-like muscle, a single lower tusk protruding from an underbite", "hunched slightly under a low cave ceiling, a crude club made from an uprooted tree gripped loosely in one hand, nostrils flaring as it catches a scent", "the mouth of a large cavern strewn with splintered bones and broken carts, weak daylight spilling in from an opening far above"],
  ["cave-troll", "a hulking cave troll, ash-grey rubbery hide, unnaturally long arms that nearly drag the ground, a low sloped brow over small deep-set eyes", "crouched low in a tight cavern passage, one long arm braced against the wall, head turned sharply toward a sound in the dark", "a dripping limestone cavern, stalactites hanging low overhead, a single flickering torch wedged into a crack in the rock wall"],
  ["swamp-troll", "a gaunt swamp troll, moss and lichen streaking mottled green-brown hide, unnervingly long clawed fingers, hunched shoulders slick with damp", "wading thigh-deep through murky water, one arm raised to push aside hanging vines, torso twisted to look back over one shoulder", "a stagnant cypress swamp at dusk, tangled roots breaking the water's surface, thick mist hanging low between the trees"],
  ["giant-rat", "an oversized mutant rat, larger than a wolf, patchy diseased-looking fur over visible ribs, yellowed fangs far too large for its jaw", "skulking low along a wall, nose twitching, one paw raised mid-step, tail dragging through standing filth", "a refuse-choked alley between leaning stone buildings, broken crates and rotting sacks piled against the walls, a shaft of weak daylight from above"],
  ["giant-bat", "a giant cave bat with a wingspan wider than a person is tall, leathery grey-brown wings, sharp folded ears, and small needle-like teeth bared", "mid-dive, wings swept back, claws extended toward the viewer, head tucked low against the rushing air", "the interior of a vast dark cavern, a shaft of moonlight breaking through a distant opening high above, faint silhouettes of a larger colony clinging to the ceiling"],
  ["giant-scorpion", "a giant desert scorpion, segmented plates of hardened chitin in dusty amber-brown, a thick curved tail arched high and ready to strike", "braced low with pincers spread wide, tail curled forward over its back, sand kicked up slightly around its forelegs", "a sun-baked desert flat, heat shimmer visible near the horizon, sparse dry scrub and sun-bleached bones scattered across cracked earth"],
  ["giant-centipede", "a giant armored centipede, a long glistening segmented body in mottled brown-black chitin, dozens of legs rippling in a wave as it moves", "coiled defensively around a jut of cavern rock, mandibles raised and clicking, the front third of its body reared slightly", "a damp cavern floor littered with loose rubble, faint phosphorescent moss casting a pale green glow along one wall"],
  ["swamp-snake", "a thick venomous swamp serpent, patterned scales in dark green and mottled brown, a broad triangular head, tongue flicking from a slightly open mouth", "coiled among tangled reeds, head raised and drawn back in a warning strike posture, body tensed in a tight S-curve", "shallow murky swamp water studded with reeds and lily pads, low mist clinging to the surface, a fallen log half-submerged nearby"],
  ["viper", "a slender coiled viper, diamond-patterned scales in muted browns and tans, a narrow wedge-shaped head, and vertical-slit eyes", "coiled tightly on a sun-warmed rock, head raised a few inches, tongue extended, utterly still except for the faint flick of the tail tip", "a dry, rocky hillside dotted with scrubby brush, harsh midday light casting short hard shadows across the stones"],
  ["crocodile", "a large river crocodile, thick armored hide in dull olive-brown, only its eyes, nostrils, and the ridge of its back breaking the water's surface", "floating motionless just beneath the surface, eyes fixed forward, the faintest ripple trailing from its submerged tail", "a slow murky river at the edge of dense reeds, overhanging branches trailing into the water, a muddy bank visible in the background"],
  ["harpy", "a shrieking harpy, a woman's torso fused to a bird's lower body, ragged brown-black feathers, sharp taloned hands, wild tangled hair", "perched on a jagged cliff edge, wings half-spread for balance, mouth open mid-shriek, talons gripping the rock tightly", "a windswept mountain cliff face, scattered bones and shredded cloth caught in the rocks below, storm clouds gathering on the horizon"],
  ["giant-eagle", "a giant eagle with a wingspan easily twice that of a person, dark brown plumage with pale banding along the wings, a hooked golden beak", "banking sharply in flight, wings angled to catch the wind, talons drawn up beneath a powerful chest", "high above a mountain ridge, scattered clouds below the wingline, jagged snow-capped peaks stretching into the distance"],
  ["imp", "a small mischievous imp, roughly cat-sized, glossy dark red-black skin, small leathery wings, and a thin barbed tail that curls and flicks constantly", "perched cross-legged atop a weathered stone gargoyle, grinning with too many small sharp teeth, one clawed hand tapping idly on stone", "a shadowed rooftop ledge at night, distant torchlit windows glowing below, thin wisps of smoke curling from a nearby chimney"],
  ["minor-demon", "a horned minor demon, dark red leathery hide over a lean muscular frame, small curling black horns, and clawed hands wreathed in faint smoke", "standing with arms loosely crossed, head tilted with cold curiosity, faint sulfurous smoke curling upward from bare shoulders", "a dim stone chamber marked with faintly glowing runes scratched into the floor, the air hazed with a thin drifting smoke"],
  ["fire-elemental", "a roiling humanoid fire elemental, a shifting body of ember-orange flame with darker cracked patches like cooling lava across its chest and limbs", "mid-stride, one arm raised, trailing sparks and small embers that drift and fade in the air around it", "a scorched clearing with blackened tree stumps, heat distortion visible in the air, small patches of smouldering grass nearby"],
  ["water-elemental", "a surging humanoid water elemental, a translucent churning body of blue-green water holding a rough humanoid shape, catching and bending the light within it", "rising up out of a pool, arms outstretched, water still cascading off its shoulders and running back down into the source below", "the edge of a forest pool fed by a small waterfall, moss-covered stones ringing the water, dappled light breaking through the canopy above"],
  ["earth-elemental", "a hulking humanoid earth elemental, a rough body of packed soil, embedded stones, and gnarled roots, moving with slow grinding weight", "standing with both fists lowered, small stones and dirt still trickling from its shoulders as though newly risen from the ground", "a rocky hillside clearing with a fresh crater of disturbed earth at its feet, scattered boulders half-buried in loose soil"],
  ["air-elemental", "a swirling humanoid air elemental, barely visible, its form suggested mainly by a tight vortex of dust, leaves, and faint distortion in the air", "caught mid-spin, leaves and loose debris whipping around a roughly humanoid silhouette, the ground beneath it swept bare", "an open windswept hilltop with bent grass and a few scattered leaves caught mid-flight, a pale overcast sky above"],
  ["will-o-wisp", "a drifting will-o-wisp, a small pale flickering orb of cold light, its edges softly irregular and pulsing faintly as it hovers", "hovering a few feet above the ground, drifting slowly sideways as though leading something forward, a faint trail of light lingering behind it", "a misty bog at night, dark still water reflecting the wisp's pale light, twisted dead trees rising out of the fog at the frame's edge"],
  ["mimic", "a battered wooden storage chest, iron-banded and scuffed with age, concealing a hidden row of small sharp teeth just visible along the inside edge of the lid", "the lid cracked open at an unnatural angle, one clawed, chest-coloured limb braced against the floor just beneath it, ready to spring shut", "a dusty dungeon storeroom, other ordinary crates and barrels stacked nearby for contrast, a single shaft of torchlight falling across the floor"],
  ["gelatinous-ooze", "a translucent gelatinous ooze, faintly glowing green-grey from within, a discarded rusted sword partially dissolved and suspended inside its jellied mass", "slowly extending a rounded pseudopod across the floor, its surface rippling gently, the shape of the engulfed sword still faintly visible", "a low dungeon corridor with damp stone walls, faint drip marks on the floor, a torch bracket long since gone cold nearby"],
  ["giant-crab", "a giant armored shore crab, thick mottled brown-grey shell, two oversized serrated claws held wide and ready", "braced sideways in a defensive stance, both claws raised, small stalked eyes tracking movement, sand kicked up around its legs", "a rocky tidepool shoreline, wet sand and scattered shells underfoot, low waves breaking against dark rocks in the background"],
  ["merfolk-raider", "a scaled merfolk raider, dark blue-green scales along a muscular humanoid torso, webbed clawed hands gripping a barbed trident", "breaching the surf at the waist, water streaming off scaled shoulders, trident held ready in both hands, gills flared along the neck", "a churning grey surf line at the edge of a rocky shore, storm clouds low on the horizon, foam breaking around jagged rocks"],
  ["satyr", "a mischievous satyr, a human torso with curled ram-like horns and shaggy goat legs ending in cloven hooves, an impish grin", "leaning casually against a gnarled tree trunk, one hand idly twirling a set of small reed pipes, weight shifted onto one hip", "a sun-dappled forest glade, wildflowers scattered through the grass, shafts of golden light breaking through the leaves overhead"],
  ["minotaur", "a towering minotaur, a powerfully muscled humanoid body topped with a bull's head bearing two curved horns, breath visibly steaming from wide nostrils", "standing braced in a narrow stone passage, a heavy double-bladed axe gripped in both hands, head lowered as though about to charge", "a torchlit labyrinth corridor, rough-cut stone walls scored with old claw marks, a dead end of rubble just visible ahead"],
  ["gargoyle", "a crouched stone gargoyle mid-transformation, granite-grey hide cracking at the joints as leathery wings unfold from what was solid rock a moment before", "perched on a cathedral ledge, wings half-spread, one clawed hand still pressed flat against the stone as if only just breaking free of it", "a rain-streaked cathedral facade at night, carved stonework and other still gargoyles visible along the roofline, distant lightning lighting the clouds"],
  ["wraith", "a hooded wraith, a hollow dark form beneath a tattered cloak, no visible face beyond two faint points of cold light where eyes should be", "drifting low across the ground with no visible feet, one skeletal hand extended slightly, cloak trailing as though in a wind that touches nothing else", "a foggy graveyard at night, crooked headstones half-swallowed by mist, a single dead tree silhouetted against a pale moon"],
  ["vampire-bat-swarm", "a swirling swarm of small vampire bats, dozens of dark leathery wings and glinting red eyes moving as one dense, shifting cloud", "pouring out of a cave mouth in a tight spiralling stream, the swarm's leading edge just beginning to fan outward into the open air", "the mouth of a rocky cave at dusk, a bruised purple-orange sky beyond, sparse dead trees silhouetted on the ridge above"],
  ["giant-wasp", "a giant wasp, an iridescent black-and-amber striped thorax, translucent wings blurring with motion, a long wicked stinger curled beneath the abdomen", "hovering just above a torn honeycomb hive, wings a blur, stinger lowering as it turns toward a disturbance below", "a sunlit clearing with a large broken hive hanging from a low branch, scattered wax fragments on the ground beneath it"],
  ["giant-ant", "an armored giant ant, glossy dark red-brown chitin, oversized serrated mandibles held open and ready, antennae twitching rapidly", "emerging from a sandy tunnel mouth, front legs braced on the lip of the hole, mandibles spread wide in warning", "a dry sandy embankment riddled with tunnel entrances, harsh midday light, a scattering of excavated soil fanned out around each opening"],
  ["giant-toad", "a bloated giant toad, mottled warty green-brown skin, a wide lipless mouth, and a long coiled tongue just visible at the corner of its jaw", "crouched low at the water's edge, throat pulsing slightly, eyes bulging and fixed forward, tongue beginning to uncoil", "the muddy edge of a still swamp pool, reeds and broad-leafed plants crowding the bank, a few insects visible skimming the water's surface"],
  ["dire-wolf", "a massive dire wolf, considerably larger than a natural wolf, shaggy dark grey fur bristling along a raised ridge on its back, pale eyes catching the light", "standing atop a snowy ridge, head thrown back mid-howl, breath visible as steam in the cold air, one forepaw braced forward", "a snow-covered mountain ridge at dusk, distant pine forest below dusted with snow, a pale moon rising over the horizon"],
  ["winter-wolf", "a pale winter wolf, near-white fur crusted with frost along the muzzle and shoulders, breath steaming heavily in the cold, ice-blue eyes narrowed", "crouched low in deep snow, ears flattened, lips curled back in a silent snarl, snow kicked up around its haunches", "a blizzard-swept pine forest, snow falling heavily and obscuring the middle distance, low visibility giving the scene a close, enclosed feeling"],
  ["ice-troll", "a hulking ice troll, blue-white hide crusted over with a thin layer of frost and hanging icicles along the forearms and jaw", "standing in a glacial cavern, one massive hand pressed against a wall of blue ice, head turned sharply toward a distant echo", "the interior of a glacial ice cave, pale blue light filtering through the ice overhead, frozen stalactites hanging in uneven rows"],
  ["sand-worm", "a colossal sand worm, a segmented ringed body the colour of sun-bleached stone, a circular maw lined with rows of small triangular teeth", "breaching the surface of a dune mid-strike, sand cascading off its segmented body in sheets, the maw open wide toward the viewer", "a vast open desert of rolling dunes, heat shimmer distorting the horizon, a scattering of bleached bones half-buried nearby"],
  ["jackal", "a lean scavenging jackal, patchy tan-and-grey fur, ribs faintly visible beneath the coat, ears alert and swivelled forward", "standing over a scatter of sun-bleached bones, head lowered, lips curled back in a warning snarl at an unseen rival", "a dry scrubland at dusk, sparse thorny brush and cracked earth stretching to the horizon, the sky deepening toward orange and purple"],
  ["hyena", "a spotted hyena, a hunched sloping back, a broad grinning muzzle, dark spots scattered across a dusty tan coat", "loping low across open ground, head slightly lowered, mouth open in a low chattering cackle, tail held stiffly behind it", "an open savanna-like scrubland at dusk, dry grass swaying, a distant scattering of low thorny trees on the horizon"],
  ["giant-vulture", "a giant vulture, a bald ridged head streaked with old scars, dark ragged plumage, a heavy hooked beak stained dark", "perched on a jagged rock outcrop over a carrion site, wings held loosely open, head cocked as it eyes something on the ground", "a rocky arid hillside strewn with old bones, harsh midday sun casting sharp short shadows, other smaller scavengers waiting at a distance"],
  ["cave-bear", "a massive cave bear, shaggy dark brown fur, small deep-set eyes, and long curved claws visible on both forepaws", "reared up on its hind legs in a torchlit cavern, forepaws raised, jaw open in a deep roar, fur bristling across its shoulders", "a wide limestone cavern chamber, a single guttering torch wedged into a crack casting long shifting shadows, old claw marks scored deep into the walls"],
  ["mountain-lion", "a lean mountain lion, tawny short fur, powerful haunches coiled beneath it, a long tail curling low and steady", "crouched flat on a rocky outcrop, ears pinned back, tail tip flicking, eyes fixed intently on something below the ledge", "a sunlit rocky mountainside, scattered scrub pines clinging to the slope, a distant valley visible far below through the haze"],
  ["forest-sprite", "a tiny glowing forest sprite, roughly the size of a hand, gossamer wings catching a faint green-gold light, a small curious face", "perched lightly on a moss-covered branch, one hand resting against the bark, head tilted as though listening to something in the leaves", "a shaded patch of old forest floor, soft green moss and small mushrooms clustered at the base of a tree, faint motes of light drifting nearby"],
  ["dryad-guardian", "a bark-skinned dryad guardian, a slender humanoid form merging seamlessly into an ancient tree trunk, leaves and small vines woven through long hair", "standing half-emerged from the trunk of a great tree, one arm still fused to the bark, the other extended outward, palm open", "the base of an enormous ancient tree deep in an old forest, roots rising above the soil like low walls, dappled light filtering far above"],
  ["animated-armor", "a suit of empty plate armor standing animate, the metal dented and scratched with age, no visible occupant behind the raised visor", "standing braced in a fighting stance in a dusty crypt hall, a longsword held ready in one gauntleted hand, the empty helm tilted slightly forward", "a long crypt hall lined with alcoves and old stone statues, dust hanging thick in a single beam of light from a high narrow window"],
]
for (const [tag, physical, pose, env] of CREATURES) {
  add({ id: "mob-" + tag, category: "creature", dest: "creatures", target: tag.replace(/-/g, " "), prompt:
    "A full-body illustration of " + physical + ". It is " + pose + ". The setting is " + env + ". " + closeOut(requests.length, 4) })
}

// ---------------------------------------------------------------------------
// NPCs — one detailed guild-leader portrait per guild, plus targeted fixes
// spreading the two riskiest local scene shapes across several races.
// ---------------------------------------------------------------------------
const GUILD_LEADER = {
  barbarian: ["a weathered barbarian guild leader, heavily muscled with old scars crossing both forearms and one across the jaw, grey beginning to streak through a braided beard", "standing with arms crossed, weight settled evenly, a heavy two-handed weapon leaning within easy reach against a nearby weapon rack", "a stone training hall hung with battle trophies — cracked shields, a mounted set of horns, a tattered banner — and a sand-floored sparring ring visible behind"],
  bard: ["a charismatic bard guild leader, striking and self-assured, in a richly embroidered performer's coat with wide sleeves and a high collar edged in faded gold thread", "standing mid-gesture on a small raised stage, one hand resting on the neck of an ornate stringed instrument, head tilted as if mid-story rather than mid-song", "a warmly lit performance hall, close-set tables and benches just visible in the middle distance, hanging lanterns throwing pools of gold light across worn floorboards"],
  cleric: ["a serene elder cleric guild leader, lined face carrying quiet authority, in formal holy vestments layered over a simple undertunic, a heavy pendant of office resting on the chest", "standing before a modest stone altar, both hands folded, head slightly bowed as though caught mid-blessing rather than posing", "a candlelit sanctuary with rows of simple wooden pews, worn stone floor, and tall narrow windows admitting only a little grey daylight"],
  empath: ["a gentle empath guild leader, calm and watchful, in simple pale unadorned robes with the sleeves pushed back to the forearm, a small satchel of dried herbs at the hip", "standing beside a low wooden worktable, one hand resting lightly on a mortar and pestle, expression open and unhurried", "a quiet herb-lined healing chamber, bundles of drying herbs hanging from the low rafters, soft daylight filtering through a single small window"],
  moon_mage: ["a moon mage guild leader, pale and composed, in dark star-patterned robes that seem to hold the faintest shimmer of their own light along the seams", "standing beneath an open dome that frames a clear night sky, both hands raised slightly, a faint arcane light gathering just above the palms", "an open-topped observatory chamber, a stone floor inlaid with a worn celestial diagram, cool moonlight the only real light source in the room"],
  necromancer: ["a gaunt necromancer guild leader, sallow-skinned and sharp-featured, in dark layered robes with old bone charms sewn along one sleeve", "standing at a low stone table scattered with old bones and burnt-down candle stubs, one hand hovering just above the table without quite touching it", "a dim stone chamber lined with shelved skulls and guttering black candles, cold air visibly misting near the floor"],
  paladin: ["a resolute paladin guild leader, upright and imposing, in polished ceremonial plate armor bearing an engraved holy sigil across the breastplate", "standing at parade rest, a longsword held point-down before them in both hands, chin level, gaze steady and direct", "a sunlit chapel hall with tall stained-glass windows casting coloured light across a polished stone floor, a row of standards along one wall"],
  ranger: ["a weathered ranger guild leader, sun-browned and economical in movement, in patched earth-toned leathers with a well-used longbow strapped diagonally across the back", "standing in a doorway with one shoulder against the frame, arms loosely folded, eyes fixed on something out past the tree line", "the covered porch of a low timber forest lodge, a hunting dog dozing near the doorstep, dense woods rising just beyond a cleared yard"],
  thief: ["a sharp-eyed thief guild leader, lean and unreadable, in dark fitted leathers with a hood pushed back just enough to show a faint, knowing half-smile", "leaning against a doorframe half in shadow, arms crossed, one boot braced against the wall behind, watching the room rather than the viewer", "a dim backroom lined with locked chests and a single shuttered window, a low table scattered with coins and a folded map"],
  trader: ["a well-dressed trader guild leader, comfortably prosperous, in a fine tailored merchant's coat with polished brass buttons and a heavy signet ring", "standing behind a tall counter, one hand resting on an open ledger, the other holding a quill just lifted from the page", "a busy trading hall with shelved goods and stacked crates receding into the middle distance, a hanging scale and stacks of ledgers on the counter"],
}
for (const [guild, entry] of Object.entries(GUILD_LEADER)) {
  const [physical, pose, env] = entry
  add({ id: "guildleader-" + guild.replace(/_/g, "-"), category: "npc-guildleader", dest: "npcs", prompt:
    "A full-body portrait of " + physical + ". They are " + pose + ". The setting is " + env + ". " + closeOut(requests.length, 1) })
}

// ---------------------------------------------------------------------------
// Named Crossing NPCs — the actual guild leaders and shopkeepers, pulled
// from Elanthipedia (29 Aug 2026) rather than invented. For each, only the
// factual infobox fields (race, gender, role, location) and a handful of
// independently-restated physical traits were used; every sentence below is
// freshly written for this file, not adapted or lightly reworded from the
// wiki's own prose — the wiki text itself is not reproduced anywhere here.
// ---------------------------------------------------------------------------
const NAMED_GUILD_LEADER = [
  ["marigon", "barbarian", "Marigon, a Gor'Tog man", "a stocky, powerfully built middle-aged warrior with dark green skin and a blunt jaw", "standing with a bastard sword bearing a pearl-set pommel held ready in one hand, weight forward on the balls of his feet, an aggressive, battle-ready set to his shoulders", "the Barbarian Guild's main hall in the Crossing, weapon racks and old trophies along the stone walls, a sand-floored sparring ring visible through an open archway behind him"],
  ["silvyrfrost", "bard", "Silvyrfrost, an elf woman", "petite and fine-boned, with long curly red hair and two visibly different-coloured eyes", "seated on the edge of a small stage with an ornate stringed instrument across her lap, one hand resting on the strings, dressed in flowing blue performer's clothes", "the Bard's Guild performance hall in the Crossing, close-set benches and hanging lanterns in the middle distance, a shelf of bound songbooks along one wall"],
  ["esuin", "cleric", "Esuin Jaleven, a human man", "younger than his position would suggest, composed in bearing but with a faint, unplaceable tension behind the eyes", "standing beside a modest writing desk in his study, one hand resting on an open ledger of guild business, dressed in simple, unadorned clerical robes", "the Cleric Guild's guildleader's study in the Crossing, shelves of devotional texts along the walls, a single narrow window letting in grey daylight"],
  ["salvur", "empath", "Salvur Siksa, an elderly human man", "weathered and stern-featured, a single streak of white running through otherwise dark hair, deep lines set into his face", "standing with both hands resting on the head of a polished ironwood walking stick he seems to lean on more for emphasis than support, dressed in fine but sober materials", "the Empath Guild's guildleader's office in the Crossing, herb bundles and old ledgers on open shelves, a low fire burning in a small hearth"],
  ["verika", "paladin", "Verika, a Rakash woman", "with a jagged old scar along one side of her jaw and thick black hair pulled back, a warrior's build under a composed, kindly expression", "standing at ease with a longsword sheathed at her hip, one boot's silver wolf-head buckle catching the light, dressed in grey and white guild colours", "the Paladin Guild's guildleader's office in the Crossing, a holy standard mounted on the wall behind her, polished stone floor reflecting soft daylight from a high window"],
  ["kalika", "ranger", "Kalika, an elf woman", "elegant and composed, ginger hair loose about her shoulders and storm-grey eyes that hold a settled, patient calm", "standing in a doorway with one hand resting lightly on the frame, a longbow leaning within easy reach against the wall beside her", "the Ranger Guild's guildleader's office in the Crossing, a large map of the surrounding woodland pinned to one wall, a hunting dog's bed empty in the corner"],
  ["kalag", "thief", "Kalag Ka'Hurst, a man of uncertain race, kept deliberately hard to place at a glance", "lean and watchful, dressed in unremarkable dark clothing that gives nothing away, a face better at being forgotten than remembered", "standing half-turned away from the light in a cluttered back office, one hand resting on a strongbox, the other loosely at his side", "the Thief Guild's guildleader's office in the Crossing, stacked ledgers and a few locked chests against the walls, a single shuttered window admitting almost no light"],
  ["ansprahv", "trader", "Ansprahv, a Kaldar man", "imposing and composed, long black hair and pale grey eyes flecked with silver, a commanding presence without needing to raise his voice", "standing behind a wide desk with one hand resting flat on a ledger, dressed in dark formal attire trimmed in silver and gold", "the Trader Guild's guildleader's office in the Crossing, tall shelves of account books behind him, a hanging brass scale on the desk's edge"],
]
for (const [slug, guild, who, physical, pose, env] of NAMED_GUILD_LEADER) {
  add({ id: "guildleader-crossing-" + slug, category: "npc-guildleader", dest: "npcs", prompt:
    "A full-body portrait of " + who + ", the guildleader of the " + guild[0].toUpperCase() + guild.slice(1) + " Guild in the Crossing. They are " + physical + ", " + pose + ". The setting is " + env + ". " + closeOut(requests.length, 3) })
}

const CROSSING_SHOPKEEPER = [
  ["emmiline", "Emmiline, a woman of unrecorded race who runs an Empath's shop from her own cottage", "dressed in a fine linen suit cut in a current, tasteful style, carrying herself with genteel composure", "standing behind a small counter with one hand resting on a display of prepared remedies, her expression pleasant but her gaze drifting somewhere past the viewer for a moment, as though distracted by a private thought", "the front room of Emmiline's Cottage in the Crossing, shelves of neatly labelled jars and bundled herbs behind the counter, a curtained window letting in soft daylight"],
  ["berolt", "Berolt, a man who runs a general dry goods store", "neatly groomed with dark blonde hair, dressed in practical merchant's clothing", "standing behind his counter with hands loosely clasped, an easy, welcoming half-smile, as though he has just greeted someone walking in", "the sales floor of Berolt's Dry Goods in the Crossing, shelves of folded cloth, tools, and sundries lining the walls, a small brass bell mounted by the door"],
  ["catrox", "Catrox, a dwarf man who runs a forge", "coal-stained skin and old burn scars across both forearms, one hand held slightly differently from the other from an old injury", "standing at his anvil with a hammer resting head-down on the metal, shoulders turned slightly away from the viewer as though reluctant to be interrupted", "the work floor of Catrox's Forge in the Crossing, a bed of glowing coals in the background, tools hung in neat rows along a soot-blackened wall"],
  ["grisgonda", "Grisgonda, a dwarf woman who runs a jewelry shop", "sturdy and cheerful, fine tools tucked into a leather apron worn over practical clothing", "seated at her work counter with a loupe pushed up on her forehead, carefully arranging a tray of finished settings, a satisfied, focused expression", "the sales counter of Grisgonda's Gems and Jewels in the Crossing, glass display cases catching the light, a small scale and a set of fine tools laid out nearby"],
  ["milgrym", "Milgrym, a man who runs a weapons shop", "dark-haired and dark-bearded, heavily muscled forearms marked with old scars from his trade", "standing behind a display of blades with arms crossed, a serious, no-nonsense expression, weight settled evenly", "the sales floor of Milgrym's Weapons in the Crossing, racks of swords and axes along the walls, a testing block scarred with old blade marks in one corner"],
  ["tembeg", "Tembeg, a Gor'Tog man who runs an armory", "dark green skin on hands roughened by years of leatherworking, dressed in plain, well-worn work clothes", "standing at a cutting table with a length of hide stretched before him, a knotted measuring cord looped over one shoulder, focused on his work", "the work floor of Tembeg's Armory in the Crossing, half-finished leather armor pieces hanging from pegs, a scatter of tools and hide scraps on the table"],
  ["ragge", "Ragge, a man of the Thief guild who runs a locksmith's shop", "dressed in sturdy, protective work clothes, striking pale blue eyes and an easy, affable manner", "standing behind his counter with a set of black-hilted picks laid out before him, one raised slightly as he demonstrates something to an unseen customer", "the sales floor of Ragge's Locksmithing in the Crossing, hung with sample locks of every size, a workbench visible through a doorway behind the counter"],
  ["mauriga", "Mauriga, a woman who runs a botanicals shop", "a weathered, expressive face that seems to have known both hardship and real happiness in equal measure, dried herbs strung at her throat", "standing among hanging bundles with both hands full of freshly gathered stems, the faint scent of her trade seeming to hang in the air around her", "the sales floor of Mauriga's Botanicals in the Crossing, bunches of drying herbs hanging from the low rafters, small clay pots of live plants along the windowsill"],
  ["falken", "Falken, a man who runs a tannery", "a heavily stained work apron and visibly worn hands, the marks of long years at his trade plain on his clothing", "standing over a stretched hide with a scraping tool in hand, pausing mid-stroke, an unmistakable note of quiet pride in his posture", "the work floor of Falken's Tannery in the Crossing, hides stretched on wooden frames along one wall, barrels of tanning solution against another"],
  ["herilo", "Herilo, an S'Kra Mur man who runs a curio shop of artifacts", "reptilian scaled skin and a narrow snout, draped in an elaborately embroidered robe hung with small crystals and amulets that catch the light", "standing watchfully behind his counter, tongue just visible at the corner of a closed mouth, eyes tracking the viewer with careful attention", "the sales floor of Herilo's Artifacts in the Crossing, shelves crowded with strange curios and softly glinting trinkets, refracted light scattered across the walls"],
  ["chizili", "Chizili, an elderly human woman who runs an alchemical goods shop", "a long silver braid under a simple silver circlet, dressed in a pale blue robe with a white silk veil", "standing behind a counter lined with small labelled bottles, hands folded, a pleasant, approachable expression", "the sales floor of Chizili's Alchemical Goods in the Crossing, shelves of tinctures and powders rising behind her, a mortar and pestle set out on the counter"],
  ["cormyn", "Cormyn, an elderly human man who runs a shop of heirlooms", "sparse grey hair, pale watery blue eyes, and fair, thin skin, dressed in a formally embroidered blue robe with a gold chain at his throat", "standing beside a display case, fidgeting absently with a ruby ring on one finger, an expression somewhere between composed and distracted", "the sales floor of Cormyn's House of Heirlooms in the Crossing, glass cases of old jewelry and keepsakes, a faded portrait hanging on the wall behind the counter"],
  ["marcipur", "Marcipur, a halfling woman who runs a stitchery shop", "small, neat, and well-groomed, a measuring tape draped around her neck over practical work clothes", "standing at a cluttered sewing table with a half-finished garment pinned in front of her, a cheerful, absorbed expression", "the work floor of Marcipur's Stitchery in the Crossing, bolts of cloth stacked along one wall, spools of thread arranged by colour on a shelf"],
  ["talmai", "Talmai, a Gor'Tog man who runs a cobbler's shop", "a compact, powerfully built frame with unusually long arms, a habitual scowl that seems more mannerism than mood", "standing at a workbench with a half-finished boot in one hand and an awl in the other, pausing mid-stitch", "the work floor of Talmai's Cobblery in the Crossing, shelves of finished boots and shoes along the walls, scraps of leather scattered across the bench"],
  ["hameel", "Hameel, a man who runs a carpet emporium", "entirely ordinary in build and feature, dressed plainly for the trade of a carpet merchant", "standing beside a tall stack of rolled carpets, one hand resting on top as though about to unroll it for a customer", "the sales floor of Hameel's Carpet Emporium in the Crossing, rolled and hanging carpets in muted patterns filling the room, a low afternoon light through a shop window"],
  ["brisson", "Brisson, a man who runs a haberdashery", "elegantly and carefully dressed, every detail of his own outfit clearly chosen with deliberate attention", "standing beside a mirror and a rack of fine hats and gloves, one hand adjusting a display piece with precise, unhurried movements", "the sales floor of Brisson's Haberdashery in the Crossing, hat forms and glove displays arranged along polished shelves, a tall mirror in one corner"],
  ["iprilu", "Iprilu, a man who runs a general emporium", "bright blue eyes and a meticulously tailored coat over a purple vest and crisp white shirt with a bow tie", "standing behind his counter with both hands spread slightly, mid-gesture as though presenting his wares, a cheerful, welcoming expression", "the sales floor of Iprilu's Emporium in the Crossing, an eclectic mix of goods on open shelves, a small hand-lettered sign propped near the register"],
  ["barsabe", "Barsabe, a halfling man who runs a grocery", "somewhat portly, a round, good-natured face suited to a lifetime of dealing with customers", "standing behind a counter stacked with produce, one hand resting on a basket of vegetables, a cheerful, unhurried expression", "the sales floor of Barsabe's Grocery in the Crossing, baskets and crates of produce arranged along the walls, a set of hanging scales over the counter"],
  ["durantine", "Brother Durantine, a man of the Cleric guild who runs a small shop", "composed and orderly, formal religious vestments bearing a medallion of his order at the throat", "standing beside a modest display of devotional items, hands folded before him, a calm, measured expression", "the sales floor of Brother Durantine's Shop in the Crossing, simple religious items arranged on a cloth-covered table, a small shrine alcove set into one wall"],
  ["orielda", "Orielda, an elf woman who runs a flower shop", "pale blonde hair and light grey eyes, dressed in a fashionable blue-green gown, hands never quite still", "standing at a worktable weaving stems into a floral arrangement, her gaze drifting somewhere past the viewer even as her hands keep working", "the sales floor of Orielda's Blossoms in the Crossing, buckets of cut flowers lining the walls, loose petals scattered across the worktable"],
  ["barana", "Barana, a human man known as Yard Master, connected to a shipyard", "a weathered, stout build, storm-grey eyes, a crooked nose, and heavy facial hair", "standing on a dockside walkway with one hand braced on a mooring post, surveying the yard with a practised, appraising eye", "Barana's Shipyard in the Crossing, timber scaffolding and a half-finished hull in the background, coiled rope and tools laid out along the dock"],
]
for (const [slug, who, attire, pose, env] of CROSSING_SHOPKEEPER) {
  add({ id: "npc-crossing-" + slug, category: "npc-guildleader", dest: "npcs", prompt:
    "A full-body portrait of " + who + ", " + attire + ", " + pose + ". The setting is " + env + ". " + closeOut(requests.length, 5) })
}

const RACE_LOOK = {
  human: "a human, unremarkable in build, features varying naturally rather than following any single template",
  elf: "an elf, slender and fine-boned, with noticeably pointed ears and an angular, refined face",
  dwarf: "a dwarf, short and powerfully stocky, with a full heavy beard and thick calloused hands",
  halfling: "a halfling, small in stature — roughly child-sized — but with an adult's proportions and a knowing, weathered face",
  gnome: "a gnome, small and slight, with sharply angular features and unusually large, expressive eyes",
  "gor-tog": "a Gor'Tog, exceptionally tall and heavily built, with dark green skin and a blunt, jutting-jawed face",
  "skra-mur": "an S'Kra Mur, with fine reptilian scales covering exposed skin, a lizard-like snout, and a long tapering tail",
  prydaen: "a Prydaen, with a feline face covered in short fur, upright cat-like ears, and a long tail that moves with its own subtle life",
  rakash: "a Rakash, human in overall build but with distinctly fox-like ears set high on the head",
  kaldar: "a Kaldar, human in stature but with a sharp, aquiline profile and unusually pale, deep-set eyes",
  elothean: "an Elothean, unnaturally tall and slender even beside other tall races, with pale skin and eyes carrying a faint inner luminosity",
}
const RISKY_SCENES = [
  ["farmer", "sun-weathered and dressed in rough patched work clothes, sleeves rolled to the elbow", "standing at the edge of a freshly tilled field, one hand resting on a wooden fence post, a sickle held loosely in the other", "a tilled field with a low thatched-roof farmhouse in the middle distance and a wooden cart leaning against a stack of hay bales"],
  ["wanderer", "dressed in a heavy travel-worn cloak over plain layered clothing, mud caked at the hem", "standing with weight settled on a worn walking stick, head turned to look back the way they came rather than at the viewer", "an open dirt road at dusk with rolling countryside behind and a distant silhouetted tree line against a fading sky"],
  ["hunter", "cloaked in fur and worn leather, a well-used longbow strapped diagonally across the back", "crouched low at the edge of the trees, one hand braced against a mossy trunk, eyes fixed on something unseen ahead", "the misty edge of a dense forest, low undergrowth and fallen branches underfoot, pale early light filtering between the trunks"],
  ["pilgrim", "dusty from long travel, wrapped in a simple hooded robe belted with rope, a small holy symbol at the throat", "walking with a tall wooden staff planted firmly ahead of each step, shoulders a little stooped from distance already covered", "a dirt road winding toward a small stone shrine visible in the distance, scattered loose stones and scrub along the roadside"],
]
let npcCount = 0
for (const race of ["elothean", "elf", "kaldar", "human", "rakash", "gor-tog"]) {
  for (const scene of RISKY_SCENES) {
    const [role, attire, pose, env] = scene
    const sex = npcCount % 2 === 0 ? "female" : "male"
    add({ id: "fix-" + race + "-" + role + "-" + sex, category: "fix", dest: "npcs", prompt:
      "A full-body portrait of " + RACE_LOOK[race] + ", a " + sex + ", working as a " + role + ". They are " + attire + ", " + pose + ". The setting is " + env + ". This scene shape rendered flat and photographic in an earlier local attempt and lost the race's defining physical trait entirely, so keep that trait clearly, deliberately visible in the proportions and face even against a plain, undetailed background. " + closeOut(requests.length, 6) })
    npcCount++
  }
}

// ---------------------------------------------------------------------------
// PC concept art. The 22 "core" entries — one per race x sex — install
// straight into the real portraits/ slot. Bonus entries past that go to the
// reusable pool instead of fighting the core entry for the one slot.
// ---------------------------------------------------------------------------
const GUILD_LOOK = {
  barbarian: ["a barbarian, broad-shouldered and heavily muscled, with old battle scars visible across the forearms", "gripping a large two-handed weapon loosely, resting its head against one shoulder, weight settled evenly on both feet", "in furs and battle-worn leather armor, straps and buckles showing real wear"],
  bard: ["a bard, striking and self-possessed, with an easy, confident stance", "holding an ornately carved stringed instrument against the hip, one hand resting on the strings as if about to play", "in richly embroidered performer's clothes with a high collar and wide sleeves"],
  cleric: ["a cleric, composed and steady, standing upright with quiet purpose", "holding a simple symbol of faith in one hand, the other relaxed at the side", "in formal holy vestments worn over sturdy layered travel gear beneath"],
  empath: ["an empath, calm and observant, with a watchful, unhurried bearing", "carrying a small satchel of dried herbs and bandages at the hip, one hand resting near the strap", "in simple pale traveling robes, sleeves pushed back to the forearm"],
  moon_mage: ["a moon mage, pale and composed, standing with an air of quiet concentration", "one hand raised slightly with a faint arcane light gathering just above the palm", "in dark star-patterned robes with a subtle shimmer along the seams"],
  necromancer: ["a necromancer, sharp-featured and unreadable, standing very still", "one hand resting on an old bone charm hanging from a cord at the belt", "in dark tattered layered robes with faded embroidery at the hem"],
  paladin: ["a paladin, upright and resolute, standing at a disciplined parade rest", "holding a sword point-down before them in both hands, shield slung across the back", "in polished plate armor bearing an engraved holy sigil across the chest"],
  ranger: ["a ranger, weathered and economical in movement, alert but relaxed", "holding a well-used longbow loosely in one hand, an arrow already nocked but not drawn", "in patched earth-toned leathers suited for long travel through rough country"],
  thief: ["a thief, lean and watchful, with a sly, knowing half-smile", "caught mid-step as though just emerging from shadow, one hand near a belt of small tools", "in dark fitted leathers with a hood pushed back off the head"],
  trader: ["a trader, comfortably confident, standing with an easy, practiced posture", "holding a satchel of ledgers and coin pouches slung across one shoulder", "in a fine tailored merchant's coat with polished buttons"],
}
const RACES = ["human", "elf", "dwarf", "halfling", "gnome", "gor-tog", "skra-mur", "prydaen", "rakash", "kaldar", "elothean"]
const GUILDS = Object.keys(GUILD_LOOK)

let guildCursor = 0
const coreGuildFor = {}
for (const race of RACES) {
  for (const sex of ["male", "female"]) {
    coreGuildFor[race + "-" + sex] = GUILDS[guildCursor % GUILDS.length]
    guildCursor++
  }
}
function pcPrompt(race, sex, guild, idx) {
  const [physical, pose, attire] = GUILD_LOOK[guild]
  return "Concept art of " + RACE_LOOK[race] + ", a " + sex + " adventurer. This character is " + physical + ". They are " + pose + ", " + attire + ". This is a standalone character concept piece — a clean three-quarter or full-body study meant to be immediately reusable, not tied to a specific pose from gameplay. " +
    closeOut(idx, 2) + " No specific logos, guild insignia text, or identifying marks — this should read as a generic, reusable character concept rather than a named individual."
}

for (const race of RACES) {
  for (const sex of ["male", "female"]) {
    const guild = coreGuildFor[race + "-" + sex]
    add({ id: "pc-" + race + "-" + guild.replace(/_/g, "-") + "-" + sex, category: "pc-concept", dest: "portraits",
      race, sex, prompt: pcPrompt(race, sex, guild, requests.length) })
  }
}

outer:
for (let round = 0; round < GUILDS.length; round++) {
  for (const race of RACES) {
    for (const sex of ["male", "female"]) {
      if (requests.length >= 229) break outer
      const usedCore = coreGuildFor[race + "-" + sex]
      const guild = GUILDS[(GUILDS.indexOf(usedCore) + 1 + round) % GUILDS.length]
      if (guild === usedCore) continue
      const id = "pc-bonus-" + race + "-" + guild.replace(/_/g, "-") + "-" + sex
      if (seen.has(id)) continue
      add({ id, category: "pc-concept", dest: "grok-art", prompt: pcPrompt(race, sex, guild, requests.length) })
    }
  }
}

const out = {
  instructions:
    "Paste each entry's prompt into Grok Imagine, generate, and save the result. " +
    "Name the saved file exactly the id plus an extension (.png, .jpg or .webp) and drop it in data/art/grok-in/. " +
    "Run 'node tools/import-grok-art.mjs' afterward. pc-concept entries marked for the portraits pool install " +
    "straight into public/portraits/ as the real default for that race+sex (the old local one is kept in " +
    "public/portraits/replaced/, never deleted); the rest install into public/grok-art/<category>/, a separate " +
    "pool tracked in data/art/grok-manifest.json. If a result came out wrong for what it was asked for but still " +
    "looks good, drop it in data/art/grok-in/reject/ instead of naming it — the importer builds a contact sheet " +
    "from that pile for review rather than installing it blind; the expected outcome for most of them is moving " +
    "into data/art/grok-in/generic/ as PC concept art, not discarding.",
  style_suffix: "Every prompt already states its own style, lighting, camera framing, and palette in full — this field is kept only for reference.",
  requests,
}

writeFileSync("data/art/grok-requests.json", JSON.stringify(out, null, 1))
const words = requests.reduce((s, r) => s + r.prompt.split(/\s+/).length, 0)
console.log(requests.length + " requests written, average " + Math.round(words / requests.length) + " words per prompt")
const byCat = {}
for (const r of requests) byCat[r.category] = (byCat[r.category] || 0) + 1
console.log(byCat)
