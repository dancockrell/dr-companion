# Wiring audit: what is connected, what is not

Measured against the running app on 28 Aug 2026, with Phemius logged into the
live server, Lich 5.20.1, bridge v0.10.1 at the time. Not read off the source
originally — every claim below came from asking the running client or the
real files, and where a number is quoted the command that produced it is
quoted with it. **The bridge version moves fast enough that this number is
already stale by the time you read it** — check `BRIDGE_VERSION` in
`lich-scripts/companion_bridge.lic` directly rather than trusting a version
number written in a doc, same rule as anything else here: verify against the
file, not the claim about the file.

This exists so several sessions can divide the remaining work without each
re-deriving the same list. **Take a section, put your name on it, and delete
the "unclaimed" line when you do.** Conversely: if you finish something
listed here as unclaimed, come back and say so with your name, so the next
session reading this doesn't redo it against a doc that never learned it was
done — see section 4b for what happens when this doc runs a day behind a
fast-moving fleet.

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

**Updated 28 Aug 2026** (bridge now v0.10.2) **— most of this table is routed
now, and none of it is consumed by any screen yet.** Checked against the
actual file rather than this doc's own earlier claim, which was already stale
by the time a second pass read it — see rule 1 in CLAUDE.md about why that
check has to be the file, not the doc. `gameStream.ts` currently handles,
confirmed by grep:

| Tag | Status |
|---|---|
| `progressBar` | routed - health/mana/spirit/stamina, plus concentration (a Bard's fifth vital) |
| `indicator` | routed - three states (on/off/unknown) plus absence, keyed by icon name |
| `component id='room players'` | routed - DR's "Also here: ..." sentence parsed into named entries |
| `component id='room objs'` | routed **for loot only** - the bold-name half (creatures) needs pairing to a separate `crtrStatus` batch at the next `<prompt>`, gated on the two counts matching, and is deliberately not implemented without a live capture to verify the pairing against |
| `compass` / `dir` | routed - replaces on every room, does not accumulate |
| `spell` | **still absent** |
| `crtrStatus` | **still absent** (needed for the room-objs creature half above) |
| `dialogData` | **still absent** |
| `image` | **still absent** |

All of it lives in `StreamCharacterState` (`src/types/stream.ts`) and is read
via `characterState(streamState)` in `src/lib/gameStream.ts`.

**Done, vitals and indicators — the consuming side is wired now.** A grep for
`characterState` in `src/components` still finds nothing, and that is not a
gap: `gameLink.ts` wraps it as `streamCharacterState()`, subscribed the same
way `GamePane` subscribes to lines (`subscribeGame` + `useSyncExternalStore`),
so check for that name instead if you are re-running this audit's greps.
`src/lib/vitals.ts` (`vitalsFor`) and `src/lib/situation.ts` (`situationFor`)
each take the stream value as a second argument and decide per-field which
source wins, stated as a real choice rather than a default:

- **Vitals** (health/mana/spirit/stamina): stream wins whenever it has
  reported a value, bridge is the fallback. Concentration stays bridge-only —
  it is never in `StreamVitals` at all, DragonRealms does not send it as a
  `progressBar`.
- **Indicators**: `'on'`/`'off'` from the stream sets or clears the matching
  situation flag; `'unknown'` (or the tag never having arrived) leaves
  whatever the bridge already said standing, rather than treated as false.

Wired into `VitalCluster`/`StatusBoard` via `DashboardLayout.tsx`. Tests in
`tools/stream-consumers-test.mjs`, sabotaged with scoping asserted (breaking
the stream-precedence path reddens only its own tests, not the bridge-only
ones). Landed 28 Aug 2026, `fcb2444`.

Room contents (Objects/Players) are a separate, larger piece — see
`src/lib/roomOccupants.ts`, in progress elsewhere as of this edit; check its
own commit history rather than this line before assuming it is done or open.

Remaining tags (`spell`, `crtrStatus`, `dialogData`, `image`) have no consumer
yet and no parser support yet either for `crtrStatus`/`dialogData`/`image` -
still real work. **Say so here before starting** - `gameStream.ts` has had
several sessions' hands in it in one day already, and the type it feeds
(`StreamCharacterState`) is the shared contract every consumer will read.
*unclaimed*

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
  - **Done, downloads-ae:** `check_toggles` (BRIEF/INVBRIEF/ShowRoomID) had
    the same gap as `read_settings` below did — the bridge read and logged
    these since before this audit existed, with no field or control for it.
    Now a `toggles` broadcast, a store field, and a Toggles panel in Settings
    next to the settings-files one. `brief`/`invBrief` only ever read `true`
    or `null`, never a confirmed `false` — see `ToggleStatus` in
    `src/bridge/types.ts` for why the wire only supports asserting one
    direction. Bridge bumped to 0.10.2. The rest of this bullet (alias,
    autostart, vars, version, textsubs, links, lich5-update) is still open.
  - **Done, downloads-ae:** `vars` (`Lich::Common::Vars`) — same shape again.
    `Vars.list`/`Vars[name]` is a clean, documented Ruby API (SQLite-backed,
    per-character), so `list_vars` reads it straight across: a `vars`
    broadcast, a store field, a read-only panel next to Toggles. Non-string
    values match Lich's own `;vars` GUI (`class: inspect`, not editable)
    rather than inventing a new display rule. Bridge bumped to 0.10.3.
  - **Checked and NOT done, downloads-ae:** `alias`, `autostart`, `textsubs`
    have no `Vars`-shaped module to read from — `grep -rn "class Alias\|module
    Alias" lib/` and the same for autostart/textsubs in `lib/common/` all
    return nothing, and none of the three scripts reference a `Settings[]`/
    `Vars[]`/YAML file for their own storage either. Whatever they use is
    either a Lich-core global this audit hasn't found yet, or GTK-only state
    with no headless read path — either way it needs actually reading the
    600-line `alias.lic`/etc. source to find out, not assumed to be another
    quick `Vars.list`-style win. `version` and `lich5-update` untouched too.

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
