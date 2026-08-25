# Lich scripts for DR Companion

## companion_bridge.lic

The interface between Lich and the Companion panel. A localhost-only
WebSocket server, written in pure stdlib Ruby so it needs no gems.

**Protocol:** [../docs/BRIDGE_CONTRACT.md](../docs/BRIDGE_CONTRACT.md)
**Default URL:** `ws://127.0.0.1:7415/companion`

### Install

Copy `companion_bridge.lic` into Lich's `scripts` folder, then in game:

```
;companion_bridge          most frontends
,companion_bridge          Genie, which uses a comma
```

Genie starts Lich scripts with a comma and every other frontend uses a
semicolon. The rest of this file writes `;`; substitute `,` if you are on
Genie.

Other forms:

```
;companion_bridge 7500     use a different port
;companion_bridge stop     stop a running bridge
```

Then open the Companion and switch the bridge to **Live Lich** in Settings.

### What it does today

Reads and pushes:

- character name, guild, race, circle, favors, encumbrance
- vitals from `DRStats`
- **per-skill ranks and mindstate** from `DRSkill`, which is what the training
  view needs; ranks alone cannot answer "what should I train"
- room title, NPCs, other players and group members from `DRRoom`
- running Lich scripts and whether each is paused

Accepts:

| Intent | Status |
|---|---|
| `stop_all` | Kills every running script except the bridge |
| `check_health` | Polls HEALTH and reports wounds and bleeders. Read-only. |
| `stow_all` | Puts what is in your hands away |
| `pause` / `resume` | Pauses and unpauses them |
| `get_status`, `get_inventory`, `subscribe`, `ping` | Working |
| everything else | Acked `ok:false` with a reason |

Unimplemented intents are refused explicitly. They do not silently do nothing,
and they do not report success.

### Things worth knowing if you are editing it

- **Bind 127.0.0.1 only.** Never 0.0.0.0.
- **Every state read is wrapped.** Lich's DR objects are populated by parsing
  the game stream, so any of them can be nil right after login. A bridge that
  raises on a nil is worse than one that reports "unknown".
- **Status carries a clock.** An open socket does not mean a live game, so the
  client watches whether that value advances. See `docs/DOMAIN.md` section 13.
- **Account tier is a user setting**, stored in `CharSettings`, because there
  is no reliable in-game read for it. Default is `unknown`, which the UI treats
  conservatively.

### Testing without the game

`tools/mock-lich-server.mjs` serves the same protocol from Node:

```bash
npm install ws --no-save
npm run mock-lich
```
