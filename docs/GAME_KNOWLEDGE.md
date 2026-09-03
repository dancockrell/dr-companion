# Game knowledge vs script property

> **Rule 0 — never fork.** A problem is to be solved, never dodged. Fix the thing,
> replace it outright, or delete the feature — those are the only three moves.
> Never leave two answers to one question standing side by side, and never route
> a parallel path around something you did not want to touch. That is a noodle to
> nowhere, and it is the most serious thing you can do to this codebase.
> Full rule: [`CLAUDE.md`](../CLAUDE.md).

## Boundary

| Allowed | Not allowed |
|---------|-------------|
| Public DR mechanics (Elanthipedia, in-game systems, community rank bands) | Copying or redistributing someone else's Genie `.cmd` / paid script **code** |
| Patterns any player can observe (guards, cooldowns, guild buffs exist, F2P limits) | Shipping Uber Combat or other paid products inside Companion |
| Building **our own** logic in React / Lich / TypeScript | Re-implementing a paid script as a Genie script clone |

We are **not** writing Genie scripts. Companion = UI + bridge + our Lich modules (and optional hooks the user wires themselves).

## Travel

Community travel automation (e.g. free travel scripts) may be referenced for **interop** later (user already runs travel; Companion can wait for arrival signals). Pathfinding and destination UI remain **ours** or user-chosen.

## Combat / town / house-entry

Game facts are open (creatures, ranks, healers, burgle system, justice).  
Automation **code** for those flows is implemented by us in Lich/TS — not by embedding paid Genie combat scripts.

## Practical rule

> Information about the game ≠ license to copy another author's script text or product.
