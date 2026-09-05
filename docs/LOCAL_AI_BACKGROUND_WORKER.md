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
    "model": "Qwen3-4B-Instruct",
    "adapter": "dr-companion-local-v1"
  },
  "supersedes": null
}
```

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
