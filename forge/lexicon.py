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

# What encloses you. This decides whether the scene has a ceiling and walls
# or a sky and a horizon, so it is the single most load-bearing call the
# parser makes.
ENCLOSURE = {
    # 'tunnels' and 'burrows' are verbs as often as nouns in this corpus
    # ("one winding alley tunnels under another" is a street, not a cave),
    # so the cave words are the ones that can only be things.
    'cave': ('cavern', 'cave', 'grotto', 'rough-hewn', 'stalactite',
             'stalagmite', 'cave mouth', 'rocky ceiling'),
    'interior': ('room', 'chamber', 'hall', 'ceiling', 'rafters', 'shop',
                 'walls of this', 'inside', 'indoor', 'hearth', 'counter'),
    'forest': ('forest', 'wood', 'grove', 'canopy', 'thicket', 'trees'),
    'underground': ('underground', 'beneath the', 'below the surface'),
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
                'path', 'trail', 'walkway', 'green', 'hedge', 'yard',
                'park', 'orchard', 'meadow', 'clearing', 'crossroads'),
}

# Built things. These become wall, door and prop sprites.
STRUCTURE = {
    'wall-stone': ('stone wall', 'granite wall', 'marble wall', 'walls of stone'),
    'wall-wood': ('wooden wall', 'timber wall', 'plank wall', 'log wall'),
    'wall-brick': ('brick', 'masonry'),
    'wall': ('wall', 'walls'),
    'door': ('door', 'doorway', 'gate', 'portal', 'archway', 'arch'),
    'window': ('window', 'casement', 'shutters'),
    'stair': ('stair', 'stairs', 'stairway', 'steps', 'staircase', 'ladder'),
    'pillar': ('pillar', 'column', 'post', 'support'),
    'roof': ('roof', 'rooftop', 'eaves', 'thatch'),
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
    'flower': ('flower', 'blossom', 'bloom', 'petal', 'rose', 'lily'),
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
    'firelight': ('firelight', 'fire', 'flames', 'embers', 'glow'),
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

CATEGORIES = {
    'ground': GROUND,
    'enclosure': ENCLOSURE,
    'structure': STRUCTURE,
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
