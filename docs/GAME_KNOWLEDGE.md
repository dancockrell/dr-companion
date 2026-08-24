# Game knowledge vs script property

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
