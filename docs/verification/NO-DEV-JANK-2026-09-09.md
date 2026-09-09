# No developer jank in front of a player — 9 September 2026

Dan, looking at the AI worker panel in his live client on a machine with no
model installed: **"this is jank that doesn't belong in front of a customer."**

The rule applied here is *maximum information transference*, so nothing was
deleted. What changed is rank and place: a number a player cannot act on is not
shown by default, it lives behind a details disclosure or in the Diagnostics
panel, where it stays available for a bug report.

## The AI panel, before and after

| | Before | After |
|---|---|---|
| No model | `Local model — No local model is installed.` / `Unreviewed events 1200` / a paragraph saying nothing is wrong / `Model server [http://127.0.0.1:11434] [Test]` / a paragraph naming Ollama 11434, LM Studio 1234, llama.cpp 8080 / `No model server answered.` / `Background jobs — queued 3` / `Last attempt: absent: No local model is installed.` / a paragraph about the worker | `The assistant is off. It needs a model running on this computer.` · a **Set one up** button · a closed **Details for a bug report** |
| Set up pressed | (always visible) | the **Model address** field, **Test**, the three known addresses, and the failure sentence for the last attempt |
| Model present | the same wall of counters, plus the review | `The assistant is watching the game.` with the review time · the suggestion card · the review's notable lines · **Change the model address** · the same closed disclosure |

Screenshots, all from a real browser against a dev server, with the
model-present state reached through the panel's own Test button and a real
loopback server speaking the `/v1/models` subset `aiLocalProvider.ts` probes:

- `no-dev-jank-2026-09-09-ai-no-model.png`
- `no-dev-jank-2026-09-09-ai-setup-open.png`
- `no-dev-jank-2026-09-09-ai-model-present.png`
- `no-dev-jank-2026-09-09-room-text.png`
- `no-dev-jank-2026-09-09-safety-footer.png`

Regenerate them, and re-run the checks that go with them:

```
npx vite --port <a free port> --strictPort     # not 1420, 5180, 5184, 8123
node tools/no-dev-jank-shots.mjs http://127.0.0.1:<that port>/
```

The command is here rather than a claim about what the pictures show, because
a claim rots and a check does not.

## Where the numbers went

One developer view, and it already existed: `DiagnosticsPanel` (Settings ›
diagnostics). It gathers Ruby, Lich, the bridge port, the token file and the
viewer, and builds the bug bundle. A second "AI diagnostics" surface would be a
fork of it, so the panel's instruments went into its `Local model` row: ticks,
unreviewed, lost, alerts pending, jobs by state, the failure kind and the
last-attempt string. A bug bundle therefore carries strictly more than before.

## The check

`tools/dev-jank-test.mjs`, registered in `package.json` as `test:dev-jank` and
in `tools/test-suites.json`. **15 checks, 0 failures.**

- The name set is **derived**: `JobStatus` and `JobKind` from `aiJobStore.ts`,
  `ProviderFailure` from `aiModelProvider.ts`, the numeric fields of
  `AiWorkerStatus` from `aiIngest.ts`. Only the snake_case members are banned as
  text — `running`, `failed`, `absent` and `error` are ordinary English and
  banning them would light up the tree and get the check switched off.
- The exemption is the real `<details>` element, depth-counted, not a comment or
  a class name.
- Positive controls: a planted counter and a planted state name are both caught.
- Negative controls: the same text inside a disclosure is not flagged; nor is a
  counter read in ordinary code, nor a comment, nor text after a nested
  disclosure. A line-number guard catches a blanker that ate newlines.

`tools/dev-jank-break-check.mjs` — **7 sabotages across 3 files; 0 did not
redden exactly the checks they named.** Not an npm script and not in
`test-suites.json`: it writes to tracked files.

## The sweep

116 `.tsx` files audited (all of `src/`), plus ~28 `src/**/*.ts` modules where
the rendered string lives in a lib helper rather than in JSX. Counts:
**5 fixed here**, **14 kept as player-facing**, **8 left as questions**.

### Fixed in this lane

| Surface | What a player saw | Verdict |
|---|---|---|
| `AiWorkerPanel.tsx` | `Unreviewed events 1200`, `Background jobs — queued 3`, `Last attempt: absent: …`, the address field and three ports, two paragraphs of machinery | **behind details** (all of it, plus the Diagnostics row) |
| `ClassicRoomText.tsx:86` | `Lich room 998, game uid 12345` as prose beside the room name | **behind a title**; the ids keep their exact values |
| `SafetyFooter.tsx:356,367` | `Bridge reconnecting 3/6`, `Bridge gave up (6)` in permanent chrome | **behind a title**; the badge says the fact, the hover says the count |
| `PanelBoundary.tsx:38` | a raw JavaScript `Error.message` in red inside whichever panel crashed | **behind details**; the panel now says `X stopped working.` |
| `StreamTabs.tsx:216` | a tooltip naming `docs/ENGINE.md` and "a frontend without the streams capability" | **player-facing, reworded** |

### Kept as player-facing (no change needed)

`SituationBanner` / `StatusBoard` flag chips (`bags full`, `roundtime` — these
read as English and the underscore is already stripped); `SafetyFooter`'s
`RT 5s`, `2 queued`, `Paused by Lich`; `GameConnectionBar`'s `Lich has exited —
restart Lich, then Attach.`; `StorageWarning`'s failed-write count (it says how
much work is at risk, which is actionable); `DemoBanner`; `GameCommandBar`'s
alias-expansion line; `WaitingForCharacter`; `CommandPalette`'s task hints;
`InventoryPanel`'s `not reported`; `AppControls`' Live/Mock badge;
`TaskFlowPanel`'s `Running <task>`; `Console`'s problem count.

### Left as questions, with evidence

Each of these is arguable in both directions, so this lane did not decide it.

1. **`TopBar` / `locationLine.ts:57,64` — `Room 998 · Empaths' Guild · confirmed
   0 s ago`.** The numeric mapper id leads the primary location display. But
   `docs/PLAN_TO_1_0.md`'s D-lane handoff §9 states a hard rule that the
   location line carries freshness and confirmation state, and the room id is
   how a player cross-references Lich's own mapper. Changing it needs the lane
   that owns that rule.
2. **`GameConnectionBar.tsx:175–187` — a numeric port box defaulting to `11024`
   and tooltips naming `--detachable-client`.** This is a genuine control a
   player operating a detached Lich has to use; the question is whether the
   default path can hide it. Owned by the attach lane.
3. **`SignIn.tsx:600` and `LichLauncher.tsx:275,281` — raw Rust `Err` text and
   raw Ruby stderr, `font-mono`, on the pre-login screen.** `LichLauncher`'s own
   comment argues this is "what to paste into a bug report or a search", which
   is a real argument. The disclosure pattern used in `PanelBoundary` here would
   fit, but the sign-in lane is live in `wt-signin`.
4. **`TaskFlowPanel.tsx:480,501,518,596` — tooltips carrying task ids, absolute
   paths, byte counts and `python python/runner.py run <id>`.** Deliberate:
   "Runs the same outside the app" is a documented feature of that panel.
   Listed because a tooltip is still a surface.
5. **`Console.tsx:197,214,271` — lowercase filter chips (`all`, `problems`,
   `game`, `trace`) and trace rows rendered as `send`/`reply`/`no_match`
   padded columns.** The Console is a disclosure the player opens, so it is
   already "behind details" by this lane's own rule; the chips are a styling
   question, not a placement one.
6. **`PanelWindow.tsx:59–75` — raw internal panel ids and "see docs/NO-3D.md"
   addressed to the player** on a stale pop-out route. Clear jank; left alone
   because `wt-layout` is rebuilding exactly this.
7. **`GameConnectionBar.tsx:141` — `{n} older lines dropped`.** A buffer-depth
   counter, but it tells a player their scrollback is truncated, which they can
   act on.
8. **`SetupWizard` / `ComponentCard` — `{plan.path}` and `{state.error}` raw.**
   `ComponentCard` already puts its checksums and sources behind a
   `Where this comes from` toggle, which is the pattern to extend; the setup
   lane owns it.
