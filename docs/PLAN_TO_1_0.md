# DR Companion — the working plan to 1.0

Version 3.1, 5 Sep 2026 (3.0 earlier the same day), written against `main` @ `ae0e57a9` with PR #285 @
`8299fe86` open and mergeable. Section 11 evaluates the 5 Sep handoff PDF against this plan. Section 9 lists what the audit of version 2
found wrong and how each was found. Section 10 lists the decisions only Dan
can make.

This document is worked by several sessions at once, by agents that may be less
careful than the one writing it. Every increment names its files, its exact
commands, and what the output must say. If you are about to guess, stop: the
guess is the bug.

**`node tools/plan-audit.mjs` checks this file.** It verifies every path an
increment says it touches exists (or, for `new:` paths, does not yet exist),
every `depends-on` names a real increment, IDs are unique, and no `[x]`
increment depends on something not yet `[x]`. Run it before and after editing
this file. It runs in the full suite, so a stale plan fails the build.

---

## 0. How to use this document

### 0.1 Increment IDs and status markers

Every increment has an ID like `A3` (lane letter, number). Its first line is a
checkbox. Change the marker and add the bookkeeping line under it, nothing else:

```
- [ ] A3  not started
- [~] A3  in progress       ← next line: `  owner: <agent> claim: <task-id> since: <date>`
- [x] A3  done              ← next line: `  commit: <sha> verified: <date> minutes: <n>`
- [!] A3  blocked           ← next line: `  blocked-on: <ID or reason>`
- [-] A3  dropped           ← next line: `  why: <one sentence>`
```

Tally (from the repo root):

```bash
node tools/plan-audit.mjs --tally
```

It prints the marker counts, then a bar per lane, then a bar per gate from
section 4, plus the minutes recorded on finished increments. That is the
answer to "where is this project", and it comes from the markers rather than
from anyone's summary, so it cannot flatter. A gate reads GREEN only when
every one of its increments is `[x]`. If a gate names an increment that does
not exist, the tally says so instead of quietly counting a smaller
denominator.

### 0.2 The document lives in the repo, so bookkeeping is a commit

The marker change ships **in the increment's own commit** — add
`docs/PLAN_TO_1_0.md` to the paths you stage. If you only have a marker to
change (claiming, blocking), commit it alone:

```bash
git commit -m "chore(plan): A3 in progress" -- docs/PLAN_TO_1_0.md
```

Two sessions editing different lines of this file merge cleanly. If you hit a
conflict it is on the same increment, which means two sessions claimed one
increment: the earlier `since:` wins, the other picks different work.

### 0.3 Picking work

1. Read section 1 (traps). Every time. Each item cost a real session hours.
2. Read section 3 (conflict matrix). Pick a lane with no `[~]` increment, or an
   increment whose `touches:` does not overlap any `[~]` increment's list.
3. Every `depends-on:` must be `[x]`.
4. Mark it `[~]`, create the claim (section 2.1), then start.

### 0.4 Starting a session (copy-paste)

```bash
cd /c/Users/Admin/dev/dr-companion && git fetch -q origin
ID=a3; SLUG=review-hash-covers-room                     # your increment
WT=/c/Users/Admin/dev/wt-$ID                            # never inside Downloads
git worktree add -b lane-$ID/$SLUG "$WT" origin/main
cd "$WT"
cmd //c mklink //J node_modules "C:\Users\Admin\dev\dr-companion\node_modules" >/dev/null
npm run worktree:init 2>/dev/null || (node tools/vendor-fetch.mjs --stub && git submodule update --init --recursive)
node tools/run-tests.mjs > /tmp/base.log 2>&1; echo "baseline exit: $?"; tail -1 /tmp/base.log
```

The baseline must say `all passed` before you change anything. If it does not,
the tree is red before you arrived: report it, do not build on it.

Branch name `lane-<id>/<slug>`, PR title `<type>(<area>): <what> [<ID>]`.
When done: `git worktree remove "$WT"`.

### 0.5 What "done" means, in addition to each increment's own done-when

- the `verify:` command was run and printed what the increment says;
- for a guard or test, `sabotage:` was performed, the test went red, the file
  was restored, and `md5sum` matched the pre-sabotage hash;
- `npx tsc -b` exit 0; `node tools/run-tests.mjs` ends `all passed`;
- `git diff --cached --check` printed nothing;
- committed with only the `touches:` files plus this plan
  (`git show --stat HEAD` to confirm);
- pushed; PR opened; the claim closed with the sha and the verify output pasted
  into `checks`;
- the marker here is `[x]` with the sha.

---

## 1. Traps — read before every increment

Each has already been hit in this repository. None is hypothetical.

1. **Node cannot run a `src/lib` module whose imports lack `.ts`.**
   `import x from './foo'` works in Vite and fails under
   `node --experimental-strip-types`. Write `./foo.ts`. JSON imports need
   `with { type: 'json' }`. `ERR_MODULE_NOT_FOUND` from a test you wrote is
   this; fix the import in *your* file.
2. **A test registered in only one place never runs.** Add to `package.json`
   `scripts` **and** `tools/test-suites.json`. Then run
   `node tools/run-tests.mjs` and confirm your suite name and its check count
   appear, and the total rose by exactly your checks.
3. **Gitleaks blocks credential-shaped literals, including fake ones.**
   Assemble fixtures at runtime (`'pass' + 'word: x'`), low entropy.
   `const STORAGE_KEY = 'drc.something.v1'` can trip it on entropy: a
   documented false positive — record it in the claim, then `--no-verify`.
   Nothing else gets `--no-verify` without the same evidence written down.
4. **Never read `$?` after a pipe.** `cmd | tail` reports `tail`'s status.
   Redirect to a file, `echo "exit: $?"`, then `tail` the file.
5. **`??` not `||` when 0 is a real value.** Balance 0, position 0, cursor 0
   are all meaningful.
6. **React effect deps that include a per-tick object restart the effect
   every tick.** If the cleanup aborts work, in-flight work dies on every
   unrelated update. Depend on stable values; read changing state inside via
   `useAppStore.getState()`.
7. **`gameLines()` returns a buffer mutated in place; its reference never
   changes.** Subscribe to `gameVersion()`. Components must use
   `useGameLines()`; `tools/gamelines-test.mjs` fails the build otherwise.
8. **A fresh worktree cannot `cargo build`** until `npm run vendor:stub` and
   `git submodule update --init --recursive`. The error says
   `resource path vendor\Ruby4Lich5.exe doesn't exist`.
9. **`cargo fmt` before pushing Rust.** CI runs `cargo fmt -- --check`.
10. **Stage by path. Never `git add -A` or `git commit -a`.** After committing,
    `git show --stat HEAD` must list only your files.
11. **Use a worktree per branch.** Never `git checkout` inside
    `C:\Users\Admin\dev\dr-companion`; another session's dev server is rooted
    there and will silently start serving your branch.
12. **Kill only processes you started, by PID.** Never `taskkill /IM`.
13. **Verify a merge by content on `origin/main`**, not by the merge message:
    `git fetch origin main && git grep -c '<symbol>' origin/main -- <file>`.
14. **The Bash tool halves backslashes.** Any file containing `\` is written
    with Write/Edit, never a heredoc.
15. **A sabotage that fails to compile tested nothing.** If breaking the code
    produces a loader error instead of a red test, the sabotage never reached
    the line. Change it until the test itself goes red.
16. **A zero is a claim about your instrument first.** Before reporting
    "no X found", run the same check against something known to contain X.
17. **Two things that answer the same question will drift.** `grep -rn` the
    concept before writing a module. Extend or replace; never add a sibling.
    If you catch yourself writing "I'll reuse its helper to avoid a second
    copy", you are forking.
18. **Git Bash rewrites `ref:path` arguments.** `git show origin/main:docs/x.md`
    fails with a mangled path. Prefix with `MSYS_NO_PATHCONV=1`, or use
    `git cat-file -p "origin/main:docs/x.md"` under that variable.
19. **Read the other branch before designing near it.** `rewrite/remove-2d`
    deletes `portraits.ts`, `playerArt.ts`, `creatureArt.ts`, `Portrait.tsx`,
    `CreatureArt.tsx` and proposes `src/domain/*`. Version 2 of this plan
    proposed extending `portraits.ts`; one `git diff --stat` would have
    stopped it. Before touching a file, `git log --all --oneline -3 -- <file>`.
20. **Do not batch-edit this file with `sed`.** Its tables are full of `|`,
    and under `sed -E` an unescaped `|` inside the pattern is alternation: a
    pattern that begins with `|` matches the empty string at the start of
    every line, so the replacement is prepended to all 1,200 of them. That
    happened while writing version 3.1 and was reversed only because the
    injected text was byte-identical on every line. Use the Edit tool, or a
    node script that asserts how many lines it changed and refuses on
    surprise, and run `node tools/plan-audit.mjs` before committing —
    "parsed only 0 increments" was the first sign.

---

## 2. The standard increment ritual

### 2.1 Claim

Create `.agents/claims/<task-id>.json` (schema and examples in
`.agents/README.md`; copy the shape of `local-ai-host-wiring.json`). `task-id`
is the increment ID lowercased plus a slug, e.g. `a3-review-hash-covers-room`.
`paths` = the increment's `touches:` list verbatim, plus `docs/PLAN_TO_1_0.md`.
`coordination.notes` names the owners you found and states you are extending,
not duplicating.

### 2.2 Work

Follow `do:`. Pseudocode gives the shape; real code follows the surrounding
file's style and comment density. Comments say why, not what.

### 2.3 Verify

Run every `verify:` command exactly. Paste the decisive output line into the
claim's `checks`. For a guard or test, run `sabotage:` and paste the red line,
then the restore-hash match.

### 2.4 Close

```bash
npx tsc -b > /tmp/tsc.log 2>&1; echo "tsc exit: $?"
node tools/run-tests.mjs > /tmp/suite.log 2>&1; echo "suite exit: $?"; tail -2 /tmp/suite.log
node tools/plan-audit.mjs
git add <touches...> docs/PLAN_TO_1_0.md .agents/claims/<task-id>.json
git diff --cached --check && echo "whitespace clean"
git commit -m "<type>(<area>): <what and why> [<ID>]" -- <those paths>
git show --stat HEAD | tail -n +2
git push -u origin lane-<id>/<slug>
gh pr create --fill --body "$(cat <<'EOF'
<what and why; the verify output; the sabotage result>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then `gh pr checks <n>`; merge when green with `gh pr merge <n> --squash
--delete-branch`; then trap 13.

---

## 3. Lanes, dependencies, conflict matrix

| Lane | Theme | Primary files | Hard depends-on |
|---|---|---|---|
| **C** | Merge and repo hygiene | PR #285, PR #276, `package.json`, `docs/ENGINE.md`, `presentationBridge.ts` split, `tools/plan-audit.mjs` | none |
| **A** | AI host repair | `src/lib/ai*.ts`, `AiWorkerPanel.tsx`, one line in `App.tsx` | C1 |
| **B** | Prove the live chain | `viewer.rs`, `world_root.gd`, `tools/live-chain-check.mjs`, `docs/verification/` | none |
| **D** | Layout toward the approved mockup | `App.tsx`, `columns.ts`, `layout.ts`, `MapWindow.tsx`, `panelDataContracts.ts` | D0 decided, A1 |
| **E** | First run and setup | `first-run/*`, `lich.rs`, Settings Bridge section, `docs/verification/` | none |
| **F** | Release engineering | `.github/workflows/release.yml`, versions, About/licences | none |
| **G** | AI slices 5–7 | new `aiEvidenceStore.ts`, `aiKnowledgeTools.ts`, `aiClaimStore.ts`, `aiJobProducers.ts`, `aiSuggestions.ts` | Lane A complete |
| **H** | Local model provider | new `aiLocalProvider.ts`, Settings AI section | A2 |
| **I** | Design tokens (#176, #179) | `src/components/**`, `src/index.css`, new `tools/color-token-test.mjs` | none |
| **J** | Map audit (#175) | per finding | D5 |
| **K** | Appearance (models for weapons/armor, glyphs) | new appearance data + `presentationBridge.ts` entity fields + Godot mapping | C7 decided, C4 |
| **L** | Codex contract for the Crossing slice | `docs/THREE_D_REBUILD_HANDOFF.md`, `godot/mock/*`, contract tests in `tools/` | B3 |

**Conflict matrix — same file, different lanes: order, do not parallelise.**

| File | Lanes | Rule |
|---|---|---|
| `src/App.tsx` | A1, D2–D6 | A1 first (one line). D waits for A1 `[x]`. |
| `src/components/layout/SettingsSheet.tsx` | A8, E9, E12, G7, H2 | Each edits its own `<section>`; never reorder; rebase before push. |
| `src/lib/presentationBridge.ts` | C4, G10, K3 | C4 first; nobody else edits it until C4 is `[x]`. |
| `src-tauri/src/viewer.rs` | B2, B5, B6 | Sequential within Lane B only. |
| `godot/scripts/world_root.gd` | B2, Codex | Read Codex's active claims first (`node tools/plan-audit.mjs --claims`). B2 is one branch of `_ready()`. |
| `package.json`, `tools/test-suites.json` | everyone adding a test | Append beside related entries; rebase on conflict; both must still parse. |
| `src/lib/portraits.ts`, `playerArt.ts`, `creatureArt.ts`, `Portrait.tsx`, `RoomBackdrop.tsx`, `RoomScene.tsx` | `rewrite/remove-2d` | **Nobody touches these** until C7 is decided. |
| `docs/PLAN_TO_1_0.md` | everyone | Marker lines only, per 0.2. Structural edits to this file are their own PR titled `docs(plan): ...`. |

**Recommended concurrency, three sessions:** S1 = C0, C1, C2, C3 → A1…A8 → G.
S2 = B1…B4 → L1…L6 → B5…B8. S3 = E1, E5–E9 → F1–F8 → E10–E12. A fourth
session takes I, then J after D5, then K after C7. D starts when A1 is `[x]`
and D0 is decided.

### 3.1 Lanes in flight

One row per session that currently holds a lane. **Claim a lane by adding your
row before you start, and delete it when your last PR merges** — a row here is
what stops two sessions picking the same increment, and a stale row is worse
than none, because it makes the lane look taken.

Every lane works in its own worktree off `origin/main`, never in
`C:\Users\Admin\dev\dr-companion` (§1 trap 11). One branch per lane, one or two
PRs per lane, squash-merged.

| Lane | Increments | Branch | Worktree | Since |
|---|---|---|---|---|
| A | A1–A6, A8–A12 | `lane-a/host-repair` | `dev/wt-a` | 5 Sep 2026 |
| B | B1–B8 | `lane-b/live-chain` | `dev/wt-b` | 5 Sep 2026 |
| C | C3–C8 | `lane-c/hygiene` | `dev/wt-c` | 5 Sep 2026 |
| E/F | E5–E8, F2, F6 | `lane-ef/tests-and-release-prep` | `dev/wt-ef` | 5 Sep 2026 |

Free to claim now: **I** (design tokens, no dependencies), **K1–K2**
(appearance defaults, needs C7 recorded only), **L1** (contract ownership,
after B3). **D** waits on A1 `[x]`. **G** waits on Lane A finishing and on C4.
**J** waits on D6.

**When two lanes touch one file**, §3's conflict matrix decides who goes first;
where it is silent, the earlier `Since` wins and the other rebases. Conflicts in
`package.json`, `tools/test-suites.json` and this file's marker lines are always
resolved by keeping **both** sides' entries, then re-running
`node tools/plan-audit.mjs` and the suite before pushing.

---

## 4. Gates

A gate is green when every listed increment is `[x]` **and** its own check
passes.

- **Gate 0 — Stable base:** C0–C3, A1–A6, B1–B3, E1–E4, F1.
  Check: fresh worktree → `npm run worktree:init && cd src-tauri && cargo test
  --lib` green; `docs/verification/live-chain-*.md` exists with a date.
- **Gate 1 — Text client stands alone:** D0–D6, E5–E9, C4–C6, C8, A7–A12.
  Check: `grep -c "kind === 'map'" src/App.tsx` → `0`; kill-switch suite (E5)
  green; a full play session recorded with viewer and AI absent.
- **Gate 2 — First run:** E10–E12, F2–F4.
  Check: a never-used-Lich person reaches a playing session from the installer
  in under ten minutes on the clean VM, recorded in `docs/verification/`.
- **Gate 3 — Viewer optional:** B4–B8, L1–L6.
  Check: `node tools/live-chain-check.mjs` passes against the running app;
  Crossing slice walk/stun/decay recorded.
- **Gate 4 — AI optional:** G0–G10, G12, H1–H8 (G11 only with Dan's yes).
  Check: no model → panel honest, client unchanged; local Qwen → one map claim
  and one script proposal reach review with provenance; scanner tests green.
- **Gate 5 — Public quality:** I1–I11, J complete, F5–F8.
  Check: token test strict (allowlist empty); #175/#176/#179 closed.
- **Gate 6 — Release:** F9–F12. Check: `v1.0.0-beta.1` artefact installs,
  runs, uninstalls on the clean VM, recorded.
- **Gate 7 — 1.0:** F13–F14; two consecutive beta weeks with no data-loss
  report; zero open ship-blockers; the seven bars of section 5 each recorded.

**Shortest honest path to a shippable product:** Gates 0 → 1 → 2 → 6 → 7 with
the viewer and AI shipped disabled. Gates 3–5 can follow the first release.

---

## 5. The bar

A player who has never seen this repo can: (1) install from one Windows
installer with no terminal; (2) sign in through Lich's own login — this app
never touches the password; (3) play all day without Genie; (4) lose nothing
when anything breaks; (5) optionally open the viewer; (6) optionally use a
local model; (7) uninstall cleanly with scripts, settings and maps intact.
5 and 6 are absent by default and harmless when absent.

---

## 6. Lanes in detail

Format:

```
- [ ] ID  title (≈minutes)
  touches: existing/path.ts, new:path/that/does/not/exist/yet.ts
  depends-on: IDs (or none)
  do: what, as pseudocode/commands
  verify: exact command → what it must print
  done-when: the observable fact
  sabotage: (guards only) what to break → which check goes red
  pitfalls: trap numbers from section 1
```

`touches:` lists source paths only. Docs under `docs/verification/` and the
claim file are implied. Three prefixes, all understood by `tools/plan-audit.mjs`:

- a bare path must exist on `main` now;
- `new:path` is created by this increment — the audit requires it absent until
  the increment is `[x]`, then present;
- `C1>path` arrives with increment C1 (today: everything under `src/lib/ai*`
  lands with PR #285) — checked only once C1 is `[x]`, counted as "awaiting"
  until then, so a not-yet-delivered file is neither a pass nor a failure.

---

### Lane C — Merge and repo hygiene (start here)

- [x] **C0  This plan and its audit tool land on main** (≈30)
  commit: (this PR) verified: 2026-09-05
  touches: new:docs/PLAN_TO_1_0.md, new:tools/plan-audit.mjs, package.json, tools/test-suites.json
  depends-on: none
  do: the audit parses this file; registered as `test:plan`.
  verify: `node tools/plan-audit.mjs` → `plan ok: N increments, M paths checked` with N ≥ 100.
  sabotage: add a `touches:` path that does not exist → red naming the ID and path.

- [x] **C1  Merge PR #285** (≈15)
  commit: ede29969 verified: 2026-09-05 minutes: 10
  touches: none
  depends-on: none
  do: the branch now also carries Codex's `docs/mockups/dr-companion-isometric-mvp.html` (commit f37f990f) — merge it as it stands.
  ```bash
  gh pr checks 285                                   # every row pass
  gh pr merge 285 --squash --delete-branch
  git fetch origin main
  MSYS_NO_PATHCONV=1 git grep -c 'useAiWorkerHost' origin/main -- src/lib/aiWorkerHost.ts
  MSYS_NO_PATHCONV=1 git grep -c 'board-wrap' origin/main -- docs/mockups/dr-companion-isometric-mvp.html
  ```
  verify: both counts ≥ 1.
  done-when: `main` carries the AI slices, the architecture doc, and the mockup.
  pitfalls: 13. Do **not** fix Lane A bugs first; they live in an optional feature hidden in Settings and merging unblocks three lanes.

- [x] **C2  Close the four `local-ai-*` claims with the squash sha** (≈5)
  commit: (this PR) verified: 2026-09-05 minutes: 5
  touches: C1>.agents/claims/local-ai-runtime-foundation.json, C1>.agents/claims/local-ai-provider-boundary.json, C1>.agents/claims/local-ai-host-wiring.json, C1>.agents/claims/local-ai-background-worker.json
  depends-on: C1
  do: set each `completion.commit` to the squash sha (they currently name pre-squash shas that will not exist on main).
  verify: `node tools/plan-audit.mjs --claims` lists the four as `completed` with a sha that `git cat-file -e <sha>^{commit}` accepts on main.

- [ ] **C3  `npm run worktree:init`** (≈15)
  touches: package.json, docs/ENGINE.md
  depends-on: none
  do: script = `node tools/vendor-fetch.mjs --stub && git submodule update --init --recursive`. ENGINE.md: one sentence naming the script in the paragraph that describes the `vendor\Ruby4Lich5.exe doesn't exist` failure (`grep -n "Ruby4Lich5.exe" docs/ENGINE.md`).
  verify:
  ```bash
  git worktree add /tmp/wt-check origin/main && cd /tmp/wt-check && npm run worktree:init
  cd src-tauri && cargo test --lib > /tmp/ct.log 2>&1; echo "exit: $?"; tail -1 /tmp/ct.log
  cd ../.. && git worktree remove --force /tmp/wt-check
  ```
  → `exit: 0` and `test result: ok`.
  pitfalls: 8, 11.

- [ ] **C4  Split `presentationBridge.ts`** (≈40; two commits)
  touches: src/lib/presentationBridge.ts, new:src/lib/presentationTypes.ts, new:src/lib/viewerClient.ts, src/components/shared/PresentationBridgePanel.tsx
  depends-on: C1
  do: commit 1 moves every `export interface|type` into `presentationTypes.ts` with re-exports left behind. Commit 2 moves `viewerStatus`, `launchViewer`, `presentationBridgeInfo`, `ViewerStatus`, `PresentationBridgeInfo` into `viewerClient.ts`, updates `PresentationBridgePanel.tsx`, deletes the re-exports nothing uses (`grep -rn "from './presentationBridge'" src tools` → each importer either imports a type from `presentationTypes.ts` or a function still in the bridge). Leave `compileWorldSnapshot`, `shouldPublish`, `justReconnected`, `gameCommandForIntent`, `cannotAct`, `publishWorldSnapshotIfChanged` where they are.
  verify: read the suite total before you start (`tail -1` of the run). After: `npx tsc -b` exit 0; total unchanged; `wc -l src/lib/presentationBridge.ts` < 500.
  pitfalls: 1, 17.

- [ ] **C5  `protocol_harness.rb`: loader or deletion** (≈10)
  touches: lich-scripts/test/protocol_harness.rb
  depends-on: none
  do: `git log --oneline -S protocol_harness -- lich-scripts/ | head`. If no test ever required it, delete it (the commit says so); if one did and was removed, restore that test instead.
  verify: `grep -rn protocol_harness lich-scripts/ tools/ package.json docs/` → only lines you also updated.

- [ ] **C6  Needs-environment test list** (≈10)
  touches: package.json, docs/ENGINE.md
  depends-on: none
  do: script `test:needs-env` prints the suites deliberately outside `test-suites.json` and their requirement: `test:godot-export` (submodule + Godot), `test:live-chain` (B4; the running app), `test:bridge` (Ruby). ENGINE.md gets the same list beside its testing section (`grep -n "run-tests" docs/ENGINE.md`).
  verify: `npm run test:needs-env` prints three names with requirements.

- [ ] **C7  Decide `rewrite/remove-2d` and merge PR #276** (≈30; decision + one merge)
  touches: none
  depends-on: none
  do: facts as of 5 Sep: `remove-2d` is 4 commits, 80 behind main, no PR, and its own `docs/ADAPTERS.md` opens "PROPOSAL, for review… nothing imports them". PR #276 (creature art pack removal, −797, CI green, claim present) is the mergeable subset. Steps: (a) `gh pr merge 276 --squash --delete-branch`; verify `git ls-tree origin/main public/creatures | wc -l` → 0. (b) Post in the ledger (a claim `c7-remove-2d-decision`, status blocked) the question for the branch owner: rebase and PR the deletion half now, keep `src/domain/` as a separate proposal PR? (c) Put the decision in section 10 for Dan. Lane K waits on this; Lane D does not (their `App.tsx` overlap is zero — checked with `git diff --stat origin/main...origin/rewrite/remove-2d -- src/App.tsx` → empty).
  verify: #276 merged and the claim exists with the question and the diffstat pasted in.

---

### Lane A — AI host repair (on `main` after C1)

- [ ] **A1  Host at the app root; panel reads a store** (≈20)
  touches: src/App.tsx, C1>src/lib/aiWorkerHost.ts, C1>src/components/shared/AiWorkerPanel.tsx
  depends-on: C1
  do:
  ```
  aiWorkerHost.ts: module-level { status, listeners }, export subscribeAiStatus(fn), getAiStatus();
                   the tick publishes through it. Add ticks:number to AiWorkerStatus.
  App.tsx: directly after usePresentationBridgePublisher(v.kind === 'app'):
                   useAiWorkerHost(v.kind === 'app')
  AiWorkerPanel.tsx: useSyncExternalStore(subscribeAiStatus, getAiStatus, getAiStatus); never calls the hook.
  ```
  verify: dev server from your worktree (`npx vite --port 1437`); open `http://127.0.0.1:1437/?demo=1` (check `grep -n "demo" src/main.tsx` for the actual demo switch); Settings **closed**; devtools: `const m = await import('/src/lib/aiWorkerHost.ts'); m.getAiStatus().ticks` twice 3 s apart → second > first.
  done-when: ticks rise with Settings closed.
  pitfalls: 7, 11, 12.

- [ ] **A2  Tick effect survives store updates** (≈20)
  touches: C1>src/lib/aiWorkerHost.ts, C1>tools/ai-worker-host-test.mjs
  depends-on: A1
  do: extract the tick body into exported `runHostTick(deps)`; effect deps `[enabled, provider]`; inside the tick read `useAppStore.getState()`.
  verify: new check — a provider whose `generate` never resolves; call `runHostTick` (generation in flight); fire 20 store updates; the `AbortSignal` is **not** aborted and `journal.acknowledged()` unchanged.
  sabotage: put `character` back into the deps array in a copy → red.
  pitfalls: 6.

- [ ] **A3  Review hash covers what matters** (≈15)
  touches: C1>src/lib/aiIngest.ts, C1>src/lib/aiWorkerHost.ts, C1>tools/ai-worker-host-test.mjs
  depends-on: A2
  do: `reviewHash({roomId, situation: sorted, inRoundtime: (roundtime ?? 0) > 0, hostiles: count of roomCombatants hostile && !dead})` → `JSON.stringify`.
  verify: room change → differs; health 84→83 → equal; roundtime 9→4 → equal; 4→0 → differs.
  sabotage: drop `roomId` → room-change check red.

- [ ] **A4  Derive all six activities** (≈20)
  touches: C1>src/lib/aiIngest.ts, C1>src/lib/aiWorkerHost.ts, C1>tools/ai-worker-host-test.mjs
  depends-on: A2
  do:
  ```
  deriveActivity({bridgeConnected, situation, roomChangedAt, lastAppendAt, isTown, now}):
    !bridgeConnected → 'disconnected' ; has 'in_combat' → 'combat'
    now-roomChangedAt < 10_000 → 'travel' ; now-lastAppendAt > 120_000 → 'idle'
    isTown → 'quiet' ; else 'active'
  ```
  `isTown` comes from `LocationInfo.isTown` (`grep -n isTown src/types/index.ts`, one hit). Host tracks `roomChangedAt` (when `mapHere?.id` changes) and `lastAppendAt` (when ingest appended > 0).
  verify: six table-driven checks in priority order.
  sabotage: swap combat/travel order → combat-while-moving check red.

- [ ] **A5  Journal cursor survives a panel remount** (≈20)
  touches: C1>src/lib/aiEventJournal.ts, C1>src/lib/aiWorkerHost.ts, C1>tools/ai-event-journal-test.mjs
  depends-on: C1
  do: `seedAcknowledged(cursor)` on the journal. The host persists `{sessionId, acknowledged}` under `drc.ai-journal-cursor.v1`; on mount seeds only when `sessionId` matches the in-memory session id. Sequence numbers restart per process, so this survives a remount, **not** a restart — say so in the doc comment and point at `JobStore.recoverInterrupted` for the restart case.
  verify: ack 5; new journal `seedAcknowledged(5)`; append → `pending()` = 1 and `readFrom(acknowledged())` returns only the new event.
  sabotage: make `seedAcknowledged` a no-op → red.
  pitfalls: 3.

- [ ] **A6  Publish status only on change** (≈10)
  touches: C1>src/lib/aiWorkerHost.ts
  depends-on: A1
  do: shallow-compare against the last published status; publish `ticks` every 5th tick only.
  verify: temporary `console.count('AiWorkerPanel render')` in the panel; with nothing happening it must not fire each second; remove before commit.

- [ ] **A7  Rust suite green in a fresh worktree** (≈10)
  touches: none
  depends-on: C3
  do: `npm run worktree:init && cd src-tauri && cargo test --lib`.
  verify: `test result: ok` with the same passed count CI's `tauri` job reports for main (read it from `gh run view --log` first; require equality).

- [ ] **A8  AI panel promises only what exists** (≈10)
  touches: C1>src/components/shared/AiWorkerPanel.tsx, C1>tools/ai-worker-host-test.mjs
  depends-on: A1
  do: when `!available` and `src/lib/aiLocalProvider.ts` is absent from the build, show "Local model support is not yet available in this build."; once H1 lands, "Point Settings → Local model at a running Ollama or LM Studio on 127.0.0.1". A test reads the panel source and asserts the string matches the presence of `aiLocalProvider.ts`.
  verify: test green today (file absent → first string).

The four increments below came out of reading the 5 Sep implementation
handoff PDF against the code (section 11). Each is a defect visible in the
PDF's own source appendices that its text did not call out.

- [ ] **A9  No model means an idle worker, not a red loss counter** (≈20)
  touches: C1>src/lib/aiWorkerHost.ts, C1>src/components/shared/AiWorkerPanel.tsx, C1>tools/ai-worker-host-test.mjs
  depends-on: A1
  do: today an install with no model still journals every line, never acknowledges (the absent provider never returns `ok`), fills the 5000-event bound, and then the panel prints "N events were discarded before review" in `text-danger` forever. The capture is correct; the framing is a lie. When `provider.describe().available` is false: the tick still ingests (capture is continuous), but the panel shows "No local model; N events captured, none reviewed" in ordinary ink and `journalLost` is reported as "unreviewed" not "discarded". Loss stays red only while a provider is available.
  verify: test — absent provider, 6000 lines ingested → status has `unreviewedWithoutModel > 0` and `journalLost` is not surfaced as loss; available provider (scripted) with the same input → loss surfaced.
  sabotage: remove the availability branch → the first check red.

- [ ] **A10  A handled alert stays handled until its condition clears** (≈25)
  touches: C1>src/lib/aiAlertBroker.ts, C1>src/lib/aiWorkerHost.ts, C1>tools/ai-alert-broker-test.mjs
  depends-on: A2
  do: `acknowledge(key)` deletes the key, and the host's alert effect re-derives `situation:stunned` on every character update, so a stun that lasts four rounds becomes four urgent reviews (one per second with a real provider). The handoff's alert lifecycle separates ACK from RESOLVE. Implement the minimum: the broker keeps a `handled: Set<key>`; `raise()` of a handled key increments `occurrences` but does not re-enter `pending`; `reconcile(activeKeys)` (called by the host after `deriveAlerts`) drops handled keys no longer present, so the next occurrence is a fresh alert. Critical priority is exempt: a repeated disconnect must always re-alert.
  verify: tests — stunned raised, acked, raised again → `pendingCount()` 0 and `occurrences` 2; condition clears then returns → pending 1; a critical key re-enters pending after ack.
  sabotage: skip the `handled` check in `raise` → first check red.

- [ ] **A11  A privacy-gate refusal is a visible failure, not an unhandled rejection** (≈15)
  touches: C1>src/lib/aiWorker.ts, C1>src/lib/aiWorkerHost.ts, C1>tools/ai-worker-test.mjs
  depends-on: A2
  do: `assertPromptCarriesNoSecrets` throws (correctly — a leak must stop the call) from outside `generateWithinBudget`'s try; `runWorkerOnce` does not catch; the host's tick has `try/finally` with no `catch`, so the rejection is unhandled and the tick reports nothing. Today unreachable (the live request carries only seqs and kinds) and reachable the moment G4 or G6 puts text in a request. Catch in `runWorkerOnce`: the outcome becomes `{did:'review'|'background-job', result:{ok:false, failure:'privacy_gate', message:<pattern names only>}}`; cursor untouched; job → `failed` with the pattern name; panel shows "Sensitive input withheld". Add `'privacy_gate'` to `ProviderFailure`.
  verify: test — a request whose `state` contains a runtime-assembled `pass`+`word: x` → outcome `privacy_gate`, cursor unchanged, no throw escapes.
  sabotage: let the throw escape → the test's `await` rejects → red.

- [ ] **A12  Job transitions match the contract: completed needs a result** (≈15)
  touches: C1>src/lib/aiJobStore.ts, C1>tools/ai-job-store-test.mjs, C1>docs/LOCAL_AI_BACKGROUND_WORKER.md
  depends-on: C1
  do: code allows `running → completed` directly and `checkpointed → failed`; the handoff's table (§25) allows neither and adds `checkpointed → queued`. Reconcile in favour of the stricter table with one exception kept: `running → completed` stays legal **only** when the transition carries a `resultRef` (a job that finished with nothing to review, e.g. evaluation mining that found no cases). Add `resultRef?: string` to `BackgroundJob`; `transition(…, 'completed')` without it is refused. Add `checkpointed → queued`. Write the final table into `LOCAL_AI_BACKGROUND_WORKER.md` §6 so the doc and the code cannot disagree.
  verify: tests — `completed` without `resultRef` refused; with it accepted; `checkpointed → queued` accepted; `checkpointed → failed` refused.
  sabotage: drop the `resultRef` check → red.

---

### Lane B — Prove the live chain (day one, in parallel)

The audit found the exact gap: `godot/scripts/world_root.gd:168` goes live only
when `--live-presentation` is on the command line, and
`src-tauri/src/viewer.rs:157` launches the viewer with **no** arguments. The
app-launched viewer has therefore always started in mock mode. Everything else
in the chain (token/port files, auth, reconnect) is already written.

- [ ] **B1  Export a viewer locally** (≈15 + download)
  touches: none
  depends-on: none
  do: Godot 4.3 (`grep -n "config/features" godot/project.godot`); the release workflow names the exact zip (`grep -n Godot_v4 .github/workflows/release.yml`) — download the same by hand outside the repo. `git submodule update --init --recursive`; `GODOT4=<path> npm run godot:export`.
  verify: `ls -la godot/build/DRCompanionWorldViewer.exe` → size > 1 MB.
  pitfalls: 8.

- [ ] **B2  The app launches the viewer live** (≈25)
  touches: src-tauri/src/viewer.rs, godot/scripts/world_root.gd
  depends-on: B1
  do: `viewer.rs`: `Command::new(&exe).args(["--", "--live-presentation"])` — Godot user args follow `--`; a mode flag is not a credential, so update the module header from "nothing goes on the command line" to "no *secrets* go on the command line", keeping the reasoning about the token. `world_root.gd` `_ready()`: when live is requested and `start_live()` fails, do not silently `return` into an empty scene — set a visible label (the world_controls or inspector already has status text: `grep -n "status\|label" godot/scripts/world_controls.gd | head`) reading "Bridge unavailable — is DR Companion running?" and let `BridgeClient`'s reconnect timer keep trying. Mock stays a dev path reached only without the flag.
  verify: `cargo test --lib viewer` green; run the app from your worktree (`npm run tauri dev`), Settings → viewer bridge shows a port; Launch; the Godot console prints `connected-awaiting-auth` then the auth result; the Rust log shows the new client.
  done-when: Godot receives a `snapshot` with a numeric `sequence` from the app.
  pitfalls: 9. Read Codex's active claims on `world_root.gd` first.

- [ ] **B3  Record the proof** (≈20)
  touches: none
  depends-on: B2
  do: `docs/verification/live-chain-<date>.md`: commit sha, `godot --version`, commands, the Godot line, the Rust `intent_accepted` line for a clicked exit, the text pane showing the movement, one screenshot, and a non-empty "what did not work" section (or "nothing, first try" with the evidence).
  verify: file exists with all six items.

- [ ] **B4  `tools/live-chain-check.mjs`** (≈30)
  touches: new:tools/live-chain-check.mjs, package.json
  depends-on: B3
  do: read `%LOCALAPPDATA%\DR Companion Data\presentation-bridge.{port,token}` (names from `presentation_bridge.rs:60`); `net.connect`; send `{"type":"auth","token"}` NDJSON; expect `auth_ok`; expect a `snapshot` with numeric `sequence` within 2 s; send a walk intent from a fabricated room id; expect `intent_rejected`. Print `OK`/`FAIL` per step; exit 1 on any FAIL or a 5 s overall timeout naming the step. Register as `test:live-chain` and in C6's list, **not** in `test-suites.json`.
  verify: app running → `all passed`; app closed → `FAIL connect: ECONNREFUSED`, not a hang.
  sabotage: wrong token → `FAIL auth`.
  pitfalls: 4.

- [ ] **B5  App exit closes the viewer** (≈25)
  touches: src-tauri/src/viewer.rs, src-tauri/src/lib.rs
  depends-on: B2
  do: hold the `Child` in managed state `Mutex<Option<Child>>`; on `RunEvent::Exit` (`grep -n "RunEvent\|on_window_event\|\.run(" src-tauri/src/lib.rs`) call `kill()`; `viewer_status` consults `try_wait()` on the held child before falling back to `tasklist`.
  verify: `cargo test --lib viewer` green; launch viewer from the app, close the app, `tasklist /FI "IMAGENAME eq DRCompanionWorldViewer.exe"` → not listed.
  pitfalls: 9, 12.

- [ ] **B6  Viewer crash visible within a tick** (≈15)
  touches: src-tauri/src/viewer.rs, src/components/shared/PresentationBridgePanel.tsx
  depends-on: B5
  do: `viewer_status` returns `exitCode: Option<i32>` when the held child exited; panel shows "viewer exited (code N)" and a Relaunch button.
  verify: kill the viewer by PID while the app runs; Recheck shows the line.

- [ ] **B7  Reconnect contract end to end** (≈15)
  touches: none
  depends-on: B3
  do: kill and relaunch Godot → it receives the held snapshot on auth; drop and reattach Lich → forced publish (`justReconnected`). Append both log lines to the B3 record.
  verify: appended section with log lines.

- [ ] **B8  Viewer absent → every path degrades** (≈20)
  touches: new:tools/viewer-absent-test.mjs, package.json, tools/test-suites.json
  depends-on: B5
  do: with `invokeTauri` mocked to reject and to return `{installed:false}`: `PresentationBridgePanel` renders the "not built yet" string and the rejection message; nothing throws. Test the pure mapping functions in `viewerClient.ts` (after C4) or `presentationBridge.ts` (before).
  verify: suite appears in the full run with its count.

---

### Lane D — Layout toward the approved mockup

The target is `docs/mockups/dr-companion-isometric-mvp.html` (Codex, 4 Sep,
"the approved client direction", on main after C1): a 48 px top bar; a
workspace of `228px | minmax(620px,1fr) | 250px` — character side, board slot,
context side; a 224 px console row spanning the width (context actions |
transcript | recent-state strip); `min-width: 1120px`. The board is Godot's;
whether it is embedded, docked or a separate window is D0.

- [ ] **D0  Board-slot decision** (≈20, decision for section 10)
  touches: none
  depends-on: C1
  do: write the three options with what each costs: (a) separate Godot window as today, board slot shows the transcript expanded and a compact viewer host card; (b) docked window — Tauri reports the slot's screen rect on move/resize and the viewer window is positioned to it (no reparenting; Godot `DisplayServer.window_set_position`); (c) true embedding (HWND reparenting) — fragile on Windows, Godot does not support it officially. Recommend (a) for 1.0 with the slot contract written so (b) is a later increment. Record in section 10; Dan decides.
  verify: section 10 has a "Decided:" line for D0.

- [ ] **D1  Confirm the `remove-2d` overlap is still zero** (≈5)
  touches: none
  depends-on: none
  do: `git fetch origin; git diff --stat origin/main...origin/rewrite/remove-2d -- src/App.tsx src/lib/columns.ts src/lib/layout.ts src/lib/panelDataContracts.ts` → empty today. Paste the output into your D2 claim. If non-empty, stop and coordinate (C7).
  verify: the pasted output.

- [ ] **D2  Frame as data: rows and columns from the mockup** (≈25)
  touches: src/lib/columns.ts, tools/columns-test.mjs
  depends-on: A1, D0, D1
  do: `columns.ts` holds the shipped defaults and the share helpers. Add the mockup's frame constants beside them (`SIDE_LEFT_W=228`, `SIDE_RIGHT_W=250`, `BOARD_MIN_W=620`, `CONSOLE_H=224`, `TOPBAR_H=48`, `FRAME_MIN_W=1120`) with a doc comment naming the mockup file as their source, and a `frameFits(innerWidth, innerHeight)` that returns which column must collapse first below the minimum. Do not add a second layout module.
  verify: `node tools/columns-test.mjs` → all passed plus: `frameFits(1366,768)` fits; `frameFits(1100,768)` names the right side as first to collapse.
  sabotage: change `FRAME_MIN_W` to 2000 → the 1366 check red.

- [ ] **D3  Map window behind a flag** (≈15)
  touches: src/App.tsx
  depends-on: D2
  do: `const MAP_WINDOW_ENABLED = false` beside `view()` (`src/App.tsx:58`); `if (q.get('view') === 'map' && MAP_WINDOW_ENABLED)`. Gate every opener: `grep -rn "view=map" src/` → each behind the same constant.
  verify: dev server; `?view=map` renders the main app; `grep -rn "view=map" src/ | grep -v MAP_WINDOW_ENABLED` → empty.

- [ ] **D4  Console row and side columns** (≈40; two commits)
  touches: src/App.tsx, src/components/room/GameChatColumn.tsx, src/lib/columns.ts
  depends-on: D3
  do: commit 1: move the game transcript + command line into a bottom row of `CONSOLE_H` spanning the workspace, per the mockup's `.console` grid `228px | 1fr | 250px`; the existing `GameConnectionBar` stays mounted inside it (`tools/game-connection-owner-test.mjs` enforces this). Commit 2: left side = vitals/room/mindstate stack; right side = context/alerts/AI (the `AiWorkerPanel` moves here from Settings — one component, two possible mounts is a fork, so it *moves*; Settings keeps only the provider URL field from H2). Existing panel ids stay; only their placement changes. Three hard rules from the handoff's §9 apply to whatever renders in the top bar and the board slot: the location line carries freshness and confirmation state ("Room 998 · confirmed 3 s ago", never a bare name); an unresolved location says "unresolved", never the last known town; nothing in the slot is a second minimap.
  verify: D5's measurement passes at 1366×768 and 1920×1080; `node tools/game-connection-owner-test.mjs` green; a test renders the top bar with `mapHere = null` and asserts the text contains "unresolved" and not "Crossing".

- [ ] **D5  Measure three resolutions** (≈25)
  touches: none
  depends-on: D4
  do: browser `resize_window` 1366×768, 1920×1080, 2560×1440; `javascript_tool`: for every element in the workspace, `getBoundingClientRect().right <= innerWidth`, and `document.body.scrollWidth <= document.body.clientWidth`, and at 1366×768 `document.body.scrollHeight <= innerHeight + 2`. Print violation counts.
  verify: zero at all three, printed as counts; fix clips in the column CSS and re-measure.
  pitfalls: screenshots lie about pixels — read the DOM numbers.

- [ ] **D6  Delete the map-window path** (≈25)
  touches: src/App.tsx, src/components/MapWindow.tsx, src/lib/layout.ts, src/lib/panelDataContracts.ts, tools/panel-data-contracts-test.mjs, tools/mapdock-test.mjs
  depends-on: D5 survived one real play session (date in the claim)
  do: remove the `kind: 'map'` branch and `MAP_WINDOW_ENABLED`; delete `MapWindow.tsx`; remove `'map'` from `PanelId` (`src/lib/layout.ts:28`) and both default `order` arrays (`:120`, `:129`) and from `PANEL_DATA_CONTRACTS`; the contracts test fails on the missing id — update it; `grep -rn "MapWindow\|'map'" src/ tools/` → resolve every hit.
  verify: `grep -c "kind === 'map'" src/App.tsx` → 0; `npx tsc -b` exit 0; full suite green.

---

### Lane E — First run and setup

- [ ] **E1  A clean Windows VM** (≈30 + download)
  touches: none
  depends-on: none
  do: this machine is Windows 11 **Home**: no Windows Sandbox, no Hyper-V. Use VirtualBox with Microsoft's Windows 11 Enterprise evaluation ISO (90-day), 4 GB RAM, 60 GB disk, no shared folders; snapshot `clean` before installing anything. Record build number and snapshot name in `docs/verification/vm.md`.
  verify: the file exists with both.

- [ ] **E2  Installer on the clean VM** (≈20)
  touches: none
  depends-on: E1, F1
  do: copy in the NSIS `.exe`; run; screenshot every prompt including SmartScreen; note admin elevation; run the app; screenshot the first screen. Write `docs/verification/first-run-<date>.md`.
  verify: the doc lists every prompt in order.

- [ ] **E3  Uninstall on the clean VM** (≈10)
  touches: none
  depends-on: E2
  do: Settings → Apps → uninstall; list what remains under `%APPDATA%` and `%LOCALAPPDATA%` (user data should; program files should not).
  verify: both lists in the doc.

- [ ] **E4  Is the installer signed?** (≈5)
  touches: none
  depends-on: F1
  do: `Get-AuthenticodeSignature .\DRCompanion*.exe | Format-List` → record `Status` verbatim (`NotSigned` expected).
  verify: the doc has it.

- [x] **E5  Kill-switch suite** (≈40; may split)
  commit: TBD verified: 2026-09-05 minutes: 55
  touches: new:tools/kill-switch-test.mjs, package.json, tools/test-suites.json, src/lib/flowStop.ts, src/lib/pythonTasks.ts, src/lib/nodeTasks.ts
  depends-on: none
  do: owners: `src/lib/stopAllTasks.ts`, `src/lib/flowStop.ts`, and whatever `grep -rn "runaway\|cancelCommand" src/lib/*.ts` finds. For each: a check that it works with `isTauri()` false, and a source check that the owner imports no `ai*`, viewer, python or node-runner module. An owner that does is a finding: file it, do not paper over.
  verify: suite green, each check naming its owner file.
  sabotage: comment out the stop path in a copy → red.

- [x] **E6  Player-data inventory, generated** (≈25)
  commit: TBD verified: 2026-09-05 minutes: 40
  touches: new:tools/build-player-data-doc.mjs, new:docs/PLAYER_DATA.md, package.json, tools/test-suites.json
  depends-on: none
  do: `grep -rhoE "writeJSON\('[^']+'|readJSON<[^>]*>\('[^']+'|(KEY|STORAGE_KEY) = '[^']+'" src/ | sort -u` drives a table: key, what it holds, owner file, behaviour on quota failure (`storage.ts` reports; say what the UI shows). The generator asserts its key count equals the grep's count. Same pattern as `tools/build-crossing-build-list.mjs`.
  verify: `node tools/build-player-data-doc.mjs --check` exit 0 against the committed doc.

- [x] **E7  Bad-script containment fixtures** (≈20)
  commit: TBD verified: 2026-09-05 minutes: 45
  touches: python/test_runner.py, typescript/test_runner.ts
  depends-on: none
  do: three fixtures — raises, loops until the runner's timeout, exits non-zero — asserting the runner reports each distinctly and the app process is unaffected (the runner is out-of-process; the assertion is on reported state). Mirror in the TS runner's tests if it has any (`ls typescript/`).
  verify: `npm run test:runner` green with the three names.

- [x] **E8  Disconnect/reconnect behaviour test** (≈20)
  commit: TBD verified: 2026-09-05 minutes: 35
  touches: tools/backlog-test.mjs, tools/game-connection-owner-test.mjs
  depends-on: none
  do: these two already exercise `attachGame`/`detachGame`/`backfill` (`grep -ln "detachGame\|backfill" tools/*.mjs`). Add: socket dropped mid-stream → pane says disconnected; `sendGame` refused with a reason; reconnect → backfill runs (`gameLink.ts` `backfill()`).
  verify: both suites green with the three named checks.

- [ ] **E9  Lich's BSD-3 licence in the app** (≈15)
  touches: src/components/layout/SettingsSheet.tsx
  depends-on: none
  do: read `<lich>/LICENSE` head (ENGINE.md says verify, not trust); an About section with the licence text and copyright lines; Godot's MIT joins in F6.
  verify: renders; `grep -c "Redistribution and use" src/components/layout/SettingsSheet.tsx` ≥ 1.

- [ ] **E10  Walk the wizard on the VM** (≈30)
  touches: none
  depends-on: E2
  do: from `clean` plus the installer: every wizard step screenshotted (`src/components/first-run/`), a note per step "did a program need me here?", total elapsed time in the doc.
  verify: the doc has the elapsed time.

- [ ] **E11  Detect Genie holding the port** (≈20)
  touches: src-tauri/src/lich.rs, src/components/first-run/SetupWizard.tsx
  depends-on: none
  do: `genie_running()` mirrors `lich_running()` (`src-tauri/src/lich.rs`, `fn lich_running`) with the image name confirmed by `tasklist | findstr /I genie`; wizard text "Genie is running and may hold the frontend port; close it or continue" — never kill it. If the wizard file has a different name, `ls src/components/first-run/`.
  verify: `cargo test --lib lich` green with a three-state parser test on `tasklist` output.

- [ ] **E12  Diagnostics panel + bug bundle** (≈40; two commits)
  touches: new:src/components/shared/DiagnosticsPanel.tsx, src/components/layout/SettingsSheet.tsx, new:src/lib/bugBundle.ts, new:tools/bug-bundle-test.mjs, package.json, tools/test-suites.json
  depends-on: A1, B6
  do: one panel: Ruby, Lich, bridge port, token file, viewer, model — each `present | absent | could not check`. "Copy bug bundle" = JSON of that plus the existing activity log (`grep -rn "activity" src/lib/*.ts | head`), passed through `scanForSecrets` from `aiModelProvider.ts`; refuse with the pattern name on a hit.
  verify: test — a bundle with a runtime-assembled `pass`+`word: x` is refused naming the pattern, not the value.
  sabotage: skip the scan → red.
  pitfalls: 3.

---

### Lane F — Release engineering

- [ ] **F1  Throwaway-tag release run** (≈30 + waiting)
  touches: none
  depends-on: none
  do: `git tag v0.0.0-ci-check origin/main && git push origin v0.0.0-ci-check`; `gh run watch`. The Godot install step (`release.yml` around line 60–69) has never executed. Each failure becomes `F1a…` here with its fix. Success = draft release with the installer and `release:verify` printing both resources. Delete the draft and the tag after.
  verify: `gh release view v0.0.0-ci-check --json assets --jq '.assets[].name'` lists the `.exe`, then both are deleted.

- [ ] **F2  One version, three files** (≈15)
  touches: new:tools/set-version.mjs, package.json
  depends-on: none
  do: sets `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` from one argument; `--check` prints all three and exits 1 if they differ. Script `version:set`.
  verify: `node tools/set-version.mjs --check` exit 0 today.
  sabotage: bump one file by hand → exit 1 naming it.

- [ ] **F3  Signing decision** (≈15)
  touches: new:docs/RELEASE.md
  depends-on: E4
  do: OV certificate (annual cost; SmartScreen still warns until reputation builds) vs unsigned with a download-page note. Recommend unsigned for beta. Section 10 for Dan.
  verify: "Decided:" line.

- [ ] **F4  Update-check decision** (≈15)
  touches: F3>docs/RELEASE.md
  depends-on: F3
  do: the app already fetches Ruby4Lich5 from GitHub releases (`tools/vendor-fetch.mjs`, `setup.rs`). Reuse for a "newer version available" link (no auto-install) or rely on the page. Recommend the link. Section 10.
  verify: "Decided:" line.

- [ ] **F5  Privacy statement** (≈20)
  touches: new:docs/PRIVACY.md, src/components/layout/SettingsSheet.tsx
  depends-on: E9
  do: `grep -rn "fetch(\|reqwest\|https://" src/ src-tauri/src/ | grep -v -E "test|127\.0\.0\.1|localhost"` → one line per destination (Elanthipedia, GitHub releases). State: no telemetry, no analytics, local model on loopback only.
  verify: the grep's destination count equals the doc's line count.

- [ ] **F6  Third-party licences, generated** (≈25)
  touches: new:tools/build-third-party.mjs, new:THIRD_PARTY.md, package.json
  depends-on: none
  do: from `package.json` deps (`license` fields), `cargo metadata`, Lich (BSD-3), Godot (MIT), fonts, and every admitted asset's `sourceLicense` in `godot/assets/shared_asset_selections.json`. `--check` exits 0 when the committed file matches.
  verify: `node tools/build-third-party.mjs --check` exit 0.

- [ ] **F7  Bundle integrity extends to the viewer** (≈10)
  touches: tools/bundle-test.mjs
  depends-on: F1
  do: assert the viewer resource destination when `godot/build/DRCompanionWorldViewer.exe` exists; skip loudly (`NOT CHECKED: viewer not built`) otherwise, and never let a skip read as a pass in the summary.
  verify: `npm run test:bundle` prints the NOT CHECKED line locally and the full check in the release run.

- [ ] **F8  Uninstall test on the CI artefact** (≈10)
  touches: none
  depends-on: E3, F1
  do: E3 again with the CI-built installer; append to the E2 doc.
  verify: appended.

- [ ] **F9  `v1.0.0-beta.1`** (≈20)
  touches: none
  depends-on: F2, gates 0–2
  do: `npm run version:set -- 1.0.0-beta.1`; commit; tag; push; watch; download; E2/E3 on it.
  verify: draft release with the installer; VM record appended.

- [ ] **F10  Publish the beta** (≈10)
  touches: none
  depends-on: F9, F3, F5
  do: un-draft; notes link PRIVACY.md, THIRD_PARTY.md, and the SmartScreen note if unsigned.
  verify: `gh release view v1.0.0-beta.1 --json isDraft` → false.

- [ ] **F11  Beta feedback triage** (≈20 per week)
  touches: none
  depends-on: F10
  do: one issue label `beta-1`; every report gets: reproduced / not reproduced / needs bundle (E12). Data-loss reports are ship-blockers.
  verify: weekly note in `docs/verification/beta-<date>.md`.

- [ ] **F12  `v1.0.0-rc.1`** (≈20)
  touches: none
  depends-on: F11 two weeks clean
  do: as F9 with the rc version; E2/E3/E10 on the VM from `clean`.
  verify: recorded.

- [ ] **F13  `v1.0.0`** (≈20)
  touches: none
  depends-on: F12 one week clean
  do: as F9; release notes name the seven bars of section 5 with the recording of each.
  verify: release page links seven records.

- [ ] **F14  Announce** (≈15)
  touches: none
  depends-on: F13
  do: a post for the DR community in Dan's voice (memory: never generic AI prose); Dan approves before it goes out.
  verify: Dan's approval quoted in the claim.

---

### Lane G — AI slices 5–7 (after Lane A)

- [ ] **G0  Evidence outlives the journal** (≈25)
  touches: new:src/lib/aiEvidenceStore.ts, new:tools/ai-evidence-store-test.mjs, C1>src/lib/aiJobStore.ts, package.json, tools/test-suites.json
  depends-on: A5
  do: a claim's `evidenceRefs` are `event:<seq>` strings, and the journal evicts at 5000 events, so a candidate reviewed an hour later can cite evidence nobody can read. The handoff's `observations.read(refs)` presumes durable observations. Minimum honest version: `pin(refs, journal)` copies the referenced events' `{seq, at, kind, payload}` into `drc.ai-evidence.v1` at the moment a job or claim cites them; `resolve(refs)` returns them or `{missing:[…]}` — never a silent partial. `JobStore.create` pins `inputRefs`; G5's store refuses a claim whose refs do not resolve. Bounded by count with the oldest **unreferenced** entries evicted first; an entry cited by a live claim is never evicted.
  verify: tests — pin, evict the journal past capacity, resolve → still returns the payload; a ref never pinned → listed in `missing`; eviction skips cited entries.
  sabotage: evict cited entries → red.

- [ ] **G1  Producer: divergent exits** (≈25)
  touches: new:src/lib/aiJobProducers.ts, C1>src/lib/aiWorkerHost.ts, new:tools/ai-job-producers-test.mjs, package.json, tools/test-suites.json
  depends-on: A4
  do: `detectExitDivergence(snapshotCell, parsedExits)` → `[{move, inSnapshot, inStream}]`. Parsed exits come from the stream parser's room state (`grep -n "exits" src/lib/gameStream.ts src/types/stream.ts`) — never parse text here. Non-empty → `jobs.create({kind:'map_reconciliation', scope:{roomId}, inputRefs:['event:<seq>'], allowedTools:['flag_conflict']})` unless a non-terminal job already has that `scope.roomId`.
  verify: divergent → 1 job; again → still 1; other room → 2.
  sabotage: remove the dedupe → red.

- [ ] **G2  Tool registry + `room_by_id`** (≈15)
  touches: new:src/lib/aiKnowledgeTools.ts, new:tools/ai-knowledge-tools-test.mjs, package.json, tools/test-suites.json
  depends-on: A4
  do: `callTool(name, args, allowedTools, trace)` returns `{ok:false, reason}` for a disallowed or unknown name — never throws. Every tool declares `{id, validate(args), maxResultBytes}`; an over-size result is truncated with `truncated:true`, never silently cut. Every call is appended to `trace` as `{tool, argsSummary, bytes, at}` (no payloads, no secrets) so a job's tool use is inspectable. Text fields returned to a model are wrapped as `{untrusted:true, text}` so the prompt builder can label them "data, not instructions" (the handoff's injection rule). `room_by_id(zone, id)` → `{id, title, exits:[{move,to}], tags}` from the same `MapZone` data `compileWorldSnapshot` reads.
  verify: allowed → result; disallowed → refusal naming the tool; unknown → refusal; a 1 MB fixture result → truncated flag and `bytes <= maxResultBytes`; trace has one entry per call.
  sabotage: skip the allowlist → red; skip the size cap → red.

- [ ] **G3  Tool `lore_for`** (≈10)
  touches: G2>src/lib/aiKnowledgeTools.ts, G2>tools/ai-knowledge-tools-test.mjs
  depends-on: G2
  do: wraps `bestiary.ts` `loreFor`/`isApproximate` → `{lore, approximate} | null`.
  verify: known creature → lore; unknown → null; approximate flagged.

- [ ] **G4  Tool `recent_events`** (≈10)
  touches: G2>src/lib/aiKnowledgeTools.ts, G2>tools/ai-knowledge-tools-test.mjs
  depends-on: G2
  do: `journal.readFrom(max(0, ack-n))` limited to n; returns kinds, seqs and the G12 privacy class only — never `text` (it may hold player speech).
  verify: a check asserts no returned object has a `text` key.

- [ ] **G5  Candidate-claim store** (≈35; two commits)
  touches: new:src/lib/aiClaimStore.ts, new:tools/ai-claim-store-test.mjs, package.json, tools/test-suites.json
  depends-on: A5
  do: the schema is the handoff's §28 (adopted whole — see section 11): `schemaVersion:1, claimId, subject, predicate, value, status ∈ candidate|corroborated|accepted-local|published|rejected|retracted|superseded, evidenceRefs[] (non-empty and resolvable via G0), producer {kind:'human'|'parser'|'model'|'import', identity, model?, adapter?, softwareVersion?}, confidence: number|null, createdAt, reviewedAt, reviewer, supersedes, privacy ∈ private|group|public-candidate (default private), licence: string|null`. Transitions: candidate→corroborated→accepted-local; candidate|corroborated→rejected; accepted-local→published only when `privacy !== 'private'` and `licence` is set (and only once G11-era sharing exists — refused until then); any non-terminal→retracted; supersession appends a new claim naming the old, never edits it (§31). `drc.ai-claims.v1`. **Imports nothing from mapData, mapPins, bestiary or any canonical store** — a source check in the test enforces it.
  verify: transitions; empty or unresolvable evidence refused; `published` refused for `private`; supersession leaves the old record addressable; a supersession cycle (A supersedes B supersedes A) refused; source check green.
  sabotage: allow empty evidence → red; allow the cycle → red.

- [ ] **G6  Map job yields a claim even with no model** (≈25)
  touches: C1>src/lib/aiWorker.ts, G1>src/lib/aiJobProducers.ts, C1>tools/ai-worker-test.mjs
  depends-on: G1, G5
  do: on `map_reconciliation` with provider absent or failing, emit the deterministic claim `{subject:'room:<id>', predicate:'exit_divergence', value:{diff}, confidence:0.5, producer:{kind:'parser', identity:'aiJobProducers.detectExitDivergence'}}`, job → `awaiting_review`. A working provider's parsed JSON adds a second claim with `producer.kind:'model'`; malformed → `invalid_output` and the deterministic claim still stands. Every model-proposed tether passes `validateTetherCandidate` (handoff §33) before it becomes a claim: `fromRoomId` known; a non-null `toRoomId` must appear as `currentRoomId` in a cited authoritative snapshot; a directionless exit gets `boardAnchor:null`, never a guessed one; kind `ferry` needs transport evidence; kinds `portal|warp` never infer adjacency from board proximity. A proposal that fails validation is recorded in the job note, not as a claim.
  verify: absent → 1 claim + awaiting_review; failing → same; valid JSON → 2 claims; **adversarial**: invented destination → no claim, note names it; directionless exit → `boardAnchor` null; portal with proximity-only evidence → rejected; ferry without transport evidence → rejected.
  sabotage: skip the destination check → the invented-destination test red.

- [ ] **G7  Claim review UI** (≈30)
  touches: new:src/components/shared/AiClaimsPanel.tsx, src/components/layout/SettingsSheet.tsx
  depends-on: G5
  do: list candidates (subject, predicate, evidence count, producer, confidence); Accept/Reject change status only; evidence tooltip.
  verify: create a claim in devtools; it appears; Accept → accepted; pins/map `localStorage` keys byte-identical before and after (read them in devtools).

- [ ] **G8  Corroboration** (≈15)
  touches: G5>src/lib/aiClaimStore.ts, G5>tools/ai-claim-store-test.mjs
  depends-on: G5
  do: same `(subject,predicate,value)` from a second independent `evidenceRef` → `corroborated`.
  verify: test; sabotage: count the same ref twice → red.

- [ ] **G9  Reversible promotion** (≈30)
  touches: G5>src/lib/aiClaimStore.ts, src/lib/mapPins.ts, G7>src/components/shared/AiClaimsPanel.tsx, G5>tools/ai-claim-store-test.mjs
  depends-on: G7
  do: read `mapPins.ts`'s pin shape first; if pins lack a `provenance` field add one defaulting to `'player'` with a migration check. Promote (only from `accepted`) creates a pin `provenance:'ai-candidate'` and records `{claimId, pinId}`; Revert deletes exactly that pin and returns the claim to `accepted`.
  verify: promote → +1 pin with provenance; revert → count restored, other pins byte-identical.
  sabotage: revert by index → "other pins identical" red.

- [ ] **G10  `publish_presentation_event` gets its caller** (≈20)
  touches: C1>src/lib/aiIngest.ts, C4>src/lib/viewerClient.ts, C1>tools/ai-worker-host-test.mjs
  depends-on: C4
  do: on `situation` transitions for stunned/webbed/immobilized (on and off) publish `PresentationEvent{kind:'status-change', authoritativeText:<flag>, roomId}` — derived from already-parsed flags, no text parsing. Godot's `event_player.gd` consumes ordered events.
  verify: `[]→['stunned']→[]` → exactly two events, increasing `sequence`; unchanged flags → none. The callerless-command sweep now lists only `extract_lich` and `bridge_install_status`.

- [ ] **G11  Live suggestion through the confirmation gate** (≈40; two commits)
  touches: new:src/lib/aiSuggestions.ts, new:tools/ai-suggestions-test.mjs, C1>src/lib/aiWorker.ts, C1>src/components/shared/AiWorkerPanel.tsx, package.json, tools/test-suites.json
  depends-on: H3, G0
  do: the handoff's §36, exactly. A suggestion is data: `{id, exactCommand, commandType, basedOnStateVersion, expiresAt, status:'pending'|'confirmed'|'expired'|'rejected'|'awaiting_result'|'resolved', evidenceRefs}`. `requestExecution(id, confirmation)` REQUIREs: status pending; not expired; `confirmation.commandText === exactCommand` (the player confirms the literal command, not a summary); `useAppStore.getState()` version equals `basedOnStateVersion` (find the store's version counter — `grep -n "version" src/store/useAppStore.ts`; if none exists, add one incremented on every character/room write); at most one suggestion in `awaiting_result`. Only then `requestGameAction` from `gameActions.ts` — the **only** import of it in any `ai*.ts`, and a source test asserts it is the only one. The authoritative result (next snapshot/state) resolves the suggestion; the model never marks its own proposal successful. Panel: one card with Confirm/Dismiss, the exact command in monospace, and the expiry.
  verify: tests — stale state version → refused; altered command → refused; expired → refused; second pending while one awaits → refused; happy path sends exactly `exactCommand` once (spy on `requestGameAction`).
  sabotage: skip the version check → red; skip the exact-command check → red.
  pitfalls: this is the one increment that gives model output a path to the game. Dan's approval is required before merge (section 10).

- [ ] **G12  Privacy class at ingest** (≈25)
  touches: C1>src/lib/aiIngest.ts, C1>src/lib/aiWorkerHost.ts, C1>tools/ai-worker-host-test.mjs
  depends-on: A4
  do: the handoff's §37 table. Each journalled event gets `privacy ∈ 'public-game' | 'private-player' | 'private-comms' | 'third-party'` derived from the already-parsed `stream` id (`grep -n "stream" src/types/stream.ts` for the vocabulary — whispers, thoughts, private messages are already labelled by the bridge). `private-comms` events are journalled (capture is continuous) but **excluded from every model request and every tool result by default**; a per-source opt-in setting lifts it. Credentials never have a class: they are refused by the scanner before they exist as events (A11).
  verify: tests — a whisper line → `private-comms`; the live-review request built from a journal containing it carries neither its text nor its seq unless opted in; `recent_events` (G4) skips it; a room line → `public-game`.
  sabotage: drop the exclusion filter → red.

---

### Lane H — Local model provider (after A2)

- [ ] **H1  OpenAI-compatible loopback adapter** (≈40; two commits)
  touches: new:src/lib/aiLocalProvider.ts, new:tools/ai-local-provider-test.mjs, package.json, tools/test-suites.json
  depends-on: A2
  do:
  ```
  localProvider({baseUrl, allowRemote=false}): ModelProvider
    refuse baseUrl whose host is not 127.0.0.1/localhost unless allowRemote
    describe(): cached ModelHealth, refreshed by a background probe of GET /v1/models every 10 s;
                available:true, profile:data[0].id | available:false, reason:'No local model server at <baseUrl>'
    generate(req, signal): POST /v1/chat/completions
      {model, messages:[{role:'system',content:req.instructions},{role:'user',content:req.state}],
       max_tokens:req.budget.maxTokens, temperature:0, stream:false}
      → choices[0].message.content, usage.completion_tokens
      5xx with /memory|oom/i in body → 'out_of_memory'; non-JSON/missing choices → 'invalid_output'
  defaults when unconfigured: 11434 (Ollama), 1234 (LM Studio), 8080 (llama.cpp server), first that answers
  ```
  Qwen3 thinking: disable via the server's documented switch — Ollama accepts `"think": false` on recent versions; **check the installed version's docs and record which in the doc comment.**
  verify: local `http.createServer` double: models list → available; 500 "out of memory" → `out_of_memory`; garbage → `invalid_output`; abort → `cancelled`; remote host → refused with reason.
  sabotage: drop the host check → red.
  pitfalls: 1, 3.

- [ ] **H2  Settings: model server URL** (≈20)
  touches: C1>src/components/shared/AiWorkerPanel.tsx, C1>src/lib/aiWorkerHost.ts
  depends-on: H1
  do: URL field + "Test connection" showing `describe()`; the host builds `localProvider` when a URL is stored under `drc.ai-provider.v1`, else `absentProvider()`.
  verify: with `ollama serve` running here → "ready: <model>"; stopped → the absent reason. (Killing `ollama app` kills the server — memory.)

- [ ] **H3  Structured output** (≈20)
  touches: C1>src/lib/aiWorker.ts, C1>src/lib/aiModelProvider.ts, C1>tools/ai-worker-test.mjs
  depends-on: H1
  do: `parseStructured<T>(text, validate)` takes the first `{...}` block; instructions end with the schema `{ "notable": string[], "question"?: string }`; failure → `invalid_output` and **no** acknowledge.
  verify: valid → ok; prose → invalid_output with cursor unchanged; extra keys → ok.

- [ ] **H4  Live review v1 in the panel** (≈15)
  touches: C1>src/components/shared/AiWorkerPanel.tsx
  depends-on: H3
  do: show last `notable[]`, `question`, and time. Nothing else changes.
  verify: browser with a model: the list updates on a room change.

- [ ] **H5  Measure** (≈30)
  touches: C1>docs/LOCAL_AI_BACKGROUND_WORKER.md
  depends-on: H4
  do: Qwen3-4B q4 on the RTX 4070: tokens/s and time-to-first-token over 20 live-review requests → `docs/verification/model-perf-<date>.md`; replace §11's targets with measured numbers.
  verify: §11 cites the file.

- [ ] **H6  Scanner over every AI log line** (≈15)
  touches: C1>src/lib/aiWorkerHost.ts, C1>src/lib/aiWorker.ts, C1>tools/ai-worker-test.mjs
  depends-on: H1
  do: every `console.*`/activity write in `ai*.ts` passes `scanForSecrets`; a source check asserts no bare `console.` in those files.
  verify: source check green; a fixture line with a runtime-assembled key is redacted.

- [ ] **H7  OOM/timeout/absent are distinct on screen** (≈10)
  touches: C1>src/components/shared/AiWorkerPanel.tsx, C1>tools/ai-worker-host-test.mjs
  depends-on: H2
  do: one string per `ProviderFailure` kind; a test maps each kind to a distinct string.
  verify: test green.

- [ ] **H8  Script-repair vertical job** (≈45; three commits)
  touches: G1>src/lib/aiJobProducers.ts, C1>src/lib/aiWorker.ts, G2>src/lib/aiKnowledgeTools.ts, new:tools/ai-script-repair-test.mjs, package.json, tools/test-suites.json
  depends-on: G6, H3
  do: producer: a task failing twice with the same error → `script_repair`. Tool `read_script(id)` read-only. The job asks for a unified diff; the worker writes the patched copy **under the app data dir, never over the script**; runs `ruby -c` / `node --check` / `tsc --noEmit` on the copy and E7's fixtures; result → claim `{predicate:'script_patch', value:{diff, checks}}` awaiting review. Never activates.
  verify: scripted provider returning a known-good diff → checks recorded; original file hash unchanged.
  sabotage: write over the original → hash check red.

---

### Lane I — Design tokens (#176, #179)

- [ ] **I1  Token test with a ratchet** (≈30)
  touches: new:tools/color-token-test.mjs, new:tools/color-token-allowlist.json, package.json, tools/test-suites.json
  depends-on: none
  do: scan `src/components/**/*.tsx` for `#[0-9a-fA-F]{3,8}\b`, `rgba?\(`, `hsl\(`, and Tailwind arbitrary colours `\[(#|rgb|hsl)`; every hit today goes into the allowlist. **Key each entry on `file` + `literal` + a count, never on a line number**: several lanes edit these files concurrently, so line numbers shift under an allowlist that has not changed meaning, and a ratchet that fails on an unrelated edit teaches everyone to regenerate it, which is the one thing that must never become routine. So an entry is `{file, literal, count}`; the test fails when a `(file, literal)` pair appears more times than the allowlist permits, when a pair is absent from the allowlist entirely, or when an allowlisted pair no longer appears at all (it can only shrink). It still reports the offending line numbers in the failure message, because that is what a person needs in order to go and fix it. Print `remaining: N` and a per-directory breakdown (`config, dashboard, first-run, game, layout, room, shared` plus the two root files).
  verify: green today with `remaining: N`; add one literal to a file that already has an allowlisted one → red naming the file, the literal, and the line it appeared on; move an allowlisted literal to a different line without changing it → still green.
  sabotage: that added literal. Also, in a scratch copy, key the allowlist on line numbers instead and shift a file by one line: the run goes red with nothing actually changed, which is the failure this wording exists to prevent.

- [ ] **I2  Bank/shop pin contradiction** (≈20)
  touches: src/lib/pinIcons.ts, src/lib/mapPins.ts, I1>tools/color-token-allowlist.json
  depends-on: I1
  do: `grep -n -iE "#[0-9a-f]{3,8}|color" src/lib/pinIcons.ts src/lib/mapPins.ts`; both read one token; remove their allowlist lines; confirm visually in the pins list.
  verify: `remaining` dropped by exactly those lines.

- [ ] **I3  `src/components/shared`** (≈25)  · **I4  `room`** · **I5  `layout`** · **I6  `game`** · **I7  `dashboard`** · **I8  `first-run`** · **I9  `config`** · **I10  `MapWindow.tsx` + `PanelWindow.tsx`** (≈15 each)
  touches: (that directory), src/index.css, I1>tools/color-token-allowlist.json
  depends-on: I1
  do: replace literals with tokens from `src/index.css`; a missing token is added there once; remove the allowlist lines; `remaining` drops by the count fixed and never rises.
  verify: `node tools/color-token-test.mjs` prints the lower `remaining`.

- [ ] **I11  Delete the allowlist** (≈5)
  touches: I1>tools/color-token-test.mjs, I1>tools/color-token-allowlist.json
  depends-on: I3, I4, I5, I6, I7, I8, I9, I10
  do: the test is strict; close #176 and #179 linking it.
  verify: `remaining: 0` and the allowlist file is gone.

---

### Lane J — Map audit (#175)

- [ ] **J1  Triage every finding** (≈30)
  touches: none
  depends-on: D6
  do: for each verified finding in #175: `dies-with-map-window` (already gone after D6), `moves-to-viewer-contract` (Lane L), or `still-real`. Post the triage as an issue comment.
  verify: the comment exists; each finding has one tag.

- [ ] **J2  Each `still-real` finding** (≈20 each; add `J2a, J2b…` lines under this one as they are claimed)
  touches: per finding
  depends-on: J1
  do: fix with a DOM-measured verification; close #175 when the list is empty.
  verify: per finding.

---

### Lane K — Appearance: models for weapons and armor, glyphs for skills

Version 2 proposed extending `portraits.ts`. `rewrite/remove-2d` deletes it,
and Dan's quoted rule in that branch is "I would rather throw an error than
keep 2d". So the appearance system is not a 2D-art descendant. It is **data the
snapshot carries and Godot renders**: a defaults table keyed to Codex's asset
registry (`godot/assets/shared_asset_selections.json` ids), a player override
store, and a per-entity `appearance` field on the snapshot the viewer already
receives. No portraits, no images in the client.

- [ ] **K1  Design note, no code** (≈20)
  touches: docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: C7
  do: add §11 "Appearance": the three pieces above; the id vocabulary is the registry's `selections[].id`; defaults are compiled by a tool from a noun→class table; overrides live in the client under `drc.appearance.v1`; the snapshot compiler attaches `appearance: {modelId, glyph?}` to `EntitySnapshot` and to `player`; Godot maps `modelId` → GLB through the registry and falls back to the class default, never to an invented mesh (the registry's own `forbiddenSubstitutions` rule).
  verify: the section exists and names the four owners it extends.

- [ ] **K2  Defaults compiler** (≈30)
  touches: new:tools/build-appearance-defaults.mjs, new:src/data/appearanceDefaults.json, package.json
  depends-on: K1
  do: input: a noun table (`sword, broadsword, bastard sword → 'Large Edged'`, …) keyed to `SKILLS_BY_SET.Weapon` (`grep -rn SKILLS_BY_SET src/`) excluding meta-skills (Parry, Offhand, Mastery, Expertise); armor classes from `armorLoadout.ts`'s coverage helpers; each class → a registry `id` that exists in `shared_asset_selections.json` (assert, do not trust). `--check` compares to the committed JSON.
  verify: `node tools/build-appearance-defaults.mjs --check` exit 0; an unknown noun maps to `null`, never a guess.
  sabotage: point a class at an id not in the registry → red naming it.

- [ ] **K3  Snapshot carries appearance** (≈25)
  touches: src/lib/presentationBridge.ts, new:src/lib/appearance.ts, tools/presentation-bridge-test.mjs
  depends-on: K2, C4
  do: `appearance.ts`: `appearanceFor(kind, name)` = override (`readJSON('drc.appearance.v1')`) ?? default ?? null; `setOverride`, `resetOverride`. `compileWorldSnapshot` attaches `appearance` to each entity and to `player` (wielded items from `CharacterStatus` — `grep -n "wield\|worn\|armor" src/types/index.ts`). Rust passes entities through opaquely already; `player` is `Option<Value>` — nothing to change there.
  verify: presentation-bridge test: a fixture with a bastard sword → `appearance.modelId` equals the Large Edged default; an override wins; unknown → absent field, not null-string.

- [ ] **K4  Godot maps `modelId`** (≈Codex; contract only here)
  touches: docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: K3
  do: §11 states the field, the fallback order, and the test Godot must add (`entity_projection_test.gd`: unknown id → class default; missing field → neutral token). File the content task in the ledger for Codex.
  verify: claim filed; §11 names the test.

- [ ] **K5  Override export / import / merge** (≈30)
  touches: K3>src/lib/appearance.ts, new:tools/appearance-test.mjs, package.json, tools/test-suites.json
  depends-on: K3
  do: one JSON `{version, overrides:{...}, provenance:'player'}`; import merges with the local player's own choices always winning; conflicts returned as a list, never silently overwritten; unknown ids ignored with a count.
  verify: tests per rule.
  sabotage: let import overwrite → red.

- [ ] **K6  Picker UI** (≈40)
  touches: new:src/components/shared/AppearancePicker.tsx, src/components/dashboard/DashboardLayout.tsx
  depends-on: K5
  do: from the inventory list, click an item → grid of registry entries for its class (thumbnails from the registry if it has them, labelled squares if not); one click sets, one resets; shows "default (from Large Edged)" vs "your choice".
  verify: browser: set, reload, still set; reset → default.

---

### Lane L — Codex contract for the Crossing slice

- [ ] **L1  Name what I own** (≈15)
  touches: docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: B3
  do: §2 lists: snapshot/event/intent shapes and their tests; the mock fixture generator; `tools/live-chain-check.mjs`; the acceptance checklist (L4). Codex owns every `.tscn`, content `.gd`, GLB and material.
  verify: the list is in §2.

- [ ] **L2  Mock fixture becomes a derived artefact** (≈20)
  touches: new:tools/build-godot-mock-fixture.mjs, godot/mock/crossing_mock_world.json, package.json
  depends-on: L1
  do: `git grep -n crossing_mock_world tools/` — if no generator exists (none did on 5 Sep), write one extracting Town Green North + depth 2 from the primitive world manifest that `tools/build-primitive-world-manifest.mjs` writes (`data/world/out/crossing-primitive-registry.json` and its siblings — read that tool's `outputDir`). `--check` compares to the committed fixture.
  verify: `node tools/build-godot-mock-fixture.mjs --check` exit 0.

- [ ] **L3  Data contract tests** (≈30)
  touches: new:tools/godot-fixture-contract-test.mjs, package.json, tools/test-suites.json, docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: L2
  do: every exit resolves to a cell or is `targetCellId:null`; no cell has two exits with the same `move`; the current room is in `cells`. §9 maps each requirement to a test name on both sides (`godot/tests/foundation_test.gd` already exists).
  verify: suite green in the full run.

- [ ] **L4  Slice acceptance checklist** (≈15)
  touches: docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: L1
  do: §9: Town Green North renders; every real exit clickable; click → `intent_accepted` → confirmed room change → token moves; a fabricated exit is refused; a stun flips `cannotAct` and the scene reacts; an assessed creature's confidence visibly ages. Each line has a "recorded in docs/verification/… on <date>" slot.
  verify: six lines with empty slots.

- [ ] **L5  Record the slice** (≈30)
  touches: none
  depends-on: L4, B4
  do: run L4 live against Codex's current content; fill the slots; file gaps as ledger tasks for the content side.
  verify: slots filled or gaps filed.

- [ ] **L6  Playable-slice gate** (≈5)
  touches: none
  depends-on: L5
  do: all six L4 lines recorded. Gate 3's content half.
  verify: no empty slot.

---

## 7. Dependency graph

```
C0 ─┐
C1 ──► A1 ──► A2 ──► A3, A4 ──► G1 ──► G6 ──► G9
 │      │      └──► H1 ──► H2 ──► H3 ──► H4 ──► H5 ; H6, H7 ; H8 (after G6,H3)
 │      └──► A6, A8
 ├──► C2, C4 ──► G10, K3
 └──► D0
C3 ──► A7
C7 ──► K1 ──► K2 ──► K3 ──► K4, K5 ──► K6
B1 ──► B2 ──► B3 ──► B4, B7 ; B2 ──► B5 ──► B6 ──► B8
B3 ──► L1 ──► L2 ──► L3 ; L1 ──► L4 ──► L5 ──► L6
D0, D1, A1 ──► D2 ──► D3 ──► D4 ──► D5 ──► D6 ──► J1 ──► J2
E1, F1 ──► E2 ──► E3, E10 ; F1 ──► E4 ──► F3 ──► F4 ; E9 ──► F5
A1, B6 ──► E12
E5, E6, E7, E8, E9, E11, F2, F6, I1 : independent
I1 ──► I2 ; I1 ──► I3…I10 ──► I11
F9 (gates 0–2) ──► F10 ──► F11 ──► F12 ──► F13 ──► F14
```

---

## 8. Estimate

C 8 · A 8 · B 8 · D 7 · E 12 · F 14 · G 10 · H 8 · I 11 · J 2+ · K 6 · L 6 =
**108 increments plus J's findings, ≈50 hours of unaided work**, plus waiting
on CI, downloads and the VM. Three sessions: Gate 0 in a day, Gate 2 in about
a week, Gate 6 in about three weeks. Gate 7 depends on beta weeks, not code.
Record actual `minutes:` on each `[x]`; the audit's `--tally` sums them so the
estimate can be recalibrated from data after Lanes C and A.

---

## 9. What the audit of version 2 found, and how

Every check below is one command against `origin/main`; a less careful reader
can rerun them. Version 3 changed each item.

| v2 said | Actually | Found by |
|---|---|---|
| Lane K extends `portraits.ts` | `rewrite/remove-2d` deletes `portraits.ts`, `playerArt.ts`, `creatureArt.ts`, `Portrait.tsx`, `CreatureArt.tsx` and quotes Dan: "I would rather throw an error than keep 2d" | `git diff --stat origin/main...origin/rewrite/remove-2d -- src/` |
| B2 "make `bridge_client.gd` attempt live first" | live connect is fully written; the gate is `world_root.gd:168` requiring `--live-presentation`, and `viewer.rs:157` passes no args | `git grep -n "start_live\|get_cmdline" origin/main -- godot`; `sed -n 150,175p viewer.rs` |
| D2 "game column takes the map's share" | Codex's approved mockup on my own branch defines a different frame: 228 / 620+ / 250 columns, a 224 px console row, 1120 px minimum | `git ls-tree` the PR branch; `grep -n grid-template` the mockup |
| E8 names `tools/live-test.mjs` | no such file; attach/detach live in `mounted-test.mjs`, `backlog-test.mjs`, `game-connection-owner-test.mjs` | `git grep -l "detachGame\|backfill" origin/main -- tools` |
| L2 reads `data/world/out/1-primitive-world.json` | no such file; the tool writes `crossing-primitive-registry.json` into its `outputDir` | `git cat-file -e`; `grep -n out/ tools/build-primitive-world-manifest.mjs` |
| PR #285 head `19cf1e79` | now `8299fe86`; Codex added the mockup and its claim to my branch | `gh pr view 285 --json headRefOid` |
| `remove-2d` treated as imminent | 4 commits, 80 behind, no PR, self-described "PROPOSAL… nothing imports them"; PR #276 is its mergeable subset | `git log origin/rewrite/remove-2d..origin/main \| wc -l`; `gh pr list` |
| plan lived in the scratchpad | bookkeeping needs a shared file; now `docs/PLAN_TO_1_0.md` with `tools/plan-audit.mjs` in the suite | — |

Every other path and symbol v2 named was checked with `git cat-file -e` and
`git grep` on `origin/main` (38 paths, 15 symbol patterns) and exists.

---

## 10. Decisions for Dan

Each is written with a recommendation so a one-word answer suffices. Until
answered, the recommendation is what gets built. On 5 Sep 2026 Dan delegated
all of the open ones: "i don't actually have any opinions on the decisions so
use your best judgement." Each below therefore records the recommendation as
the decision; a later session may reopen one by writing why here.

- **D0 — board slot.** Recommend (a): separate Godot window for 1.0; the slot
  shows the transcript and a compact viewer host card; the slot contract is
  written so docking (b) is a later increment. *Decided:* **(a), separate Godot window for 1.0**, 5 Sep 2026.
- **C7 — `rewrite/remove-2d`.** Recommend: rebase and PR the deletion half now
  (2D art out, `removed2d.tsx` throwing sites as the to-do list); keep
  `src/domain/*` + `docs/ADAPTERS.md` as a separate proposal PR reviewed on
  its own. *Decided:* **as recommended**, 5 Sep 2026; the rebase is the branch owner's work, C7 only records the question.
- **F3 — signing.** Recommend unsigned for beta with a SmartScreen note;
  revisit at 1.0. *Decided:* **unsigned for beta**, 5 Sep 2026.
- **F4 — update check.** Recommend a "newer version available" link via the
  existing GitHub-releases fetch; no auto-install. *Decided:* **the link**, 5 Sep 2026.
- **Shortest path.** Recommend shipping beta.1 with viewer and AI disabled
  (Gates 0→1→2→6). *Decided:* **yes**, 5 Sep 2026.
- **G5 — claim vocabulary.** Recommend adopting the handoff PDF's §28 schema
  whole (adds `privacy`, `licence`, `reviewer`, `retracted`, `published`)
  rather than the narrower one v3 first wrote; nothing is built yet, so this
  costs nothing now and a migration later. *Decided:* **adopt the PDF schema whole**, 5 Sep 2026.
- **G11 — live suggestions.** The one increment that gives model output a
  path to a game command, confirmation-required, exact-command match, one
  pending at a time. Recommend building it last in Lane G and not enabling it
  in beta.1. *Decided:* **build it last in Lane G; it may merge once its adversarial tests are green, and ships behind a default-off setting until a beta cycle has run**, 5 Sep 2026. The confirmation gate, exact-command match, state-version match and one-pending rule are the safeguard, and they are testable; a permanently unbuilt increment is not safer, only later.
- **G12 — whispers and private messages.** Recommend excluded from every
  model prompt by default with a per-source opt-in, per the handoff's §37.
  *Decided:* **excluded by default**, 5 Sep 2026.
- **The handoff PDF itself.** Recommend it is **not** committed: its
  normative parts move into `docs/LOCAL_AI_BACKGROUND_WORKER.md` (C8) and its
  execution parts are now increments here, so there is one source of truth
  for each. The PDF stays a dated review artefact in your files. *Decided:* **not committed**, 5 Sep 2026.

---

## 11. The 5 September implementation-handoff PDF, evaluated

`DR-Companion-Claude-Implementation-Handoff.pdf` (84 pages, assembled from the
PR #285 branch at `8299fe86`, the same commit as Codex's mockup ledger record)
and this plan answer different questions and were written blind to each other.
This section records what each is for, what the PDF added to this plan, and
what it got wrong, so nobody has to read both again.

**What it is.** A product and architecture contract: the player promise, ten
non-negotiable rules, schemas (identity model, typed tethers, kits, candidate
claims, tools, suggestions), state machines (cursor, jobs, alerts, model-result
truth table), pseudocode for the four vertical slices, a privacy
classification, a test-attack matrix, a milestone ladder M0–M9, and full
source snapshots of the AI modules and the mockup. It says *what must be true
and why*. It has no file-level steps, no commands, no expected outputs, no
owner or claim mechanism, and no bookkeeping. This plan is the inverse: it
says *what to type, in what order, by whom, and what the output must say*, and
it leans on the repo docs for the why.

**Adopted from it (now increments here):**

| PDF section | Became | Why it was missing |
|---|---|---|
| §28 candidate-claim schema | G5 rewritten | v3's schema lacked privacy, licence, reviewer, retraction |
| §29 tool registry rules (size cap, input validation, call trace, untrusted-text labelling) | G2 rewritten | v3 had only the allowlist |
| §32–33 map job + tether validator (invented destination, null anchor, ferry, portal) | G6 adversarial tests | v3 tested only the happy path |
| §36 suggestion → command boundary (exact command, state version, expiry, one pending) | G11 | v3 had no live-suggestion increment at all |
| §37 data classification | G12 | v3 had only the credential scanner |
| §26 alert ACK ≠ RESOLVE | A10 | found the re-raise loop while reading it |
| §25 job table (`checkpointed→queued`; completed needs a result) | A12 | code and doc disagreed; neither plan had noticed |
| §9 screen hard rules (freshness on location, "unresolved" not last town, no minimap) | D4 | v3 had geometry but not these rules |
| `observations.read(refs)` presumes durable evidence | G0 | v3's `event:<seq>` refs dangle after journal eviction |

**Found by reading its appendices against its text** — defects in code the PDF
calls "Implemented" and "mounted and visually verified": the worker only runs
while Settings is open (A1); the tick effect restarts on every character
update (A2); a no-model install fills the journal and shows red "discarded"
text forever (A9); a persistent stun re-raises an urgent review every second
(A10); a privacy-gate throw is an unhandled rejection (A11). The PDF's baseline
status table is therefore optimistic, and its M0 "refresh live state" would not
have caught these because they are behavioural, not structural.

**Where it is silent and this plan is not:** everything between "the AI slices
work" and "a stranger can install and play" — installer, clean-VM first run,
uninstall, signing, privacy statement, third-party licences, the never-run live
viewer chain (B2), the `remove-2d` question (C7), the layout migration (D), and
release engineering (F). Its "Definition of MVP complete" is a feature list; the
bar in section 5 here is a player outcome.

**Where they agree, independently:** do not install a model first; extend
owners, never add siblings; the mockup approves hierarchy not art; model output
is data; the text client must stand alone; deterministic safeguards never wait
for a model; every generated fact is a candidate with provenance.

**Ordering difference, resolved:** the PDF's M1→M2 (claims, then map vertical)
before M3 (provider) matches Lane G before Lane H's *product* dependence, but it
skips Lane A because it did not know Lane A's defects exist. Lane A stays first.

- [ ] **C8  Fold the PDF's normative content into the architecture doc** (≈40)
  touches: C1>docs/LOCAL_AI_BACKGROUND_WORKER.md
  depends-on: C1
  do: append as normative sections, rewritten in that document's voice and citing the PDF by date: the §28 claim schema, §29 tool rules, §33 tether validator, §36 suggestion gate, §37 classification table, and the §41 attack matrix as "required adversarial tests" beside §14's acceptance criteria. Reconcile the job table with A12's outcome. Do not paste the PDF; do not commit it. After this, the PDF has no content the repo lacks.
  verify: `grep -c "privacy" docs/LOCAL_AI_BACKGROUND_WORKER.md` ≥ 3; `grep -c "validateTetherCandidate\|invented destination" docs/LOCAL_AI_BACKGROUND_WORKER.md` ≥ 1; the doc's §6 table equals `ALLOWED` in `aiJobStore.ts` (a test in `tools/ai-job-store-test.mjs` reads both and compares — write it).
  sabotage: change one row of the doc table → the comparison test red.
