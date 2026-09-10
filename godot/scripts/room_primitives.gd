extends RefCounted
# Deliberately no `class_name`. Every user of this file `preload`s it under the
# name `RoomPrimitives`, and a global class of the same name would collide with
# that constant the moment somebody opened the project in the editor and the
# global class cache was built - a parse error that only appears on one
# machine, in one workflow, and never in a headless run.
## The placeholder vocabulary: one entry per `kind` the forge can emit.
##
## There is no art yet. Every entry here is a coloured polygon with a label on
## it, and that is deliberate rather than temporary scaffolding: the entry says
## what *shape of thing* a kind is (does it lie flat on the ground, stand up in
## the cell, run along an edge, or hang overhead) and how big it is. Those are
## the facts a layout depends on. The colour is the only part real art
## replaces.
##
## So when sprites arrive, `art` gains a texture path per kind and
## `RoomComposer` swaps `Polygon2D` for `Sprite2D`. Footprint, anchor, height
## and z-order are already decided here and do not move, which is the whole
## point of keeping them in a table rather than inline in the composer.
##
## # Unknown kinds are a third state
##
## `of()` never invents an entry. A kind this table has never heard of comes
## back flagged `unknown`, gets a magenta box so it is impossible to miss on
## screen, and `RoomComposer.report()` lists it separately. A silent grey
## default would make a forge that emitted `tree-brodleaf` look exactly like
## one that emitted `tree-broadleaf`, and the render would look fine.

## Screen size of one ground cell. Isometric 2:1, the ordinary choice, and the
## only two numbers the projection in `RoomComposer.iso()` uses.
const TILE_W := 64.0
const TILE_H := 32.0

## How a primitive occupies its cell.
##   FLAT  - lies on the ground, one tile diamond (ground, water, carpet)
##   BLOCK - stands in the cell, an extruded box (buildings, walls, rocks)
##   POST  - narrow and tall (trees, pillars, signs, statues)
##   PANEL - a boundary segment, drawn along the cell rather than in it
##   HANG  - overhead, drawn lifted clear of the floor (canopy, ceiling)
enum Shape { FLAT, BLOCK, POST, PANEL, HANG }

## `[shape, height_px, color]`. Heights are in screen pixels at scale 1.
const TABLE := {
	# ---- ground surfaces (forge/lexicon.py GROUND) -----------------------
	"cobble": [Shape.FLAT, 0.0, Color(0.44, 0.43, 0.41)],
	"flagstone": [Shape.FLAT, 0.0, Color(0.52, 0.51, 0.48)],
	"stone-floor": [Shape.FLAT, 0.0, Color(0.48, 0.48, 0.50)],
	"wood-floor": [Shape.FLAT, 0.0, Color(0.45, 0.31, 0.18)],
	"tile": [Shape.FLAT, 0.0, Color(0.62, 0.60, 0.56)],
	"carpet": [Shape.FLAT, 0.0, Color(0.45, 0.15, 0.18)],
	"sand": [Shape.FLAT, 0.0, Color(0.78, 0.70, 0.48)],
	"snow": [Shape.FLAT, 0.0, Color(0.86, 0.89, 0.93)],
	"mud": [Shape.FLAT, 0.0, Color(0.33, 0.26, 0.18)],
	"grass": [Shape.FLAT, 0.0, Color(0.30, 0.47, 0.24)],
	"moss": [Shape.FLAT, 0.0, Color(0.27, 0.42, 0.28)],
	"dirt": [Shape.FLAT, 0.0, Color(0.40, 0.32, 0.22)],
	"gravel": [Shape.FLAT, 0.0, Color(0.50, 0.48, 0.44)],
	"road": [Shape.FLAT, 0.0, Color(0.42, 0.38, 0.33)],
	"path": [Shape.FLAT, 0.0, Color(0.46, 0.40, 0.30)],
	"water": [Shape.FLAT, 0.0, Color(0.20, 0.38, 0.52)],
	"rock": [Shape.FLAT, 0.0, Color(0.42, 0.42, 0.44)],

	# ---- boundaries and canopies (forge/compose.py ARCHETYPES) -----------
	"wall": [Shape.PANEL, 46.0, Color(0.55, 0.52, 0.48)],
	"rock-face": [Shape.PANEL, 58.0, Color(0.36, 0.35, 0.36)],
	"treeline": [Shape.PANEL, 64.0, Color(0.18, 0.32, 0.19)],
	# "open" is what an outdoor archetype has at its edge: nothing built. It
	# is a real value from the composer, not a missing one, so it gets an
	# entry with zero height and full transparency rather than being dropped
	# into the unknown bucket.
	"open": [Shape.PANEL, 0.0, Color(0.0, 0.0, 0.0, 0.0)],
	"ceiling": [Shape.HANG, 0.0, Color(0.30, 0.28, 0.26, 0.55)],
	"rock-ceiling": [Shape.HANG, 0.0, Color(0.22, 0.21, 0.22, 0.70)],
	"branches": [Shape.HANG, 0.0, Color(0.16, 0.30, 0.17, 0.45)],
	"sky": [Shape.HANG, 0.0, Color(0.40, 0.58, 0.78, 0.22)],

	# ---- structure (forge/lexicon.py STRUCTURE) --------------------------
	"wall-stone": [Shape.PANEL, 48.0, Color(0.55, 0.54, 0.52)],
	"wall-wood": [Shape.PANEL, 44.0, Color(0.46, 0.32, 0.19)],
	"wall-brick": [Shape.PANEL, 46.0, Color(0.51, 0.27, 0.22)],
	"door": [Shape.PANEL, 40.0, Color(0.62, 0.44, 0.20)],
	"window": [Shape.PANEL, 26.0, Color(0.52, 0.68, 0.75)],
	"stair": [Shape.BLOCK, 24.0, Color(0.50, 0.47, 0.42)],
	"pillar": [Shape.POST, 72.0, Color(0.66, 0.64, 0.60)],
	"roof": [Shape.BLOCK, 62.0, Color(0.38, 0.24, 0.20)],
	"fence": [Shape.PANEL, 20.0, Color(0.44, 0.34, 0.24)],
	"bridge": [Shape.FLAT, 6.0, Color(0.44, 0.35, 0.26)],
	"building": [Shape.BLOCK, 88.0, Color(0.47, 0.41, 0.36)],
	"counter": [Shape.BLOCK, 22.0, Color(0.42, 0.30, 0.20)],
	"hearth": [Shape.BLOCK, 34.0, Color(0.35, 0.18, 0.14)],
	"statue": [Shape.POST, 54.0, Color(0.60, 0.58, 0.54)],
	"well": [Shape.BLOCK, 20.0, Color(0.38, 0.42, 0.48)],
	"sign": [Shape.POST, 34.0, Color(0.50, 0.40, 0.26)],

	# ---- flora (forge/lexicon.py FLORA) ----------------------------------
	"tree-broadleaf": [Shape.POST, 86.0, Color(0.22, 0.44, 0.22)],
	"tree-conifer": [Shape.POST, 96.0, Color(0.15, 0.34, 0.24)],
	"tree-palm": [Shape.POST, 90.0, Color(0.29, 0.47, 0.26)],
	"tree-dead": [Shape.POST, 70.0, Color(0.36, 0.31, 0.25)],
	"tree": [Shape.POST, 82.0, Color(0.24, 0.42, 0.23)],
	"shrub": [Shape.BLOCK, 22.0, Color(0.26, 0.40, 0.22)],
	"vine": [Shape.POST, 40.0, Color(0.28, 0.45, 0.25)],
	"flower": [Shape.POST, 12.0, Color(0.72, 0.45, 0.60)],
	"reed": [Shape.POST, 30.0, Color(0.52, 0.55, 0.30)],
	"fern": [Shape.BLOCK, 18.0, Color(0.24, 0.44, 0.28)],
	"crop": [Shape.FLAT, 10.0, Color(0.62, 0.56, 0.26)],

	# ---- water (forge/lexicon.py WATER) ----------------------------------
	"river": [Shape.FLAT, 0.0, Color(0.18, 0.36, 0.54)],
	"stream": [Shape.FLAT, 0.0, Color(0.22, 0.42, 0.56)],
	"sea": [Shape.FLAT, 0.0, Color(0.12, 0.30, 0.50)],
	"lake": [Shape.FLAT, 0.0, Color(0.18, 0.34, 0.48)],
	"waterfall": [Shape.PANEL, 60.0, Color(0.30, 0.50, 0.62)],
	"marsh": [Shape.FLAT, 0.0, Color(0.28, 0.34, 0.26)],
}

## Tints the forge can attach to a detection (`forge/lexicon.py` TINT).
const TINTS := {
	"white": Color(1.00, 0.98, 0.94),
	"grey": Color(0.72, 0.73, 0.75),
	"black": Color(0.30, 0.30, 0.33),
	"brown": Color(0.72, 0.55, 0.36),
	"green": Color(0.55, 0.85, 0.50),
	"red": Color(0.90, 0.42, 0.36),
	"gold": Color(0.95, 0.78, 0.32),
	"blue": Color(0.50, 0.68, 0.95),
}

## Scale words (`forge/lexicon.py` SCALE) as a size multiplier.
const SCALES := {
	"huge": 1.9,
	"large": 1.4,
	"tall": 1.35,
	"small": 0.6,
	"long": 1.25,
}

## What an unrecognised kind gets: loud magenta, and `unknown` set so the
## report can count it instead of the render quietly absorbing a typo.
const UNKNOWN := [Shape.BLOCK, 30.0, Color(1.0, 0.0, 0.85)]


## The table entry for `kind`, as a dictionary, never null.
##
## `unknown` is part of the answer rather than an exception, so every caller
## gets a drawable primitive AND the fact that the table did not recognise it.
static func of(kind: String) -> Dictionary:
	var known: bool = TABLE.has(kind)
	var row: Array = TABLE[kind] if known else UNKNOWN
	return {
		"kind": kind,
		"shape": int(row[0]),
		"shape_name": shape_name(int(row[0])),
		"height": float(row[1]),
		"color": row[2] as Color,
		"unknown": not known,
	}


static func shape_name(shape: int) -> String:
	match shape:
		Shape.FLAT: return "flat"
		Shape.BLOCK: return "block"
		Shape.POST: return "post"
		Shape.PANEL: return "panel"
		Shape.HANG: return "hang"
	return "?"


## Size multiplier for a forge `scale` word. An absent or unrecognised word is
## 1.0 and is reported as such by `scale_known()`, not silently rounded up.
static func scale_of(word) -> float:
	if word is String and SCALES.has(word):
		return float(SCALES[word])
	return 1.0


static func scale_known(word) -> bool:
	return word is String and SCALES.has(word)


## Modulate colour for a forge `tint` word, or white (no change).
static func tint_of(word) -> Color:
	if word is String and TINTS.has(word):
		return TINTS[word] as Color
	return Color.WHITE


static func tint_known(word) -> bool:
	return word is String and TINTS.has(word)


## The outline of one primitive, in local pixels, anchored so that (0,0) is
## the centre of the ground cell it stands on.
##
## FLAT is the tile diamond. BLOCK/POST are the ordinary isometric box
## silhouette - a hexagon, top face raised by `height`. PANEL is a box a
## quarter as deep, meant to sit along a boundary. HANG is a diamond drawn
## where it will be lifted overhead by the composer.
static func outline(shape: int, height: float) -> PackedVector2Array:
	var hw := TILE_W * 0.5
	var hh := TILE_H * 0.5
	match shape:
		Shape.FLAT, Shape.HANG:
			return PackedVector2Array([
				Vector2(0.0, -hh), Vector2(hw, 0.0),
				Vector2(0.0, hh), Vector2(-hw, 0.0),
			])
		Shape.POST:
			hw *= 0.34
			hh *= 0.34
		Shape.PANEL:
			hh *= 0.30
	return PackedVector2Array([
		Vector2(0.0, -hh - height), Vector2(hw, -height),
		Vector2(hw, 0.0), Vector2(0.0, hh),
		Vector2(-hw, 0.0), Vector2(-hw, -height),
	])
