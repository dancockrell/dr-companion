# The game adapter interface — PROPOSAL, for review

Status: **proposed shape, for review.** The types exist as `src/domain/*.ts`
and typecheck, but **nothing imports them** — no runtime behaviour has changed.
Deleting `src/domain/` reverses this entirely.

Written before any wiring because once third-party adapters exist, this
interface stops being free to change, and that is the whole point of writing it
down first.

Supersedes the narrower plan in the 3 Sep survey, which was "a seam with a
DragonRealms adapter and a GemStone adapter". Two closely-related Simutronics
games are not enough evidence to design a general interface from. See §1.

## 0. Who this is written for

The intended reader is **not** a maintainer of this repo. It is somebody — or
somebody's AI — who wants a client for a MUD nobody here has played, and who
will read this document, the reference adapter, and nothing else.

That is a design requirement, not a courtesy, and it has consequences that show
up throughout:

- **This is a specification, not API reference.** It states what an
  implementation must do and why, not what our functions are called.
- **The conformance suite is the definition of done.** If it passes, the
  adapter is correct. Nobody needs to ask us anything. (§6)
- **Every domain type documents its semantics, not DragonRealms' usage of it.**
  "The gauge the game treats as life", never "health, as DR sends it".
- **The reference adapter is a plain GMCP MUD**, not either Simutronics game,
  so the worked example is the ordinary case rather than the exotic one. (§6)
- **Naming and structure are regular enough to infer from one example.** One
  file per concern, one adapter per directory, the same file names in each,
  reasoning in the file it applies to.

The test of whether this succeeded: someone points a model at this repo and
gets a competent adapter for their MUD out, without a human explaining
anything. If that fails, this document is at fault, not the reader.

---

## 1. The thing that changes the design: Simutronics is the outlier

The instinct is to design the domain model around DragonRealms, add GemStone,
and call the result general. That produces an interface shaped like Simutronics
XML, and every non-Simutronics MUD then has to be bent into it.

The wider MUD world did not go that way. It standardised on **telnet option
subnegotiation**, and specifically on two out-of-band data protocols:

| | GMCP | MSDP |
|---|---|---|
| Telnet option | 201 | 69 |
| Payload | JSON, `Package.Message {json}` | typeless VAR/VAL, with TABLE and ARRAY framing |
| Year | 2010 (from ATCP/ATCP2) | 2009 |
| Spec quality | vague; implementations differ | simple and clear |
| Client support | near-universal | common, often opt-in |

Mudlet enables GMCP, MSP, MSSP, MTTS, MXP, NAWS and NEW-ENVIRON by default and
offers MSDP behind a setting. TinTin++, MUSHclient and Blightmud all speak
GMCP. There is also a documented bridging convention, **MSDP over GMCP**, which
lets an MSDP server talk to a GMCP-only client — meaning MSDP does not need a
parallel domain model, only a different decoder into the same one.

**Consequence for us.** If the domain model is shaped so that a GMCP package
maps onto it near-losslessly, one adapter buys most of the MUD world, and the
Simutronics XML stream becomes what it actually is: an unusual, rich special
case. Designed the other way round, GMCP support means a rewrite.

So: **GMCP is the reference shape. Simutronics is an adapter.** Including ours.

### What Simutronics has that nothing else does

Worth naming, because these are the features most likely to leak into core if
nobody is watching:

- **No telnet subnegotiation at all.** A bespoke XML-ish tag soup on the main
  stream, with unescaped ampersands, both quote styles and no single root. Not
  parseable by a real XML parser, which is why `src/lib/gameStream.ts` is a
  hand-written chunk state machine and must stay one.
- **GemStone pushes UI layout over the wire.** `openDialog` / `dialogData` ship
  positioned, anchored widgets — progress bars, labels, buttons — that the
  client is expected to lay out. No GMCP MUD does this. It cannot be a core
  concept; it has to be an optional capability that a skin may or may not honour.
- **The two Simutronics games diverge from each other more than expected.**
  Lich's own source splits `lib/gemstone/` and `lib/dragonrealms/`, and the
  GemStone side has `wounds.rb`, `scars.rb`, `critranks.rb`, `psms.rb`,
  `societies.rb`, `spellranks.rb` as first-class, where DragonRealms has
  `drinfomon` and little overlap. Two adapters, not one with a flag.

---

## 2. The layers

```
  bytes                    game-specific                normalised
  ─────                    ─────────────                ──────────

  Transport      ──▶       GameAdapter        ──▶       Domain          ──▶  Skin
  (moves bytes,            (all knowledge of            (versioned,          (renders,
   knows no game)           one game lives here)         game-neutral)        no game logic)
```

The rule that makes this real, and the only one that matters:

> **Nothing in `Domain` or `Skin` may name a game, and nothing in `Transport`
> may parse one.** If a symbol contains `dragonrealms`, `gemstone`, `mindstate`,
> `guild`, `roundtime` or any other game's vocabulary, it belongs in an adapter.

### 2.1 Transport

Moves bytes and reports link state. Three implementations to start:

- `TelnetTransport` — TCP plus RFC 854/855 option negotiation. Surfaces
  subnegotiation payloads as typed events (`{ option: 201, payload: Uint8Array }`)
  without interpreting them. Option negotiation is genuinely game-independent,
  so it lives here rather than in every adapter.
- `LichTcpTransport` — Lich's `--detachable-client=PORT`. Newline framing only.
  (Exists today as `src-tauri/src/game_link.rs`.)
- `LichWsTransport` — the legacy `companion_bridge` WebSocket.
  (Exists today as `src/bridge/realBridge.ts`.)

Transport reports a `LinkState` that distinguishes, at minimum: not connected /
connecting / connected / connected-but-the-far-end-looks-dead. The third-party
diagnosis already in `game_link.rs` — `alive` / `gone` / `unknown`, refusing to
fold "could not determine" into "gone" — is the standard for this and should be
lifted into the shared type.

### 2.2 GameAdapter — the public API

```ts
/** Stable identifiers. Third parties pick their own; ours are not special. */
type AdapterId = string          // 'gmcp', 'dragonrealms', 'gemstone'
type VitalId  = string           // 'health', 'mana', 'stance', 'mindstate'
type StreamId = string           // 'thoughts', 'death', 'room', 'inv'

interface GameAdapter {
  readonly id: AdapterId
  readonly displayName: string

  /** The domain schema version this adapter targets. See §4. */
  readonly schemaVersion: string

  /** What this adapter can do. Absent capability ≠ false; see §3. */
  readonly capabilities: ReadonlySet<Capability>

  /** Everything the UI needs to render this game without knowing it. §2.4 */
  readonly manifest: GameManifest

  /** Consume whatever arrived, in whatever sizes. Never throws. */
  feed(chunk: Uint8Array, ctx: FeedContext): AdapterOutput

  /** Turn a player command into bytes for this game. */
  encode(command: string): Uint8Array

  /** Discard all derived state. See §5 — this one is load-bearing. */
  reset(reason: EpochReason): void
}

interface AdapterOutput {
  /** Text for the panes, tagged with the stream the game itself named. */
  lines: DisplayLine[]
  /** Normalised state changes. */
  events: DomainEvent[]
  /**
   * Anything the adapter recognised but the domain has no room for.
   * Namespaced under the adapter id. The core never interprets this; a skin
   * may render it via a manifest descriptor.
   */
  extensions?: Record<string, unknown>
}
```

`feed` takes bytes and chunk boundaries are arbitrary — a tag, a telnet
subnegotiation or a GMCP JSON body may be split across packets. Adapters buffer
internally. This is not a preference; a line-splitter that ran before the parser
is the bug `gameStream.ts` was rewritten to fix.

**`feed` never throws and never drops.** Input the adapter does not understand
must still reach `lines`. GMCP's own history is the argument: the spec is vague,
implementations differ, and IRE shipped variables that break their own JSON.
An adapter that rejects malformed input is a client that goes blank on the
evening a MUD ships a bad build.

### 2.3 The domain model

Small, and **declared rather than hardcoded**. This is the concrete change from
what exists today.

Today `src/types/stream.ts` has:

```ts
// closed struct, DragonRealms' bars, by name
interface StreamVitals {
  health?: StreamVital; mana?: StreamVital; spirit?: StreamVital
  stamina?: StreamVital; concentration?: StreamVital
}
```

with a comment explaining that stance and mindstate are GemStone-only and will
never arrive. That reasoning is correct and well-sourced for DragonRealms, and
it is exactly what cannot survive contact with a second game, let alone a
hundred. Proposed instead:

```ts
type Gauge = { current: number; max: number | null }

interface CharacterState {
  /** Keyed by VitalId. Which ids exist is declared by the manifest. */
  vitals: ReadonlyMap<VitalId, Sourced<Gauge>>
  indicators: ReadonlyMap<string, Sourced<IndicatorState>>
  identity: Sourced<Identity>
}
```

An open map alone would reintroduce the problem the closed struct was solving —
a panel reading `vitals.get('stance')` and getting `undefined` forever with no
way to tell that from "not measured yet". The manifest is what fixes that: it
declares the ids this game *can* produce, so absence from a declared id means
"not yet", and an undeclared id is a programming error the conformance suite
catches. **Keep `Sourced<T>`** — value, provenance and arrival time bound
together so a spread can't drop the provenance. It is the best idea already in
the codebase and it generalises unchanged.

What is defensibly universal, being roughly the intersection of GMCP `Char.*` /
`Room.*` / `Comm.*` and MSDP's generic variables:

- identity (name, and whatever the game calls a title)
- gauges (declared per game)
- room: id, name, description, exits, contents, occupants
- items with a stable handle where the game gives one
- entities present, with a stable handle where the game gives one
- communication channels, carrying the game's own channel label
- a command/timing gate (GMCP has no standard one; DR/GS roundtime and
  most MUDs' lag are the same *shape*: "you may not act until T")
- link state and epoch

**Everything else is an extension.** Mindstate, wounds by body part, scars,
crit ranks, guilds, societies, account tiers, PSMs, encumbrance — all of it
lives in the adapter and surfaces through `extensions` plus a manifest
descriptor. Including the ones that feel universal. Wounds-by-body-part feels
general and is not: GemStone models wounds *and* scars per location with
severity ranks, DragonRealms models it differently, and most MUDs have a single
hit-point number and nothing else.

### 2.4 The manifest — how the UI stays game-blind

The manifest is data, not code, so a skin can render a game it has never heard
of:

```ts
interface GameManifest {
  vitals: VitalDescriptor[]     // id, label, colour role, ordering, format
  streams: StreamDescriptor[]   // id, label, default window, default visibility
  windows: WindowDescriptor[]   // generic panes, not hardcoded types
  commands: CommandDescriptor[] // movement verbs, look, inventory
  extensions: ExtensionDescriptor[] // how to render adapter-specific state
}
```

This is what makes MUD windows agnostic: a window is `{ id, label, sources:
StreamId[] }` rather than a `MindstateBoard` component that only DragonRealms
can fill. `src/lib/gameStream.ts` already routes by the game's own
`pushStream id=` and shows unmapped ids under their own name rather than
dropping them, so most of this exists — `STREAM_LABELS` is a single global
DragonRealms-flavoured table that wants to become per-adapter manifest data.

---

## 3. Capabilities, not booleans

Copy Lich's own pattern, which is proven in this exact ecosystem —
`Frontend.register(name, capabilities:, metadata:)` with a capability set and
per-frontend metadata, in `lib/common/front-end.rb`.

```ts
type Capability =
  | 'structured-state'   // GMCP/MSDP or equivalent
  | 'named-streams'      // the game labels its own channels
  | 'room-graph'         // stable room ids suitable for mapping
  | 'entity-handles'     // stable per-entity ids ('third giant rat')
  | 'server-ui'          // the server ships layout: GemStone dialogData
  | 'compression'        // MCCP
  | 'server-status'      // MSSP
```

A capability the adapter does not declare is *unavailable*, which is different
from *false* and different again from *unknown*. The three-state discipline
already in `IndicatorState` and in `game_link.rs`'s Lich probe is the house
style and should hold here too.

---

## 4. Versioning, from the first commit

```ts
export const DOMAIN_SCHEMA_VERSION = '1.0.0'
```

- Semver on the domain model only. Adapters declare the version they target.
- The registry refuses an adapter whose major does not match, with a message
  naming both versions. Silent partial compatibility is worse than a refusal.
- Additive changes are minor. Removing or re-typing a field is major.
- Every domain type gets a doc comment stating its **semantics**, not its
  DragonRealms usage. "The gauge the game treats as life" rather than "health,
  as DR sends it". A third-party adapter author reads these instead of asking.

Retrofitting this after adoption is the expensive version. It costs one
constant and one check now.

---

## 5. Epochs — the protocol tells us to do this

Both the GMCP and MSDP specifications state that on a server copyover or a
client reconnect, **all previously exchanged data is lost and the option must be
renegotiated from scratch.**

So this is not our safety habit, it is a protocol requirement, and it
generalises Dan's original concern about stale combat data into something
enforceable:

- Every piece of domain state carries an **epoch**.
- The epoch increments on connect, disconnect, and any server-initiated
  renegotiation (`IAC WONT GMCP`).
- Consumers reading state from a previous epoch get nothing, not stale values.
- `adapter.reset(reason)` is called on every epoch change and must discard
  everything derived.

The codebase already has the instinct — `backlog-test.mjs` asserts "a fresh
attach must not keep the previous character's health" and "detaching clears the
stream-derived vitals immediately, not just on the next attach". This makes it a
rule of the model rather than two tests somebody remembered to write.

---

## 6. The conformance suite is the specification

Prose describes the interface; the suite defines it. A third party runs it
against their own adapter and gets a yes or no without asking us anything.

**Transcript cases.** Recorded byte streams with expected domain output.
Contributed per game, ours included, so the corpus grows with the ecosystem.

**Property cases**, which matter more:

1. **Chunk-split invariance.** Feeding the same stream split at every possible
   boundary must produce identical output. This is the single highest-value
   test in the suite — it is the bug class the current parser was rewritten to
   fix, and it is the one every new adapter author will hit.
2. **Nothing is swallowed.** Every input byte reaches `lines` or a `DomainEvent`
   or `extensions`. Unrecognised input reaches `lines`.
3. **Reset is total.** After `reset()`, no field holds a pre-reset value.
4. **Declared ids only.** Every emitted `VitalId` / `StreamId` appears in the
   manifest.
5. **No throw.** Random and adversarial bytes — truncated tags, bad JSON,
   invalid UTF-8, a lone `IAC` — must not throw.
6. **Encode round-trip.** `encode()` output is accepted by the game's own
   framing rules.

**Reference adapter: a plain GMCP MUD.** Not DragonRealms, not GemStone. The
teaching example must be the ordinary case — a few hundred well-commented lines
someone can copy — or every third-party adapter inherits Simutronics' oddities
by imitation.

---

## 7. Honest cost

What has to move, from the 3 Sep survey: 53 source files carry DragonRealms
vocabulary. The bulk is `src/data/*` (skills, hunting, healers, instances,
obstacles, gearConflicts, activities, macros, places, map) and `src/lib/*`
(`accountCapabilities`, `bestiary`, `chatChannels`, `vitals`, `npcDefaults`,
`lookMatch`, `roomText`, `watchedRooms`), plus `src/types/index.ts`.

Most of that is a *move*, not a rewrite — it is already data and already
correct. The genuine rewrites are narrower:

1. `src/types/stream.ts` — closed structs to declared maps. The load-bearing one.
2. `src/lib/gameStream.ts` — split the generic chunk state machine from the
   Simutronics tag vocabulary. The split is clean; the machine is already
   game-neutral in everything but its tag table.
3. `STREAM_LABELS` → per-adapter manifest data.
4. Panels that read DR fields by name → read declared ids via the manifest.

Sequenced so the app runs at every step:

1. Domain types and `DOMAIN_SCHEMA_VERSION`, unused. Nothing breaks.
2. Conformance suite against the empty interface. Fails, correctly.
3. `dragonrealms` adapter wrapping the existing parser unchanged. App still
   runs; the suite starts passing.
4. Panels move to manifest-driven reads, one at a time.
5. Reference GMCP adapter — the first real test that the seam is a seam.
6. `gemstone` adapter, including the `server-ui` dialog surface.

Step 5 before step 6 on purpose. If GemStone is the second adapter, the
interface will quietly assume Simutronics and nobody will notice until the
third.

---

## 8. Rulings

Decided 3 Sep 2026. Recorded here because these are the questions a future
maintainer will re-open, and the reasoning matters more than the answer.

**Everything is an extension unless it is demonstrably universal.** When in
doubt, it goes in the adapter. This is now the tie-breaker for every case not
explicitly listed in §2.3, and it resolves the room-graph question below.

**The room graph is not core.** `Room.id` is `RoomId | null` and that is all
core holds. The 17,750-room map, the 42,866 exits, the 3,174 named places, the
310 gateways, the 3D world manifests — every bit of cartography is an
extension. This costs us the ability to write generic mapping in core, which is
the right trade: room identity is among the least standardised things across
MUDs, and a core that assumes it forces every adapter without stable ids to
invent them. An invented id that collides is worse than no id.

**Telnet negotiation lives in `TelnetTransport`.** It is identical for every
telnet MUD, and the alternative is every adapter reimplementing RFC 1143. It
does mean transport is not purely bytes — it surfaces subnegotiation payloads
as typed events without interpreting them. Accepted.

Still open:

1. **Do we publish the conformance suite as a package?** It is the difference
   between "others can build on this" and "others could in principle". Costs a
   release pipeline.
2. **Scripting API across games.** The Python and TypeScript task APIs assume
   DragonRealms. Out of scope here; it will hit the same wall.

---

## 9. Scope: what gets built, and what GemStone is for

**DragonRealms is the reference implementation, including the 3D world.**
GemStone exists in this project to prove the seam is real, not as a product.
Lich integration should be excellent for both games. **No GemStone world will
be built.**

The consequence for how the DragonRealms world is written: it is a **public
worked example**, not a private pile of one-off decisions. Another community
porting to their MUD builds their own world against it as a template. So the
generation pipeline, the asset conventions and the manifest compilation are all
part of the deliverable, and each needs its reasoning written down where
somebody reading only that file can follow it.

### The 3D window is one panel, not the application

The Godot viewer occupies a region of a shell. Whatever space it does not need,
the panels use. That is a layout rule with two consequences worth stating:

- The skin must treat the 3D view as a resizable participant in a layout, not
  as a background the panels float over. `FreeCanvas`, `DockView` and
  `DashboardLayout` already do this for panels; the viewer joins as another
  member.
- **It is also where server-pushed UI goes.** GemStone's `openDialog` /
  `dialogData` ship positioned, anchored widgets and need somewhere to put
  them. The answer is the same space, allocated by the same rules. A game with
  the `server-ui` capability contributes widgets to the layout; a game without
  it simply contributes none. That is why `server-ui` is a capability rather
  than a special case — the layout does not branch on which game is loaded.

### The existing Godot bridge is a second consumer, and that is useful

`docs/THREE_D_REBUILD_HANDOFF.md` §4 already defines `WorldSnapshot`,
`PresentationEvent` and `PresentationIntent` over an authenticated loopback
socket, with the right rule stated plainly: *Godot never decides whether an
exit exists; it plays confirmed state and events, and a click is always a
request.* That is the skin-has-no-game-logic rule, already implemented, for the
hardest skin we have. The seam should reuse its vocabulary rather than invent a
parallel one.

Two alignment notes:

- `protocol: 1` there versions the *app↔renderer wire format*.
  `DOMAIN_SCHEMA_VERSION` versions the *model adapters produce*. They move for
  different reasons and must not be conflated. Stated in `src/domain/version.ts`.
- **`PresentationEvent.kind` is a closed union** — enter, leave, advance,
  retreat, attack, hit, miss, parry, evade, block, cast, death, item-drop. That
  is DragonRealms combat seen from outside, and it has exactly the defect the
  closed vitals struct has: an adapter whose MUD has a concept not on the list
  must edit core to express it. `DomainEvent` fixes this with a namespaced
  `extension` member (`src/domain/adapter.ts`). The bridge contract should
  follow when it is next revised — not urgently, since only our own renderer
  consumes it today, but before a third party does.

---

## 10. A factual note for anything user-facing

DragonRealms and GemStone IV are operated by **Simutronics Corp**, which has
been majority-owned by **Stillfront Group** (Stockholm) since 2016 — 52.65% on
completion in 2016, increased to 55.06% in February 2017. I found no evidence
of any later sale or divestiture, but "no evidence found" is not "did not
happen", and this is the kind of fact that dates badly. **Re-verify before it
appears in a README, a funding page, or anything a Simutronics employee might
read.** Do not describe the company from memory.
