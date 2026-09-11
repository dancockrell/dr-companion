"""What the room descriptions actually say, counted rather than imagined.

Every term in here was taken from a frequency pass over the 1,055,139 words of
description text in Lich's own DragonRealms map database. Nothing is in this
file because it seemed like a thing a fantasy game would have; if a word is
here it is because rooms say it, and `forge/audit.py --lexicon` prints the
count behind each entry so a term that stops earning its place shows up as a
zero instead of sitting here forever.

The categories are what a scene needs to be composed: what you stand on, what
encloses you, what is built, what grows, what moves, and what lights it.
"""

# What you stand on. First match wins, so the specific ones lead.
GROUND = {
    'cobble': ('cobblestone', 'cobbles', 'cobbled'),
    'flagstone': ('flagstone', 'flagstones', 'paving stone', 'paved'),
    'stone-floor': ('stone floor', 'rock floor', 'granite floor', 'marble floor'),
    'wood-floor': ('wooden floor', 'floorboards', 'plank floor', 'wood floor'),
    'tile': ('tiled floor', 'tiles', 'mosaic'),
    'carpet': ('carpet', 'rug', 'runner'),
    'sand': ('sand', 'sandy', 'dune'),
    'snow': ('snow', 'ice', 'frost-covered'),
    'mud': ('mud', 'muddy', 'mire', 'bog'),
    'grass': ('grass', 'grassy', 'turf', 'meadow', 'lawn'),
    'moss': ('moss', 'mossy', 'lichen'),
    'dirt': ('dirt', 'earth', 'packed earth', 'bare ground', 'soil'),
    'gravel': ('gravel', 'pebble', 'shale', 'scree'),
    'road': ('road', 'street', 'avenue', 'lane', 'thoroughfare'),
    'path': ('path', 'trail', 'track', 'walkway'),
    'water': ('water', 'shallows', 'stream bed'),
    'rock': ('rock', 'stone', 'bedrock'),
}

# The words that name the surface you are standing on, as opposed to naming
# what it is made of. On their own they say nothing a renderer can use - a
# "floor" is not a material - but they mark the one place in a description
# where a material word is talking about the ground rather than about a table,
# an altar or a wall. 'marble' appears in 688 rooms and is the floor in a
# minority of them; "the polished marble floor" is the minority, and this is
# how it gets told apart.
SURFACE = (
    'floor', 'flooring', 'ground', 'underfoot', 'paving', 'pavement',
    'paved', 'footing', 'surface underfoot', 'you stand on', 'beneath your',
    'under your feet', 'underneath',
)

# Materials, read only inside a window around one of the words above. Kept
# separate from GROUND because GROUND's entries are surfaces already ('sand',
# 'grass') and match honestly anywhere, while these are substances that need
# to be told what they are a substance *of*.
SURFACE_MATERIAL = {
    'marble': ('marble',),
    'granite': ('granite',),
    'slate': ('slate',),
    'sandstone': ('sandstone', 'limestone', 'chalk'),
    'obsidian': ('obsidian', 'basalt', 'volcanic glass'),
    'lava': ('lava', 'magma'),
    'clay': ('clay', 'adobe'),
    'silt': ('silt', 'loam', 'peat', 'humus'),
    'ash': ('ash', 'soot', 'cinder', 'char'),
    'straw': ('straw', 'hay', 'rushes', 'thresh', 'sawdust'),
    'brick': ('brick', 'masonry'),
    'tile': ('tile', 'mosaic', 'terracotta'),
    'metal': ('iron', 'steel', 'metal', 'bronze', 'copper'),
    'glass': ('glass', 'crystal'),
    'bone': ('bone', 'shell', 'skull'),
    'leaf-litter': ('leaves', 'needles', 'leaf litter', 'pine needles',
                    'fallen leaves'),
    'seaweed': ('seaweed', 'kelp', 'algae', 'coral'),
    'wood': ('wood', 'wooden', 'plank', 'board', 'timber', 'oak', 'pine',
             'cedar', 'teak', 'mahogany'),
    'fur': ('fur', 'hide', 'pelt', 'skins'),
}

# What encloses you. This decides whether the scene has a ceiling and walls
# or a sky and a horizon, so it is the single most load-bearing call the
# parser makes.
ENCLOSURE = {
    # 'tunnels' and 'burrows' are verbs as often as nouns in this corpus
    # ("one winding alley tunnels under another" is a street, not a cave),
    # so the cave words are the ones that can only be things.
    'cave': ('cavern', 'cave', 'grotto', 'rough-hewn', 'stalactite',
             'stalagmite', 'cave mouth', 'rocky ceiling'),
    # The interior half of the same lesson the outdoor list learned below: it
    # had furnishings ('counter', 'hearth') and the three generic words for a
    # space, and no *rooms*. A frequency pass over the 3,746 rooms the parser
    # could not place found 'hallway' in 152 of them, 'corridor' in 106 and
    # 'alcove' in 64 - none of which mention a ceiling, and all of which are
    # somewhere you can only be indoors. 'passage' was tested and rejected:
    # "the red-tile north king's passage connects the street of metalworkers"
    # is a street, and "passage of time" is not a place at all. 'passageway'
    # has no such second sense and is kept.
    'interior': ('room', 'chamber', 'hall', 'ceiling', 'rafters', 'shop',
                 'walls of this', 'inside', 'indoor', 'hearth', 'counter',
                 'hallway', 'corridor', 'alcove', 'passageway', 'foyer',
                 'vestibule', 'antechamber', 'stairwell', 'cellar', 'attic',
                 'kitchen', 'library', 'workshop', 'smithy', 'parlor',
                 'chapel', 'sanctuary', 'dormitory', 'nook', 'booth',
                 'office', 'warehouse', 'cabin', 'tapestry', 'tapestries',
                 'curtain', 'tent'),
    'forest': ('forest', 'wood', 'wooded', 'grove', 'canopy', 'thicket',
               'trees'),
    # 'tunnel' is the noun in 574 of the 600-odd places the corpus writes it
    # and the verb in a handful ("one winding alley tunnels under another"),
    # which is why the bare word was left out originally. Counted rather than
    # argued: 'the tunnel' 392, 'the tunnels' 76, 'a tunnel' 25, 'this tunnel'
    # 25, 'of tunnels' 32. A determiner in front of it settles the question,
    # and an unanchored 'tunnel' stays unread rather than being guessed at.
    'underground': ('underground', 'beneath the', 'below the surface',
                    'the tunnel', 'a tunnel', 'this tunnel', 'of tunnel',
                    'the burrow', 'a burrow', 'catacomb', 'crypt', 'sewer',
                    'warren', 'chasm', 'abyss'),
    # Weather words were all this had at first, and they cost 823 rooms in the
    # first 2,000: "the street climbs up the great hill", "along the side of
    # the road", "a natural bridge across the swiftly moving river" are
    # unmistakably outdoors and mention no sky at all. A place you can only
    # stand in outdoors is evidence of being outdoors - and it is still the
    # description saying so, which is the rule that matters.
    'outdoor': ('sky', 'sun', 'clouds', 'overhead', 'horizon', 'open air',
                'breeze', 'wind', 'outside',
                'road', 'street', 'avenue', 'alley', 'lane', 'thoroughfare',
                'courtyard', 'square', 'plaza', 'garden', 'field', 'pasture',
                'hill', 'hillside', 'slope', 'ridge', 'cliff', 'valley',
                'river', 'riverbank', 'shore', 'beach', 'dock', 'pier',
                'bridge', 'pavement', 'gate', 'rooftop', 'terrace',
                # A bare 'green' was here for the village green, and it was
                # measured and cut. It is the colour in 475 rooms and the
                # place in 136, and putting it back is worth +77 clean reads
                # of which roughly four in five are a patch of dark green moss
                # being read as open ground. That is the exact invention this
                # parser exists to refuse, so the 0.4 of a point stays lost
                # and only the named place is kept. 'green' still earns its
                # keep in TINT, which is where it always belonged.
                'village green', 'town green', 'the commons',
                'path', 'trail', 'walkway', 'hedge', 'yard',
                'park', 'orchard', 'meadow', 'clearing', 'crossroads',
                # Same reasoning one step further out. The list above has the
                # places a *town* puts you outdoors and almost no wild ones,
                # so open country read as nothing at all: "dark shadowy buttes
                # rise above the flat expanse of the savannah" was refused
                # outright. These are the wild and coastal places the corpus
                # actually names, with their counts taken from it.
                'savannah', 'prairie', 'steppe', 'desert', 'dune', 'moor',
                'canyon', 'gorge', 'ravine', 'bluff', 'knoll', 'summit',
                'mountain', 'glade', 'plateau', 'butte', 'mesa', 'ledge',
                'marsh', 'swamp', 'bog', 'lake', 'pond', 'island', 'creek',
                'brook', 'rapids', 'waterfall', 'glacier', 'shoreline',
                'boulevard', 'promenade', 'esplanade', 'wharf', 'jetty',
                'harbor', 'harbour', 'cove', 'inlet', 'lagoon', 'moat',
                'rampart', 'battlement', 'vista', 'graveyard', 'cemetery',
                'quarry', 'causeway', 'boardwalk', 'sidewalk',
                # A ship's deck is under the sky; its cabins are in the
                # interior list above.
                'deck', 'mast', 'rigging',
                # Weather you can only stand in outdoors. 'mist' was tested
                # and rejected - caves are full of it.
                'rain', 'fog', 'storm', 'snowfall', 'drizzle',
                'moon', 'stars', 'dawn', 'dusk', 'twilight'),
}

# Built things. These become wall, door and prop sprites.
STRUCTURE = {
    'wall-stone': ('stone wall', 'granite wall', 'marble wall', 'walls of stone'),
    'wall-wood': ('wooden wall', 'timber wall', 'plank wall', 'log wall'),
    'wall-brick': ('brick', 'masonry'),
    'wall': ('wall', 'walls', 'walled'),
    'door': ('door', 'doorway', 'gate', 'portal', 'archway', 'arch', 'arched'),
    'window': ('window', 'casement', 'shutters'),
    'stair': ('stair', 'stairs', 'stairway', 'steps', 'staircase', 'ladder'),
    'pillar': ('pillar', 'column', 'post', 'support'),
    'roof': ('roof', 'roofed', 'rooftop', 'eaves', 'thatch', 'thatched'),
    'fence': ('fence', 'railing', 'rail', 'balustrade', 'palisade'),
    'bridge': ('bridge', 'span', 'crossing'),
    'building': ('building', 'house', 'structure', 'cottage', 'hut', 'tower',
                 'shack', 'edifice', 'shop', 'storefront', 'inn', 'tavern',
                 'temple', 'hall of', 'dome', 'arena', 'warehouse', 'barn',
                 'stable', 'mill', 'guild'),
    'counter': ('counter', 'table', 'desk', 'bench', 'stall', 'shelf', 'shelves'),
    'hearth': ('hearth', 'fireplace', 'forge', 'furnace', 'brazier', 'oven'),
    'statue': ('statue', 'monument', 'obelisk', 'shrine', 'altar', 'idol'),
    'well': ('well', 'fountain', 'cistern', 'trough'),
    'sign': ('sign', 'signpost', 'placard', 'plaque'),
}

# The shape of the land itself. This class exists because of a population the
# audit was refusing wholesale: rooms with an enclosure and a ground and no
# features at all. #13845 ("Each giant sand dune is constantly being built,
# destroyed, and moved") and #52389 ("Great mounds of fine golden sand make up
# the huge swells") are not empty rooms - they are rooms whose entire content
# is landform, and the parser had no word for a landform, so it read them as
# containing nothing. A silhouette is a thing a renderer has to draw.
TERRAIN = {
    'dune': ('dune', 'sand drift'),
    'cliff': ('cliff', 'precipice', 'bluff', 'palisade of rock'),
    'ledge': ('ledge', 'shelf of rock', 'overhang', 'overhanging'),
    'boulder': ('boulder', 'outcropping', 'outcrop', 'crag', 'standing stone'),
    'rubble': ('rubble', 'scree', 'debris', 'shards of rock'),
    'hill': ('hill', 'hillock', 'knoll', 'mound', 'rise', 'hummock'),
    'slope': ('slope', 'incline', 'embankment', 'grade'),
    'ridge': ('ridge', 'spine of rock', 'arete'),
    'mountain': ('mountain', 'plateau', 'mesa', 'butte', 'summit'),
    'valley': ('valley', 'canyon', 'ravine', 'gorge', 'gully', 'chasm',
               'crater', 'depression', 'hollow'),
    'shore': ('shore', 'shoreline', 'strand', 'sandbar', 'mudflat'),
    'expanse': ('expanse', 'plain of', 'flats', 'basin'),
}

# Movable and applied things - the goods, furnishings and remains a room names.
# Same origin as TERRAIN: an interior whose whole description is crates,
# tapestries and racked weapons was scoring zero features, because STRUCTURE
# only knows about things that are built in place. 'tools' is listed in the
# plural on purpose; the singular also matches 'tooled', which in this corpus
# is nearly always leather.
GOODS = {
    'crate': ('crate', 'barrel', 'keg', 'cask', 'chest of', 'coffer'),
    'basket': ('basket', 'sack', 'bundle', 'pouch of'),
    'cushion': ('cushion', 'pillow', 'mattress', 'bedroll'),
    'rope': ('rope', 'cord', 'chain', 'cable'),
    'banner': ('banner', 'pennant', 'flag', 'standard of'),
    'hanging': ('tapestry', 'tapestries', 'curtain', 'curtained', 'drape',
                'hanging'),
    'artwork': ('mural', 'painting', 'portrait', 'fresco', 'carving', 'relief'),
    'book': ('book', 'scroll', 'tome', 'ledger', 'parchment', 'manuscript'),
    'tools': ('tools', 'hammer', 'anvil', 'bellows', 'loom of', 'spindle'),
    'weapon': ('weapon', 'sword', 'blade', 'spear', 'axe', 'bow and'),
    'armor': ('armor', 'armour', 'shield', 'helm', 'mail'),
    'pottery': ('pottery', 'urn', 'vase', 'jar', 'crockery', 'bowl'),
    'remains': ('bone', 'skull', 'corpse', 'carcass', 'skeleton'),
    'web': ('web', 'cobweb', 'nest', 'burrow of'),
    'cage': ('cage', 'crate of', 'pen of', 'coop'),
    'pole': ('pole', 'stake', 'mast of', 'flagpole'),
}

# What grows. Dan named plants specifically as a primitive class.
FLORA = {
    'tree-broadleaf': ('oak', 'maple', 'elm', 'birch', 'willow', 'beech',
                       'broadleaf', 'leafy tree'),
    'tree-conifer': ('pine', 'fir', 'spruce', 'cedar', 'evergreen', 'conifer'),
    'tree-palm': ('palm', 'frond'),
    'tree-dead': ('dead tree', 'skeletal tree', 'blasted tree', 'stump'),
    'tree': ('tree', 'trees', 'trunk', 'branches', 'boughs'),
    'shrub': ('bush', 'shrub', 'hedge', 'bramble', 'undergrowth', 'scrub'),
    'vine': ('vine', 'ivy', 'creeper', 'tendril'),
    'flower': ('flower', 'flowering', 'blossom', 'bloom', 'blooming', 'petal',
               'rose', 'lily'),
    'reed': ('reed', 'rush', 'cattail', 'sedge'),
    'fern': ('fern', 'frond', 'bracken'),
    'crop': ('crop', 'field of', 'wheat', 'grain', 'orchard', 'vineyard'),
}

# Moving water and weather. These animate, so they are worth their own class.
WATER = {
    'river': ('river', 'current', 'rapids'),
    'stream': ('stream', 'brook', 'creek', 'rivulet'),
    'sea': ('sea', 'ocean', 'surf', 'waves', 'tide'),
    'lake': ('lake', 'pool', 'pond', 'lagoon'),
    'waterfall': ('waterfall', 'cascade', 'falls'),
    'marsh': ('marsh', 'swamp', 'fen', 'wetland'),
}

# What lights the scene, which decides the palette more than anything else.
LIGHT = {
    'sunlit': ('sunlight', 'sunlit', 'bright sun', 'daylight', 'sunbeam'),
    'moonlit': ('moonlight', 'moonlit', 'starlight', 'night sky'),
    'torch': ('torch', 'torchlight', 'sconce', 'brazier'),
    'lamp': ('lamp', 'lantern', 'globe', 'candle', 'candelabra'),
    'firelight': ('firelight', 'fire', 'flames', 'embers', 'glow', 'glowing'),
    'gloom': ('dark', 'gloom', 'shadow', 'dim', 'murky', 'unlit', 'pitch'),
}

# Tints. Colour words are frequent enough in the corpus to be worth carrying
# through to the sprite tint rather than thrown away.
TINT = {
    'white': ('white', 'pale', 'ivory', 'alabaster'),
    'grey': ('grey', 'gray', 'slate', 'ashen'),
    'black': ('black', 'ebon', 'obsidian', 'sable'),
    'brown': ('brown', 'umber', 'tan', 'russet'),
    'green': ('green', 'verdant', 'emerald'),
    'red': ('red', 'crimson', 'scarlet', 'rust'),
    'gold': ('gold', 'golden', 'brass', 'amber'),
    'blue': ('blue', 'azure', 'cerulean'),
}

# Size and shape modifiers, which scale the sprite rather than choose it.
SCALE = {
    'huge': ('huge', 'massive', 'enormous', 'vast', 'towering', 'immense'),
    'large': ('large', 'big', 'broad', 'wide', 'great'),
    'tall': ('tall', 'high', 'lofty'),
    'small': ('small', 'little', 'tiny', 'narrow', 'cramped'),
    'long': ('long', 'lengthy'),
}

# People, as the room's own description accounts for them.
#
# This class exists because a live playtest bot walked 169 real rooms and filed
# the same complaint twelve times: every scene was drawn empty of people. It was
# right. Before this table the parser knew the word 'people' only well enough to
# stop "the stream of customers" being read as a river.
#
# What is in here and what is deliberately not:
#
# **A description tells you who is USUALLY somewhere. Only the live game tells
# you who is there NOW.** Both halves of that sentence are load-bearing. "A
# place for merchant and customer to haggle" is a standing fact about a market
# and is worth drawing on every visit; the shaggy mutt the game reports this
# second is not, and nothing in this table is about it. `forge/presence.py`
# carries the contract for the live half and says why it must never be baked in.
#
# Counts are rooms out of the 18,945 that carry a description, measured with the
# same boundaried matcher `extract.py` uses, before any of these terms were
# written down. Terms that were counted and REJECTED are listed at the bottom
# with the reason, because a rejection nobody records gets re-proposed.
PRESENCE = {
    # Many, unnamed. These are the terms that make a place busy rather than
    # merely occupied, so this kind is what sets the 'thronged' density.
    # crowds 71, throng 28, bustle 132, bustling 61, traffic 194, hustle 26,
    # passersby 63, passers-by 28, pedestrian 31, milling 14, jostle 11,
    # teeming 9, people 217.
    #
    # 'crowd' is listed only with a determiner, and that is measured rather
    # than fussy: of its 195 rooms, the bare word is a verb in a large share -
    # "plain stone buildings crowd the narrow lane", "storefronts crowd their
    # way toward the path". Same lesson the 'tunnel' entry above learned. The
    # plural is kept bare: a building crowds nothing in this corpus.
    # Known false positive, left in with its count rather than patched around:
    # "a narrow byway slinks between crowds of shuttered buildings" is 2 rooms
    # out of the 791 this kind fires in. Both happen to be discounted by the
    # busy-elsewhere guard in `presence.py`, and that is an accident - the cue
    # firing there is "curving away from the North Wall Road", which has nothing
    # to do with buildings. Counted every "crowds of ..." in the corpus and the
    # rest are people, so a guard for this would be two rooms of vocabulary
    # against a new way to be wrong.
    'crowd': ('a crowd', 'the crowd', 'crowds', 'throng', 'bustle', 'bustling',
              'hustle', 'traffic', 'passersby', 'passers-by', 'pedestrian',
              'milling', 'jostle', 'teeming', 'people'),
    # Here to buy or to visit. customer 298, patron 184, visitor 192,
    # shopper 128, guest 102, haggle 47, clientele 23.
    'patron': ('customer', 'patron', 'visitor', 'shopper', 'guest', 'haggle',
               'clientele'),
    # Passing through. traveler 352, traveller 36. The largest single presence
    # term in the corpus, and nearly always habitual - "a foreboding sign to
    # travelers who dare disturb" is a claim about the road, not a headcount.
    # wayfarer 11.
    'traveler': ('traveler', 'traveller', 'wayfarer'),
    # Sells here. merchant 235, trader 175, vendor 27, peddler 8, hawker 6.
    # fishmonger 4.
    'trader': ('merchant', 'trader', 'vendor', 'peddler', 'hawker',
               'fishmonger'),
    # Works here, in service rather than in trade. clerk 229, attendant 93,
    # apprentice 50, proprietor 34, servant 28, teller 27, shopkeeper 21,
    # innkeeper 5, barkeep 2.
    # waiter 9. The bare word 'staff' is NOT here; see the rejections below.
    'staff': ('clerk', 'attendant', 'apprentice', 'proprietor', 'servant',
              'teller', 'shopkeeper', 'innkeeper', 'barkeep', 'waiter'),
    # Armed watch. soldier 42, sentry 21, sentries 12, guardsmen 10, militia 8,
    # guardsman 4, watchman 4, watchmen 4.
    #
    # 'guard' is here bare, at 359 rooms, and it is the one term in this table
    # that cannot be read by containment: it is a verb in roughly a third of its
    # 388 occurrences ("a mahogany banister guards the edge", "obelisks stand
    # guard over the road"). The determined forms were tried first - 'a guard',
    # 'the guards', 'armed guard' - and they measured 52 rooms out of the 251
    # occurrences that really are people, because a determiner plus an adjective
    # is how this corpus usually introduces one: "a beefy guard", "s'kra
    # guards", "a stern-looking clan guard". So the word is read per occurrence
    # instead, by `presence.every_occurrence_is_other`, which is where the
    # evidence for the transitive/intransitive split is written down.
    'guard': ('guard', 'guardsman', 'guardsmen', 'sentry', 'sentries',
              'watchman', 'watchmen', 'soldier', 'militia'),
    # Manual and craft labour. worker 123, farmer 50, artisan 42, crafter 37,
    # sailor 29, builder 24, craftsmen 22, laborer 20, workmen 18, craftsman 12,
    # miner 11, fisherman 9. 'workman' returned 0 rooms and is not listed;
    # 'workmen' is what this corpus writes.
    # 'labourer' was proposed and counted 0 rooms; this corpus spells it the
    # American way throughout, and a term that matches nothing is dead weight
    # the audit would have to keep reporting as a zero.
    'worker': ('worker', 'farmer', 'artisan', 'crafter', 'sailor', 'builder',
               'craftsmen', 'craftsman', 'laborer', 'workmen', 'miner',
               'fisherman', 'fishermen', 'stevedore'),
    # Devotional presence. monk 43, cleric 38, priest 26, worshipper 14,
    # pilgrim 14, acolyte 9, worshiper 7, priestess 5.
    'devout': ('monk', 'cleric', 'priest', 'priestess', 'worshipper',
               'worshiper', 'pilgrim', 'acolyte'),
    # student 57, scholar 21, scribe 11, teacher 10, librarian 5.
    'scholar': ('student', 'scholar', 'scribe', 'teacher', 'librarian'),
    # Lives here. resident 159, inhabitant 78, citizen 51, denizen 41,
    # neighbor 41, folk 37, locals 30, townsfolk 19, dweller 14, villager 10.
    'resident': ('resident', 'inhabitant', 'citizen', 'denizen', 'neighbor',
                 'folk', 'locals', 'townsfolk', 'dweller', 'villager'),
    # children 161, child 66, lad 20, youth 12, urchin 10.
    'child': ('children', 'child', 'lad', 'youth', 'urchin'),
    # Fighters who are not the watch. warrior 91, adventurer 60, hunter 36,
    # archer 21, trapper 11. 'mercenary' counted 1 room and was dropped.
    'martial': ('warrior', 'adventurer', 'hunter', 'trapper', 'archer'),
    # performer 28, musician 19, dancer 18, bard 15, minstrel 8.
    'performer': ('musician', 'performer', 'dancer', 'bard', 'minstrel'),
    # People the room says you can hear but does not show you. Worth its own
    # kind because it is drawn as sound and off-screen motion, not as a figure.
    # conversation 86, voices 78, laughter 75, chatter 34, gossip 13.
    #
    # 'footstep' (172) was counted and left out: its commonest use by a wide
    # margin is the reader's own - "footsteps echo along the passage" appears
    # 29 times verbatim - which is presence of nobody. 'murmur' (53), 'babble'
    # (16) and 'cries' (56) went the same way: running water and gulls.
    'voices': ('voices', 'laughter', 'chatter', 'conversation', 'gossip'),
}

# Counted and rejected, so that nobody has to count them twice:
#
#   'face' 390 / 'faces' 119   a rock face, a cliff face, a building that
#                              faces the bay. Almost never a person's.
#   'figure' 61 / 'figures'    a carved figure, the figure of a god, figures
#              115            engraved on a plaque. Roughly half.
#   'body' 82 / 'bodies' 78    "a large body of water", and where they are
#                              people they are corpses in a catacomb.
#   'press' 78                 "senses press for attention", "brambles press
#                              in on all sides".
#   'multitude' 75            "a multitude of small flecks", "a multitude of
#                              books". A quantity word, not a crowd.
#   'sentinel' 72             metaphor in nearly every instance: a fir, a
#                              cairn, a mooring, a gate "stands sentinel".
#   'local' 233               an adjective. "the local name for this area",
#                              "the local flora". Where it modifies a person
#                              the head noun is already in the table.
#   'owner' 105               commonest use is a possessive about somebody
#                              absent or dead - "its former owner", "attesting
#                              its owner's neglect".
#   'man' 127 / 'men' 70      'man-made' alone is 22 rooms, and 'man and
#                              beast' is a figure of speech. The specific role
#                              nouns carry this weight already.
#   'noble' 32               "noble lords" (the head noun is the person), but
#                              also "this noble giant" of a tree and "a noble
#                              effort".
#   'staff' 51               the personnel sense and the walking stick, in one
#                              word, at similar rates.
#   'band' 37 / 'party' 15    a band of stained glass windows; a death party
#                              of wax drippings.
#   'master' 62              a modifier in nearly all of them - "master
#                              trader", "master craftsman" - so the head noun
#                              is what gets read.

CATEGORIES = {
    'ground': GROUND,
    'presence': PRESENCE,
    'enclosure': ENCLOSURE,
    'structure': STRUCTURE,
    'terrain': TERRAIN,
    'goods': GOODS,
    'flora': FLORA,
    'water': WATER,
    'light': LIGHT,
    'tint': TINT,
    'scale': SCALE,
}

# Compass words, used to place a detected feature rather than scatter it.
# "a fountain to the southeast" is placeable; this is what reads it.
DIRECTIONS = (
    'northeast', 'northwest', 'southeast', 'southwest',
    'north', 'south', 'east', 'west',
    'above', 'below', 'overhead', 'underfoot', 'center', 'centre',
)
