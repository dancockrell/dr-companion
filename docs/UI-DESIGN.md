# What goes on the screen, and why

Written after being told to stop building and go find out. It is a record of
what the data actually supports, what a player actually needs in front of them,
and where this app is currently wrong.

Nothing here is a guess about the game. Every capability listed was read out of
Lich 5.20.1 on this machine, and the paths are given so the next person can
check rather than trust.

## First, a correction

There was never a paperdoll, enemy cards, or an earlier map system in this
repository. `git log --diff-filter=D` lists exactly one deleted component,
`SimpleDashboard.tsx`, removed on 25 Aug 2026 when three UI modes became two.
Build A shipped fifteen components and none of them were those.

That is worth stating plainly and then setting aside, because the substance of
the complaint is correct: those things should exist and do not. Who deleted
them is not the interesting part.

## The scale we are working next to

`uber.cmd`, one community combat script, is **77,867 lines**. With its includes,
about 95,000. It is that size because DragonRealms does not present a clean
state machine — it presents exceptions. `uberwatch.cmd` exists solely to notice
when uber has died, and it watches for:

- the connection dropping, in six distinguishable ways
- the idle timeout
- the script vanishing from `$scriptlist`
- **the game clock not advancing** — `if (%CurrentTime = $gametime)`
- an unexplained `Your worn items are:` appearing, which means something has
  desynced badly enough to need a full restart

We are not going to out-script that, and should not try. The opportunity is the
other half: uber has no interface. It is 95,000 lines with no way to see what it
thinks is happening. **This app should be the face for state and control, on top
of primitives Lich already provides**, not a second automation engine.

## What Lich already gives us, verified

Lich 5 is BSD 3-Clause (`C:\Ruby4Lich5\Lich5\LICENSE`), so calling any of this
is unencumbered.

| What | Where | Status here |
|---|---|---|
| 16 body parts, wound + scar severity 0–3 | `XMLData.injuries` (`lib/common/xmlparser.rb:137`) | **unused** |
| Creatures in the room, with per-creature status | `GameObj.npcs`, `GameObj.npc_status` (`lib/common/gameobj.rb:506,267`) | **unused** |
| What is in each hand | `GameObj.right_hand` / `left_hand` | **unused** |
| Worn and carried items, container contents | `GameObj.inv`, `GameObj.containers` | partly |
| Wear, remove, stow, get, tie, put away | `DRCI.wear_item?` etc. (`lib/dragonrealms/commons/common-items.rb`) | **unused** |
| Whole gear sets, e.g. `'standard'` / `'swimming'` | `EquipmentManager#wear_equipment_set?` (`commons/equipmanager.rb:94`) | **unused** |
| Weapon swap by skill, offhand, unload, stow | `EquipmentManager#swap_to_skill?`, `wield_weapon?` | **unused** |
| Room graph, Dijkstra, tags, uid translation | `Lich::Common::Map` | used |
| Skills with mindstate | `DRSkill` | used |
| Vitals, guild, circle, favors, encumbrance, position, balance | `DRStats` | partly |
| Dead creatures, prone/sitting players, exits | `DRRoom` | partly |

The pattern is hard to miss. The app uses the parts that were easy to reach
from a status payload, and none of the parts that require doing something.

## The drowning case, which is the whole argument

> when you are drowning you might want to take off armor, sometimes it can help
> you pass a check

This is already solved upstream. `EquipmentManager` supports named gear sets and
its own documentation gives `"swimming"` as the example alongside `"standard"`.
The community hit this, generalised it, and shipped it.

So the feature is not "write armour handling". It is **one button that calls
`wear_equipment_set?('swimming')`, and a way to see what you are wearing so you
know whether it worked.** That is a day of work against an API, not a project.

It also reframes the whole app: the useful question for any feature is not "how
do we build this" but "which Lich call is this, and what does the player need to
see to trust it happened".

## What actually deserves the space

The window is 520×780. Everything below fights for that, so the ranking has to
come from what a player is doing, not from what is easy to render.

**Always visible, never scrolled to:**

1. **Am I in trouble** — health, and specifically *wounds by location*, because
   a bleeding leg and a bleeding head are different emergencies. A number
   cannot say that; a paperdoll can, in less space than three bars.
2. **What is in the room** — creature names and their status. This is the
   single largest gap. It is the thing a player looks at every few seconds and
   the thing that decides whether to keep going.
3. **Stop.** Already correct.

**One glance away:**

4. **The map**, sized to follow movement. Not a thumbnail. See below.
5. **What I am holding and wearing**, with gear-set switching.
6. **Is the automation still alive** — the uberwatch problem. Game clock
   advancing, script list, last command sent and what came back.

**Deliberately demoted:** healer rankings and hunting-ground scores currently
occupy the middle of the Power view. They are decisions made once every few
hours. They should not outrank the room you are standing in.

## The map, specifically

Three attempts so far and all three were wrong in the same way: treating the map
as a lookup you open, read and close. It is not. It is a **monitoring surface** —
players know which rooms break scripts, and they keep the map in view to see it
coming.

What follows from that:

- It has to be big enough to follow movement, which a 168px panel is not.
- It docks to the side and stays, rather than opening as a window you alt-tab
  to and lose behind the game.
- Hazard rooms need to be visible at a glance, which is why `MapCanvas` already
  colours them from tags — that part was right.
- It should track the character rather than needing a refresh.

A separate OS window was the easy build, not the right one. Side-docked, with
the app window widening to hold it, is the thing that was asked for.

## Layout: the arrangement is the player's

Both current layouts are arbitrary, arrived at by appending panels in the order
they were written. Rather than defend a guess, the panels move and resize, and
the arrangement persists — `Panel.tsx` and `lib/layout.ts` exist for this.

They are not wired into most panels yet. That is the next job, and it is more
valuable than any new feature, because a crafter and someone hunting want
opposite things from the same screen and neither of them is wrong.

## Order of work

1. Wire `Panel` into every panel, both modes. The layout is already persisted;
   only the components are unconverted.
2. Room panel: creatures, status, dead, players. `GameObj.npcs` + `npc_status`.
3. Paperdoll from `XMLData.injuries`.
4. Equipment: hands, worn, gear sets, `swap_to_skill?`. Wired to `DRCI` and
   `EquipmentManager`.
5. Map to a side dock that follows the character.
6. A health-of-automation panel, modelled on what `uberwatch.cmd` watches for.

Every one of those is exposing something Lich already does. None of it needs new
Rust, which is the point: the Rust side is the installer and the window shell,
and it is largely finished.
