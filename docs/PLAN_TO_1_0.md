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
| G | G0, G2–G5, G1, G6, G8, G7, G9, G10, G12 (not G11) | `lane-g/ai-claims` | `dev/wt-g` | 5 Sep 2026 |
| C/F | C12, F7, F8 | `chore/dead-test-suites` | `dev/wt-tests` | 5 Sep 2026 |

Finished and released: **C** (C3–C8, PRs #291 and #296), **E/F** (E5–E8,
F2, F6, PRs #293 and #295), **I** (I1–I11, PRs #303 and #300) and **L**
(L1–L5, PRs #305 and this one; L6 is `[!]`, blocked on four acceptance lines
that need a live character and one human click, neither of which is a code
change), and **K** (K1–K5, PRs #313 and this one; K6 is `[!]` on a content
gap, not a code one). Their rows are gone from the table above, which is what
finishing a lane looks like here. **H** is finished too (H1–H4, H6, H7; PRs
#316 and #318), with H5 and H8 left `[!]`: H5 needs a model runtime this
machine does not have and no numbers were invented for it, and H8 depends on
G6, which is not started. Both say what would unblock them.

**K1–K5 are done** (PRs #313 and the Lane K follow-up). C7's open question
turned out not to gate any of them: appearance touches none of the six files
`rewrite/remove-2d` deletes, which one `git diff --stat` established.
**K6 is `[!]`** for a different and better reason than C7 — the registry admits
no item meshes, so a picker would have nothing to offer but scenery; see its
own `note:`. **L1** is free now that B3 is done. **G** is claimed and has
landed G0 and G2–G5 (PR #317), so the line that used to stand here saying it
waits on Lane A is stale and has gone.

**D6 is free to claim**, and needs one thing this fleet cannot supply on its
own: D5's measurements were all taken against the mock bridge, and D6 depends
on the new layout having survived a real play session. Whoever picks it up
should read D6's own `blocked-on` and `note` lines first — its `do:` as written
would remove the `'map'` panel id, which is still live. **J** waits on D6.

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

- [x] **C3  `npm run worktree:init`** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 15
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

- [x] **C4  Split `presentationBridge.ts`** (≈40; two commits)
  commit: (this PR) verified: 2026-09-05 minutes: 40
  touches: src/lib/presentationBridge.ts, new:src/lib/presentationTypes.ts, new:src/lib/viewerClient.ts, src/components/shared/PresentationBridgePanel.tsx
  depends-on: C1
  do: commit 1 moves every `export interface|type` into `presentationTypes.ts` with re-exports left behind. Commit 2 moves `viewerStatus`, `launchViewer`, `presentationBridgeInfo`, `ViewerStatus`, `PresentationBridgeInfo` into `viewerClient.ts`, updates `PresentationBridgePanel.tsx`, deletes the re-exports nothing uses (`grep -rn "from './presentationBridge'" src tools` → each importer either imports a type from `presentationTypes.ts` or a function still in the bridge). Leave `compileWorldSnapshot`, `shouldPublish`, `justReconnected`, `gameCommandForIntent`, `cannotAct`, `publishWorldSnapshotIfChanged` where they are.
  verify: read the suite total before you start (`tail -1` of the run). After: `npx tsc -b` exit 0; total unchanged; `wc -l src/lib/presentationBridge.ts` < 500.
  pitfalls: 1, 17.

- [x] **C5  `protocol_harness.rb`: loader or deletion** (≈10)
  commit: (this PR) verified: 2026-09-05 minutes: 35
  touches: lich-scripts/test/protocol_harness.rb
  depends-on: none
  do: `git log --oneline -S protocol_harness -- lich-scripts/ | head`. If no test ever required it, delete it (the commit says so); if one did and was removed, restore that test instead.
  verify: `grep -rn protocol_harness lich-scripts/ tools/ package.json docs/` → only lines you also updated.

- [x] **C6  Needs-environment test list** (≈10)
  commit: (this PR) verified: 2026-09-05 minutes: 25
  touches: package.json, docs/ENGINE.md
  depends-on: none
  do: script `test:needs-env` prints the suites deliberately outside `test-suites.json` and their requirement: `test:godot-export` (submodule + Godot), `test:live-chain` (B4; the running app), `test:bridge` (Ruby). ENGINE.md gets the same list beside its testing section (`grep -n "run-tests" docs/ENGINE.md`).
  verify: `npm run test:needs-env` prints three names with requirements.

- [x] **C7  Decide `rewrite/remove-2d` and merge PR #276** (≈30; decision + one merge)
  commit: (this PR) verified: 2026-09-05 minutes: 30
  touches: none
  depends-on: none
  do: facts as of 5 Sep: `remove-2d` is 4 commits, 80 behind main, no PR, and its own `docs/ADAPTERS.md` opens "PROPOSAL, for review… nothing imports them". PR #276 (creature art pack removal, −797, CI green, claim present) is the mergeable subset. Steps: (a) `gh pr merge 276 --squash --delete-branch`; verify `git ls-tree origin/main public/creatures | wc -l` → 0. (b) Post in the ledger (a claim `c7-remove-2d-decision`, status blocked) the question for the branch owner: rebase and PR the deletion half now, keep `src/domain/` as a separate proposal PR? (c) Put the decision in section 10 for Dan. Lane K waits on this; Lane D does not (their `App.tsx` overlap is zero — checked with `git diff --stat origin/main...origin/rewrite/remove-2d -- src/App.tsx` → empty).
  verify: #276 merged and the claim exists with the question and the diffstat pasted in.

---

### Lane A — AI host repair (on `main` after C1)

- [x] **A1  Host at the app root; panel reads a store** (≈20)
  commit: 3cd66c33 verified: 2026-09-05 minutes: 35
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

- [x] **A2  Tick effect survives store updates** (≈20)
  commit: 335376e5 verified: 2026-09-05 minutes: 40
  touches: C1>src/lib/aiWorkerHost.ts, C1>src/lib/aiIngest.ts, C1>tools/ai-worker-host-test.mjs
  depends-on: A1
  do: extract the tick body into exported `runHostTick(deps)`; effect deps `[enabled, provider]`; inside the tick read `useAppStore.getState()`.
  verify: new check — a provider whose `generate` never resolves; call `runHostTick` (generation in flight); fire 20 store updates; the `AbortSignal` is **not** aborted and `journal.acknowledged()` unchanged.
  sabotage: put `character` back into the deps array in a copy → red.
  pitfalls: 6.

- [x] **A3  Review hash covers what matters** (≈15)
  commit: 6fd25275 verified: 2026-09-05 minutes: 25
  touches: C1>src/lib/aiIngest.ts, C1>src/lib/aiWorkerHost.ts, C1>tools/ai-worker-host-test.mjs
  depends-on: A2
  do: `reviewHash({roomId, situation: sorted, inRoundtime: (roundtime ?? 0) > 0, hostiles: count of roomCombatants hostile && !dead})` → `JSON.stringify`.
  verify: room change → differs; health 84→83 → equal; roundtime 9→4 → equal; 4→0 → differs.
  sabotage: drop `roomId` → room-change check red.

- [x] **A4  Derive all six activities** (≈20)
  commit: 6fd25275 verified: 2026-09-05 minutes: 30
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

- [x] **A5  Journal cursor survives a panel remount** (≈20)
  commit: ddd55f8d verified: 2026-09-05 minutes: 30
  touches: C1>src/lib/aiEventJournal.ts, C1>src/lib/aiWorkerHost.ts, C1>tools/ai-event-journal-test.mjs
  depends-on: C1
  do: `seedAcknowledged(cursor)` on the journal. The host persists `{sessionId, acknowledged}` under `drc.ai-journal-cursor.v1`; on mount seeds only when `sessionId` matches the in-memory session id. Sequence numbers restart per process, so this survives a remount, **not** a restart — say so in the doc comment and point at `JobStore.recoverInterrupted` for the restart case.
  verify: ack 5; new journal `seedAcknowledged(5)`; append → `pending()` = 1 and `readFrom(acknowledged())` returns only the new event.
  sabotage: make `seedAcknowledged` a no-op → red.
  pitfalls: 3.

- [x] **A6  Publish status only on change** (≈10)
  commit: 2028ec48 verified: 2026-09-05 minutes: 30
  touches: C1>src/lib/aiWorkerHost.ts
  depends-on: A1
  do: shallow-compare against the last published status; publish `ticks` every 5th tick only.
  verify: temporary `console.count('AiWorkerPanel render')` in the panel; with nothing happening it must not fire each second; remove before commit.

- [ ] **A7  Rust suite green in a fresh worktree** (≈10)
  touches: none
  depends-on: C3
  do: `npm run worktree:init && cd src-tauri && cargo test --lib`.
  verify: `test result: ok` with the same passed count CI's `tauri` job reports for main (read it from `gh run view --log` first; require equality).

- [x] **A8  AI panel promises only what exists** (≈10)
  commit: 110cf643 verified: 2026-09-05 minutes: 15
  touches: C1>src/components/shared/AiWorkerPanel.tsx, C1>tools/ai-worker-host-test.mjs
  depends-on: A1
  do: when `!available` and `src/lib/aiLocalProvider.ts` is absent from the build, show "Local model support is not yet available in this build."; once H1 lands, "Point Settings → Local model at a running Ollama or LM Studio on 127.0.0.1". A test reads the panel source and asserts the string matches the presence of `aiLocalProvider.ts`.
  verify: test green today (file absent → first string).

The four increments below came out of reading the 5 Sep implementation
handoff PDF against the code (section 11). Each is a defect visible in the
PDF's own source appendices that its text did not call out.

- [x] **A9  No model means an idle worker, not a red loss counter** (≈20)
  commit: 110cf643 verified: 2026-09-05 minutes: 25
  touches: C1>src/lib/aiWorkerHost.ts, C1>src/components/shared/AiWorkerPanel.tsx, C1>tools/ai-worker-host-test.mjs
  depends-on: A1
  do: today an install with no model still journals every line, never acknowledges (the absent provider never returns `ok`), fills the 5000-event bound, and then the panel prints "N events were discarded before review" in `text-danger` forever. The capture is correct; the framing is a lie. When `provider.describe().available` is false: the tick still ingests (capture is continuous), but the panel shows "No local model; N events captured, none reviewed" in ordinary ink and `journalLost` is reported as "unreviewed" not "discarded". Loss stays red only while a provider is available.
  verify: test — absent provider, 6000 lines ingested → status has `unreviewedWithoutModel > 0` and `journalLost` is not surfaced as loss; available provider (scripted) with the same input → loss surfaced.
  sabotage: remove the availability branch → the first check red.

- [x] **A10  A handled alert stays handled until its condition clears** (≈25)
  commit: 199b2a22 verified: 2026-09-05 minutes: 30
  touches: C1>src/lib/aiAlertBroker.ts, C1>src/lib/aiWorkerHost.ts, C1>tools/ai-alert-broker-test.mjs
  depends-on: A2
  do: `acknowledge(key)` deletes the key, and the host's alert effect re-derives `situation:stunned` on every character update, so a stun that lasts four rounds becomes four urgent reviews (one per second with a real provider). The handoff's alert lifecycle separates ACK from RESOLVE. Implement the minimum: the broker keeps a `handled: Set<key>`; `raise()` of a handled key increments `occurrences` but does not re-enter `pending`; `reconcile(activeKeys)` (called by the host after `deriveAlerts`) drops handled keys no longer present, so the next occurrence is a fresh alert. Critical priority is exempt: a repeated disconnect must always re-alert.
  verify: tests — stunned raised, acked, raised again → `pendingCount()` 0 and `occurrences` 2; condition clears then returns → pending 1; a critical key re-enters pending after ack.
  sabotage: skip the `handled` check in `raise` → first check red.

- [x] **A11  A privacy-gate refusal is a visible failure, not an unhandled rejection** (≈15)
  commit: 7c5450e6 verified: 2026-09-05 minutes: 25
  touches: C1>src/lib/aiWorker.ts, C1>src/lib/aiWorkerHost.ts, C1>tools/ai-worker-test.mjs
  depends-on: A2
  do: `assertPromptCarriesNoSecrets` throws (correctly — a leak must stop the call) from outside `generateWithinBudget`'s try; `runWorkerOnce` does not catch; the host's tick has `try/finally` with no `catch`, so the rejection is unhandled and the tick reports nothing. Today unreachable (the live request carries only seqs and kinds) and reachable the moment G4 or G6 puts text in a request. Catch in `runWorkerOnce`: the outcome becomes `{did:'review'|'background-job', result:{ok:false, failure:'privacy_gate', message:<pattern names only>}}`; cursor untouched; job → `failed` with the pattern name; panel shows "Sensitive input withheld". Add `'privacy_gate'` to `ProviderFailure`.
  verify: test — a request whose `state` contains a runtime-assembled `pass`+`word: x` → outcome `privacy_gate`, cursor unchanged, no throw escapes.
  sabotage: let the throw escape → the test's `await` rejects → red.

- [x] **A12  Job transitions match the contract: completed needs a result** (≈15)
  commit: dd59374d verified: 2026-09-05 minutes: 30
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

- [x] **B1  Export a viewer locally** (≈15 + download)
  commit: (this PR) verified: 2026-09-05 minutes: 25
  touches: none
  depends-on: none
  do: Godot 4.3 (`grep -n "config/features" godot/project.godot`); the release workflow names the exact zip (`grep -n Godot_v4 .github/workflows/release.yml`) — download the same by hand outside the repo. `git submodule update --init --recursive`; `GODOT4=<path> npm run godot:export`.
  verify: `ls -la godot/build/DRCompanionWorldViewer.exe` → size > 1 MB.
  pitfalls: 8.

- [x] **B2  The app launches the viewer live** (≈25)
  commit: (this PR) verified: 2026-09-05 minutes: 55
  touches: src-tauri/src/viewer.rs, godot/scripts/world_root.gd
  depends-on: B1
  do: `viewer.rs`: `Command::new(&exe).args(["--", "--live-presentation"])` — Godot user args follow `--`; a mode flag is not a credential, so update the module header from "nothing goes on the command line" to "no *secrets* go on the command line", keeping the reasoning about the token. `world_root.gd` `_ready()`: when live is requested and `start_live()` fails, do not silently `return` into an empty scene — set a visible label (the world_controls or inspector already has status text: `grep -n "status\|label" godot/scripts/world_controls.gd | head`) reading "Bridge unavailable — is DR Companion running?" and let `BridgeClient`'s reconnect timer keep trying. Mock stays a dev path reached only without the flag.
  verify: `cargo test --lib viewer` green; run the app from your worktree (`npm run tauri dev`), Settings → viewer bridge shows a port; Launch; the Godot console prints `connected-awaiting-auth` then the auth result; the Rust log shows the new client.
  done-when: Godot receives a `snapshot` with a numeric `sequence` from the app.
  pitfalls: 9. Read Codex's active claims on `world_root.gd` first.

- [x] **B3  Record the proof** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 20
  touches: none
  depends-on: B2
  do: `docs/verification/live-chain-<date>.md`: commit sha, `godot --version`, commands, the Godot line, the Rust `intent_accepted` line for a clicked exit, the text pane showing the movement, one screenshot, and a non-empty "what did not work" section (or "nothing, first try" with the evidence).
  verify: file exists with all six items.

- [x] **B4  `tools/live-chain-check.mjs`** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 30
  touches: new:tools/live-chain-check.mjs, package.json
  depends-on: B3
  do: read `%LOCALAPPDATA%\DR Companion Data\presentation-bridge.{port,token}` (names from `presentation_bridge.rs:60`); `net.connect`; send `{"type":"auth","token"}` NDJSON; expect `auth_ok`; expect a `snapshot` with numeric `sequence` within 2 s; send a walk intent from a fabricated room id; expect `intent_rejected`. Print `OK`/`FAIL` per step; exit 1 on any FAIL or a 5 s overall timeout naming the step. Register as `test:live-chain` and in C6's list, **not** in `test-suites.json`.
  verify: app running → `all passed`; app closed → `FAIL connect: ECONNREFUSED`, not a hang.
  sabotage: wrong token → `FAIL auth`.
  pitfalls: 4.

- [x] **B5  App exit closes the viewer** (≈25)
  commit: (this PR) verified: 2026-09-05 minutes: 35
  touches: src-tauri/src/viewer.rs, src-tauri/src/lib.rs
  depends-on: B2
  do: hold the `Child` in managed state `Mutex<Option<Child>>`; on `RunEvent::Exit` (`grep -n "RunEvent\|on_window_event\|\.run(" src-tauri/src/lib.rs`) call `kill()`; `viewer_status` consults `try_wait()` on the held child before falling back to `tasklist`.
  verify: `cargo test --lib viewer` green; launch viewer from the app, close the app, `tasklist /FI "IMAGENAME eq DRCompanionWorldViewer.exe"` → not listed.
  pitfalls: 9, 12.

- [x] **B6  Viewer crash visible within a tick** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 25
  touches: src-tauri/src/viewer.rs, src/components/shared/PresentationBridgePanel.tsx, src/lib/viewerClient.ts
  depends-on: B5
  do: `viewer_status` returns `exitCode: Option<i32>` when the held child exited; panel shows "viewer exited (code N)" and a Relaunch button.
  verify: kill the viewer by PID while the app runs; Recheck shows the line.

- [x] **B7  Reconnect contract end to end** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 25
  note: the Godot half is recorded and proven; the Lich half cannot be reached with `tools/fake-lich.mjs`, because `justReconnected` follows `bridgeConnected` (the companion-bridge plugin socket), which the fixture does not provide. Recorded in the appendix as unexercised rather than passed.
  touches: none
  depends-on: B3
  do: kill and relaunch Godot → it receives the held snapshot on auth; drop and reattach Lich → forced publish (`justReconnected`). Append both log lines to the B3 record.
  verify: appended section with log lines.

- [x] **B8  Viewer absent → every path degrades** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 40
  note: the component itself is not rendered — this repository has no component-render harness and adding one is bigger than this increment. The strings the panel shows are checked at the functions it calls for them, which is why `viewerStateLabel` was lifted out of its ternary; the JSX is the remaining gap and the suite's own header says so.
  touches: new:tools/viewer-absent-test.mjs, package.json, tools/test-suites.json, src/lib/viewerClient.ts, src/components/shared/PresentationBridgePanel.tsx
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

- [x] **D0  Board-slot decision** (≈20, decision for section 10)
  commit: (decided in section 10, no code) verified: 5 Sep 2026 minutes: 0
  touches: none
  depends-on: C1
  do: write the three options with what each costs: (a) separate Godot window as today, board slot shows the transcript expanded and a compact viewer host card; (b) docked window — Tauri reports the slot's screen rect on move/resize and the viewer window is positioned to it (no reparenting; Godot `DisplayServer.window_set_position`); (c) true embedding (HWND reparenting) — fragile on Windows, Godot does not support it officially. Recommend (a) for 1.0 with the slot contract written so (b) is a later increment. Record in section 10; Dan decides.
  verify: section 10 has a "Decided:" line for D0.

- [x] **D1  Confirm the `remove-2d` overlap is still zero** (≈5)
  commit: (this PR) verified: 5 Sep 2026 minutes: 5
  touches: none
  depends-on: none
  do: `git fetch origin; git diff --stat origin/main...origin/rewrite/remove-2d -- src/App.tsx src/lib/columns.ts src/lib/layout.ts src/lib/panelDataContracts.ts` → empty today. Paste the output into your D2 claim. If non-empty, stop and coordinate (C7).
  verify: the pasted output.

- [x] **D2  Frame as data: rows and columns from the mockup** (≈25)
  commit: (this PR) verified: 5 Sep 2026 minutes: 30
  touches: src/lib/columns.ts, tools/columns-test.mjs
  depends-on: A1, D0, D1
  do: `columns.ts` holds the shipped defaults and the share helpers. Add the mockup's frame constants beside them (`SIDE_LEFT_W=228`, `SIDE_RIGHT_W=250`, `BOARD_MIN_W=620`, `CONSOLE_H=224`, `TOPBAR_H=48`, `FRAME_MIN_W=1120`) with a doc comment naming the mockup file as their source, and a `frameFits(innerWidth, innerHeight)` that returns which column must collapse first below the minimum. Do not add a second layout module.
  verify: `node tools/columns-test.mjs` → all passed plus: `frameFits(1366,768)` fits; `frameFits(1100,768)` names the right side as first to collapse.
  sabotage: change `FRAME_MIN_W` to 2000 → the 1366 check red.

- [x] **D3  Map window behind a flag** (≈15)
  commit: (this PR) verified: 5 Sep 2026 minutes: 15
  touches: src/App.tsx
  depends-on: D2
  do: `const MAP_WINDOW_ENABLED = false` beside `view()` (`src/App.tsx:58`); `if (q.get('view') === 'map' && MAP_WINDOW_ENABLED)`. Gate every opener: `grep -rn "view=map" src/` → each behind the same constant.
  verify: dev server; `?view=map` renders the main app; `grep -rn "view=map" src/ | grep -v MAP_WINDOW_ENABLED` → empty.

- [x] **D4  Console row and side columns** (≈40; two commits)
  commit: (this PR) verified: 5 Sep 2026 minutes: 165
  touches: src/App.tsx, src/components/room/GameChatColumn.tsx, src/lib/columns.ts
  depends-on: D3
  do: commit 1: move the game transcript + command line into a bottom row of `CONSOLE_H` spanning the workspace, per the mockup's `.console` grid `228px | 1fr | 250px`; the existing `GameConnectionBar` stays mounted inside it (`tools/game-connection-owner-test.mjs` enforces this). Commit 2: left side = vitals/room/mindstate stack; right side = context/alerts/AI (the `AiWorkerPanel` moves here from Settings — one component, two possible mounts is a fork, so it *moves*; Settings keeps only the provider URL field from H2). Existing panel ids stay; only their placement changes. Three hard rules from the handoff's §9 apply to whatever renders in the top bar and the board slot: the location line carries freshness and confirmation state ("Room 998 · confirmed 3 s ago", never a bare name); an unresolved location says "unresolved", never the last known town; nothing in the slot is a second minimap.
  verify: D5's measurement passes at 1366×768 and 1920×1080; `node tools/game-connection-owner-test.mjs` green; a test renders the top bar with `mapHere = null` and asserts the text contains "unresolved" and not "Crossing".

- [x] **D5  Measure three resolutions** (≈25)
  commit: (this PR) verified: 5 Sep 2026 minutes: 45
  touches: none
  depends-on: D4
  do: browser `resize_window` 1366×768, 1920×1080, 2560×1440; `javascript_tool`: for every element in the workspace, `getBoundingClientRect().right <= innerWidth`, and `document.body.scrollWidth <= document.body.clientWidth`, and at 1366×768 `document.body.scrollHeight <= innerHeight + 2`. Print violation counts.
  verify: zero at all three, printed as counts; fix clips in the column CSS and re-measure.
  pitfalls: screenshots lie about pixels — read the DOM numbers.

- [!] **D6  Delete the map-window path** (≈25)
  blocked-on: its own `depends-on` — D5 has not survived a real play session. Every D5 measurement was taken against the mock bridge; there is no live Lich/DragonRealms session available to this worktree, so the dependency is unmet by construction rather than by omission. The map window is already unreachable (D3's `MAP_WINDOW_ENABLED = false`), so nothing user-visible is waiting on this: it is a deletion, and deleting on an unmet dependency buys nothing.
  note: a second, separable problem was found while sizing this. The `do:` says to remove `'map'` from `PanelId` and `PANEL_DATA_CONTRACTS`, but that entry's own `purpose` reads "Retiring from this wrapper once Godot owns world/route presentation — kept here only as the current, still-live fallback until that migration slice lands", and that slice has not landed: D0 chose a separate Godot window for 1.0, and after D4 the map still renders in the board slot and still pops out through `?view=panel&id=map`, which is a different path from the `?view=map` window this increment is about. Removing the id would delete a live panel. Deleting `MapWindow.tsx` is safe and separable; removing the panel id belongs with Lane J's map audit or the Godot migration, and wants a line in section 10 first.
  also: `MapWindow.tsx` is read by five tests outside this increment's `touches:` — `aux-window-boundary-test`, `battlespace-test`, `gateway-test`, `map-loading-test` and `map-state-sync-test` (the last asserts properties of "both map surfaces"). They all go red on the deletion, correctly; whoever takes D6 should expect to update them and should say so in the commit.
  touches: src/App.tsx, src/components/MapWindow.tsx, tools/mapdock-test.mjs
  depends-on: D5 survived one real play session (date in the claim)
  do: **corrected 5 Sep 2026 — this used to say to remove the `'map'` panel id, and that was wrong.** Lane D declined and said why; checking settles it. `?view=panel&id=map` renders `<MapPanel>` through `PANEL_CONTENT.map`, which is a different route from the `?view=map` window this increment deletes, so removing the id would delete a live panel while claiming to remove a dead window. So: drop the `kind: 'map'` branch and `MAP_WINDOW_ENABLED` from `App.tsx`, delete `MapWindow.tsx`, and **leave `PanelId`, both default `order` arrays and `PANEL_DATA_CONTRACTS` alone**. Retiring the map *panel* is a separate question that belongs with Lane J or the Godot migration and wants a line in section 10 before anybody acts on it.
  verify: `grep -c "kind === 'map'" src/App.tsx` → 0; `?view=panel&id=map` still renders the map; `npx tsc -b` exit 0; full suite green.
  pitfalls: this is what an increment is for, and it is also how one goes wrong. The old wording came from reading the panel list rather than the two routes, and a session following it literally would have deleted a feature and passed every check it was told to run — the tests that would have caught it (`aux-window-boundary`, `battlespace`, `gateway`, `map-loading`, `map-state-sync`) are all outside the `touches:` list.

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

- [x] **E4  Is the installer signed?** (≈5)
  commit: (this PR) verified: 2026-09-05 minutes: 5
  touches: none
  depends-on: F1
  result: `Status : NotSigned`, `SignerCertificate : (none)`, measured on the artefact from run 2 rather than assumed. Recorded in `docs/verification/release-dry-run-2026-09-05.md`; the decision it supports is `docs/RELEASE.md` §2.1.
  do: `Get-AuthenticodeSignature .\DRCompanion*.exe | Format-List` → record `Status` verbatim (`NotSigned` expected).
  verify: the doc has it.

- [x] **E5  Kill-switch suite** (≈40; may split)
  commit: 9eef5356 verified: 2026-09-05 minutes: 55
  touches: new:tools/kill-switch-test.mjs, package.json, tools/test-suites.json, src/lib/flowStop.ts, src/lib/pythonTasks.ts, src/lib/nodeTasks.ts
  depends-on: none
  do: owners: `src/lib/stopAllTasks.ts`, `src/lib/flowStop.ts`, and whatever `grep -rn "runaway\|cancelCommand" src/lib/*.ts` finds. For each: a check that it works with `isTauri()` false, and a source check that the owner imports no `ai*`, viewer, python or node-runner module. An owner that does is a finding: file it, do not paper over.
  verify: suite green, each check naming its owner file.
  sabotage: comment out the stop path in a copy → red.

- [x] **E6  Player-data inventory, generated** (≈25)
  commit: 9eef5356 verified: 2026-09-05 minutes: 40
  touches: new:tools/build-player-data-doc.mjs, new:docs/PLAYER_DATA.md, package.json, tools/test-suites.json
  depends-on: none
  do: `grep -rhoE "writeJSON\('[^']+'|readJSON<[^>]*>\('[^']+'|(KEY|STORAGE_KEY) = '[^']+'" src/ | sort -u` drives a table: key, what it holds, owner file, behaviour on quota failure (`storage.ts` reports; say what the UI shows). The generator asserts its key count equals the grep's count. Same pattern as `tools/build-crossing-build-list.mjs`.
  verify: `node tools/build-player-data-doc.mjs --check` exit 0 against the committed doc.

- [x] **E7  Bad-script containment fixtures** (≈20)
  commit: 9eef5356 verified: 2026-09-05 minutes: 45
  touches: python/test_runner.py, typescript/test_runner.ts
  depends-on: none
  do: three fixtures — raises, loops until the runner's timeout, exits non-zero — asserting the runner reports each distinctly and the app process is unaffected (the runner is out-of-process; the assertion is on reported state). Mirror in the TS runner's tests if it has any (`ls typescript/`).
  verify: `npm run test:runner` green with the three names.

- [x] **E8  Disconnect/reconnect behaviour test** (≈20)
  commit: 9eef5356 verified: 2026-09-05 minutes: 35
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

- [x] **F1  Throwaway-tag release run** (≈30 + waiting)
  commit: (this PR) verified: 2026-09-05 minutes: 75
  touches: none
  depends-on: none
  result: run 1 failed at `actions/checkout` — `submodules: recursive` cannot clone `godot/shared-assets`, whose repository is private, because a workflow's built-in token reaches only its own repository. Every tagged release since this wiring landed would have failed identically, and nothing had ever run it. Fixed by making the viewer's absence a state rather than a crash (see `docs/RELEASE.md`). Run 2 green: a draft release with a 217,267,200-byte installer, SHA-256 `9FCF5444…DECAE8`, carrying the correct "does not include the Godot world viewer" note in its body. Full record in `docs/verification/release-dry-run-2026-09-05.md`, including what is still unexercised: the token branch has never run, and the installer has not been installed anywhere.
  do: `git tag v0.0.0-ci-check origin/main && git push origin v0.0.0-ci-check`; `gh run watch`. The Godot install step (`release.yml` around line 60–69) has never executed. Each failure becomes `F1a…` here with its fix. Success = draft release with the installer and `release:verify` printing both resources. Delete the draft and the tag after.
  verify: `gh release view v0.0.0-ci-check --json assets --jq '.assets[].name'` lists the `.exe`, then both are deleted.

- [x] **F2  One version, three files** (≈15)
  commit: 48f6f3af verified: 2026-09-05 minutes: 30
  touches: new:tools/set-version.mjs, package.json, tools/test-suites.json
  depends-on: none
  do: sets `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` from one argument; `--check` prints all three and exits 1 if they differ. Script `version:set`.
  verify: `node tools/set-version.mjs --check` exit 0 today.
  sabotage: bump one file by hand → exit 1 naming it.

- [x] **F3  Signing decision** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 20
  touches: new:docs/RELEASE.md
  depends-on: E4
  do: OV certificate (annual cost; SmartScreen still warns until reputation builds) vs unsigned with a download-page note. Recommend unsigned for beta. Section 10 for Dan.
  verify: "Decided:" line.

- [x] **F4  Update-check decision** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 15
  touches: F3>docs/RELEASE.md
  depends-on: F3
  do: the app already fetches Ruby4Lich5 from GitHub releases (`tools/vendor-fetch.mjs`, `setup.rs`). Reuse for a "newer version available" link (no auto-install) or rely on the page. Recommend the link. Section 10.
  verify: "Decided:" line.

- [ ] **F5  Privacy statement** (≈20)
  touches: new:docs/PRIVACY.md, src/components/layout/SettingsSheet.tsx
  depends-on: E9
  do: `grep -rn "fetch(\|reqwest\|https://" src/ src-tauri/src/ | grep -v -E "test|127\.0\.0\.1|localhost"` → one line per destination (Elanthipedia, GitHub releases). State: no telemetry, no analytics, local model on loopback only.
  verify: the grep's destination count equals the doc's line count.

- [x] **F6  Third-party licences, generated** (≈25)
  commit: 21df5812 verified: 2026-09-05 minutes: 50
  touches: new:tools/build-third-party.mjs, new:THIRD_PARTY.md, package.json, tools/test-suites.json
  depends-on: none
  do: from `package.json` deps (`license` fields), `cargo metadata`, Lich (BSD-3), Godot (MIT), fonts, and every admitted asset's `sourceLicense` in `godot/assets/shared_asset_selections.json`. `--check` exits 0 when the committed file matches.
  verify: `node tools/build-third-party.mjs --check` exit 0.

- [x] **F7  Bundle integrity extends to the viewer** (≈10)
  commit: (this PR) verified: 2026-09-05 minutes: 30
  touches: tools/bundle-test.mjs
  depends-on: F1
  do: assert the viewer resource destination when `godot/build/DRCompanionWorldViewer.exe` exists; skip loudly (`NOT CHECKED: viewer not built`) otherwise, and never let a skip read as a pass in the summary. The destination is read out of the config `tools/build-release-config.mjs` emits rather than restated here, so the check cannot agree with a path that has moved; and the generator's own refusal — it throws when `viewer.rs` no longer resolves the folder it bundles to — is caught and reported as a named FAIL rather than a stack trace nobody reads. Its viewer.rs contract is invoked, not re-implemented.
  verify: with no viewer exported, `node tools/bundle-test.mjs` ends `no failures, but 1 not checked: the viewer resource destination` — never `all passed`, and exit 0 because an absent viewer is a supported build. With one present it ends `all passed` and prints `and it is bundled to the viewer/ folder the app searches first: viewer/DRCompanionWorldViewer.exe`.
  sabotage: both branches, since a skip that cannot become a check is not a skip. Point `VIEWER_SRC` at `Sabotaged.exe` → `FAIL the exported viewer is a bundled resource: no entry in the release config` plus `FAIL and it is bundled to the viewer/ folder…: undefined`; rename `dir.join("viewer")` in `viewer.rs` → `FAIL the release config can be derived at all: Error: viewer.rs does not look for the viewer under a "viewer" folder…`. Restored, md5 `38cc398ffe46` and `20f85970347e` either side.
  pitfalls: the checked branch was exercised with a one-byte placeholder at `godot/build/DRCompanionWorldViewer.exe` (gitignored), because the real export needs the private `shared-assets` submodule. That proves the branch runs and can go red; it does not prove a real installer works, which is F8's and F9's job.

- [!] **F8  Uninstall test on the CI artefact** (≈10)
  blocked-on: E3, which is `[ ]` and itself waits on E2 — a clean VM, a CI-built NSIS installer and a person at the keyboard. No installer exists on this machine (`src-tauri/target/release/bundle` is absent) and none can be produced here, so there is nothing to uninstall. Marked blocked rather than skipped: an unstarted increment and one that cannot start look identical from the marker alone.
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

- [x] **G0  Evidence outlives the journal** (≈25)
  commit: e82330d1 verified: 2026-09-05 minutes: 40
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

- [x] **G2  Tool registry + `room_by_id`** (≈15)
  commit: 26dfd050 verified: 2026-09-05 minutes: 35
  touches: new:src/lib/aiKnowledgeTools.ts, new:tools/ai-knowledge-tools-test.mjs, package.json, tools/test-suites.json
  depends-on: A4
  do: `callTool(name, args, allowedTools, trace)` returns `{ok:false, reason}` for a disallowed or unknown name — never throws. Every tool declares `{id, validate(args), maxResultBytes}`; an over-size result is truncated with `truncated:true`, never silently cut. Every call is appended to `trace` as `{tool, argsSummary, bytes, at}` (no payloads, no secrets) so a job's tool use is inspectable. Text fields returned to a model are wrapped as `{untrusted:true, text}` so the prompt builder can label them "data, not instructions" (the handoff's injection rule). `room_by_id(zone, id)` → `{id, title, exits:[{move,to}], tags}` from the same `MapZone` data `compileWorldSnapshot` reads.
  verify: allowed → result; disallowed → refusal naming the tool; unknown → refusal; a 1 MB fixture result → truncated flag and `bytes <= maxResultBytes`; trace has one entry per call.
  sabotage: skip the allowlist → red; skip the size cap → red.

- [x] **G3  Tool `lore_for`** (≈10)
  commit: 026050a7 verified: 2026-09-05 minutes: 15
  touches: G2>src/lib/aiKnowledgeTools.ts, G2>tools/ai-knowledge-tools-test.mjs
  depends-on: G2
  do: wraps `bestiary.ts` `loreFor`/`isApproximate` → `{lore, approximate} | null`.
  verify: known creature → lore; unknown → null; approximate flagged.

- [x] **G4  Tool `recent_events`** (≈10)
  commit: bf863754 verified: 2026-09-05 minutes: 20
  touches: G2>src/lib/aiKnowledgeTools.ts, G2>tools/ai-knowledge-tools-test.mjs
  depends-on: G2
  do: `journal.readFrom(max(0, ack-n))` limited to n; returns kinds, seqs and the G12 privacy class only — never `text` (it may hold player speech).
  verify: a check asserts no returned object has a `text` key.

- [x] **G5  Candidate-claim store** (≈35; two commits)
  commit: f23cc92a verified: 2026-09-05 minutes: 55
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

- [x] **H1  OpenAI-compatible loopback adapter** (≈40; two commits)
  commit: (this PR) verified: 2026-09-05 minutes: 70
  touches: new:src/lib/aiLocalProvider.ts, new:tools/ai-local-provider-test.mjs, package.json, tools/test-suites.json, src/lib/aiModelProvider.ts, tools/ai-worker-host-test.mjs
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
  note: **the thinking switch could not be checked as written, because Ollama is not installed on this machine.** `Get-Command ollama` finds nothing, a recursive `C:\` search for `ollama*.exe` returns nothing (positive control: the same search finds `node.exe`), `~/.ollama/models` is empty, and nothing listens on 11434. So rather than record a guess as a documented fact, the flag is made self-correcting: `think: false` is sent by default, and a `400` whose body mentions `think` is retried once without it, which is a case the test double exercises. `<think>…</think>` is stripped from the text regardless, so H3's "first `{…}` block" cannot pick up the model's reasoning instead of its answer. Two deviations from `touches:`, both forced and both narrower than they look. `aiModelProvider.ts` gains `redactSecrets` and `aiLog` — H6's helper, put in the module that already owns `scanForSecrets` rather than in a second file that would drift from it, and given a live caller here rather than left as a scaffold. And A8's panel guard keyed on `existsSync('src/lib/aiLocalProvider.ts')`, which is an existence check on a container standing in for a content check on the thing: this commit creates that file while nothing can yet reach it, so the guard would have forced the panel to promise a feature with no way in. It now keys on whether `aiWorkerHost.ts` imports the provider, which is what actually decides what a player can do. The check's name and property are unchanged; only the thing it measures moved, and it still fails if the two drift.
  verify (as done): `npm run test:ai-local-provider` → `77 checked, 0 failed`, `all passed`; the decisive lines are `a remote server that WOULD answer is still never contacted`, `control: the same recorder does see a loopback request  http://127.0.0.1:11434/v1/models`, and `it fails as out_of_memory`.
  sabotage (as done): `if (false && !options.allowRemote && !isLoopbackHost(...))` → `72 checked, 5 failed`, naming the harm rather than a generic red: `so it cannot be reported as ready  somebody-elses-model` and `and generating against it sends nothing  2`. Restored, md5 `2b0e482e81da` either side. A first version of the sabotage produced only **two** failures — pointed at an unreachable remote address, a dropped check fails as ordinary absence and reads exactly like a refusal — so the two decisive checks above were added, using a recorded `fetchImpl` that *answers*, plus a loopback positive control so a zero call count means a refusal rather than a broken recorder.

- [x] **H2  Settings: model server URL** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 45
  touches: C1>src/components/shared/AiWorkerPanel.tsx, C1>src/lib/aiWorkerHost.ts, tools/ai-worker-host-test.mjs, tools/build-player-data-doc.mjs, docs/PLAYER_DATA.md
  depends-on: H1
  do: URL field + "Test connection" showing `describe()`; the host builds `localProvider` when a URL is stored under `drc.ai-provider.v1`, else `absentProvider()`.
  verify: with `ollama serve` running here → "ready: <model>"; stopped → the absent reason. (Killing `ollama app` kills the server — memory.)
  note: **the field is in `AiWorkerPanel`, not in the Settings sheet**, because Lane D moved that panel into the right rail; the increment's own `touches:` already said so and only its title did not. The address commits on the button rather than on every keystroke - writing on each character would rebuild the provider, and open a probe, for every letter of a URL somebody is halfway through typing. "Test" probes `getActiveProvider()`, the object the worker is actually running, because a connection test that passes for a provider nobody uses is worse than no test. The new key needed a description in `tools/build-player-data-doc.mjs`, which refused the build until it had one - the tool working exactly as designed.
  verify (as done): **Ollama is not installed on this machine** (see H1's note), so the check ran against a throwaway OpenAI-compatible server on 127.0.0.1:11437 with the app itself on 127.0.0.1:1437. Typing the address and pressing Test moved the panel's "Local model" line from `No local model is installed.` to `ready`; the stored setting read back as `http://127.0.0.1:11437`; `getAiStatus()` in the running app reported `available: true` at `ticks: 140`, so the host was live and had built the local provider from the stored value. Every process started for this was killed by the port it owned, and 1437, 11437 and 11129 were each confirmed closed afterwards.
  sabotage: `buildProvider` passing `allowRemote: true` → `FAIL and the host never passes allowRemote, so a stored remote address is refused`, 99 checked 1 failed; restored, md5 `9aa2e82f1af5` either side. The first version of that check matched the bare word and flagged the *comment* explaining why it is never passed - a check failing on its own documentation - so it now matches the code form with the colon.

- [x] **H3  Structured output** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 40
  touches: C1>src/lib/aiWorker.ts, C1>src/lib/aiModelProvider.ts, C1>tools/ai-worker-test.mjs
  depends-on: H1
  do: `parseStructured<T>(text, validate)` takes the first `{...}` block; instructions end with the schema `{ "notable": string[], "question"?: string }`; failure → `invalid_output` and **no** acknowledge.
  verify: valid → ok; prose → invalid_output with cursor unchanged; extra keys → ok.
  note: the extraction is **brace-matched, not regular-expression-matched**, and that is the whole of the increment's difficulty. A greedy pattern swallows a trailing object; a lazy one truncates at the first nested one; neither can describe balanced delimiters, and the input this exists for - a nested result inside a chatty sentence - breaks both. Strings are tracked too, so a closing brace inside a quoted value does not end the object early. The schema lives in `aiWorker.ts` beside the validator it describes rather than in `aiIngest.ts` with the rest of the prompt: a schema that has drifted from its validator produces `invalid_output` forever with nothing indicating why, and one file owning both is the only thing that prevents it. `LiveReview` has no field for a command, a destination or a target, so a model that wants the character to act has nowhere to put it - section 2's one command path enforced by the shape of the contract rather than by filtering afterwards.
  verify (as done): `npm run test:ai-worker` → `65 checked, 0 failed`, `all passed`. Conforming object → ok and parsed; a json code fence inside two sentences → still found; nested object plus trailing prose → ok with extra keys kept; a closing brace inside a quoted string → does not close the object; prose → `invalid_output` with `and the cursor did NOT move  0`; valid JSON of the wrong shape → `invalid_output`, cursor `0`; a truncated object → `invalid_output` rather than a crash; and the request's instructions begin with the caller's own prompt and end with the schema the validator enforces.
  sabotage: delete the demotion line so a non-conforming answer stays `ok` → `59 checked, 6 failed`, including `and the cursor did NOT move  1` - the exact harm, a cursor moved past events nothing ever reviewed and which cannot be moved back. Restored, md5 `eed5e2c6bab1` either side.
  pitfall met: the suite's success double returned `'{}'`, which is no longer a review. The property those checks assert - a working model advances the cursor - is unchanged, so the fixture was updated rather than the contract loosened.

- [x] **H4  Live review v1 in the panel** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 25
  touches: C1>src/components/shared/AiWorkerPanel.tsx, C1>src/lib/aiIngest.ts, tools/ai-worker-host-test.mjs
  depends-on: H3
  do: show last `notable[]`, `question`, and time. Nothing else changes.
  verify: browser with a model: the list updates on a room change.
  note: the review is **held between turns**, not replaced with null when a turn produces none. The host ticks once a second and almost every tick is idle, so a field that blanked each time would flicker faster than anybody could read it. An empty `notable` renders "Nothing notable." rather than an empty box, because a review that found nothing and no review at all are different states.
  verify (as done, and **the increment's own verify could not be run as written**): it asks for a browser with a model, and this machine has neither - no Ollama (H1's note), and `attachGame` goes through Tauri, so in Chrome the game socket does not exist and the journal stays empty forever. `gameLines()` was `0` and the host sat on `lastOutcome: 'background-idle'` at `ticks: 95`, which is the honest reading of a client with nothing to review rather than a fault. So the chain was driven in the running app instead, against a real loopback HTTP model server: `runHostTick` with a journal holding two events returned `lastOutcome: 'review'`, `lastFailure: null`, `cursor: 2`, and a `lastReview` carrying the server's notable line, its question and a timestamp, with the server's own log confirming `completion 1`. That is every link from the socket to the parsed review; the one step not exercised in a browser is React drawing it, which six source checks in `tools/ai-worker-host-test.mjs` hold to shape - the list, the empty case, the question, the timestamp, and the hold-between-turns rule. **Somebody with the Tauri app and a real model should still watch the list change on a room change** before this is called finished on screen.

- [!] **H5  Measure** (≈30)
  blocked-on: no model runtime on this machine. Ollama is **not installed**: `Get-Command ollama` finds nothing; a recursive search of `C:` for `ollama*.exe` returns nothing while the same search finds `node.exe` (positive control, so the zero is about the machine and not the instrument); the Ollama home directory holds a config and an **empty** models directory, so it was installed once and removed; nothing listens on 11434. `nvidia-smi --query-gpu=memory.total --format=csv` does report `12282 MiB`, so the GPU half of the requirement is fine and only the runtime is missing. Installing one and pulling Qwen3-4B is a download and an install decision, which is Dan's rather than this lane's. **No numbers are written and section 11's targets are untouched**: a measured file is the entire point of this increment, and inventing figures or promoting the marketing ones would be worse than the gap. To unblock: install Ollama, `ollama pull qwen3:4b`, then re-run this increment.
  touches: C1>docs/LOCAL_AI_BACKGROUND_WORKER.md
  depends-on: H4
  do: Qwen3-4B q4 on the RTX 4070: tokens/s and time-to-first-token over 20 live-review requests → `docs/verification/model-perf-<date>.md`; replace §11's targets with measured numbers.
  verify: §11 cites the file.

- [x] **H6  Scanner over every AI log line** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 20
  touches: C1>src/lib/aiModelProvider.ts, new:tools/ai-local-provider-test.mjs
  depends-on: H1
  do: every `console.*`/activity write in `ai*.ts` passes `scanForSecrets`; a source check asserts no bare `console.` in those files.
  verify: source check green; a fixture line with a runtime-assembled key is redacted.
  note: landed with H1 rather than after it, because H1 is the first module in this directory with anything to log and a redactor with no caller is exactly the scaffold `AGENTS.md` forbids. `redactSecrets` is built from `aiModelProvider.ts`'s own `SECRET_PATTERNS` - the list the prompt gate already uses - rather than a private copy, because two lists answering one question drift and the half nobody re-reads is the half that leaks. `aiLog` is the only permitted console call in the AI modules and the ratchet enforces it. Today **no** AI module logged anything at all, so the check's value is entirely in the next one; it therefore asserts its own population first (`the scan found the AI modules rather than an empty list  9 files`) so a broken walk reports itself instead of certifying an empty directory clean.
  verify (as done): `npm run test:ai-local-provider` → `a key-shaped value is replaced  request failed: [redacted api or provider key] rejected`, `and the kind that matched is named, so the line is still diagnosable`, `aiLog writes exactly one line  1`, `no ai*.ts module writes to console except aiLog`. The fixture key is assembled at runtime (section 1 trap 3): a credential-shaped literal in a tracked file is blocked by gitleaks whether or not it is real.

- [x] **H7  OOM/timeout/absent are distinct on screen** (≈10)
  commit: (this PR) verified: 2026-09-05 minutes: 25
  touches: C1>src/components/shared/AiWorkerPanel.tsx, C1>tools/ai-worker-host-test.mjs, C1>src/lib/aiModelProvider.ts, C1>src/lib/aiIngest.ts
  depends-on: H2
  do: one string per `ProviderFailure` kind; a test maps each kind to a distinct string.
  verify: test green.
  note: the status carried only `lastFailure`, which reads `"timeout: No result within the 5s budget."` - fine to read once, useless to branch on, and a panel wanting to say something different for out-of-memory had to match the prefix of a sentence somebody may later reword. So `lastFailureKind` travels beside it as the closed set it is. The table is a `Record` over the failure type, so a new kind fails to compile here rather than quietly inheriting somebody else's sentence. **Distinct is not the real bar**: the test also checks that each sentence names a *different next action*, because seven distinguishable strings that all mean "something went wrong" would pass a uniqueness check and help nobody.
  verify (as done): `npm run test:ai-worker-host` → `106 checked, 0 failed`, `all passed`, including `and no two kinds share one  7 distinct of 7`, `out of memory sends you to a smaller model`, `timeout is about time, not about memory`, and `the panel reads the shared table rather than writing its own copy`.
  sabotage: point `out_of_memory` at the `error` sentence → `FAIL and no two kinds share one  6 distinct of 7` **and** `FAIL out of memory sends you to a smaller model  The model server returned an error.`, 98 checked 2 failed; restored, md5 `2a9286427626` either side. It firing on both is what says the second check does work the uniqueness check alone would not.

- [!] **H8  Script-repair vertical job** (≈45; three commits)
  blocked-on: G6, which is `[ ]`. This increment's `depends-on` names G6 and H3; H3 is `[x]` and G6 has not been started, and section 0.3 requires every `depends-on` to be `[x]` before work begins. It also `touches:` two files Lane G creates, neither of which exists yet, so there is nothing here to extend and writing them from this lane would be the fork section 1 trap 17 forbids. Free to claim the moment Lane G reaches G6.
  touches: G1>src/lib/aiJobProducers.ts, C1>src/lib/aiWorker.ts, G2>src/lib/aiKnowledgeTools.ts, new:tools/ai-script-repair-test.mjs, package.json, tools/test-suites.json
  depends-on: G6, H3
  do: producer: a task failing twice with the same error → `script_repair`. Tool `read_script(id)` read-only. The job asks for a unified diff; the worker writes the patched copy **under the app data dir, never over the script**; runs `ruby -c` / `node --check` / `tsc --noEmit` on the copy and E7's fixtures; result → claim `{predicate:'script_patch', value:{diff, checks}}` awaiting review. Never activates.
  verify: scripted provider returning a known-good diff → checks recorded; original file hash unchanged.
  sabotage: write over the original → hash check red.

---

### Lane I — Design tokens (#176, #179)

- [x] **I1  Token test with a ratchet** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 45
  touches: new:tools/color-token-test.mjs, new:tools/color-token-allowlist.json, package.json, tools/test-suites.json
  depends-on: none
  do: scan `src/components/**/*.tsx` for `#[0-9a-fA-F]{3,8}\b`, `rgba?\(`, `hsl\(`, and Tailwind arbitrary colours `\[(#|rgb|hsl)`; every hit today goes into the allowlist. **Key each entry on `file` + `literal` + a count, never on a line number**: several lanes edit these files concurrently, so line numbers shift under an allowlist that has not changed meaning, and a ratchet that fails on an unrelated edit teaches everyone to regenerate it, which is the one thing that must never become routine. So an entry is `{file, literal, count}`; the test fails when a `(file, literal)` pair appears more times than the allowlist permits, when a pair is absent from the allowlist entirely, or when an allowlisted pair no longer appears at all (it can only shrink). It still reports the offending line numbers in the failure message, because that is what a person needs in order to go and fix it. Print `remaining: N` and a per-directory breakdown (`config, dashboard, first-run, game, layout, room, shared` plus the two root files).
  verify: green today with `remaining: N`; add one literal to a file that already has an allowlisted one → red naming the file, the literal, and the line it appeared on; move an allowlisted literal to a different line without changing it → still green.
  sabotage: that added literal. Also, in a scratch copy, key the allowlist on line numbers instead and shift a file by one line: the run goes red with nothing actually changed, which is the failure this wording exists to prevent.

- [x] **I2  Bank/shop pin contradiction** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 35
  touches: src/lib/mapPins.ts, tools/pins-test.mjs
  depends-on: I1
  do: as written this increment expected two files to disagree about a colour. They no longer do: `src/lib/mapPlaceColors.ts` holds one table and the pin presets, the automatic landmarks and Quick Travel all read it — somebody fixed it before this plan existed, and `pinIcons.ts` has no colours in it at all. What was still there is the same defect one level down: nine of the ten *shop* presets typed `'blue'` instead of reading `COMMON_PLACE_PIN_COLORS.shop`. Correct today, wrong the day the table changes, and one shop pin would then move while nine stayed. All ten now read the table, and `tools/pins-test.mjs` grew the guard the original fix never got: no rival `category: 'colour'` table in any of the three consumers, and at least ten shop lookups.
  verify: `npm run test:pins` → `all passed`, 66 assertions, including `every shop preset reads the shared colour rather than typing it: 10 lookups`.
  sabotage: turn one preset back into `'gold'` → red at `9 lookups`; restored, md5 `119ff62c4380` either side. A first version of that guard did *not* fire, because it looked for the word `shop` on a line that says `label: 'Jeweler'` — it was measuring rival tables, not typed literals, and the sabotage is what said so.
  pitfalls: the allowlist is untouched — `mapPins.ts` is `src/lib`, and I1 scans `src/components`.

- [x] **C10  Eight suites that had never run, and one that contradicted another** (≈60)
  commit: (this PR) verified: 2026-09-05 minutes: 60
  touches: tools/scrollable-region-test.mjs, tools/needs-env.mjs, tools/test-suites.json, package.json
  depends-on: C6
  do: unplanned. C6's own list said 21 `test:` scripts existed that the full suite never reached — tests that had not run since the day they were written. Eight of them pass today and are now registered: `scrollable-region`, `map-landmarks`, `map-state-sync`, `splitter-range`, `map-viewport`, `game-time`, `command-history`, `editor-safety`. Registered suites go from 104 to 115 and the backlog from 21 to 13. `scrollable-region` did **not** pass, and the reason is the interesting part: it asserted flatly that no scrollable region may carry `no-scrollbar` or `touch-none`, while `battlespace-test.mjs` — registered, green, maintained — asserts the exact opposite for the battle workspace on purpose, and `CombatRadar` explains in prose why (the roster sits over a picture, where a permanent scrollbar track reads as chrome). Two tests answering one question is the drift this repo forbids, and a dormant test does not get to overrule a maintained one by having never run. The property they both agree on is that **a region which scrolls must be operable**: it shows a scrollbar, or it hides it and drag-scrolls instead. That is what it now checks, so no shipped behaviour changed. Its file list was also ten hand-typed paths that had drifted — it named `CombatRadar` and missed `BattleColumn`, which has the same construction — so the population is now computed by walking `src/components`, with a floor.
  verify: `node tools/run-tests.mjs` → `all passed`, 115 suites; `test:scrollable-region` → `scrollable regions found by walking src/components: 11`, 41 checks, 0 failed; `test:needs-env` → 16 listed entries, exit 0.
  sabotage: strip a region's drag handlers *and* hide its scrollbar → `FAIL … is operable`; restored, md5 `e31ca1319c6f` either side. The first attempt renamed only `useDragScroll` and left `onPointerMove`, so the region could still be dragged and the check was right not to fire — trap 15, caught by the sabotage failing to go red rather than by reading.
  pitfalls: the checks match text, so writing a comment explaining why a file no longer sets `touch-none` made them flag their own documentation. Whole-line `//` comments are stripped before matching now. A check that fails on its own explanation teaches people to stop writing explanations.

- [x] **C11  Nothing ran the Godot tests, and one of them could not parse** (≈50)
  commit: (this PR) verified: 2026-09-05 minutes: 55
  touches: new:tools/godot-tests.mjs, godot/tests/live_bridge_transport_test.gd, tools/needs-env.mjs, tools/plan-audit.mjs, .agents/claims/c6-needs-env-list.json, package.json
  depends-on: B1
  do: unplanned, from two defects Lane B reported in passing. Underneath both was a larger one: **eleven `.gd` test scripts exist and nothing ran any of them** — no npm script enumerated them, no CI step invoked them, and `godot:export` only builds the binary. They were written, reviewed, committed, and never executed again. `live_bridge_transport_test.gd` shows what that costs: it called `OS.get_temp_dir()`, which arrived in Godot 4.4 while this project is 4.3, so the script failed to *parse* and had been shipping in every export as a file the engine refuses — fourteen checks about the live bridge transport, none of which had ever run. `tools/godot-tests.mjs` now runs all eleven; the fix uses `OS.get_user_data_dir()`, which 4.3 has. Separately `.agents/claims/c6-needs-env-list.json` carried an unescaped `\R` in a Windows path, so it was not valid JSON and `plan-audit --claims` threw for every session on this machine — the ledger tool broke and nothing failed, because it is the tool nobody runs in CI. That path is forward-slashed now, and `plan-audit` parses every claim on each run.
  verify: `npm run test:godot` → 4.3.stable, `11 of 11 Godot test scripts passed, 131 checks`, `all passed`. `node tools/plan-audit.mjs` → 46 claims parse, `plan ok`. `npm run test:needs-env` → 17 listed entries, exit 0.
  sabotage: put the 4.4 call back → `FAIL … Parse Error: Static function "get_temp_dir()" not found`; break one assertion in `world_controls_test.gd` → `FAIL … 1 of 7 checks failed`; truncate a claim to `{ "broken":` → `FAIL claim … is not valid JSON`. All three restored with matching md5s (`7392970e3fc0`, `4c7b7b032573`, `c3550e4c8135`).
  pitfalls: Godot exits 0 both for a script it could not load and for a script that passed, so the exit code alone cannot tell them apart — which is exactly how a broken script survived. The runner requires a recognisable result line and fails a run that produces none. With no Godot binary it prints NOT CHECKED and `0 of the Godot tests ran`, rather than exiting silently green.

- [x] **C12  The last thirteen suites that had never run, and the guard the collapse stepped over** (≈70)
  commit: (this PR) verified: 2026-09-05 minutes: 90
  touches: tools/crossing-build-list-test.mjs, tools/room-scene-patterns-test.mjs, tools/task-catalog-status-test.mjs, tools/map-keyboard-test.ts, tools/needs-env.mjs, tools/test-suites.json
  depends-on: C10
  do: unplanned, finishing what C6 counted and C10 started. All thirteen names left in `UNWIRED` were run standalone. Ten passed untouched and are registered. Three did not, and none of the three could have been noticed while it sat on a backlog list: `room-scene-patterns` threw ENOENT after **74 passing checks** on `data/art/out/scene-basket-audit.json`, a generated input under a gitignored directory — under the runner that is NOT RUN, and its builder needs nothing but tracked files and a fifth of a second, so the test builds it as `geometric-room-briefs-test.mjs` already does for its own input, and 110 further checks appear. `task-catalog-status` had been red since `9d92b5ef` against a **literal that went stale when the code got better**: it matched `'Task lookup failed:'` while `QuickSwitchBar` now names which catalog failed, `${languageLabel} task lookup failed: ${catalog.error}`. Its own name says "distinguishes failed lookup from loading", which is a property the change made *more* true, so the test was the stale half — it asserts the property now, plus that the reason reaches the player, which the version it replaces never required. `map-keyboard` used bare `node:assert` and one summary line, so it printed no OK or FAIL and the runner rightly called it "asserted nothing"; it has eight named checks and a floor.
  And separately the finding Lane L reported in passing, confirmed: **`test:crossing-build-list` ran 1 check instead of 21 on `main`** and the run still ended `all passed`. Its skip branch was announced, which reads as careful, and it exited *before* the `MIN_EXPECTED` floor at the foot of the same file — the one guard written against a collapsed denominator was the one thing the collapse stepped over, and a skip printed inside a suite is invisible to a runner that counts OK and FAIL lines. Nothing environmental was missing: the briefs builder reads tracked inputs and takes 1.7 seconds. It builds them rather than skipping.
  verify: `node tools/run-tests.mjs` on a worktree with `data/art/out` and `data/world/out` deleted → `131 passed, 0 failed, 0 not run | 3814 checks across 131 suites`, `all passed`, against a baseline of `118 … 3569`. `test:crossing-build-list` goes 1 → 21 checks; the thirteen contribute 238 more; `test:needs-env` drops 17 → 4 listed entries because thirteen backlog lines became suites, and exits 0 with `UNWIRED` empty for the first time since C6 counted 21 of them.
  sabotage: each repaired check separately, and each had to go red *only* where named. Strip `${catalog.error}` from the QuickSwitchBar message → `FAIL and a failed lookup names the source and carries its reason` while the sibling check stays green (md5 `0eed5c04dc1f` either side). Flip `direction === 'right' ? dx` to `-dx` → `FAIL right moves east` (md5 `2142372820e1`). Make the audit builder exit before writing → `FAIL the generated scene-basket audit is available` (md5 `54751699bc84`). Delete the 62 MB briefs → 21 checks, not 1. **The first map-keyboard sabotage did not go red**, because the `'right'` it changed was the one in the `MapDirection` type alias, which `--experimental-strip-types` erases before anything runs — trap 15, and it was the sabotage failing rather than any reading of the code that said so.
  pitfalls: `portrait-art` and `room-scene-patterns` read files `rewrite/remove-2d` proposes to delete (§3's matrix, C7 undecided). Registering a passing test does not touch them, but that branch now owns updating two more suites, and it should rather than have them sit unregistered. The 62 MB briefs and the audit are both gitignored, so **the order suites run in used to decide how many checks the run performed** — that is gone: each suite that needs a generated input now builds it, so no suite's denominator depends on which one went first. And both builders `room-scene-patterns` invokes also rewrite *tracked* files as a side effect, so those bytes are snapshotted and put back: registering a suite that leaves three modified files behind on every full run would hand every lane a dirty tree to explain, and worse, would silently regenerate a committed file that had drifted — repairing the exact disagreement the coverage checks exist to report. `coverage` is read before the build, so the comparison is still committed-against-freshly-derived. `git status` is empty after the suite; it was not before.

- [x] **I3  `src/components/shared`** (≈25)  · **I4  `room`** · **I5  `layout`** · **I6  `game`** · **I7  `dashboard`** · **I8  `first-run`** · **I9  `config`** · **I10  `MapWindow.tsx` + `PanelWindow.tsx`** (≈15 each)
  commit: (this PR) verified: 2026-09-05 minutes: 150
  touches: (that directory), src/index.css, I1>tools/color-token-allowlist.json, I1>tools/color-token-test.mjs
  depends-on: I1
  do: replace literals with tokens from `src/index.css`; a missing token is added there once; remove the allowlist lines; `remaining` drops by the count fixed and never rises.
  verify: `node tools/color-token-test.mjs` prints the lower `remaining`.
  note: eight IDs share one checkbox, so the marker only moved when all eight were done. `remaining` went 52 → 49 → 30 → 27 across three PRs and never rose. **I7, I8 and I10 were already clean the day I1 landed** — `dashboard` (8 files), `first-run` (6) and the two root components hold no literal at all, and the walk demonstrably reaches them because it reports 117 files and finds literals in six of the others. Of the 25 real fixes, three (I5, I6, and one in shared) were not colours at all but PR numbers and a measured value inside *comments*, which the scanner read as hex because every digit 0-9 is a hex digit; the scanner strips comments now. **The 27 that remain are permanent and documented**, which is the finding this lane ends on rather than a shortfall: 24 are pigments in `RoomBackdrop`'s generated landscape, whose whole purpose is that a forest does not look like a bank, and 3 are the *game client's* colour vocabulary in `config` — a default highlight colour and two placeholder examples, all read by a Ruby script that cannot resolve a CSS variable.
  pitfalls: `CombatRadar`'s eleven were shadows, highlights and washes — black and white at an alpha, which no `--color-*` token is the right shape for and which four new tokens would only have duplicated. They moved to named classes in `index.css` beside `.game-icon-button`, which already writes exactly this vocabulary exactly this way; every computed style was checked in the running app to be byte-identical afterwards. The one appearance change made on purpose is `MindstateBoard`, which was Tailwind's raw violet-through-red ramp.

- [x] **I11  Delete the allowlist** (≈5)
  commit: (this PR) verified: 2026-09-05 minutes: 30
  touches: I1>tools/color-token-test.mjs, I1>tools/color-token-allowlist.json
  depends-on: I3, I4, I5, I6, I7, I8, I9, I10
  do: the test is strict; close #176 and #179 linking it.
  verify: `remaining: 0` and the allowlist file is gone.
  note: **the file is kept, and the increment's own instruction was the wrong ending.** `remaining: 0` is not reachable and should not be: 27 of the original 52 are a generated landscape's pigments and the game client's own colour words, and a test that refused every literal would be wrong about a picture of a forest. Deleting the file would delete the 27 explanations with it and leave the next person to rediscover each one. So the strictness lands on the list instead — **an entry without a `why` is now a failure**, which turns it from a grandfathering backlog into a register of documented exceptions and prices a new exception at one sentence. The test reports the two counts separately (`of those, N are documented permanent exceptions and M still owe a token`), because adding them gives a figure that never reaches zero and that nobody can act on. `--write` used to rebuild the file from scratch and would silently have erased all 27 notes; it carries them across now and warns on any it could not match.
  verify (as done): `of those, 27 are documented permanent exceptions and 0 still owe a token`, all passed, 63 checks.
  sabotage: remove one `why` → `FAIL … has no \`why\``, and the split line correctly re-reads it as `1 still owe a token`; shorten a `why` to seven characters → `FAIL … is not an explanation; the floor is 40`; put a colour back into `RoomScene` as code → `FAIL … new raw colour #1d2229`. Each fired on its own check and nothing else, control green either side, `md5` `7fd30a5b6acb` / `f1d66508eff7` restored.

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

- [x] **K1  Design note, no code** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 25
  touches: docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: C7
  do: add §11 "Appearance": the three pieces above; the id vocabulary is the registry's `selections[].id`; defaults are compiled by a tool from a noun→class table; overrides live in the client under `drc.appearance.v1`; the snapshot compiler attaches `appearance: {modelId, glyph?}` to `EntitySnapshot` and to `player`; Godot maps `modelId` → GLB through the registry and falls back to the class default, never to an invented mesh (the registry's own `forbiddenSubstitutions` rule).
  verify: the section exists and names the four owners it extends.

- [x] **K2  Defaults compiler** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 55
  touches: new:tools/build-appearance-defaults.mjs, new:src/data/appearanceDefaults.json, package.json, tools/test-suites.json, src/lib/armorLoadout.ts
  depends-on: K1
  do: input: a noun table (`sword, broadsword, bastard sword → 'Large Edged'`, …) keyed to `SKILLS_BY_SET.Weapon` (`grep -rn SKILLS_BY_SET src/`) excluding meta-skills (Parry, Offhand, Mastery, Expertise); armor classes from `armorLoadout.ts`'s coverage helpers; each class → a registry `id` that exists in `shared_asset_selections.json` (assert, do not trust). `--check` compares to the committed JSON.
  verify: `node tools/build-appearance-defaults.mjs --check` exit 0; an unknown noun maps to `null`, never a guess.
  sabotage: point a class at an id not in the registry → red naming it.

- [x] **K3  Snapshot carries appearance** (≈25)
  commit: (this PR) verified: 2026-09-05 minutes: 60
  touches: src/lib/presentationBridge.ts, new:src/lib/appearance.ts, tools/presentation-bridge-test.mjs, src/lib/presentationTypes.ts, src/lib/usePresentationBridgePublisher.ts, tools/build-appearance-defaults.mjs, src/data/appearanceDefaults.json, tools/build-player-data-doc.mjs, docs/PLAYER_DATA.md
  depends-on: K2, C4
  do: `appearance.ts`: `appearanceFor(kind, name)` = override (`readJSON('drc.appearance.v1')`) ?? default ?? null; `setOverride`, `resetOverride`. `compileWorldSnapshot` attaches `appearance` to each entity and to `player` (wielded items from `CharacterStatus` — `grep -n "wield\|worn\|armor" src/types/index.ts`). Rust passes entities through opaquely already; `player` is `Option<Value>` — nothing to change there.
  verify: presentation-bridge test: a fixture with a bastard sword → `appearance.modelId` equals the Large Edged default; an override wins; unknown → absent field, not null-string.

- [x] **K4  Godot maps `modelId`** (≈Codex; contract only here)
  commit: (this PR) verified: 2026-09-05 minutes: 15
  touches: docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: K3
  do: §11 states the field, the fallback order, and the test Godot must add (`entity_projection_test.gd`: unknown id → class default; missing field → neutral token). File the content task in the ledger for Codex.
  verify: claim filed; §11 names the test.

- [x] **K5  Override export / import / merge** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 35
  touches: K3>src/lib/appearance.ts, new:tools/appearance-test.mjs, package.json, tools/test-suites.json
  depends-on: K3
  do: one JSON `{version, overrides:{...}, provenance:'player'}`; import merges with the local player's own choices always winning; conflicts returned as a list, never silently overwritten; unknown ids ignored with a count.
  verify: tests per rule.
  sabotage: let import overwrite → red.

- [!] **K6  Picker UI** (≈40)
  blocked-on: the asset registry admits no item meshes, so the picker has nothing to offer
  touches: new:src/components/shared/AppearancePicker.tsx, src/components/dashboard/DashboardLayout.tsx
  depends-on: K5
  note: K1–K5 are `[x]`, so nothing in Lane K blocks this. `godot/assets/shared_asset_selections.json` holds two ids and both are scenery, so `do:`'s "grid of registry entries for its class" would today be a grid offering a rock and a footbridge as alternatives to a sword — a UI that can only be exercised by making exactly the substitution `admission.forbiddenSubstitutions` forbids, and whose `verify:` (set, reload, still set) would pass while demonstrating the wrong behaviour. `knownModelIds()` and `appearanceClasses()` in `src/lib/appearance.ts` are what it will read; unblock it when the registry admits its first item mesh. Codex's side is filed as `.agents/claims/k4-godot-appearance-mapping.json`.
  do: from the inventory list, click an item → grid of registry entries for its class (thumbnails from the registry if it has them, labelled squares if not); one click sets, one resets; shows "default (from Large Edged)" vs "your choice".
  verify: browser: set, reload, still set; reset → default.

---

### Lane L — Codex contract for the Crossing slice

- [x] **L1  Name what I own** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 20
  touches: docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: B3
  do: §2 lists: snapshot/event/intent shapes and their tests; the mock fixture generator; `tools/live-chain-check.mjs`; the acceptance checklist (L4). Codex owns every `.tscn`, content `.gd`, GLB and material.
  verify: the list is in §2.

- [x] **L2  Mock fixture becomes a derived artefact** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 40
  note: the source is `data/world/out/1-primitive-world.json`, not the registry file the increment named — the registry is an input to it and carries assets, not cells. The fixture's original cell order matched no property of the data, so the generator states an order (focused room first, then room number) and the committed file was regenerated into it; content is byte-identical per cell.
  touches: new:tools/build-godot-mock-fixture.mjs, godot/mock/crossing_mock_world.json, package.json
  depends-on: L1
  do: `git grep -n crossing_mock_world tools/` — if no generator exists (none did on 5 Sep), write one extracting Town Green North + depth 2 from the primitive world manifest that `tools/build-primitive-world-manifest.mjs` writes (`data/world/out/crossing-primitive-registry.json` and its siblings — read that tool's `outputDir`). `--check` compares to the committed fixture.
  verify: `node tools/build-godot-mock-fixture.mjs --check` exit 0.

- [x] **L3  Data contract tests** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 35
  touches: new:tools/godot-fixture-contract-test.mjs, package.json, tools/test-suites.json, docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: L2
  do: every exit resolves to a cell or is `targetCellId:null`; no cell has two exits with the same `move`; the current room is in `cells`. §9 maps each requirement to a test name on both sides (`godot/tests/foundation_test.gd` already exists).
  verify: suite green in the full run.

- [x] **L4  Slice acceptance checklist** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 15
  touches: docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: L1
  do: §9: Town Green North renders; every real exit clickable; click → `intent_accepted` → confirmed room change → token moves; a fabricated exit is refused; a stun flips `cannotAct` and the scene reacts; an assessed creature's confidence visibly ages. Each line has a "recorded in docs/verification/… on <date>" slot.
  verify: six lines with empty slots.

- [x] **L5  Record the slice** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 90
  note: two of the six lines are recorded (1 and 4); four are written into `docs/verification/crossing-slice-2026-09-05.md` as unproven with what was tried, per L4's own rule. Lines 3, 5 and 6 need a live character, which `tools/fake-lich.mjs` cannot be. Line 2 needs a person to click once: a synthesised click did move the mock room, so the binding is not dead, but the rig could not say which button it pressed.
  touches: none
  depends-on: L4, B4
  do: run L4 live against Codex's current content; fill the slots; file gaps as ledger tasks for the content side.
  verify: slots filled or gaps filed.

- [!] **L6  Playable-slice gate** (≈5)
  blocked-on: four of the six §9 slots are still empty. Lines 3, 5 and 6 need a live DragonRealms character; line 2 needs one human click on an exit button in the viewer. None is a code change, and no fixture on this machine can substitute.
  touches: none
  depends-on: L5
  do: all six L4 lines recorded. Gate 3's content half.
  verify: no empty slot.

- [x] **L7  The board overlapped itself, so the exits had no edge to sit on** (≈70)
  commit: (this PR) verified: 2026-09-05 minutes: 70
  touches: src/lib/isometric-board-layout.mjs, tools/build-primitive-world-manifest.mjs, godot/scripts/content_registry.gd, godot/scripts/exit_anchor_layer.gd, tools/primitive-world-manifest-test.mjs, tools/presentation-bridge-test.mjs
  depends-on: B3
  do: unplanned, from Dan playing the viewer — "the exits are sometimes hard to find… you should put a little bit of a gap between each block, good idea anyways actually, prevents clipping", then "some kind of shape randomly on the edge for directions… the 8 cardinal and sub cardinal… but not on the block itself, it won't be readable. it should be on the edge actually." Measuring the manifest found the cause was worse than a missing gap. Room positions were map units × 0.25, which put the **median** nearest neighbour 2.5 m away and the closest at 2.0 m, while every room drew a block 4.4–5 m wide: blocks overlapped by roughly their own width everywhere, and an exit anchor at the block edge landed inside the neighbour's geometry. Three numbers described one dimension and none derived from another — the manifest said 5, the selection box 4.5, Godot drew a hardcoded 4.5. Now `CELL_PITCH_METRES`, `CELL_GAP_METRES` and `CELL_BLOCK_METRES` are one source, Godot draws the published footprint, and the scale is 0.625 — derived rather than picked: 8 map units is the smallest gap the data contains, so `8 × scale ≥ block + gutter`. Exit markers became flat chevrons lying in the gutter and pointing out of the room, instead of upright cylinders standing on the block: at a fixed isometric camera a standing post is seen nearly end-on and hides behind room content, while a floor marking keeps its area toward the camera and can carry direction.
  verify: minimum same-storey spacing 5.00 m against a 4.4 m block — a 0.60 m gutter everywhere; `npm run test:godot` 11 of 11, 131 checks; full suite `all passed`, 117 suites, 3563 checks.
  sabotage: put the scale back to 0.25 → `FAIL blocks touch or overlap: closest neighbours are 2.00m apart but blocks are 4.4m wide`; restored, md5 `5938abc03a96` either side.
  pitfalls: two rooms (Paladins' Guild `1-804`/`1-866` and `1-805`/`1-867`) share exact map coordinates and overlap at any scale. That is a map-data defect rather than a layout one, so the check names both pairs as NOT CHECKED instead of folding them into a failure it cannot fix. **Not verified on screen**: the Godot window is GPU-composited and would not screenshot for Lane B either, so this geometry is proved by measurement and by the tests, and the look still wants Dan's eye.

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

- [x] **C8  Fold the PDF's normative content into the architecture doc** (≈40)
  commit: (this PR) verified: 2026-09-05 minutes: 40
  touches: C1>docs/LOCAL_AI_BACKGROUND_WORKER.md
  depends-on: C1
  do: append as normative sections, rewritten in that document's voice and citing the PDF by date: the §28 claim schema, §29 tool rules, §33 tether validator, §36 suggestion gate, §37 classification table, and the §41 attack matrix as "required adversarial tests" beside §14's acceptance criteria. Reconcile the job table with A12's outcome. Do not paste the PDF; do not commit it. After this, the PDF has no content the repo lacks.
  verify: `grep -c "privacy" docs/LOCAL_AI_BACKGROUND_WORKER.md` ≥ 3; `grep -c "validateTetherCandidate\|invented destination" docs/LOCAL_AI_BACKGROUND_WORKER.md` ≥ 1; the doc's §6 table equals `ALLOWED` in `aiJobStore.ts` (a test in `tools/ai-job-store-test.mjs` reads both and compares — write it).
  sabotage: change one row of the doc table → the comparison test red.

- [x] **C9  The suite survives being run by several lanes at once** (≈35)
  commit: (this PR) verified: 2026-09-05 minutes: 40
  touches: new:tools/free-port.mjs, tools/link-test.mjs, tools/live-bridge-test.mjs, tools/cdp-timeout-test.mjs
  depends-on: none
  do: unplanned, and found by `main` going red under four concurrent lanes. Three registered suites bound a hardcoded port - `test:link` on 11731, `test:live` on 7894, `test:cdp-timeout` on 9934 and 9935. Each constant had been chosen with care to dodge a known occupant, and none of them could dodge the occupant that actually turns up now: a second copy of the same suite, because several sessions run `node tools/run-tests.mjs` on one machine. `tools/free-port.mjs` asks the OS for a port instead, and `freePortWithRetry` tries another when a fixture does not come up, so the microsecond race between probing and binding cannot flake a run. The other half of the red run was `needs-env.mjs` still marking `test:live-chain` as pending after Lane B landed it. I fixed that too and Lane E/F fixed it first, in #295; on rebase their version won and mine vanished, which is the right outcome and worth recording rather than quietly dropping. Two lanes finding one stale marker within an hour is the check working, not duplicated effort.
  verify: each of the four suites green alone; then two copies of `test:link` at once - different ports (measured 59556 and 59557), both `all passed`.
  sabotage: hand the retry helper one fixed port three times over, same fixture, only the port source changed - the second concurrent run fails with `FAIL the fixture is listening`, exit 1. Restored, md5 `971a167994cc` before and after, and the pair passes again.
  pitfalls: the first attempt at that sabotage returned exit 127 from a mis-nested subshell, which is a broken harness rather than a collision (trap 15). It was redone until the failure was the one being claimed.
