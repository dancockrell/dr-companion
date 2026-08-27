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

### Who is allowed to connect

Two independent gates, and they stop different attackers. Both are needed;
either alone leaves a gap.

**Binding 127.0.0.1 is necessary and is not a boundary.** This is the part
that catches nearly everyone who writes a localhost service, and it caught
this one. The same-origin policy does not restrict WebSockets: any page in any
browser on the machine can open `ws://127.0.0.1:7415/companion` with no
preflight and no CORS block, because the connection genuinely does originate
from localhost. Until v0.9.0 the handshake asked only for the path and a
`Sec-WebSocket-Key`, both of which a browser supplies automatically, so any
website open in the player's browser could send `stop_all` in a loop while
they were logged in.

**1. Origin, checked when present.** Stops every browser. A browser always
sends `Origin` and cannot forge or suppress it, so this is a real boundary
rather than a speed bump.

An *absent* Origin is allowed, deliberately. That is what a non-browser sends -
the test harness in `test/`, `wscat`, any CLI written later - and refusing
those would break real tools while stopping nothing, since a hostile local
process can simply omit the header. That attacker is gate 2's job.

Refusals are logged with the origin they saw. A silent 403 turns "a website
tried to stop your scripts" into "the bridge seems flaky", and the log line is
also the whole diagnosis if a Tauri version invents a new scheme.

**2. A token, for the attacker Origin cannot stop.** Fresh 32 bytes each time
the bridge starts, written `0600` to `companion_bridge.token` beside this
script, and required as the first frame within one second. Compared in constant
time. A socket that has not authenticated never joins the client list, so it
never receives a broadcast - somebody who fails learns nothing on the way out.

**What that token is actually worth.** `0600` is honoured on Unix and largely
ignored on Windows. So it defends against other *software* on the machine - a
web page, a curious script, something that stumbled onto the port - and **not**
against a process already running with the player's privileges. Anything
running as the player can read the token, and could equally read Lich's saved
account file. Said plainly because a boundary people overestimate is worse than
one whose shape they know.

**What is not reachable, so the claim stays honest.** Client arguments do not
reach `fput` as text. `map_nearest`, `map_path` and `map_zone` take arguments
and feed them into `MapInfo` lookups rather than into a command string, and
`map_path` is read-only by construction - it says "Not moving." in its own
reply rather than only in a comment. This was never command injection against
the character.

### Things worth knowing if you are editing it

- **Bind 127.0.0.1 only.** Never 0.0.0.0. Necessary, and not sufficient - see
  above.
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
