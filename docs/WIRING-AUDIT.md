# Wiring audit: what is connected, what is not

Measured against the running app on 28 Aug 2026, with Phemius logged into the
live server, Lich 5.20.1, bridge v0.10.1. Not read off the source — every
claim below came from asking the running client or the real files, and where a
number is quoted the command that produced it is quoted with it.

This exists so several sessions can divide the remaining work without each
re-deriving the same list. **Take a section, put your name on it, and delete
the "unclaimed" line when you do.**

---

## 1. The chain, end to end — working

    launch_lich  ->  Lich 5.20.1  ->  dr.simutronics.net  ->  Phemius
                     |                                        |
                     +-- :11024 detachable client  -----------+--> game_attach
                     +-- :7415  companion_bridge   ---------------> live bridge

Verified this session: Lich launches from the app's own button, logs in
without any password reaching this app, opens both ports, and the client
attaches to both. `lich: "alive"` is reported on the link state.

**Two fixes it took to get here**, both committed:

- `MapInfo.coords` accepted Hash and Array and returned `[nil,nil,nil]` for a
  String. Lich stores position as `"360,460,0"`. Every room lost its
  coordinates — 896 in The Crossing, all discarded — and the map rendered
  "No rooms with coordinates on this level" while correctly reporting the zone
  name and room count, because those do not pass through `coords`.
- `lich_status` was a synchronous Tauri command taking 5.4s, so it ran on the
  main thread and froze the window on mount and on every "Check again". Every
  other command queued behind it; `bridge_default_url`, which returns a
  constant string, timed out at 30s. Now `spawn_blocking`.

## 2. The map — working

Draws the full Crossing street grid: 400 rooms of 896 (capped for drawing),
guild labels, hazard markers, exits, and the "you are here" marker.

**Still owed:** the room panel says "Not in a room yet" even while the map
header knows the zone. The map's *geometry* is fixed; per-room position
tracking is a separate path and has not been verified working. — *unclaimed*

## 3. Buttons — all reachable

259 buttons. None invisible, none clipped, one disabled (`Zoom out`, correct
at minimum zoom).

The ~200 "Start" buttons and the four quick actions that first looked
off-screen are inside `overflow-auto` / `overflow-x-auto` scrollers, so they
are reachable by scrolling rather than clipped. Worth stating because a naive
viewport check reports them as broken — if you re-run this audit, walk the
ancestors for a scrollable container before calling anything unreachable.

**Not verified:** that each button *does* something. Reachability was checked;
behaviour was not, because clicking ~200 Start buttons against a live game
would issue ~200 real commands. Needs a different approach than clicking. —
*unclaimed*

## 4. Genie's 31 windows — the real gap list

Genie players lay out named windows; `C:\Genie4\Config\Layout\default.layout`
defines 31. That layout is the closest thing to a spec for "what information a
DragonRealms player expects to have somewhere", so it is worth treating as one.

### Covered, same name
Game, Room, Inventory, Experience, Combat, Objects, Log, Raw, Data, Shop,
Active Spells, Chatter

### Covered under a different name — not a gap, do not "fix"
| Genie | dr-companion |
|---|---|
| Players | PEOPLE panel |
| Mobs | HOSTILE panel |
| Portrait | character portrait image |

### Covered but conditional — renders only when the game sends that stream
`StreamTabs` can label: thoughts, death, talk, whispers, logons, familiar,
group, room, bounty, assess, inv, society.

So Thoughts, Deaths, Talk, Whispers, Arrivals (logons), Familiar, Group and
Assess **do** have a home — they were absent from the DOM at audit time only
because no such stream had arrived yet. This is by design: a tab for a channel
the character never uses is furniture.

**Checked, so nobody has to guess.** Connected a second client directly to
:11024 and read the raw wire for 22 seconds on a live session:

    bytes read: 3821
    tags seen: dialogData 4, skin 3, progressBar 7, prompt 9, spell 1,
               indicator 7, compass 1, dir 3, output 2, component 8,
               image 15, pushBold 1, popBold 1, crtrStatus 1
    pushStream present: false

So the parser is fine — `pushBold` arrives and is handled — and **no stream
was sent at all** in that window. Streams are event-driven (a thought, a
death, someone speaking), so an idle room produces none. The channel tabs are
not broken; they have had nothing to show. Confirming them needs a session
where somebody actually speaks or dies nearby, not more code.

### Genuinely absent — no home in the app
| Genie window | What it carries | Note |
|---|---|---|
| Atmospherics | ambient room flavour text | high volume, low signal — may deserve suppression rather than a pane |
| Conversation | grouped speech | overlaps Talk/Chatter; decide whether it is a distinct concept before building |
| OOC | out-of-character chatter | |
| Output | script output | dr-scripts write here; currently mixed into the main pane |
| Time | game clock / sunrise-sunset | small, cheap, genuinely useful |
| Weather | in-game weather | |
| Debug | Lich diagnostics | arguably belongs in Console, not a game pane |
| FluffMuff | community plugin window | check whether Dan uses it before building anything |

Each is *unclaimed*. Do not build all eight — decide per window whether a
player actually reads it, and say so in the commit either way.

## 4b. The biggest unclaimed win: Lich already sends structured data

Found while settling the streams question above, and it reframes several of
the gaps in section 4.

Declaring `--stormfront` gets this client the full StormFront protocol, not
just text. Read off the live wire, these tags arrive unprompted:

| Tag | Carries | Sampled value |
|---|---|---|
| `progressBar` | vitals, as numbers | `id='health' text='health 100/'`, plus mana, spirit, stamina |
| `indicator` | posture and afflictions | `IconBLEEDING=n`, `IconPOISONED`, `IconDISEASED`, `IconSTANDING=y`, `IconKNEELING=n`, `IconSITTING=n`, `IconPRONE=n` |
| `component` | live room contents | `room objs`, `room players` |
| `compass` / `dir` | available exits | |
| `spell` | active spell | |
| `crtrStatus` | creature status | |
| `dialogData` | grouped panels | `id='minivitals'` |
| `image` | portrait and room art | 15 in 22 seconds |

**The app currently gets none of this from the game.** Vitals, posture,
room contents and exits all come from the bridge polling Lich's Ruby state
instead — a round trip through a WebSocket and a Ruby script to fetch numbers
the game is already pushing down the socket the client is holding.

That matters for three reasons, and it is why this is worth doing before more
panes get built:

1. **It is free and already arriving.** `game_link.rs` receives these bytes
   today and `gameStream.ts` skips them as unknown markup.
2. **It removes a dependency.** Anything sourced from these tags keeps
   working when the bridge is down — which, per the log, it frequently is
   during a restart.
3. **Several "absent" Genie windows are already answerable.** Objects and
   Players map straight onto `component id='room objs'` / `'room players'`.
   Posture and afflictions have no Genie window but are real state the app
   shows nowhere.

`gameStream.ts` deliberately keeps the text inside unknown tags and drops the
tags, which is right for `<d>` and `<a>` and wrong for these — they are data,
not decoration. The work is to route named tags to state rather than to the
text pane.

**Do not start this without saying so here first** — it touches
`gameStream.ts`, which two sessions have already edited today. *unclaimed*

## 5. Lich scripts — 234 installed, all catalogued

Every installed script resolves to a catalogue entry; none fall through to
`Uncategorized`.

**Corrected this session:** thirteen player-facing scripts were filed as
"engine tooling, not a player activity" and therefore had no UI at all —
`alias` (which ships its own settings window), `autostart`, `esp`, `find`,
`vars`, `version`, `schedule`, `textsubs`, `trigger-watcher`, `log`, `logxml`,
`links`, `lich5-update`. Each now carries a description read from the script's
own source, with the quoted evidence in a comment beside it.

Eleven remain hidden and each is genuinely plumbing: `dependency`, `echo`,
`help-me`, `mock`, `noop`, `register`, `repeat`, `wait`,
`dr-scripts_install`, `companion_bridge`.

**The remaining work, and it is the biggest item here.** A catalogue entry is
not a control. Most scripts still surface only as a generic "Start" button in
the Script Library, which is the raw-launch equivalent of handing someone a
terminal. Dan's framing is the right one: *each script solves a problem*, so
the question for each is **what problem, and what would the control look like
if the script did not exist?**

`go2` is the worked example — it is `promoted`, and its real control is the
map's "Find a place" box rather than a Start button, recorded in
`realControl`. That field exists precisely so a promoted script can point at
its first-class control instead of rendering a redundant launch button.

Suggested division, so several sessions do not collide:

- **Travel & Navigation** — go2, find, the map search box. *unclaimed*
- **Training & Skills** — the Training panel already exists; wire the scripts
  that feed it. *unclaimed*
- **Money, Trade & Inventory** — Shop/Inventory panels exist and are thin.
  *unclaimed*
- **Monitoring & Notifications** — esp, log, logxml, trigger-watcher; overlaps
  the absent Genie windows above. *unclaimed*
- **Character Setup & Config** — alias, autostart, vars, version, textsubs,
  links, lich5-update. Mostly settings surfaces, not game actions. *unclaimed*

## 6. Traps worth not rediscovering

- **`install_bridge_script` copies the bundled resource, not your working
  copy.** In dev that resource is a build-time snapshot, so editing
  `lich-scripts/companion_bridge.lic` and pressing install silently reinstalls
  the *old* version. Copy the file directly, then verify by reading
  `BRIDGE_VERSION` off the installed file — not by trusting the command's
  success.
- **Verify against the running binary, not the source.** A measurement of the
  `lich_status` fix showed no improvement because the exe on disk was eleven
  hours older than the change. Check `stat` on the exe against your source
  before believing a "the fix did nothing" result.
- **A blank screenshot means the window is minimized**, not that the app
  renders blank. `Page.captureScreenshot` returns an empty frame and reports
  success, and `document.hidden` stays `false` for a minimized WebView2.
  `tools/app-eyes.mjs shot` now warns below 0.02 bytes/pixel.
- **Count both catalogue forms.** `scriptCatalog.ts` holds entries as object
  literals *and* as an array of names mapped to a shared entry. A regex for
  one form reports the other as missing — this produced a false "23 scripts
  uncatalogued" during this audit.
