# Local AI Monitor and Background Knowledge Worker

Status: **approved architecture; implementation is not yet complete**

Scope: one interruptible local-model service that assists the live client and
uses idle time to improve evidence-backed maps, knowledge, and scripts.

This document defines a product contract, not permission to automate play in a
way the game or a community forbids. Game commands remain subject to the
existing command boundary, user control, server policy, and authoritative game
feedback.

---

## 1. Product promise

DR Companion should feel attended even when the player is not asking the AI a
question. A small local model periodically reviews recent game-state changes,
can be interrupted by meaningful alerts, and spends otherwise idle inference
time on bounded research jobs:

- reconcile observations with the room/node and typed-tether map;
- extract candidate facts for the local knowledge base and wiki drafts;
- find conflicts, gaps, and stale evidence in databases;
- explain, translate, test, and propose repairs to Ruby/Lich, Python, and
  TypeScript scripts; and
- prepare questions when evidence is insufficient instead of inventing facts.

The model is not the game's nervous system. Deterministic parsers, the current
state store, the MUD graph, Lich, and the command arbiter remain authoritative.
The model is a preemptible cartographer, librarian, script mechanic, and
advisor.

## 2. Non-negotiable boundaries

1. **Read structured events before pixels.** “Scan the game screen” normally
   means inspect the accumulated game-event and state-delta buffer. Screenshot
   or vision analysis is a fallback only for information unavailable through
   the game stream or accessible UI state.
2. **Never drop events between scans.** The five-second review is not
   five-second polling of ephemeral UI. The bridge captures continuously and
   the AI receives a bounded, ordered delta since its last acknowledged cursor.
3. **The MUD is authoritative.** Model output never confirms movement, combat,
   inventory, roundtime, health, or a room transition. Only observed game state
   can do that.
4. **Known mechanics stay deterministic.** Parsing, emergency stop, command
   cancellation, route execution, roundtime gates, reconnect, and known event
   recognition must not wait for an LLM.
5. **One command path.** AI proposals enter the existing typed, permissioned
   command boundary. There is no alternate socket, hidden macro path, or direct
   model-to-Lich executor.
6. **Background output starts as a proposal.** A generated map edge, database
   value, wiki statement, or script patch is not canonical merely because it
   looks plausible.
7. **Every durable claim carries evidence.** Origin, timestamps, source scope,
   confidence, authorship/model identity, review state, and supersession remain
   queryable.
8. **Interruption is normal.** Background work checkpoints at small boundaries,
   yields to live alerts, and resumes without replaying the entire world.
9. **No credentials in model context.** Game passwords, API keys, provider
   tokens, private keys, and unrelated private messages never enter prompts,
   training corpora, logs, or published datasets.
10. **Local-first does not mean unrestricted.** Imported models and adapters
    receive explicit capabilities and resource budgets. Untrusted code or model
    output is data, not executable authority.

## 3. Runtime shape

```text
continuous MUD/Lich stream
           |
           v
 deterministic parsing and normalization
           |
           +------> authoritative live state ------> UI / isometric board
           |                       |
           |                       +------> critical deterministic safeguards
           |
           v
 ordered event journal + alert classifier
           |
           +------> urgent interrupt -------------------------+
           |                                                   |
           v                                                   v
 adaptive review scheduler ----------------------------> live AI context
           |                                                   |
           |                                             typed proposal
           |                                                   |
           |                                      validation + command policy
           |                                                   |
           |                                       existing command boundary
           |
           +------> idle budget scheduler
                               |
                               v
                    resumable background job
                               |
                               v
                 evidence-backed candidate patch
                               |
                               v
                  validate / review / promote
```

This is one service and one data flow. The AI worker consumes the established
stream and stores proposals beside the established map, knowledge, and script
systems; it does not replace them.

## 4. Scheduling contract

### 4.1 Continuous capture

Incoming game data is journaled and normalized immediately. A model invocation
is never required to preserve a line, update a known state field, sound a
deterministic alert, or stop a command queue.

Each AI review receives an inclusive start cursor and returns an acknowledged
end cursor. Events remain available until acknowledgment. On timeout, crash, or
cancellation, the cursor is not advanced.

### 4.2 Adaptive review heartbeat

Five seconds is the normal-play target, not a hard timer:

| Situation | Review policy |
|---|---|
| Critical alert | Interrupt immediately; deterministic protection acts first |
| Combat or active travel | Small state packets every 1–2 seconds only when judgment is needed |
| Normal active play | Review changed state about every 5 seconds |
| Quiet town activity | Review every 10–30 seconds |
| No relevant state change | Skip inference |
| Disconnected or player idle | Suspend live reviews; run approved background jobs |

A stable hash of the AI-relevant state prevents repeated review of identical
input. The scheduler reserves capacity for urgent work and may cancel a
background generation at any token boundary.

### 4.3 Alert priorities

| Priority | Examples | Required behavior |
|---|---|---|
| **Critical** | stop request, disconnect, runaway command loop, credential exposure | Act deterministically, cancel AI work, surface the result |
| **Urgent** | death, stun, unexpected combat, route divergence, destructive-action ambiguity | Interrupt background work and submit a focused live packet |
| **Normal** | new room, unfamiliar object, script warning, private message selected by user policy | Include in the next heartbeat |
| **Background** | missing wiki metadata, map conflict, undocumented script behavior | Create or reprioritize a durable job |

Player-configured alerts can change notification behavior, but cannot weaken
credential isolation, emergency stop, command validation, or game-state truth.

## 5. Separate live and research contexts

An ever-growing chatbot transcript is not runtime state.

The **live context** is deliberately small: current room, nearby confirmed
topology, character condition, active objective, running script, latest event
delta, outstanding command, alerts, and currently legal tools.

The **research context** belongs to one resumable job: selected records,
retrieved documentation, evidence excerpts, candidate patch, validations,
unresolved questions, and a checkpoint summary.

Stable instructions and tool schemas should use provider-supported prefix/KV
caching. Changing state is appended as a compact suffix. Large maps, manuals,
and script libraries are retrieved by ID rather than copied wholesale into
every request.

## 6. Background job contract

Every job is bounded, durable, inspectable, and restartable. A minimum record:

```json
{
  "schemaVersion": 1,
  "jobId": "job:01J...",
  "kind": "map_reconciliation",
  "priority": "background",
  "status": "queued",
  "scope": { "regionId": "crossing-west" },
  "inputRefs": ["observation:1732", "routeFailure:219"],
  "allowedTools": [
    "propose_node",
    "propose_tether",
    "flag_conflict",
    "request_observation"
  ],
  "budget": { "maxTokens": 2048, "maxSeconds": 30 },
  "cursor": null,
  "checkpointRef": null,
  "createdAt": "2026-09-04T00:00:00Z",
  "updatedAt": "2026-09-04T00:00:00Z"
}
```

Required states are `queued`, `running`, `checkpointed`, `awaiting_review`,
`completed`, `failed`, and `cancelled`. A crash cannot convert `running` into
`completed`. Retrying a job must be idempotent or create a new candidate
revision linked to the earlier attempt.

### 6.1 Legal transitions

This table is normative and it is also the table `ALLOWED` in
`src/lib/aiJobStore.ts` implements. The two are compared by
`tools/ai-job-store-test.mjs`, which parses this table out of this file, so a
change to either that is not made to both fails the build. Edit them together.

| From | May become |
|---|---|
| `queued` | `running`, `cancelled` |
| `running` | `checkpointed`, `awaiting_review`, `completed`, `failed`, `cancelled`, `queued` |
| `checkpointed` | `running`, `cancelled`, `failed` |
| `awaiting_review` | `completed`, `failed`, `cancelled` |
| `completed` | — |
| `failed` | — |
| `cancelled` | — |

Two changes are pending and deliberately not written above, because the table
must describe the code as it stands rather than as it is about to be.
Increment A12 of `PLAN_TO_1_0.md` will require a `resultRef` on
`running → completed`, so a job cannot reach a terminal success without
naming what it produced, and will add `checkpointed → queued` so a resumable
job can be handed back to the queue instead of only forward to `running`. The
implementation handoff of 5 Sep 2026 records both; neither is true of the code
today.

Initial job families:

- `map_reconciliation`
- `knowledge_extraction`
- `wiki_draft`
- `database_conflict_review`
- `script_explanation`
- `script_translation`
- `script_repair`
- `evaluation_case_mining`

## 7. Evidence and promotion

Durable work follows this lifecycle:

```text
raw observation -> normalized event -> candidate claim
       -> corroborated claim -> accepted local fact
       -> optional signed publication or community endorsement
```

A candidate claim should resemble:

```json
{
  "schemaVersion": 1,
  "claimId": "claim:01J...",
  "subject": "room:142",
  "predicate": "has_tether",
  "value": {
    "destination": "room:143",
    "kind": "ladder",
    "command": "climb ladder"
  },
  "evidenceRefs": ["event:1733"],
  "confidence": 0.72,
  "status": "candidate",
  "producer": {
    "kind": "model",
    "identity": "local-worker",
    "model": "Qwen3-4B-Instruct",
    "adapter": "dr-companion-local-v1",
    "softwareVersion": "0.1.1"
  },
  "createdAt": "2026-09-04T00:00:00Z",
  "reviewedAt": null,
  "reviewer": null,
  "supersedes": null,
  "privacy": "private",
  "licence": null
}
```

Every field above is required, and the four the first draft of this section
left out are the ones that decide whether a claim may leave the machine. They
were adopted from the implementation handoff of 5 Sep 2026 while nothing had
yet been built against the narrower shape, so they cost a decision now instead
of a migration later.

| Field | Why it is not optional |
|---|---|
| `privacy` | `private`, `group`, or `public-candidate`. Publication reads this field, so a claim with no privacy is a claim nothing may safely share. |
| `licence` | Null only when the claim rests on nothing third-party. A claim derived from wiki prose or a community script carries the terms it inherited. |
| `reviewer` | Who accepted it, named. A promotion with no reviewer cannot be audited or reversed against a person. |
| `reviewedAt` | Null until reviewed. "Never reviewed" and "reviewed and found current" must stay different facts, exactly as with `enrichedAgeSeconds` elsewhere in this app. |
| `producer.identity` | Which worker, parser, importer or person emitted it. `producer.kind` alone cannot distinguish two models or two people. |

`status` is one of `candidate`, `corroborated`, `accepted-local`, `published`,
`rejected`, `retracted`, or `superseded`. `retracted` and `superseded` are
distinct on purpose: a retraction says the claim should never have been made,
a supersession says a better one exists, and collapsing them loses the reason
the older record is still on file.

Confidence is advisory, never proof. Promotion policy is based on evidence type
and risk. A private provisional visual tag may be admitted after one clean
observation; a new public route, item property, or safety classification may
require repetition, independent corroboration, or human approval.

Retractions and corrections append new records and supersede old claims. They
do not erase the evidence trail. A future public signed ledger may distribute
claim hashes, endorsements, revocations, and authority metadata; it is not an
MVP dependency and must not become a speculative token or financial system.

## 8. Map and isometric-world work

The worker extends the fixed-isometric world contract in
`THREE_D_WORLD_STRATEGY.md`; it does not author a free-roaming world.

Useful background results include:

- candidate room/node identities and aliases;
- typed tether classification for roads, doors, portals, ladders, ferries,
  docks, water crossings, climbs, and warp points;
- conditional, directional, seasonal, scheduled, or skill-gated traversal;
- room-cluster and region membership;
- terrain, structure-kit, overlay, prop, spawn-socket, and influence tags;
- contradictions between observed topology and stored map data; and
- requests for a specific observation needed to resolve ambiguity.

The worker never invents screen coordinates to conceal an unresolved exit.
Node identity and legal transitions come from the MUD graph; isometric
footprints, anchors, and art metadata remain presentation-only.

## 9. Knowledge, database, and wiki work

The existing knowledge-base rule remains in force: mutable or exact facts stay
in queryable sources, not model weights. Fine-tuning teaches the model how to
query, extract, compare, cite, abstain, and propose changes.

Every generated fact records whether it was:

- observed directly in game;
- parsed from official game text;
- retrieved from a named documentation or wiki revision;
- inferred from multiple evidence records;
- supplied by a player;
- endorsed by a named community authority; or
- generated but uncorroborated.

The worker emits small patches, not silent whole-database rewrites. Source
licence, redistribution permission, privacy, and community rate limits travel
with imported data.

## 10. Script improvement loop

Ruby remains required for Lich. Python and TypeScript are supported authoring
and automation languages. Genie script is an import/translation source, not a
new runtime target.

```text
observe repeated failure -> collect minimal trace -> locate owning script
 -> draft patch -> syntax/static checks -> recorded-event simulation
 -> review or policy gate -> activate at a safe boundary -> monitor + rollback
```

The worker never edits a running script and immediately trusts the replacement.
Fixtures must cover success, roundtime, missing target, changed room, closed
door, absent transport, interruption, disconnect, misleading player speech,
and unexpected combat. Activation preserves the previous known-good version.

## 11. Model and performance profile

The reference MVP is **Qwen3 4B Instruct in non-thinking mode**, preferably a
4-bit local build. It is a deployment profile, not a hard-coded provider: the
worker interface must allow later local or user-authorized hosted providers
without changing the job, evidence, or command contracts.

Expected roles:

- Qwen3 4B: script comprehension, extraction, reconciliation, drafting, and
  ambiguous live-event judgment;
- deterministic rules or a later 270M–1B specialist: common event routing and
  tightly constrained function selection; and
- existing code: continuous capture, state ownership, safety, scheduling,
  validation, route execution, and command delivery.

Design targets for one local character:

| Measure | MVP target |
|---|---|
| Normal review cadence | approximately 5 seconds when relevant state changed |
| Urgent model response | begin within 500 ms on target hardware |
| Short structured decision | 5–20 generated tokens |
| Routine live context | compact enough for prompt-prefix caching |
| Background work | checkpointable and preemptible |
| Automatic consequential commands | at most one awaiting confirmation |

An 8–12 GB GPU should be a viable inference target; 16–24 GB provides more
context and development headroom. A 24 GB NVIDIA GPU is the practical initial
QLoRA development target. CPU and user-selected hosted-provider fallbacks must
remain possible. Measured performance, not model marketing, determines the
shipped defaults.

References:

- [Qwen3-4B model card](https://huggingface.co/Qwen/Qwen3-4B)
- [Qwen3 official speed benchmark](https://github.com/QwenLM/Qwen3/blob/main/docs/source/getting_started/speed_benchmark.md)
- [Hugging Face PEFT quantization and QLoRA guide](https://huggingface.co/docs/peft/developer_guides/quantization)

## 12. Training-data policy

Do not dump raw logs into training. Curate high-value transformations and keep
exact or changing facts in retrieval.

Good adapter data includes verified examples of:

- broken script to corrected script;
- Genie concept to reviewed Ruby, Python, or TypeScript equivalent;
- natural-language request to permitted typed tool call;
- game output to normalized event;
- observations to evidence-backed node/tether proposals;
- ambiguous evidence to a precise question or abstention; and
- unsafe or unsupported action to a correct refusal.

Before training, remove credentials, API keys, private communications, personal
data, disallowed copyrighted material, and records without appropriate consent
or provenance. Deduplicate repetitive play logs. Keep game text, player speech,
script output, and system messages explicitly separated.

Evaluation splits must be separated by whole script family, character, session,
time range, and region where practical; random adjacent-line splits leak. The
hidden suite must include unfamiliar scripts, unseen routes, contradictory
sources, malformed metadata, interrupted commands, and prompt injection through
room descriptions or player speech.

Adapters may eventually be distributed per game or community, but an untrusted
adapter never receives unrestricted credentials, filesystem access, peer
network access, paid API access, or game-command authority.

## 13. MVP implementation slices

Implement in this order, extending current owners rather than adding alternate
systems:

1. **Event journal and cursor:** persist bounded normalized deltas from the
   existing stream; prove no loss across timeout and cancellation.
2. **Alert broker:** deterministic priorities, deduplication, acknowledgement,
   and immediate cancellation of background work.
3. **Scheduler and job store:** adaptive heartbeat, unchanged-state suppression,
   resource budgets, checkpoints, restart recovery, and honest status.
4. **Model-provider boundary:** local Qwen adapter first; typed input/output,
   cancellation, timeout, health, and capability reporting. No command access.
5. **Read-only knowledge tools:** query existing map, knowledge, script, and
   evidence stores by stable references.
6. **Candidate-claim store:** provenance, validation, supersession, review, and
   reversible promotion into local data.
7. **One vertical map job:** reconcile a recorded room/tether discrepancy and
   produce a reviewable candidate without changing canonical topology.
8. **One vertical script job:** propose a repair and pass syntax plus recorded
   fixtures without activating it.
9. **Live suggestion tool:** allow a tiny validated proposal through the
   existing command boundary, initially confirmation-required.
10. **Training/export pipeline:** only after runtime schemas and hidden
    evaluations provide a stable target.

## 14. MVP acceptance criteria

The first complete slice is acceptable when:

- every incoming event is preserved while the worker is busy;
- unchanged state causes no model call;
- a critical alert cancels a background job and deterministic protection does
  not wait for the model;
- a cancelled or crashed job resumes from a truthful checkpoint;
- the model cannot call Lich, the network, or the filesystem except through
  explicitly granted typed tools;
- one map job emits a provenance-bearing candidate and leaves canonical map
  data unchanged until promotion;
- one script-repair job passes recorded fixtures and retains rollback material;
- model failure, absence, timeout, and out-of-memory state are visible and do
  not impair ordinary client use;
- logs and exported datasets contain no credentials or private messages; and
- the fixed-isometric board continues to render solely from authoritative room
  identity plus presentation metadata.

### 14.1 Required adversarial tests

The criteria above are the happy path, and a suite that only proves the happy
path is a suite that cannot tell a working seam from an inert one. Each seam
below is acceptable only when its attack column is also covered. Adopted from
the implementation handoff of 5 Sep 2026, which listed them against the same
seams this document already names.

| Seam | Happy path | Required attack |
|---|---|---|
| Event journal | Ordered append, read, acknowledge | Acknowledging past the latest event; a cursor behind retention; an append during a read; a crash before the acknowledgement |
| Ingestion | New lines appended once | Remount and replay; a trimmed source buffer; a version tick carrying no new lines |
| Alert broker | Priority, dedupe, acknowledge | Priority escalation; a repeated alert; a false disconnect at startup; acknowledge as distinct from resolve |
| Scheduler | Activity cadence | An unchanged review hash; a clock that runs backwards; a critical alert arriving before the next due time; no provider at all |
| Job store | Legal transitions | An illegal terminal transition; a restart while `running`; a duplicate retry; a stale worker lease |
| Provider | A valid schema result | Timeout, abort, out of memory, malformed JSON, extra fields, a secret reaching the prompt |
| Worker | Success advances the cursor | An abort or invalid result must not acknowledge; an alert preempts background work; a stale checkpoint |
| Candidate claims | Append and review | Missing evidence; a forged reference; a supersession cycle; a claim rejected on privacy or licence |
| Map job | An observed tether candidate | An invented destination; a directionless exit given a fabricated anchor; a portal treated as adjacency |
| Script job | A patch passes fixtures | A path escape; modifying a running file; a network attempt; a base hash that changed underneath |
| Command suggestion | A confirmed exact command | Stale state; an altered command; an expired suggestion; a second pending action |

Two of these are already increments rather than aspirations: the alert
broker's acknowledge-versus-resolve row is A10 of `PLAN_TO_1_0.md`, filed
after a persistent stun was found re-raising an urgent review every second,
and the job store's terminal row is A12.

## 15. Explicitly deferred

- autonomous unrestricted play;
- computer vision as the primary game-state source;
- full-model fine-tuning;
- mandatory cloud accounts;
- automatic publication of generated wiki or map claims;
- peer-to-peer model transfer before provenance, consent, moderation, resource
  budgets, and secure unloading are designed;
- public signed-ledger implementation; and
- automatic activation of generated scripts.

These are deferred so the MVP can first prove reliable capture, interruption,
evidence, resumability, and one safe end-to-end background result.

## 16. Read-only tool registry

The model reaches the world through typed tools and through nothing else. A
tool declares its shapes and its ceiling:

```ts
interface ReadOnlyTool<I, O> {
  id: string
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  maxResultBytes: number
  execute(input: I, context: ToolContext): Promise<O>
}
```

The initial set, all read-only:

- `map.get_node(roomId)`, `map.get_tethers(roomId)`,
  `map.find_conflicts(regionId, since)`
- `observations.read(refs)`
- `knowledge.search(query, sourceFilters, limit)`,
  `knowledge.get_record(stableId)`
- `scripts.search(language, query)`,
  `scripts.read_excerpt(path, startLine, endLine)`
- `tests.list_for_path(path)`

An allowlist of names is the smaller half of this. The rules are the half that
does the work:

- **Validate input before execution.** A tool that trusts its arguments is a
  tool the model can point anywhere.
- **Enforce the result ceiling and the scope,** both. `maxResultBytes` is not
  advisory; a tool that would exceed it fails rather than truncating, because
  a silently shortened corpus is a wrong answer that looks complete.
- **Return stable references, not copied corpora.** `observations.read(refs)`
  presumes durable evidence: a reference that dangles after journal eviction
  is a claim whose provenance cannot be re-derived, so evidence has to outlive
  the journal or the reference must not be issued.
- **Escape or label every piece of untrusted text.** Room descriptions, wiki
  prose and script source are data. Nothing read through a tool is ever
  interpreted as an instruction, however it is phrased.
- **Record every call in the job trace, without secrets.** A job whose tool
  calls are not in its trace cannot be audited, and a trace carrying a
  credential is a leak with a long tail.

Adopted from the implementation handoff of 5 Sep 2026, which stated the rules
this section had left as an allowlist.

## 17. Map candidate validator

A tether the model proposes is checked before it is even allowed to be a
candidate. The validator is deterministic and runs without the model:

```text
FUNCTION validateTetherCandidate(candidate, evidenceStore, mapStore):
  REQUIRE candidate.fromRoomId is known to mapStore
  REQUIRE candidate.evidenceRefs is not empty
  evidence = evidenceStore.resolveAll(candidate.evidenceRefs)
  REQUIRE every evidence item resolves, is unmodified, and is in scope

  IF candidate.toRoomId is not null:
    REQUIRE evidence contains an authoritative snapshot whose roomId
            equals candidate.toRoomId
  ELSE:
    candidate.boardAnchor = null

  IF candidate.kind == 'ferry':
    REQUIRE evidence includes a transport entry or a successful crossing

  IF candidate.kind IN {'portal', 'warp'}:
    REQUIRE no geometric adjacency is inferred from visual proximity

  candidate.status = 'candidate'
  RETURN candidate
```

Each clause exists because of a specific way a plausible-looking map is wrong.
An **invented destination** is the commonest: a model that has read a room
description can name an exit's far side without anything ever having gone
through it, and only the authoritative-snapshot requirement separates a
observed tether from a guessed one. A **directionless exit** must not be given
a board anchor, because an anchor is a claim about compass placement and the
graph did not make one — null is the honest value, and `WorldExit.boardAnchor`
in `src/lib/presentationTypes.ts` already documents it that way. A **portal**
looks adjacent on a board and is not: proximity in a presentation layout is
never evidence about movement, which is the same rule the world contract
states from the other end.

## 18. Suggestion to command boundary

This is the only path by which model output can become a game command, and it
is confirmation-gated at every step:

```text
FUNCTION requestSuggestionExecution(suggestionId, userConfirmation):
  suggestion = suggestions.get(suggestionId)
  REQUIRE suggestion.status == 'pending'
  REQUIRE suggestion.expiresAt > now
  REQUIRE userConfirmation.matches(suggestion.id, suggestion.exactCommand)
  REQUIRE authoritativeState.version == suggestion.basedOnStateVersion
  REQUIRE commandPolicy.allows(suggestion.commandType, currentContext)

  pending = existingCommandBoundary.submit(suggestion.exactCommand)
  suggestions.markAwaitingAuthoritativeResult(suggestion.id, pending.id)
  RETURN pending

ON gameResult(pendingId, result):
  suggestion = suggestions.forPending(pendingId)
  suggestions.resolveFromAuthoritativeResult(suggestion.id, result)
```

Five properties, and none of them is optional:

1. **The exact command.** The player confirms the literal text that will be
   sent, not a description of it. A confirmation that matches an intent rather
   than a string is a confirmation of something else.
2. **The state version.** A suggestion made about a room the character has
   left is stale, and staleness here is not cosmetic — it is the difference
   between attacking what is in front of you and attacking nothing.
3. **Expiry.** A pending suggestion ages out on its own rather than waiting to
   be wrong.
4. **One pending action at a time.** Two confirmations in flight cannot be
   reasoned about, by the player or by the code.
5. **The model never labels its own proposal successful.** The outcome comes
   from the game, through the existing command boundary, which stays the only
   thing that talks to Lich.

## 19. Data classification before prompting

Every piece of state is classified before it can reach a prompt, and the
classification decides what may happen to it.

| Class | Examples | Handling |
|---|---|---|
| Public game state | Room title, a public NPC action, a public system line | May enter a local prompt, carrying provenance |
| Private player state | Build, inventory, personal notes | Local prompt only, for an explicit product purpose; never published |
| Private communications | Whispers, direct messages | **Excluded by default**; opt-in per source, never global |
| Credential | Password, API key, token, private key | Never prompted, never logged, never trained on, never published |
| Third-party authored | Scripts, wiki prose, model files | Track licence, source, permission, and untrusted-instruction status |
| Generated candidate | A model claim, a patch, a category | Stored with producer, evidence, review state, and its limits |

The credential row is already enforced by the scanner this document's section
2 requires. The private-communications row is not yet built, and it is the one
most easily lost by accident: whispers arrive in the same stream as everything
else, so excluding them is an active step rather than a default that happens
on its own. It is increment G12 of `PLAN_TO_1_0.md`, with the per-source
opt-in recommended rather than a single global switch, because "share my
whispers" is not one decision.

Adopted from the implementation handoff of 5 Sep 2026, which had the full
table where this document had only the credential rule.
