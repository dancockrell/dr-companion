# Board legibility — 5 September 2026

Increment L7's second half, and the first time anyone has looked at this board
in a captured image rather than reasoned about it.

Dan, playing the viewer:

> the exits are sometimes hard to find… you should put a little bit of a gap
> between each block, good idea anyways actually, prevents clipping

> some kind of shape randomly on the edge for directions… the 8 cardinal and
> sub cardinal directions most of the time… but not on the block itself, it
> won't be readable. it should be on the edge actually, but keep the nodes and
> edges nice.

## How this was looked at

`tools/capture-godot-window.ps1`, which Lane L wrote after `PrintWindow`
returned an unchanging image for the GPU-composited Godot window. It refused
twice rather than photographing whatever was in front — the abort is the reason
these pictures are of the thing they claim to be.

PowerShell's execution policy here is `AllSigned`, so the script needs
`-ExecutionPolicy Bypass` to run at all. Viewer launched with
`Godot_v4.3-stable_win64.exe --path godot` (mock mode), killed by PID after
each capture.

| | |
|---|---|
| `board-before-2026-09-05.png` | the board as Dan found it |
| `board-after-2026-09-05.png` | after the four changes below |

## What the pictures showed, in order

**1. The blocks overlapped.** Not a missing gap — the median room sat 2.5 m
from its neighbour while every block was 4.4–5 m wide. Fixed by deriving the
scale (`8 map units × scale ≥ block + gutter` → 0.625), which is the main body
of L7. The before capture already has the gutter; both pictures show separated
tiles.

**2. Eight labels crowded one block.** The before capture shows `southwest`,
`go green pond`, `west`, `south`, `north`, `east`, `southeast` and
`go weaponsmith's` overlapping into an unreadable knot — this *was* the
readability problem Dan named. A compass chevron already says which way it
points, so it needs no word; an exit like `go weaponsmith's` has no direction
to draw, so it keeps one. Two words on the board now instead of eight. The
viewer's own "Current exits" list still names every exit, so nothing is lost
for a player who wants the text.

**3. The markers were buried in the block.** They sat at `y = 0.08` while the
cell block is 0.3 tall centred on its origin, so it spans −0.15 to +0.15: the
chevrons were inside its upper half, which is why they read as small clipped
slivers. Raised to 0.24, clear of the top face, and enlarged from 0.9 × 0.7 to
1.2 × 0.9.

**4. The markers were the same colour as the block.** `Color(0.95, 0.85, 0.30)`
against a gold street cell — findable only once you knew where to look, which
is the complaint restated. Now cyan `Color(0.45, 0.85, 1.0)`: far from every
terrain colour in the palette (gold street, green grass, brown earth) and
matching the blue that already outlines the current room, so an exit reads as
part of the selection language rather than as ground.

## What is still not settled

- **Nobody has clicked one.** Lane L got synthesised clicks to move the mock
  room, so the press path is alive, but which marker was hit could not be
  attributed. One human click on a cyan chevron settles it.
- **These are mock-mode captures.** The live board is the same geometry driven
  by real snapshots, and it has not been photographed.
- **The camera was at Route distance.** World and Room distances are not
  captured, and the marker size is tuned for what is in these pictures.
- Whether cyan is the right colour is Dan's call, not a measurement. It is one
  constant in `exit_anchor_layer.gd`.
