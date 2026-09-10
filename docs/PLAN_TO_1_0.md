# DR Companion — the working plan to 1.0

> **3D is cancelled ([NO-3D.md](NO-3D.md)). Godot is not.** Godot stays and is
> expanding: world and route presentation live there, rendered as **2D
> isometric sprite art**. The map panel is gone and cancelling 3D did not
> revive it; the room-graph data under `src/data/map` and `src/data/world` is
> retained so Godot can consume it. Do not propose, scaffold or restore a 3D
> viewer, a model library, meshes or rigging — and do not read this as a reason
> to move functionality back into the React wrapper.
>
> Increments that delivered 3D work are marked `[-]` **superseded** (§0.1).
> That marker keeps their history and their recorded minutes while asserting
> that the files they owned are now absent, so the audit checks the deletion
> instead of tripping over it. It replaced a header here that said the audit
> was red on purpose: that was true for one working day, and a plan whose own
> check is expected to fail is a plan on which nobody runs the check.
>
> Lane T (backend half of the 2D presentation) and Lane U (Godot as the MUD
> front end) are where the work went. §6 has both.

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
- [-] A3  superseded        ← next line: `  superseded: <date> — <why>, <the PR that removed it>`
```

**`[-]` superseded**, added 9 Sep 2026 when 3D was cancelled. It says: *this
increment will not be delivered in this form, and every file it would have
owned is absent.* Use it when the ground an increment stood on has been
removed — not when the work merely stalled, which is `[!]`.

- The `superseded:` line is required and must carry a date. `tools/plan-audit.mjs`
  refuses a `[-]` row without one, and refuses one on a row that is not `[-]`.
- Keep the `commit:` line if the work was actually delivered. Whether it shipped
  and was then deleted (K2, K3, K5) or was retired before it could be built
  (K6) is carried by whether that line is there, where a person reads it.
- Rewrite every `new:` path the increment owned to name the file that is now
  gone; the audit asserts `new:` and `gone:` paths are **absent** on a `[-]`
  row, and plain paths still have to exist, so the row goes on checking the
  survivors instead of quietly becoming an unchecked row.
- Nothing that is not itself settled may `depends-on:` a `[-]` increment. The
  audit fails it: work resting on a removed foundation has to be rewritten or
  superseded in turn, not picked up by whoever reads the lane next.
- A gate line may not name a `[-]` increment, and the audit fails that too.
  A gate member that can never become `[x]` is a permanent red mark on the
  status board rather than a condition. Supersede an increment, rewrite the
  gate in the same edit.

`[-]` used to mean "dropped" and was never used once, so nothing was rewritten
to make room for this.

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
9. **`cargo fmt` before pushing Rust.** `npm run gate` runs
   `cargo fmt --check`; nothing else does.
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
21. **There is no CI. `npm run gate` on your own machine is the gate.**
    Actions was disabled for this repository on 6 September 2026 (minutes were
    at 1,903 of 2,000 for the month, $127.80 of it this repository) and every
    workflow in `.github/workflows/` was deleted. Nothing off this machine
    builds, tests or verifies anything, and `gh pr checks <n>` now reports no
    checks at all — which reads exactly like a repository whose checks have
    not started yet. A PR with no red rows is not a PR that passed.

    ```bash
    gh api repos/dancockrell/dr-companion/actions/permissions   # enabled: false
    git ls-tree origin/main .github/workflows                   # empty
    git ls-tree origin/main .github/                            # control: still there
    ```

    `main` also has no branch protection and no rulesets
    (`gh api repos/dancockrell/dr-companion/branches/main/protection` → 404,
    `.../rulesets` → `[]`), so `gh pr merge --auto` merges on the spot and
    always did. That used to be a race against a job that would have caught
    you; now there is no job. **Run `npm run gate`, read its last line, and
    only then merge.** It prints its own denominator (`7 of 7 stages ran`) and
    refuses to call a stage it could not run a pass, so a partial verification
    cannot read as a whole one. The seven are `tsc`, `lint`, `test:all`, `cargo
    fmt`, `clippy`, `cargo test`, and `node tools/godot-tests.mjs`.

    The Godot scripts were the one thing the gate shipped without, and they
    landed there on 6 September 2026 — measured at 14 scripts, 274 checks. The
    stage obeys the machine rule mechanically rather than by promise: headless,
    one script at a time, and a count of running Godot processes taken *before*
    it starts, so a machine already carrying two engines gets NOT RUN naming the
    count instead of a third. A missing engine is a separate NOT RUN naming the
    paths searched and `GODOT4`; both exit non-zero, and both are reachable on
    purpose through `DRC_GATE_GODOT` and `DRC_GATE_GODOT_RUNNING`.

    Still not covered, and nothing else covers it either: `npm run tauri:build`,
    a 217 MB installer build that belongs to release work (`docs/RELEASE.md`).
    The gate names it in its own summary every run rather than letting its
    absence go unnoticed.
22. **This tree checks out CRLF, so a multi-line fragment built with `\n`
    matches nothing.** It bites hardest in the tools that edit tracked files
    on purpose — a sabotage harness, a codemod — because it fails silently in
    the worst direction: the fragment is not found, the replacement changes
    nothing, the file is rewritten identical, the guard stays green, and the
    output reads exactly like proof that the guard caught something. Hit while
    writing `tools/bridge-client-null-target-break-check.mjs`, and caught only
    because that harness aborts on a fragment it cannot find rather than
    falling through. Detect the ending from the file itself
    (`text.includes('\r\n') ? '\r\n' : '\n'`), join your lines with it, and
    make "fragment not found" a hard abort. A single-line `includes` is
    unaffected, which is why this stays invisible until the day you need two.

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
npm run gate > /tmp/gate.log 2>&1; echo "gate exit: $?"; tail -12 /tmp/gate.log
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

Then merge. Everything from here — the squash merge, deleting the remote
branch when the local step declines to, and verifying the change by content
rather than by SHA — is **[`docs/MERGING.md`](MERGING.md)**, which is its only
copy. There are no checks to wait for (trap 21): `gh pr checks <n>` reports
none, and that is indistinguishable from checks that have not started. The
green `npm run gate` above is the whole gate.

Redirect to a file and read `$?` rather than piping: a pipe reports the last
command's status, so `npm run gate | tail` is always a success.

---

## 3. Lanes, dependencies, conflict matrix

**Merging is [`docs/MERGING.md`](MERGING.md).** One page: worktree, `npm run
gate`, rebase, push, `gh pr create`, `gh pr merge --squash --delete-branch`,
deleting the remote branch by API when the local step declines, and verifying
by content. It is not repeated here — two documents describing one procedure
disagree eventually, and then both are wrong.

| Lane | Theme | Primary files | Hard depends-on |
|---|---|---|---|
| **C** | Merge and repo hygiene | PR #285, PR #276, `package.json`, `docs/ENGINE.md`, `presentationBridge.ts` split, `tools/plan-audit.mjs` | none |
| **A** | AI host repair | `src/lib/ai*.ts`, `AiWorkerPanel.tsx`, one line in `App.tsx` | C1 |
| **B** | Prove the live chain | `viewer.rs`, `world_root.gd`, `tools/live-chain-check.mjs`, `docs/verification/` | none |
| **D** | Layout toward the approved mockup | `App.tsx`, `columns.ts`, `layout.ts`, `MapWindow.tsx`, `panelDataContracts.ts` | D0 decided, A1 |
| **E** | First run and setup | `first-run/*`, `lich.rs`, Settings Bridge section, `docs/verification/` | none |
| **F** | Release engineering | `docs/RELEASE.md`, `tools/build-release-config.mjs`, `tools/verify-release-bundle.mjs`, versions, About/licences | none |
| **G** | AI slices 5–7 | new `aiEvidenceStore.ts`, `aiKnowledgeTools.ts`, `aiClaimStore.ts`, `aiJobProducers.ts`, `aiSuggestions.ts` | Lane A complete |
| **H** | Local model provider | new `aiLocalProvider.ts`, Settings AI section | A2 |
| **I** | Design tokens (#176, #179) | `src/components/**`, `src/index.css`, new `tools/color-token-test.mjs` | none |
| **J** | Map audit (#175) | per finding | D5 |
| ~~**K**~~ | ~~Appearance~~ — **superseded 9 Sep 2026**, 3D cancelled; see Lane K's heading | — | — |
| **L** | Codex contract for the Crossing slice — **mostly superseded 9 Sep 2026**; L2, L3, L8 survive | `godot/mock/*`, contract tests in `tools/` | B3 |
| **T** | Godot 2D isometric presentation, backend half | `presentationTypes.ts`, `presentationBridge.ts`, `isometric-board-layout.mjs`, `presentation_bridge.rs`, new `docs/WORLD_MANIFEST_2D.md` + contract tests in `tools/` | none (T0 first) |
| **U** | Godot as the MUD front end | `panelDataContracts.ts`, `presentationTypes.ts`, `presentationBridge.ts`, `usePresentationBridgePublisher.ts` | T3, then U1 |
| **V** | Backend continuation and repo hygiene | per increment; `break-check-tree.mjs`, `credentials.rs`, `lich.rs`, `doc-claims-test.mjs`, `docs/MERGING.md` | none |
| **N** | Lich-native login and frontend (no Genie) | new `src-tauri/src/eaccess.rs`, new `src-tauri/src/sal.rs`, `lich.rs`, `LichLauncher.tsx`, `WaitingForCharacter.tsx`, `tools/build-privacy-doc.mjs` | none |
| **Q** | Player config: the client's own macros, aliases, highlights, substitutes, gags, variables, presets | new `src/lib/playerConfig.ts`, new `src/lib/playerConfigImport.ts`, new `src/lib/lineRules.ts`, new `src/components/config/`, `useHighlights.ts`, `useAliases.ts`, `keybindings.ts`, `useGameLines.ts` | N6 |
| **R** | The nine activity intents (from [GAP-2026-09-09.md](GAP-2026-09-09.md)) | `lich-scripts/companion_bridge.lic`, `src/bridge/mockBridge.ts`, `docs/BRIDGE_CONTRACT.md`, new `tools/activity-intent-contract-test.mjs` | none (R0 first) |
| **W** | The facts a fighting player reads back — stance, containers, prep, encumbrance, roster, rezz | `src/types/index.ts`, `lich-scripts/companion_bridge.lic`, `src/lib/gameStream.ts`, new `roomRoster.ts` + `spellCycle.ts` | none (W0 first) |
| **X** | The town loop — money, shops, repair, banking | new `src/lib/townLoop.ts`, new `WealthPanel.tsx`, `lich-scripts/companion_bridge.lic` | none (X0 first) |
| **Y** | Tasks and bounties | new `docs/BOUNTIES.md`, new `src/lib/tasks.ts`, new `TaskPanel.tsx` | none (Y0 is research) |
| **Z** | dr-scripts settings as forms | new `src/lib/drScriptsSchema.ts` + `drScriptsWrite.ts`, new `config/DrScriptsTab.tsx`, `lich-scripts/companion_bridge.lic` | none (Z0 first) |

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
| `src-tauri/src/lich.rs` | N3 | N3 replaces `launch_args`. N6 is `[x]` (it renamed `genie_status` to `frontend_conflict_status` and rewrote the note). Nobody outside Lane N edits it while N3 is `[~]`. |
| `src/components/shared/LichLauncher.tsx`, `WaitingForCharacter.tsx` | D2–D6 | N5 rewrote both and N6 swept what was left; both are `[x]`, so Lane D's hold on these is released. |
| `tools/build-privacy-doc.mjs`, `docs/PRIVACY.md` | N2 | N2 alone. The generated doc is never hand-edited; change the generator. |
| `src/lib/playerConfig.ts` | Q1, then Q2/Q3/Q4/Q5/Q6 | Q1 writes it and publishes the schema; nobody else touches it until Q1 is `[x]`. After that each editor increment adds only its own domain's defaults, never a second store. |
| `src/lib/highlights.ts`, `useHighlights.ts` | Q2 | Q2 alone. `paint()` keeps its signature; only the source changes. |
| `src/lib/aliases.ts`, `useAliases.ts`, `keybindings.ts` | Q3 | Q3 alone. `resolveKeybinding` gains one case and one optional argument; Lane D and Lane E do not edit these. |
| `src/lib/useGameLines.ts` | Q4 | Q4 alone, and it is the *only* place substitutes and gags may be applied: `tools/gamelines-test.mjs` already fails the build if a component reads the buffer another way. |
| `src/lib/pinsFile.ts`, `genieConfigWrite.ts`, `src-tauri/src/config_import.rs` | Q5 | Q5 alone. It deletes the Genie write path; Lane J must not add a caller to it in the meantime. |
| `lich-scripts/companion_bridge.lic` | R0–R7, W1–W6, X1–X3, Y1, Z0, Z1 | One dispatch table, 3,351 lines. **Only one increment touching it may be `[~]` at a time, across all five lanes.** Check section 3.1 before claiming; see section 6b. |
| `src/types/index.ts` (`CharacterStatus`) | W0, then W1–W6, X0, Y1 | W0 adds every new field in one edit and publishes it. Nobody else edits `CharacterStatus` until W0 is `[x]`. |
| `src/lib/layout.ts`, `src/components/dashboard/panels.tsx` | X1, Y2 | Each appends one `PanelId` and one registry entry. Append, never reorder; rebase on conflict. |

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
| V | V2 (#505) | `fix/505-break-check-tree`, **never pushed** | `C:\Users\Admin\dev\wt-505` | 2026-09-09 |
| N | N3, N3b, N4 | `lane-n/n4-attach-measure-v2` | `dev/wt-n3` | 2026-09-06 |
| Q | Q2 | `lane-q/q2-highlights` | `C:\Users\Admin\dev\wt-q2` | 2026-09-06 |
| S | S1-S4 | `feat/scene-editor` | `C:\Users\Admin\dev\wt-scene` | 6 Sep 2026 |

**Lanes R, W, X, Y and Z are new on 9 September 2026, unheld, and are the
first player-facing work in this plan** — see section 6b and
[GAP-2026-09-09.md](GAP-2026-09-09.md). Take **R0** or **W0** first: they are
the two that publish an interface everything else in their lane waits on, and
they name disjoint files. X0, Y0 and Z0 can start beside them.

**Lanes T, U and V are unheld and free to claim** (added 9 Sep 2026). Take
T0 or T3 first — they name disjoint files and are the two that unblock the
rest. Lane K is superseded in full and Lane L is superseded except for L2,
L3 and L8; neither has work in it.

**The V row above is a real claim on a live worktree, not a placeholder.**
`C:\Users\Admin\dev\wt-505` holds another session's uncommitted 322-line
change to `tools/break-check-tree.mjs`; that session was killed by a usage
limit and never pushed. The row exists so nobody re-implements it and
nobody deletes the worktree. Read V2 before touching either.

N1 and N2 have merged (#441, #438). N7 is unheld and needs Dan rather than a
session. G's row was deleted on 6 Sep 2026 when G11's second
PR (#359) merged, and **Lane N's design row went the same day** when PR #432
merged — that row covered the design PR only, the one that wrote the lane into
this document and `docs/LICH_NATIVE_LOGIN.md` while implementing none of it.
An empty table means every lane is free to claim. Read
`docs/LICH_NATIVE_LOGIN.md` before claiming anything in Lane N, including its
§7 list of what is inferred rather than measured.

**N1 and N2 both landed on 6 Sep 2026 - N1 in PR #441, N2 in PR #438 - and
neither added a row here.** Both were one-increment, one-PR sessions, and a row
whose only job is to stop a second session claiming that increment has nothing
left to do the moment it is `[x]` (Lane H's precedent, above); added in the same
commit, it would have been stale the moment it arrived. Lane N is still unheld.

**Q4 landed the same way on 6 Sep 2026** (PR #468): one increment, one PR, one
session, so the row it would have added would have been deleted in the merge
that made it true. Q2, Q3 and Q5 were running concurrently in their own
worktrees and no two of them name the same source file, which is the property
a row exists to protect and which Lane Q's own concurrency note already states.
**N5 depends only on N1**, so a session can pick it up now and another can
follow on N6. N3 has merged (PR #440) and its lane still holds N4, the row
above; N8 is `[x]`, below. N1 published
`src-tauri/src/eaccess.rs` - read its header before N3 or N5, because it records
two corrections to the design document, one of them to the protocol itself.

**Q1 and Q5 landed on 6 Sep 2026 and added no row**, for the reason N1, N2
and N8 set below: one increment, one PR, and the `[x]` ships in the same commit, so a
row claiming it would have been stale the moment it arrived. Lane Q is
unheld. **Q5 is `[x]`**: it deleted the Genie write path and moved the pin
file into `app_data_dir()/config`, and `src-tauri/src/player_files.rs` plus
`src/lib/playerFiles.ts` are now the whole write surface — **Q6 writes through
them rather than adding a second writer.** **Q2, Q3 and Q4 can be claimed at
the same time**, in three
worktrees, as §6's concurrency note says: Q1 published `playerConfig.ts`
(schema, `migratePlayerConfig`, `setDomain`/`addEntry`/`updateEntry`/`removeEntry`,
`usePlayerConfig`, `mergeImported`), `playerConfigImport.ts`
(`importGenieConfig`, the five recovered parsers, `isGenieScript`) and
`PlayerConfigPanel.tsx`, whose per-domain placeholder line is the one shared
edit each of them makes. Read `docs/PLAYER_CONFIG.md` §10 first: it records
where Q1 landed differently from the design, including the two resolvers that
shipped early and why. **Q3 has since landed the aliases, variables
and macros tabs** and added no row to the table below, for the reason Lane H
and N1/N8 set out there: one increment, one PR, so a row claiming the lane
would have been stale in the same commit that added it. Q2, Q4 and Q5 stay
free to claim. Q3's own `landed:` line lists the five files it touched beyond
its `touches:`, including the two predicates that moved into
`playerConfig.ts`.

**N8 landed the same day and added no row either**, for the same reason: one increment, one PR, and its plan edit and its `[x]` are in the same commit, so a row would have been stale the moment it arrived. It settles §10's **N-b** — Dan answered *yes, opt-in, default off* — so `keyring` 4.2.0 is a `cfg(windows)` dependency, the "remember password on this computer" box exists (`src/components/shared/RememberPassword.tsx`) and defaults to off, and Gate 1 no longer carries a conditional on that decision. N5 merged first, with the box deliberately absent and a check asserting that absence; N8 mounted `RememberPasswordCheckbox` in its form and turned that check the other way up, so `SignIn.tsx` now offers the box, off, with the warning beside it. `src/lib/rememberPassword.ts` owns the default and the sentence; there is one of each. **That paragraph describes 6 September and is no longer the current position**: N10 reversed the default to on on 9 September at Dan's instruction, and renamed both files (`rememberSignIn.ts`, `RememberSignIn.tsx`) as the module grew to own everything a sign-in remembers. Left standing as the record of what N8 settled, with this sentence so nobody reads it as today.

Finished and released: **C** (C3–C8, PRs #291 and #296), **E/F** (E5–E8,
F2, F6, PRs #293 and #295; then C12 and F7 in PR #315, which emptied the
UNWIRED backlog C6 opened — that PR's *title* also names F8, but F8 was not
done there and stayed `[!]` until 5 Sep 2026), **I** (I1–I11, PRs #303 and
#300) and **L**
(L1–L5, PRs #305 and this one; L6 is `[!]`, blocked on four acceptance lines
that need a live character and one human click, neither of which is a code
change), and **K** (K1–K5, PRs #313 and this one; K6 is `[!]` on a content
gap, not a code one). Their rows are gone from the table above, which is what
finishing a lane looks like here, and **G** has just done it too (G0–G10 and
G12; PRs #317 and #327). **H** is nearly finished (H1–H4, H6, H7; PRs #316 and
#318, then H8, and H9 after it — the Ruby half of H8's E7 containment, which
was the suite's last honest skip), with **H5** left `[!]`: it needs a model runtime this
machine does not have and no numbers were invented for it. H8 was `[!]` on G6 until G6 landed in PR #317, and it is done in the PR that
carries this line. **H has no row in the table above on purpose**: it held one
while the work was open, and it is removed in the same commit rather than in a
follow-up, because the lane's only PR is this one and a row whose whole job is
to stop a second session claiming H8 has nothing left to do the moment H8 is
`[x]`. It also stopped this branch conflicting with every lane that closed its
own row while this was in review, which was four of them in one evening.

**Lane E is finished** (E1, E9, E11, E12 and F5 in PR #314; **E2, E3 and E10**
in the Lane E follow-up). The line that stood here said those last three were
blocked because `VBoxManage guestcontrol` never becomes ready on that VM. It
does. The earlier attempts were made at `GuestAdditionsRunLevel=2`, before
anyone had logged in, and the execution service is a run-level-3 facility; the
account password nobody had is in the VM's own unattended answer file, still on
disk. Waiting a minute after `startvm` and reading that file was the whole fix,
and all three increments then ran through guest control in one sitting.
`docs/verification/vm.md` carries the corrected method and
`docs/verification/first-run-2026-09-05.md` the walkthrough, the timings and
the two file inventories. Two defects outside the lane were filed rather than
worked around: #323 (`npm run tauri:build` cannot run in any worktree prepared
by `worktree:init`) and #324 (`run-tests` counts a suite's honest NOT CHECKED
as a pass).

**All five of E2/E10's defects are GONE on the machine, re-measured 6 Sep 2026**
against CI run 34013788861 and recorded in
`docs/verification/first-run-2026-09-06.md`. Every one of the five fixes (#384,
#386, #388, #389 with #396 and #405, #409) said in its own record that it was
proved by unit test and *not* re-measured on the VM, which is the gap this run
closes: the window is inside a 1024x768 display with "Check again" reachable, the
Ruby row explains the Lich-folder fork and the Lich row names the tree the
third-party installer chose, a fresh install opens on "Nothing is connected yet."
rather than on Dan the Bold, Settings -> Apps says `Dan Cockrell`, and the bottom
bar says nothing about music until Play and then `Music not installed` with no
Retry. The unticked uninstall is clean on the program half and takes all four
loopback bearer files with it (#354 holding). Three new defects were found on the
way and filed rather than fixed here: #417 (the clamp measures the client area,
so the window hangs 15 px into the taskbar), #418 (the empty state does not fit
the default window and does not scroll, so "Start the demo" is unreachable) and
#419 (a popped-out panel window renders blank white, which is why #409's compact
banner is the one thing this run could not check).

**Lane G is finished** (G0, G1, G2–G12; PRs #317, #322, the one that carried
this line, then #346 and #359). This paragraph has been corrected twice as G11
moved: it once said G11 was "deliberately not started", then that its second
half was held unmerged. Both halves are in as of 6 Sep 2026 — commit 1
(`efbc19ec`) the data model, the gate and its adversarial tests with no
producer and no UI; commit 2 (`129e222b`) the panel that makes a suggestion
confirmable and therefore sendable, merged on Dan's explicit yes per section 10
and gate 4. So a confirmed suggestion is now the one path by which model output
can become a real game command, and it is gated on the player retyping the
literal command. Nothing else in G0–G12 can reach `gameActions.ts`, no
model ships (`absentProvider` is still the only provider in `src/`), and the
only path from a candidate into canonical data is G9's promotion, which is
explicit, records the pin id it created, and reverts by that id. One
prediction in the plan turned out wrong and is left corrected rather than
quietly met: G10 says the callerless-command sweep would then list only
`extract_lich` and `bridge_install_status`. It lists a third,
`install_bundled_ruby`, which is outside this lane.

**K1–K5 are done** (PRs #313 and the Lane K follow-up). C7's open question
turned out not to gate any of them: appearance touches none of the six files
`rewrite/remove-2d` deletes, which one `git diff --stat` established.
**K6 is `[!]`** for a different and better reason than C7 — the registry admits
no item meshes, so a picker would have nothing to offer but scenery; see its
own `note:`. **L1** is free now that B3 is done. **G** is claimed and has
landed G0 and G2–G5 (PR #317), so the line that used to stand here saying it
waits on Lane A is stale and has gone.

**Lane D is finished.** D6 landed 9 Sep 2026 and deleted the map presentation,
window and panel both, which is wider than the `do:` it inherited — read D6's
own `scope:` line for why, and `docs/NO-3D.md` for the decision it rests on.
The room-graph data stays, for Godot.

Two things a later lane will want from it. Its `blocked-on` was released
rather than met, and says so in its own words: waiting for a real play session
was right while this was a layout question and stopped being right when it
became a deletion, because a play session cannot report on the absence of
something `MAP_WINDOW_ENABLED = false` had already made unreachable. And **J
never waited on D6** — an earlier version of this paragraph said it did and was
too strict; triage needed only that flag's value, which was measurable all
along. J1's `note:` records the measurement.

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
- **Gate 1 — Text client stands alone:** D0–D6, E5–E9, C4–C6, C8, A7–A12,
  N1–N7, Q1–Q6 (N8 too: Dan gave that yes on 6 Sep 2026 — §10's **N-b** — and N8 is `[x]`).
  Check: `grep -c "kind === 'map'" src/App.tsx` → `0`; kill-switch suite (E5)
  green; `npm run test:mud-client-e2e` and `npm run test:mud-client-e2e-break`
  green — one run that signs in, attaches to a stand-in Lich, plays, drops,
  reconnects and round-trips a configuration, with nothing in the play chain's
  import closure able to reach the viewer, a denominator on every step and its
  skips named
  (`docs/verification/mud-client-e2e-2026-09-09.md`); a full play session
  recorded with viewer and AI absent, **signed in from this app with no other
  game client installed or running**;
  `git grep -ic genie -- src/components src-tauri/src/lich.rs src/lib/frontends.ts`
  → `0`.

  The harness and the recording are both in that list on purpose, and neither
  replaces the other. A recording proves the session happened once and cannot
  notice the day a change breaks it; the harness runs on every commit and
  cannot reach the installer, a real account or a real Lich. The four things it
  reports NOT CHECKED are Rust, and each names the `cargo test` that settles
  it, which is the honest shape of "stands alone" from a suite that does not
  build the backend.

  Lane Q belongs in this gate for the same reason Lane N does, and it is the
  same sentence that puts it there. "Stands alone" is a claim about what the
  client needs beside it. After N6 a player who wants to change one highlight,
  bind one key, hide one line or name one shortcut has to open Genie, because
  this app has no editor for any of it and reads the rules it does honour out of
  a Genie install's `Config` folder (`useHighlights.ts`, `useAliases.ts`). A Gate
  1 that went GREEN on that would certify "plays all day without Genie" for a
  client that still needs Genie to be configured, which is the same false
  sentence N6's own PR body warned about when it wrote down what the sweep cost.
  Q5 is in the gate as well as the editors: it is what makes the app stop
  *writing* into a Genie install, and "stands alone" is a claim about both
  directions. Design: `docs/PLAYER_CONFIG.md`.

  Lane N belongs in this gate rather than in a new one, and the gate's own name
  is the argument. "Stands alone" is a claim about what the client needs beside
  it, and today it needs Genie — not for the game stream, which has been
  Lich-native since `--headless=11024` shipped, but for the account login, which
  the app cannot perform and Lich's own window cannot complete on this machine
  (`src-tauri/src/lich.rs:490-495`). Section 5's bar already says the same thing
  in item 3, "play all day without Genie", so a Gate 1 that went GREEN while the
  Genie instructions were still the only way in would be certifying a sentence
  that is not true. A separate gate would let that happen and would also put
  Lane N after Gate 7, which is where 1.0 is defined. Evidence and the design
  are in `docs/LICH_NATIVE_LOGIN.md`.
- **Gate 2 — First run:** E10–E12, F2–F4.
  Check: a never-used-Lich person reaches a playing session from the installer
  in under ten minutes on the clean VM, recorded in `docs/verification/`.
- **Gate 3 — Viewer optional:** B4–B8, L2, L3, T0–T5.
  Check: `node tools/live-chain-check.mjs` passes against the running app;
  the acceptance list in `docs/verification/godot-2d-acceptance.md` (T5) has
  no line that is neither recorded nor marked as needing a live character.

  Rewritten 9 Sep 2026. It named L1–L6, four of which are now superseded
  `[-]` — they were about a 3D Crossing slice and a handoff document that
  no longer exist, so the gate was waiting on increments that could
  never become `[x]` — a permanent red mark on the status board rather than
  a condition. `tools/plan-audit.mjs` now fails a gate line that names a
  superseded increment, so this cannot happen quietly again. L2 and L3 stay
  because the mock fixture and the data-contract tests are about the room
  graph and are as true of a 2D board; Lane T replaces the rest.

  "Optional" still means what it meant: the client plays without the
  viewer, and `test:viewer-absent` is what keeps that honest. Note the
  gate cannot go green on this side alone — `godot/project.godot` has no
  main scene, and authoring the 2D one is the Godot owner's work.
- **Gate 4 — AI optional:** G0–G10, G12, H1–H8 (G11 only with Dan's yes — given
  6 Sep 2026, and G11 merged on it).
  Check: no model → panel honest, client unchanged; local Qwen → one map claim
  and one script proposal reach review with provenance; scanner tests green.
- **Gate 5 — Public quality:** I1–I11, J complete, F5–F8.
  Check: token test strict (allowlist empty); #175/#176/#179 closed.
- **Gate 6 — Release:** F9–F12, F15–F17. Check: `npm run gate` green on the
  tagged commit, then a locally built `v1.0.0-beta.1` installer — its sha256
  recorded by hand, because nothing prints it for you any more — installs, runs
  and uninstalls on the clean VM, recorded. The release must carry **both**
  assets (`-setup.exe` and `latest.json`) and
  `npm run release:verify -- --expect-update-manifest` must be green on the
  build they came from; and F17 must have recorded one real update applied over
  a running install, because every other check in this gate runs against files
  in a directory on this machine.
- **Gate 7 — 1.0:** F13–F14; two consecutive beta weeks with no data-loss
  report; zero open ship-blockers; the seven bars of section 5 each recorded.

- **Gate 8 — The game is playable:** R0–R7, W0–W6, X0–X3, Y0–Y2, Z0–Z3.
  Added 9 September 2026 from [GAP-2026-09-09.md](GAP-2026-09-09.md), which
  measured 29 things a player does in an hour of DragonRealms against what this
  client does when they do them: 9 full, 13 partial, 7 absent.
  Check: `node tools/intent-drift-test.mjs` reports **34 of 35** implemented
  (`burgle` deferred, R8); `node tools/gap-survey-probe.mjs` shows no capability
  with a non-zero send column and three zeros beside it — the shape that
  finding was, a client that can type the command and cannot read the answer;
  and a recorded session in `docs/verification/` in which one character fights,
  tends, trains, travels, sells and turns in a task **without the player typing
  a command this app could have offered**.

  It is a separate gate rather than an extension of Gate 1 on purpose. Gate 1
  is "text client stands alone", which is a claim about what the client needs
  *beside* it — Genie, another frontend, a second window — and it is 34/35
  true. This gate is a claim about what the client can *do*, and folding the
  two together would have turned a nearly-green gate red and hidden the
  distinction between them. It also sits after Gate 7 in numbering and before
  it in nothing: the shortest honest path to a shippable product is unchanged,
  and this gate is what makes the shipped thing worth using rather than what
  makes it shippable.

  **This gate cannot go green from a fixture.** Every increment in it is about
  reading what a live DragonRealms character is doing, and N7 — a real sign-in,
  Dan's, still `[!]` — is upstream of the recording above.

**Shortest honest path to a shippable product:** Gates 0 → 1 → 2 → 6 → 7 with
the viewer and AI shipped disabled. Gates 3–5 can follow the first release, and
so can Gate 8 — but Gate 8 is the one a player would notice, so shipping before
it means shipping a client that is excellent at everything except playing.

---

## 5. The bar

A player who has never seen this repo can: (1) install from one Windows
installer with no terminal; (2) sign in from this app — it sends the account and
password to `eaccess.play.net`, to Simutronics and nowhere else, and stores the
password only if asked and only in Windows Credential Manager;
(3) play all day without Genie; (4) lose nothing
when anything breaks; (5) optionally open the viewer; (6) optionally use a
local model; (7) uninstall cleanly with scripts, settings and maps intact.

Item 2 used to read "sign in through Lich's own login — this app never touches
the password", which was written true and stopped being achievable: Lich's own
window cannot complete a sign-in on this machine
(`src-tauri/src/lich.rs:490-495`), so the only route that existed was the Genie
instructions in `WaitingForCharacter.tsx`, and Dan retired Genie on 6 Sep 2026.
Lane N replaces the promise with what will actually be true rather than leaving
a bar nothing can clear. The privacy claim it costs is real and is not softened
anywhere: `docs/PRIVACY.md`, `docs/ENGINE.md:33-37` and
`LichLauncher.tsx:304-307` all say the app never sees the password, and N2 and
N5 change every one of them.
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

- [x] **A7  Rust suite green in a fresh worktree** (≈10)
  done: 2026-09-05 minutes: 35 — `dev/wt-a7` off `origin/main` at `113ef294`, no
  build state of any kind: `src-tauri/target` absent, no `CARGO_TARGET_DIR`, no
  `.cargo/config.toml` at user or repo level. After `npm run worktree:init`
  (exit 0), `cargo test --lib` compiled 289 crates into a new 2.0 GB target
  directory and printed `test result: ok. 117 passed; 0 failed; 0 ignored;
  0 measured; 0 filtered out`, exit 0. The whole `cargo test` CI runs gives the
  same three lines it does: lib **117 passed**, `src/main.rs` 0, doc-tests 0,
  0 failed throughout; `cargo fmt --check` exit 0. CI's `tauri` job for this
  exact base commit (run 33973123694, job 101325042758) reports **117 passed**,
  and so does the previous green run on main (33972082431), so the equality
  `verify:` requires holds against a number that is not an artefact of one run.
  Sabotage, because a green suite that cannot go red proves nothing: deleting
  the `"mute"` arm of `vk_for` in `src-tauri/src/media_keys.rs` — the sabotage
  that module's own comment names — still compiled, so it reached the line
  (§1 trap 15), and gave `test result: FAILED. 116 passed; 1 failed`, exit 101,
  naming `every_documented_action_resolves_to_a_distinct_vk` and the real
  `unknown media action: mute`. Restored by `git checkout --`, with
  `git status --porcelain` empty (byte-identity with HEAD) and 117 green again.
  claim: `.agents/claims/a7-rust-suite-fresh-worktree.json`.
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
  do: Godot 4.3 (`grep -n "config/features" godot/project.godot`); `godot/project.godot` is the authority on the version and the zip is `Godot_v<version>-stable_win64.zip` from that release — download it by hand outside the repo, and check its sha512 against the release's own `SHA512-SUMS.txt`. (The release workflow used to name the zip and its sum; it was deleted 6 Sep 2026 with the rest of CI, so a grep for it now returns a silent zero.) `git submodule update --init --recursive`; `GODOT4=<path> npm run godot:export`.
  verify: `ls -la godot/build/DRCompanionWorldViewer.exe` → size > 1 MB.
  pitfalls: 8.

- [x] **B2  The app launches the viewer live** (≈25)
  commit: (this PR) verified: 2026-09-05 minutes: 55
  touches: src-tauri/src/viewer.rs, gone:godot/scripts/world_root.gd
  still true, 9 Sep 2026: the launch path is alive and is not superseded — `viewer.rs` still starts the engine with `--live-presentation`, and Godot is where world presentation is going. What went with `world_root.gd` is the scene it launched *into*, and `godot/project.godot` now has no `run/main_scene` until a 2D one is authored (the Godot owner's). `viewer.rs`'s cross-language check that Rust passes the flag the GDScript reads had `include_str!`'d the deleted file, so the whole Rust build failed to compile; it now scans `godot/scripts/*.gd` for the reader and prints what it searched, so it re-arms by itself when the 2D scene lands. `done-when:` is therefore not currently demonstrable end to end.
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

- [x] **B9  The outbound half: one command lane** (≈120)
  done: 2026-09-06 — Lane B rather than Lane G, and the argument is worth
  stating because neither is an obvious home. G is the AI lane; filing a
  transport-wide gate under it would imply the lane is about model output,
  which is exactly the wrong reading — G11's guards run *before* this and are
  untouched, and its single `requestGameAction` call site is asserted
  unchanged by two suites. Lane B is the only lane in this document about the
  live wire to the game rather than about a subsystem sitting on it. B1–B8
  proved the inbound half and the viewer's lifecycle; the outbound half —
  app → game — had never been proven at all, and `game_send` was a bare
  socket write with eight callers racing on it. Same chain, other direction.
  commit: (this PR) verified: 2026-09-06 minutes: 130 — Fixes #446
  touches: new:src-tauri/src/command_gate.rs, src-tauri/src/game_link.rs, src-tauri/src/pause.rs, src-tauri/src/script_api.rs, src-tauri/src/lib.rs, new:src/lib/commandLane.ts, src/lib/gameLink.ts, src/lib/gameActions.ts, src/lib/aiSuggestions.ts, src/lib/presentationIntents.ts, src/App.tsx, src/components/game/GameCommandBar.tsx, src/components/room/FloorItems.tsx, src/components/shared/CombatRadar.tsx, src/components/shared/InventoryPanel.tsx, src/components/shared/QuickQueuePanel.tsx, src/components/layout/SafetyFooter.tsx, new:tools/command-lane-test.mjs, new:tools/command-lane-break-check.mjs, tools/kill-switch-test.mjs, tools/ai-suggestions-test.mjs, tools/test-suites.json, tools/game-command-boundary-test.ts, tools/needs-env.mjs, package.json, docs/BRIDGE_CONTRACT.md, docs/PLAYER_DATA.md, docs/PRIVACY.md
  depends-on: none
  do: `command_gate.rs`. `LaneCore` is a pure scheduler — handed `now`, never reads a clock, never touches a socket — and `CommandGate` wraps it in a mutex, a condvar and the one thread that owns the wire. Every command carries `{text, source, submitted_at}`; `Source` is `player > ui-action > keybind > macro > ai-suggestion > script` with no default and an error on an unknown value (defaulting to `player` lets unlabelled automation jump the queue, defaulting to `script` puts a real player behind a walk loop — either guess breaks one of the two invariants). Ordering is `(priority, seq)`. Roundtime comes off the reader thread in `game_link.rs`, which sees every chunk first: `<roundTime|castTime value='<epoch>'/>` is an absolute epoch second (grounded in `python/drtask.py`, itself checked against Lich's `xmlparser.rb`), plus the `Roundtime: N sec.` / `...wait N` text forms as durations; the longer wins, and a hold only moves forward. `TYPEAHEAD_DEPTH` = 1 released into an active roundtime, reset by each new one. Movement coalescing: an identical compass command already queued **from the same source** drops the new one and counts it. `game_send` becomes the only entry and `write_command` the only writer, `pub(crate)`, called from the sender thread alone. Pause moves from `script_api::dispatch` into the lane and holds automation only — the same move `pause.rs` made out of `flowDriver.ts`, one layer further out; `script_api` waits on a ticket so a task still blocks rather than walking on believing it sent. Stop's outbound half is `game_lane_flush`, registered through `flowStop.ts`'s signal from a new `commandLane.ts` consumer. `game:lane` + `game_lane_status` report queue, hold and counters; `SafetyFooter` shows the queued count beside the RT badge, so a held command is a visible fact rather than a key press that appears to have done nothing.
  verify: `cargo test --lib` 174/0; `cargo test --lib command_gate` 15/0; `cargo clippy --all-targets -- -D warnings` and `cargo fmt -- --check` silent; `npx tsc -b` 0; `npm run lint` 0; `node tools/command-lane-test.mjs` → `all passed: 33/33` and `17 of 17 call sites name a source`; `node --experimental-test-module-mocks tools/kill-switch-test.mjs` → 52 checks, subscribers exactly `aiSuggestions.ts, commandLane.ts`; `node --experimental-strip-types tools/ai-suggestions-test.mjs` → `215 checked, 0 failed`; `node tools/run-tests.mjs` → `no failures`.
  sabotage: `node tools/command-lane-break-check.mjs` → `all passed: 17/17`. Six: remove the roundtime hold; invert `(priority, seq)`; make Stop flush the player; drop the source from the coalescing predicate; make Pause hold the player; read the roundtime tag as a duration. Each asserts the **exact** set of tests that reddens, not "at least one" — which earned its keep immediately: the first draft expected seven tests to fail on the roundtime sabotage and three did, because four of them merely *arrange* a hold to make a queue form and assert something the hold is not part of. The file is restored and verified by sha256, and a fragment that fails to match is a hard abort rather than a pass.
  done-when: nothing but the lane's sender thread writes to the game socket, and every caller in `src/` names a source. Both are asserted, with the call list printed and a floor under it.
  pitfalls: 4, 10, 14, 15, 22. `game_link.rs` is shared with lane N3/N4's attach work — keep to the send path.

- [x] **B10  Pause reaches travel: one Pause, every route** (≈70)
  done: 2026-09-06 — Fixes #462, and it is B9's own claim being corrected. B9 moved Pause into the outbound lane and `pause.rs` then said the lane was "the one place every automated command passes through". It is the one place every command *this process sends* passes through, which is not the same sentence: `map_walk` is a bridge intent, `companion_bridge.lic` answers it by starting Lich's `go2` as its own script, and every movement command of that route is emitted inside the Lich process. Pause held every typed, keybound, macro, AI and script command and did not hold the one control that walks a character across a zone — widened by #447, which turned the viewer's read-only `focus-room` into `travel-to-room` and routed it to the same intent.
  commit: (this PR) verified: 2026-09-06 minutes: 85
  touches: lich-scripts/companion_bridge.lic, new:lich-scripts/test/pause_test.rb, lich-scripts/test/map_walk_test.rb, src-tauri/src/pause.rs, new:src/lib/pauseStatus.ts, new:src/lib/bridgePauseRelay.ts, src/lib/presentationIntents.ts, src/main.tsx, src/App.tsx, src/components/layout/SafetyFooter.tsx, src/components/shared/CommandPalette.tsx, src/bridge/mockBridge.ts, src/types/index.ts, src/lib/versions.ts, new:tools/pause-reaches-travel-test.mjs, new:tools/pause-reaches-travel-break-check.mjs, tools/test-suites.json, package.json, docs/BRIDGE_CONTRACT.md
  depends-on: B9
  do: the bridge gains `@pause_requested` beside `@stop_requested`, set by `pause_all` **before** its `Script.running` snapshot and cleared only by `resume_all` — a snapshot holds what is already running and can say nothing about a script started afterwards, which is the whole defect. `PAUSE_HELD` names the three intents that start something autonomous (`map_walk`, `run_macro`, `start_script`) with the sentence each refuses with, and `pause_refusal(intent)` is what each consults. Suspension of a route already under way is `pause_all`'s existing `Script.pause`, which is genuinely enough: Lich enforces `@paused` inside `Script.current` (`lib/common/script.rb:1026`, `sleep 0.2 while script.paused?`), every movement call resolves the current script first, and go2 itself pauses and unpauses to hold mid-route (`go2.lic:2236-2237`). Resume therefore continues the route; Stop cancels it, because `Script.kill` matches by name whether or not the script is paused. The bridge reports `pauseLatched` on `status` (bridge 0.13.0) — and deliberately **not** on `hello`, which is followed immediately by a full status on the same socket, so a copy there would be a second answer to one question with no reader. The app reads that field and its own pause flag as **three** states — running, paused-confirmed, paused-unconfirmed — in `pauseStatus.ts`, because a bridge that predates the field has said nothing and must never read as confirmed. App-side, `requestIntent('pause')` moved out of both button handlers into `bridgePauseRelay.ts`, which subscribes to `flowStop`'s signal, so Pause has exactly one sender and a future caller cannot reach the lane while forgetting the bridge. **Corrected by #487 (bridge 0.14.0), and the correction is the ownership.** The app was treated as the owner of "paused" and the bridge as a confirmation of it, which is a decision the app cannot enforce: a `;unpause go2` typed at the Lich prompt walked the character under "Paused, bridge confirmed", and a latch that outlived an app restart read as "Running" with travel refused and no chip on screen. The bridge owns it. `pause_requested?` reconciles the latch against the scripts `pause_all` suspended rather than reporting a flag; `bridgePauseRelay.ts` adopts `status.pauseLatched` on connect, adopting a hold and never a release; and the reader is **four** states rather than three — the fourth, "Paused by Lich", is the cell that used to render nothing at all.
  verify: `node --experimental-test-module-mocks tools/pause-reaches-travel-test.mjs` → 51 checks, movers derived from the bridge's own `HANDLERS` (`run_macro, map_walk, install_mapdb, start_script`), `3 of 3` held with `install_mapdb` exempt and asserted to send no game command; `npm run test:pause-bridge` → 32 checks and `npm run test:map-walk` → 32, both registered in `test-suites.json` so the local gate runs them (#472 removed GitHub Actions, so `npm run gate` is the only gate these Ruby suites have); `cargo test` 212/0; `cargo clippy --all-targets -- -D warnings`; `cargo fmt -- --check`; `npx tsc -b`; `npm run lint`; `node tools/plan-audit.mjs`; `node tools/run-tests.mjs` → `no failures`.
  sabotage: `node tools/pause-reaches-travel-break-check.mjs` → 23 assertions. Three: `map_walk` stops consulting the latch, `pause_all` stops setting it, `resume_all` stops clearing it. Each must redden a **named** check in both the class check and the Ruby suite, and the file is restored and verified by sha256 between cases, not only at exit.
  done-when: every bridge intent that starts a script or sends player-supplied commands is in the refusal set, derived from the `.lic` rather than listed, and `pause.rs` states what is actually true.
  pitfalls: 4, 22.

- [x] **B11  The attach-time state replay: measure it, and synthesise the half Lich will not give back** (≈50)
  done: 2026-09-07 — Fixes #479 (first half), and it settles the hypothesis PR #454 recorded and handed on: attached to a real Lich for 22 s and *never observed the state replay arriving*. Read against the installed Lich 5.20.1 (`lib/version.rb:3`) rather than reasoned about. Three findings, and the first corrects this repo's own doc. **The suppression is not keyed on `$frontend`** — it is a raw ARGV match, `unless ARGV.any? { |a| a.match?(/^--(?:genie|saga)$/i) }` (`global_defs.rb:2357-2360`); `$frontend` appears nowhere in that block and there is no `profanity` branch anywhere in the tree. This app passes neither flag, so it receives the replay. **It arrives about ten seconds late, every time, in DragonRealms**: `100.times { sleep 0.1; break if XMLData.indicator['IconJOINED'] }` (`:2307`), and every setter of `IconJOINED` is under `lib/gemstone/` (`group.rb:353,395,398`, `infomon/xmlparser.rb:9`) while the generic path only sets it if the game sends that id (`common/xmlparser.rb:789`) — DragonRealms does not, so the loop always runs its full course and the dump lands behind ten seconds of live text. That is the likeliest reason #454 did not see it. **It is partial and cannot be requested**: vitals, spell, seven indicators and the compass, with hands/wounds/stance/mindstate gated behind `XMLData.game =~ /GS/`, and no room, occupants, prompt, roundtime or scripts at all; the detachable read loop understands `SET_FRONTEND_PID` and an exit command and treats everything else as player input (`:2363-2379`), and `detachable_client_send_init` has exactly one caller — the accept. So the answer to "if the replay does not fire the app must request it" is that **it cannot**, and the half Lich will not replay is synthesised from the bridge's `status` on 7415 instead.
  commit: (this PR) verified: 2026-09-07 minutes: 55 — Fixes #479
  touches: new:src/lib/linkReplay.ts, src/lib/gameLink.ts, src/main.tsx, docs/LICH_NATIVE_LOGIN.md, docs/BRIDGE_CONTRACT.md
  depends-on: B9
  do: `game:reconnected` is an **event**, not a flag on `game:state`: the parser reset must happen once per reconnect, and a level would re-fire it on every later state event. `gameLink.ts` drops the tag parser's accumulated vitals, indicators, compass and occupants on that edge — `vitals.ts` and `situation.ts` both prefer the stream's answer over the bridge's whenever the stream has one, so without it the previous session's health reads as current until the game happens to resend every tag. `linkReplay.ts` subscribes to the same edge and asks the bridge for a fresh `status`, which carries the room, occupants, scripts and roundtime Lich's replay does not; installed once per window from `main.tsx`, the same shape and for the same reason as `bridgePauseRelay.ts`. Its own module because `gameLink.ts` owns the game socket and deliberately knows nothing about 7415, and folding the two together would put two transports in one file.
  verify: `node --experimental-strip-types --experimental-test-module-mocks tools/link-reconnect-test.mjs` → `all passed: 56/56`, including that the bridge re-sends `auth`, `subscribe` and `get_status` on **every** open with the token first, which is the bridge's own replay and the thing that makes the synthesis work.
  sabotage: `node tools/link-reconnect-break-check.mjs` case 8 removes the `get_status` on reopen and requires `a fresh status is requested on every open` to go red, and nothing else.
  done-when: every claim about the replay in `LICH_NATIVE_LOGIN.md` is cited `file:line` against the installed Lich, and the two negative results — no `_` sentinel, no connect-time `<c>` hello on the detachable socket — are recorded with the search that establishes them and a positive control for that search.
  pitfalls: 4, 15, 22.

- [x] **B12  Reconnect: bounded backoff on both sockets, three states, and a lane that refuses honestly** (≈95)
  done: 2026-09-07 — Fixes #479 (second half). The game socket did not reconnect **at all**: the reader thread hit EOF, emitted one `game:state` and stopped, so a Lich restart or a network blip meant pressing Attach by hand and, until somebody did, a silent pane — the exact state `game_link.rs`'s own header says the file exists to make distinguishable. The bridge reconnected **forever**, capped at 30 s with no bound, reporting through `setStatus('disconnected', 'retrying in Ns (attempt N)')` — so the attempt count lived only in a free-text detail string that the store logged and no component could render, and a bridge that had gone and one fifteen seconds into a restart produced the identical permanent spinner. Both reported through one boolean, so *reconnecting* and *gave up* were the same value.
  commit: (this PR) verified: 2026-09-07 minutes: 100 — Fixes #479
  touches: src-tauri/src/game_link.rs, src/lib/gameLink.ts, src/bridge/realBridge.ts, src/bridge/index.ts, new:src/store/bridgeStatus.ts, src/store/bridgeLifecycle.ts, src/store/useAppStore.ts, src/types/index.ts, src/components/game/GameConnectionBar.tsx, src/components/layout/SafetyFooter.tsx, new:tools/link-reconnect-test.mjs, new:tools/link-reconnect-break-check.mjs, tools/test-suites.json, package.json
  depends-on: B9, B11
  do: `reconnect_run` in `game_link.rs` takes its clock, dialler and reporter as parameters, so the schedule is something a test **reads** rather than times. Six attempts, 0.5 s doubling to an 8 s cap; the dialler is `dial_with_retry` (#458) with a zero wait — reused, not forked, because it already owns the single-dial semantics, the "Lich exited" branch and the launch-file rules, and a dialler with its own internal wait would stack two backoffs neither of which the published state describes. `desired` is a second flag beside `running`, cleared by `game_detach` **before** `running`: a dropped socket and a pressed Detach both clear `running` and want opposite things, and without the second flag a detach landing as the reader winds down comes back reconnected. `GaveUp` has three arms — `Exhausted`, `Cancelled`, `Fatal` — because cancellation is not a failure and a Lich that has exited is not worth five more dials; every arm's note names the attempt count. `LinkState` gains `reconnecting`/`attempt`/`maxAttempts`, published rather than counted by the UI, and `state_of` makes connected and reconnecting mutually exclusive. `attached()` gains a third refusal naming the attempt, and it is what stops a command being queued into a dead socket — the lane's queue outlives every attach on purpose, so a send accepted during a drop would sit there looking sent. `game_attach` refuses while a reconnect is in flight, or two dials race for one port. App-side: `linkPhase` is the one classifier for four states, defensive against a `reconnecting`-less state from an older Rust binary; the bridge gains `reconnecting` and `gave-up` statuses and an 8-attempt bound, with a deliberate reconnect resetting the budget so the retry is not inert; `storeBridgeStatus` is a `Record` over `RealBridgeStatus` so a new status is a type error rather than one that lands nowhere, and it lives in its own module because `bridgeLifecycle.ts` reaches `import.meta.glob` and could not be imported from a plain `node` test.
  verify: `cargo test --lib game_link` → 22/0; `cargo test` → the full lib suite green; `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` silent; `npx tsc -b` 0; `npm run lint` 0 errors; `npm run test:link-reconnect` → `all passed: 56/56`; `node tools/plan-audit.mjs`; `npm run gate`.
  sabotage: `node tools/link-reconnect-break-check.mjs` → `all passed: 32/32`. Eight cases across both subjects, each asserting the **exact** set that reddens: remove the attempt bound; let the lane queue into a dead socket; drop the attempt from the refusal; flatten the backoff; let a live link also read as reconnecting; remove the bridge's give-up branch; report a reconnect as a plain disconnect; drop the `get_status` on reopen. Both files restored and verified by sha256, and the Rust one touched forward so cargo cannot serve a stale object. It found three real defects on its first runs — two in the new Node suite (an index into an empty array that ended the file early, so a crash reported fewer failures than it had; and an `.every` over an empty array that was vacuously true in exactly the case it existed for) and one in itself (a `let _ = guard` sabotage that is a deny-by-default compile error and so never reached the tests it was aimed at).
  done-when: neither transport can retry without a bound, both bars show which of three states each transport is in with the attempt count, and a command cannot be accepted while the socket it would use is not there.
  pitfalls: 4, 10, 14, 15, 22. `game_link.rs` is shared with lane N's attach work — this keeps to the disconnect and reconnect paths and does not change `dial_with_retry` itself.

---

### Lane D — Layout toward the approved mockup (finished 9 Sep 2026)

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

- [x] **D6  Delete the map presentation** (≈25)
  commit: (this PR) verified: 2026-09-09 minutes: 210
  touches: src/App.tsx, gone:src/components/MapWindow.tsx, gone:src/components/room/MapColumn.tsx, gone:src/components/shared/MapPanel.tsx, gone:src/components/shared/MapCanvas.tsx, gone:src/lib/mapDock.ts, src/lib/layout.ts, src/lib/dock.ts, src/lib/windowView.ts, src/components/dashboard/panels.tsx, src/components/PanelWindow.tsx, gone:tools/mapdock-test.mjs, tools/layout-test.mjs, tools/mud-client-e2e.mjs
  depends-on: D5 survived one real play session (date in the claim)
  scope: **widened 9 Sep 2026, and this is the second time this increment's scope has moved, so both moves are recorded.** It first said to remove the `'map'` panel id; Lane D declined, correctly, because `?view=panel&id=map` renders `MapPanel` through `PANEL_CONTENT.map` and that is a different route from the `?view=map` window. The corrected wording narrowed it to the window alone and said retiring the panel "belongs with Lane J or the Godot migration and wants a line in section 10 before anybody acts on it". That line exists now and it is Dan's, 9 Sep 2026, in `docs/NO-3D.md`: "The map is gone. It is not coming back, and cancelling 3D did not revive it. The room-graph data is retained for one reason: so Godot can consume it." So this increment is the window *and* the panel.
  blocked-on: (was) D5 surviving a real play session. **Released rather than met, deliberately.** That dependency was written when this was a layout question - do not delete the old surface until the new one has been played. It is not a layout question any more: the map is not being replaced by a better arrangement of itself, it is being removed, and a play session cannot report on the absence of something the flag had already made unreachable. `MAP_WINDOW_ENABLED` had been `false` since D3, so no player has reached the window this deletes since then.
  do: delete the map *presentation* and keep the room-graph *data*, which is the whole distinction `NO-3D.md` draws. Presentation: the `?view=map` branch and `MAP_WINDOW_ENABLED` in `App.tsx`, the `kind: 'map'` case in `windowView.ts`, the board slot's map half and its divider, the map-column toggle in `AppControls`, `'map'` from `PanelId`/`PANEL_TITLES`/`PANEL_CONTENT`/`PANEL_DATA_CONTRACTS`/both default `order` arrays, and every component and hook that existed only to draw it. Data: `src/data/map`, `src/data/world`, `mapData.ts`, `mapZoneIndex.ts`, `mapLandmarks.ts`, `mapPlaceColors.ts`, `mapPins.ts` and the world-content pipeline all stay - each has a live non-map reader, and those readers are the control that this deleted presentation rather than data. Migrate the persisted layout: `RETIRED_PANEL_IDS` in `layout.ts` and `stripRetiredKeys()`, so a saved layout naming the map keeps everything else.
  also: `#518` is fixed in the same PR and closed by it, because it is this increment's own blast radius rather than an adjacent issue - `map` was the first `PanelId` and the id most likely to sit in somebody's saved layout, and a pop-out of it now lands on `PanelWindow`'s unknown-id branch. That branch names the valid ids (read from `PANEL_CONTENT`, so it cannot drift) and offers the app.
  verify: `grep -c "kind === 'map'" src/App.tsx` → 0 (Gate 1's first clause); `npx tsc -b` exit 0; `npm run gate`; `tools/mud-client-e2e.mjs`'s `the removed map panel is not reachable` step was NOT CHECKED and is now four assertions.
  sabotage: empty `RETIRED_PANEL_IDS` → five named checks in `layout-test` go red (`panels`/`rects`/dock tab/dissolved region/active tab) and `order has no map` stays green, which is the honest boundary: `order` is cleaned by the pre-existing filter against the defaults and never needed this. Reintroduce `kind === 'map'` in `App.tsx` → the e2e's Gate 1 clause goes red. Restore by md5 either way.
  pitfalls: this is what an increment is for, and it is also how one goes wrong twice. The first wording came from reading the panel list rather than the two routes, and a session following it literally would have deleted a live feature while claiming to remove a dead window. The second was right about the code and out of date about the product. Neither was fixed by being more careful with the text; both were fixed by somebody checking the actual routes and, the second time, by Dan saying what the map is for now.
  aftermath: eight suites were retired with the code they tested (`mapdock`, `map-state-sync`, `map-viewport`, `map-keyboard`, `map-stamps`, `map-stamp-curation`, `map-leaves`, `pin-art`) and eleven more were edited. Two edits are worth a reader's attention rather than being buried in a diff. `tools/doc-claims-test.mjs`'s positive control counted `exportPinsToFile(`'s two call sites, and both were map files - the control went to zero and red, which is the whole reason to have one; it counts `openPanelWindow(` now. And `tools/aux-window-boundary-test.mjs` asserted the map window sat inside a boundary with `/AuxiliaryWindowBoundary[\s\S]*MapWindow/`, which still **passed** after the window was deleted, because `MapWindow` survives in an `App.tsx` comment saying it is gone and the regex spans the file. It now counts auxiliary windows instead of naming one.

---

### Lane E — First run and setup

- [x] **E1  A clean Windows VM** (≈30 + download)
  commit: (this PR) verified: 2026-09-05 minutes: 70
  touches: new:docs/verification/vm.md
  depends-on: none
  do: this machine is Windows 11 **Home**: no Windows Sandbox, no Hyper-V. Use VirtualBox with Microsoft's Windows 11 Enterprise evaluation ISO (90-day), 4 GB RAM, 60 GB disk, no shared folders; snapshot `clean` before installing anything. Record build number and snapshot name in `docs/verification/vm.md`.
  result: `drc-clean-win11`, Windows 11 Enterprise LTSC Evaluation build **26100.1742**, EFI + TPM 2.0 (Windows 11 refuses to install without both), 4 GB, 2 CPUs, 60 GB VDI, NAT, no shared folders, clipboard and drag-and-drop disabled. Snapshot **`clean`**, UUID `f3d11570-c6a9-46d2-99c1-77e300027040`, taken powered off with the install ISO detached. VirtualBox 7.0.18 was already on this machine and was not installed by this increment. The ISO came from Microsoft's own CDN via `go.microsoft.com/fwlink/p/?linkid=2289029`, 5,112,850,432 bytes matching the server's `Content-Length`; it lives outside the repository at `C:\Users\Admin\dev\_scratch\vm\win11-ltsc-eval.iso`.
  verify: the file exists with both — `docs/verification/vm.md`, build and snapshot name in the table at the top. It also records that `ver` could **not** be run inside the guest (`VBoxManage guestcontrol` returned "the guest execution service is not ready", twice), so the build is what VirtualBox read off the ISO and what the desktop watermark shows, and says so rather than implying an in-guest reading.
  note: the unattended install appeared to run for twenty-five minutes and had in fact done nothing — it was parked on `Press any key to boot from CD or DVD` and had fallen through to `No bootable option or device was found`. `VMState="running"` said nothing about that. Caught by taking a screenshot instead of trusting the state field; the fix and three other traps are in the doc.

- [x] **E2  Installer on the clean VM** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 75  re-measured: 2026-09-06 (all five defects, `docs/verification/first-run-2026-09-06.md`)
  result: seven prompts before the app runs, screenshotted in order in `docs/verification/first-run-2026-09-05.md` — three from Windows refusing an unsigned download (Edge "isn't commonly downloaded", the download held as a `.crdownload`, then Defender SmartScreen "Publisher: Unknown", whose default button is **Delete** and whose keep path is hidden behind "Show more → Keep anyway") and four from NSIS (Welcome; Choose Install Location `%LOCALAPPDATA%\DR Companion`, 210.8 MB; Installing; Completing, with Run and Create desktop shortcut both ticked). **No administrator elevation was requested at any point** — not by this installer, not by Ruby4Lich5's underneath it, not by the uninstaller. The installer shows **no licence page**. The file was fetched with Edge inside the guest rather than pushed in with `copyto`, because a copied file carries no Mark of the Web and would have skipped SmartScreen entirely; it arrived with `ZoneId=3` and its SHA-256 was re-measured in the guest as `1f813b6f…0be09e`, matching the build record exactly.
  note: the `blocked-on` this replaces was a misdiagnosis, and `docs/verification/vm.md` now says so in place of the three routes it used to list. `guestcontrol` was never broken. The earlier attempts ran at `GuestAdditionsRunLevel=2` — nobody had logged in, and the execution service is a run-level-3 facility — and the account password nobody had is in the VM's own `Unattended-*-autounattend.xml`, still on this disk. Waiting for run level 3 and reading the password out of that file was the entire fix.
  touches: none
  depends-on: E1, F1
  do: copy in the NSIS `.exe`; run; screenshot every prompt including SmartScreen; note admin elevation; run the app; screenshot the first screen. Write `docs/verification/first-run-<date>.md`.
  verify: the doc lists every prompt in order.

- [x] **E3  Uninstall on the clean VM** (≈10)
  commit: (this PR) verified: 2026-09-05 minutes: 20  re-measured: 2026-09-06 (unticked default on the CI build, `docs/verification/first-run-2026-09-06.md`)
  result: both lists are in `docs/verification/first-run-2026-09-05.md`, taken by the same script before and after so they compare line for line. Program files go completely: `%LOCALAPPDATA%\DR Companion` (49 files, 221,078,388 bytes) is absent afterwards, along with the HKCU uninstall entry and both shortcuts. User data survives: the WebView2 profile `%LOCALAPPDATA%\io.github.dancockrell.dr-companion` (302 files, 46,868,004 bytes) holds the settings and is untouched. **`%APPDATA%` never had a DR Companion entry at all**, before or after — everything the app writes is under `%LOCALAPPDATA%`. The uninstaller's own page offers "Delete the application data" **unticked by default**, which is the right default; only that default path was exercised. Two things survive that are not user data and should not: a 65 MB cached `DR Companion Data\downloads\Ruby4Lich5.exe`, and the four live bearer files `presentation-bridge.port/.token` and `script-api.port/.token` — credentials for the local bridges, left on disk after the thing that used them is gone. That last one is the finding worth acting on.
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

- [x] **E9  Lich's BSD-3 licence in the app** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 45
  touches: new:src/data/lichLicense.ts, src/components/layout/SettingsSheet.tsx, tools/build-third-party.mjs, THIRD_PARTY.md, docs/PLAYER_DATA.md
  depends-on: none
  result: `C:/Ruby4Lich5/Lich5/LICENSE` read rather than trusted — it is the BSD 3-Clause License, holders Murray Miron (2005-2006), Matt Lowe/Tillmen (2006-2020) and Elanthia Online (2021-present). A Licences section in the Settings sheet shows the grant, all three conditions and the disclaimer, collapsed behind a button.
  do: read `<lich>/LICENSE` head (ENGINE.md says verify, not trust); an About section with the licence text and copyright lines; Godot's MIT joins in F6.
  verify: the original line here was `grep -c "Redistribution and use" src/components/layout/SettingsSheet.tsx` ≥ 1, which asserts the mechanism — the text typed into the component — rather than the property. F6 already held those copyright lines in `tools/build-third-party.mjs`, so typing the text into the sheet as well would have been a second copy of a licence, which is the one document where two versions drifting is not merely untidy (§1 trap 17). The text lives once, in `src/data/lichLicense.ts`; the sheet and THIRD_PARTY.md both render from it. So the property is checked instead, and by command: `node tools/build-third-party.mjs --check` exit 0, whose Lich block now compares the module's grant, all three conditions and the disclaimer against the installed `LICENSE` (whitespace-flattened, since the file is hard-wrapped and the module is not), and whose new Settings block asserts the sheet imports the module and renders all four fields. `grep -c "Redistribution and use" src/data/lichLicense.ts` → 1. On a machine with no Lich the comparison still says NOT CHECKED rather than passing.
  sabotage: (1) `must retain` → `must keep` in the module → `FAIL ...and condition 1 the app shows is the installed one`, exit 1, that one check only; (2) `{LICH_LICENSE.disclaimer}` → `{null}` in the sheet → `FAIL ...and renders LICH_LICENSE.disclaimer`, exit 1, that one check only. Both restored; md5 `86ce1299cfb2e7c57207a0b14678c211` and `26cb139010cb5f174b5a75bd7544048c` matched their pre-sabotage values.

- [x] **E10  Walk the wizard on the VM** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 30
  result: every step screenshotted in `docs/verification/first-run-2026-09-05.md`, with the "did a program need me here?" note per step. **Total elapsed: 11 minutes 15 seconds**, from Enter on the downloaded installer to the app logging "All dependencies found. Connecting." The doc breaks that into machine time (NSIS extraction ~45 s, Ruby4Lich5's own installer 3 m 48 s, bridge script < 2 s) and operator latency, because the wall-clock figure includes a screenshot-and-decide pause between every click and would flatter nobody to quote bare; the floor for a person who knows the steps is under five minutes. **A stranger can finish it unaided**: nothing asked for a credential, an account, a path or a port. A program was needed at exactly one step, and unavoidably — Ruby4Lich5's own four-page installer, which DR Companion cannot answer for and which it honestly warns "asks its own questions".
  note: that third-party page defaults to the **wrong game** — "Lich5 Folder Location" offers Desktop ("preferred for Gemstone IV", the default) versus `C:\Ruby4Lich5\Lich5` ("preferred for DragonRealms"). This run deliberately took the default to find out what happens rather than predict it, and **it worked**: DR Companion found Lich at the Desktop path and installed the bridge there, so detection is not hardcoded to `C:\Ruby4Lich5`. It is therefore a guidance defect, not a breakage — one sentence in the Ruby row saying either option works would close it. Also found: the app window opens 1196x859 on a 1024x768 screen and is not clamped to the display, putting "Check again" and "App folder" off the right edge (measured with `GetWindowRect`, not eyeballed); Settings lists the publisher as the literal string `github`; and the first screen after setup shows fabricated combat state ("In combat, 84 of 100 health", eighteen people present) on a machine that has never connected — labelled `MOCK`, but faintly.
  touches: none
  depends-on: E2
  do: from `clean` plus the installer: every wizard step screenshotted (`src/components/first-run/`), a note per step "did a program need me here?", total elapsed time in the doc.
  verify: the doc has the elapsed time.

- [x] **E11  Detect Genie holding the port** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 50
  touches: src-tauri/src/lich.rs, src-tauri/src/setup.rs, src-tauri/src/lib.rs, src/lib/setup.ts, src/components/first-run/SetupWizard.tsx
  depends-on: none
  result: `genie_running()` shares `lich_running()`'s parser rather than copying it — the empty-stdout-is-unknown rule now lives in one `any_image_listed(listed, images)`, because two functions deciding what an empty `tasklist` means would eventually decide it differently, and the one that got it wrong would be the one reporting no frontend while one holds the port. The image names come from `setup::GENIE_IMAGE_NAMES`, extracted from the list `find_genie` was already using, for the same reason. Exposed as its own cheap `genie_status` command rather than a field on `LichStatus`: that command measures about five seconds (its own doc comment records the measurements), and this is one `tasklist` call. It reports and never acts — there is deliberately no button, because the process may be a session someone is playing.
  do: `genie_running()` mirrors `lich_running()` (`src-tauri/src/lich.rs`, `fn lich_running`) with the image name confirmed by `tasklist | findstr /I genie`; wizard text "Genie is running and may hold the frontend port; close it or continue" — never kill it. If the wizard file has a different name, `ls src/components/first-run/`.
  note: the image name could **not** be confirmed the way this increment says. `tasklist | findstr /I genie` returned nothing, because Genie was not running on this machine at the time — a zero about the instrument, not about the name. Confirmed from a second source instead: `src-tauri/src/setup.rs` already probes for `Genie.exe`, `Genie4.exe`, `Genie5.exe` and `GenieClient.exe` on disk, so the repo already knew the answer and the two now share one list.
  do: `genie_running()` mirrors `lich_running()` (`src-tauri/src/lich.rs`, `fn lich_running`) with the image name confirmed by `tasklist | findstr /I genie`; wizard text "Genie is running and may hold the frontend port; close it or continue" — never kill it. If the wizard file has a different name, `ls src/components/first-run/`.
  verify: `cargo test --lib lich` green with a three-state parser test on `tasklist` output — `tasklist_output_has_three_answers_not_two`, 15 passed 0 failed. It asserts `Some(true)` on a real CSV line, `Some(false)` on a populated list with no Genie, and `None` on empty and whitespace-only stdout; that the same parser answers for Lich; that every name in `GENIE_IMAGE_NAMES` is matched (a chooser tested where the wrong answer is available — without it the list could shrink to one entry and every other assertion would still pass); and that `GenieLauncher.exe.bak` is not a match. `cargo fmt -- --check` exit 0; `cargo test --lib` 117 passed.
  sabotage: (A) `return None` → `return Some(false)` on empty stdout → exit 101, `assertion left == right failed, left: Some(false), right: None`; (B) `GENIE_IMAGE_NAMES` cut to one entry → exit 101 at the name loop. Restored; md5 `c575862fc3cb16a8e6ca7f0fce51ce67` and `e3b9618ba1a33debcac715016fa7f561` matched. Worth recording: the first attempt at sabotage A was a `perl -0pi` that matched nothing and the suite reported `ok`, which is exactly the pass a sabotage that never landed produces. It was caught only because the replacement count was printed and was 0.

- [x] **E12  Diagnostics panel + bug bundle** (≈40; two commits)
  commit: (this PR) verified: 2026-09-05 minutes: 60
  touches: new:src/components/shared/DiagnosticsPanel.tsx, src/components/layout/SettingsSheet.tsx, new:src/lib/bugBundle.ts, new:tools/bug-bundle-test.mjs, package.json, tools/test-suites.json, docs/PLAYER_DATA.md, docs/PRIVACY.md
  depends-on: A1, B6
  result: one Diagnostics section in Settings, six rows, each `present | absent | could not check`, and "Copy bug bundle". It refuses rather than redacts: a redacting bundle hands back something that looks safe, and the one time the redaction was imperfect nobody would be looking. Two privacy rules are reused rather than rewritten — the activity log goes through `bugReport.ts`'s own `scrub`, so there is one set of private-speech patterns, and the finished text goes through `aiModelProvider.ts`'s `scanForSecrets`, so there is one list of what a credential looks like. The scan runs on the serialised artefact rather than per field, because a credential can be split across fields and reassembled by serialisation, and because the artefact is the thing that leaves. Outside the desktop app every row reads `could not check` with a reason, never six absences. The token row reports the token's *length* and never the token.
  note: the first version of the panel had the plan's own trap 6 in it — the gather callback depended on `ai.ticks` and `ai.journalPending`, which move every second, so a five-second `lich_status` probe would have restarted on every tick of an unrelated worker. Fixed by reading `getAiStatus()` inside the callback. The subscription left behind then had no consumer and was removed rather than kept as furniture.
  do: one panel: Ruby, Lich, bridge port, token file, viewer, model — each `present | absent | could not check`. "Copy bug bundle" = JSON of that plus the existing activity log (`grep -rn "activity" src/lib/*.ts | head`), passed through `scanForSecrets` from `aiModelProvider.ts`; refuse with the pattern name on a hit.
  verify: `npm run test:bug-bundle` → `19 checked, 0 failed`. A bundle whose log carries a runtime-assembled `pass`+`word`+`: hunter2` is refused, `patterns` is `['account password']`, and the refusal message and pattern list are asserted **not** to contain the value. Also: an `api_key=` shape refused; a credential in a *diagnostic detail* rather than the log refused, which is what proves the scan is on the finished artefact and not scoped to one field; a bundle missing rows still builds but names them in `diagnosticsNotGathered`, so an incomplete bundle cannot be read as a complete one; a tell in the log is scrubbed by the shared scrubber; and a positive control that fails loudly with `THE GATE DID NOT FIRE` if the scanner is not running.
  sabotage: skip the scan → red. `const scan = scanForSecrets(text)` replaced with `{ safe: true, found: [] }` → exit 1, `15 checked, 4 failed`, the four being the three refusals and the control, which named itself. Restored; md5 `606dec7bb69258cf1d12e2b306a492c1` matched.
  pitfalls: 3. All three met: gitleaks (fixtures assembled at runtime, `['pass','word',': ','hunter','2'].join('')`); `.ts` import extensions in `src/lib` (`./bugReport.ts`, `./aiModelProvider.ts`); and registration in both `package.json` and `tools/test-suites.json`, with the total rising by exactly the new suite's 19 checks.

- [x] **E13  The music library is installable** (≈40)
  commit: (this PR) verified: 2026-09-06 minutes: 150
  touches: new:src/lib/musicLibrary.ts, new:src-tauri/src/music.rs, new:tools/music-library-test.mjs, src/lib/ambientSound.ts, src/components/game/MusicTransport.tsx, src-tauri/src/lib.rs, src-tauri/src/setup/downloads.rs, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, tools/vendor-audio.mjs, tools/build-third-party.mjs, data/audio/manifest.json, THIRD_PARTY.md, docs/SETUP-POLICY.md, package.json, tools/test-suites.json
  depends-on: #383/#389, #394
  do: #389 fixed how a missing music library is *reported* and said so plainly: "the installer still ships no music. Putting `vendor-audio.mjs` into `tauri:build` and asserting the files in `tools/bundle-test.mjs` is a release-size decision for whoever owns the bundle." This is that decision and the feature behind it. Measure the library; bundle it if small, offer it as an in-app install if not; either way the `Music not installed` state names an action instead of dead-ending.
  result: **measured 4.36 GB (4,682,892,016 bytes) across 182 files**, by fetching every entry and weighing what landed. Against a 211 MB installer that settles it: an install the player asks for, not a bundle. `MusicInstallAction` in the shared transport (so the footer and the Sound panel get it from one component), downloading through the setup wizard's own `download_verified` - one sha256-pinned file at a time, into `%LOCALAPPDATA%\DR Companion Data\audio`, emitting `setup://progress` so the existing progress plumbing displays it, with Cancel and a visible failure. `data/audio/manifest.json` now carries a measured `sha256` and `bytes` per entry, written by `node tools/vendor-audio.mjs --record`, and the manifest ships inside the installer - so there is no manifest to fetch and therefore no manifest-fetch to verify. Two allowlist prefixes added (`upload.wikimedia.org/wikipedia/commons/`, `opengameart.org/sites/default/files/`), which is every host the manifest names. One resolver: `audioUrl` builds a track URL from the bundled path or the installed copy, and `ambientSound.ts` asks it rather than keeping a second map.
  note: **the first measurement was wrong and looked right.** A HEAD sweep of the same 182 URLs reported 120.6 MB and "0 unknown". Wikimedia had rate-limited it and answered 168 of the 182 with a 2144-byte error page, whose `content-length` reads exactly like a small file - and the denominator I printed counted only the requests that threw, so the instrument reported full confidence in numbers it had invented. Caught by the real fetch disagreeing on the first sixteen files. The manifest's sizes are bytes on disk for that reason, and the module headers say so where the next person will look.
  note: 4.36 GB is a large thing to offer behind one button. Per-station or transcoded installs are the obvious follow-up and are deliberately not in this increment; what is here is honest about the cost before the click, which the previous state was not.
  verify: `npx tsc -b` clean; `npm run lint` exit 0; `cargo test` 138 passed / 0 failed (132 before, 6 new in `music::tests`); `cargo fmt -- --check` clean; `node tools/plan-audit.mjs` → `plan ok`; `node tools/run-tests.mjs` ends `no failures`; `node tools/build-third-party.mjs --check` passes with the new Music library section and a per-licence check; `npm run test:music-library` → 34 checks, 0 failures.
  sabotage: nine, each restored by md5 and each turning **only** its named checks red. JS: `audioUrl` ignoring the installed library → 2 red ("resolves to the installed copy", "playing from the installed copy"); the unavailable state rendering no install → 1 red; the install started from a mount effect → 1 red ("no effect, timer or module body starts it"); a track losing its sha256 pin → 2 red ("every entry carries a sha256", "the installable set is exactly the pinned set"); an installed URL no longer counting as ours → 1 red. Rust: removing the sha256 comparison → `a_body_whose_sha_does_not_match_is_refused_and_nothing_is_written` FAILED; the allowlist accepting anything → same test FAILED on its "loopback must not be reachable through the real allowlist" leg; an empty sha pin accepted → `a_track_with_no_sha_pin_is_refused_naming_the_file` FAILED; `..` allowed in a track path → `a_track_path_cannot_escape_the_audio_directory` FAILED. One tenth attempt wrote a literal backslash into the TypeScript, so the suite crashed and produced no FAIL lines at all - a red that never ran. The harness now refuses to read a sabotage run that does not print its own summary line, which is CLAUDE.md §19 applied to the saboteur.
  pitfalls: the `download_verified` allowlist has no seam a test can reach, so a real verifier run needed one: `download_verified_from` takes the allowlist as a parameter, every shipping caller goes through `download_verified` with the real list, nothing reads an environment variable, and the test asserts that the real list still refuses the loopback URL it just used. `expected_sha256.is_empty()` means "do not check" in `download_verified` - correct for the bundled Ruby it was written for, a hole here - so `check_track` refuses an unpinned entry before any byte moves. Registration in both `package.json` and `tools/test-suites.json`. `tools/bundle-test.mjs` untouched: with nothing bundled there is nothing there to assert, and another lane is editing that file.

- [x] **E14  The music install becomes per-station** (≈40)
  commit: (this PR) verified: 2026-09-06 minutes: 130
  touches: new:src/components/game/MusicInstall.tsx, src/lib/musicLibrary.ts, src/lib/ambientSound.ts, src/components/game/MusicTransport.tsx, src/components/game/SoundControls.tsx, src-tauri/src/music.rs, src-tauri/src/lib.rs, tools/music-library-test.mjs, docs/PRIVACY.md, docs/PLAYER_DATA.md, new:docs/verification/music-groups-2026-09-06-transport.png, new:docs/verification/music-groups-2026-09-06-panel.png
  depends-on: E13
  do: E13 shipped the library behind one button and named this as the follow-up in its own words - "4.36 GB is a large thing to offer behind one button. Per-station or transcoded installs are the obvious follow-up and are deliberately not in this increment." This is the per-station half. Use the grouping the manifest already has for playback; do not invent a taxonomy for the installer.
  result: the unit of install is the manifest's own `station`, which is what `ambientSound.ts` already builds `RADIO_STATIONS` from. Measured from the recorded `bytes`: **Ambience 4 tracks / 5 MB, The Old Concert Hall 42 / 512 MB, Six Strings 61 / 1.3 GB, Halls of Shadow 36 / 1.6 GB, Throne and Temple 39 / 885 MB** - 182 tracks and 4,682,892,016 bytes, the same total E13 measured, now in five choices whose largest is 1.6 GB. The transport offers the group it was about to play (`NowPlaying.groupId`) with `Install all (4.4 GB)` beside it; the Sound panel lists every group with its size, state and an install, resume or remove. Presence is per group and derived in one place: `music_library_status` now returns the pinned files it found and nothing about what they mean, and `musicLibrary.ts` does all the counting - Rust never learns about stations and the frontend never walks a directory. A track whose group is absent resolves to no URL and is stepped past by all three players through one `firstPlayable`, so one installed station plays while the other four are missing; a queue where nothing is playable reports the group that would fix it, and stays silent when no install would.
  note: `RadioPlayer` had the step-past-an-unplayable-track walk and `ZoneMusicPlayer` and `PlaylistPlayer` did not, which was survivable while the only cause was a renamed id. With a whole group absent it was a zone that stopped dead at its first track, so the three now share one walk rather than gaining two more copies of it.
  note: `remove_tracks` was written with two gates - `track_path`'s shape checks and a `path.starts_with(dir)` after them - and the second was removed, because given the first there is no input that reaches it and escapes. Nothing could ever prove it still worked, and an unreachable guard reads as protection while providing none. The sabotage that loosens `track_path` reds both path tests, which is the guard that is actually load-bearing.
  note: while this was open, a review lane filed #402 against this same file. Its item 3 is fixed here, because it is a lie a person can see: Cancel pressed during the *last* track was never read, so the app reported a normal completion. The flag is now read once more after the loop. Cancel still only takes effect between files, and #402 items 1 (an interrupted download orphans its `.part`) and 2 (no free-space check) are left open on that issue - both live in `src-tauri/src/setup/downloads.rs` rather than here, and resume-from-`.part` is a design question worth more than a deletion on a 4.36 GB library. #402 also records two facts this increment made stale, and they are corrected on the issue: `complete` is no longer computed in Rust, and the frontend now derives the counts rather than deferring to a Rust status.
  note: the render check found two layout defects that reading the class list did not. With two install buttons instead of one, the Sound panel's copy of the transport clipped `Install all` clean off the panel's right edge - on screen and unreachable - and the group rows truncated their names to fit a fixed-width state column. Both fixed by wrapping rather than by clipping, and re-shot.
  verify: `npx tsc -b` clean; `npm run lint` exit 0 (warnings only, one new and it is the same subscribe-time re-read the rest of the file documents); `cargo test` **140 passed, 0 failed** (138 before: 3 new music tests, 1 replaced); `cargo fmt -- --check` clean; `node tools/plan-audit.mjs` → `plan ok`; `DRC_TEST_PORT=8020 node tools/run-tests.mjs` → `152 passed, 0 failed, 0 not run, 2 partial | 5447 checks across 152 suites`, ending `no failures` (the 2 partials are the same pre-existing pair #389 recorded); `node tools/build-third-party.mjs --check` passes; `npm run test:music-library` → 71 checks, 0 failures (33 before). `docs/PRIVACY.md` and `docs/PLAYER_DATA.md` regenerated, not hand-edited - the only change in either is the source-file count, since no host and no stored key was added.
  verify: render check against a dev server in this worktree with no `public/audio/`, which is the app's real not-installed state rather than one arranged for the picture. `docs/verification/music-groups-2026-09-06-transport.png`: before pressing Play there is no mention of music; after, the footer reads `Music not installed`, `Install The Old Concert Hall (512 MB)` and a quieter `Install all (4.4 GB)`, with no Retry. `docs/verification/music-groups-2026-09-06-panel.png`: five rows, each with its track count and size, each reading `Could not check` - which is the honest answer in a browser and is asserted as such.
  sabotage: eight, each restored by md5 and each turning **only** its named checks red. JS: group sizes stop being summed → 2 red ("sizes sum to the whole library", "no group is empty"); an absent track resolves to a URL anyway → 2 red ("a zone whose only group is absent reports unavailable", "nothing was loaded from the absent group"); a half-installed group called absent → 1 red; the transport stops naming the group that failed → 1 red; an unplayable queue reports nothing → 2 red. Rust: `..` allowed in a track path → `a_track_path_cannot_escape_the_audio_directory` and `removal_refuses_a_path_outside_the_music_directory` FAILED; removal leaving the `.part` → `removing_one_group_leaves_the_other_group_alone` FAILED; a truncated file counting as installed → `status_reports_the_files_that_are_there_and_nothing_else` FAILED. The harness itself was wrong twice and said so: it split FAIL lines at two spaces, so a check name of exactly 66 characters - the pad width - ran into its own detail and a red check read as green; and it restored through `copyFileSync`, which on Windows preserves the source mtime, so cargo reused a test binary built from the sabotaged code and a restored, md5-matching tree kept failing for several minutes. It now matches by substring, stamps the mtime forward, and ends by requiring the restored tree to be green.
  pitfalls: `MockAudio.instances.length` was the wrong denominator - `Layer` reuses one element across tracks, so counting elements stayed at zero while the layer happily loaded a track that is not there. Found by sabotaging the skip and watching two checks that should have gone red stay green; the mock now records every URL it was pointed at. The chooser is tested where the wrong answers are available: four groups installed and one absent, so "it offered the right group" is not a chooser with one option.

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
  superseded-in-substance: 9 Sep 2026 by Dan's "we need to build an updater, right?", delivered as **F16**. Kept `[x]` rather than `[-]` because the increment was a *decision* and it genuinely ran; `[-]` asserts every file the increment owned is absent, and `docs/RELEASE.md` is very much still here. The decision it recorded no longer holds — §2.2 of that file carries both the old text and the new one, so the change is legible rather than silent.

- [x] **F5  Privacy statement** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 45
  touches: new:docs/PRIVACY.md, new:tools/build-privacy-doc.mjs, src/components/layout/SettingsSheet.tsx, package.json, tools/test-suites.json
  depends-on: E9
  do: `grep -rn "fetch(\|reqwest\|https://" src/ src-tauri/src/ | grep -v -E "test|127\.0\.0\.1|localhost"` → one line per destination (Elanthipedia, GitHub releases). State: no telemetry, no analytics, local model on loopback only.
  result: the doc is generated, not written, for the reason F6 and E6 are: a privacy statement that has quietly stopped being true reads exactly like one that has not, and it is the document where that matters most. Six hosts — `elanthipedia.play.net`, `api.github.com`, `github.com`, `objects.githubusercontent.com`, `raw.githubusercontent.com`, `rubyinstaller.org`. Five are contacted by the app; `rubyinstaller.org` is a link the player's own browser opens, and the scan cannot tell those apart, so the classification is by hand against each call site and the doc says so. Elanthipedia's entry states that the wiki runs on Simutronics' own infrastructure, which is why the fetch goes through the sanctioned `api.php`, carries a user agent naming this app, and is limited to watched rooms at `MIN_INTERVAL_MS = 60_000` (`src/lib/elanthipedia.ts:27`, read rather than assumed).
  verify: `node tools/build-privacy-doc.mjs --check` exit 0, `6 checked, 0 failed`. The generator reproduces the increment's grep in node so it runs on a CI runner too, and the two were compared: both find 56 lines and the same six hosts on the tree before this increment (57 lines after, because the Settings link to the new doc is itself an `https://` the scan sees). `--check` asserts every scanned host is described **and** every described host is still in the source; the second direction is what catches a promise outliving the code.
  sabotage: (A) a new `https://example.invalid/telemetry` in `src/lib/bugReport.ts` → exit 1, `FAIL every host the scan found is described   example.invalid`; (B) a described host renamed so the code no longer has it → exit 1, `FAIL every host described is still in the source   gone.example.invalid`; (C) the scan pattern replaced with one that matches nothing → exit 1, `Error: only 0 lines matched; refusing to publish.`, which is the case that matters — a broken scan must abort rather than publish an empty and flattering promise. All restored; md5 `07d39c67fdf44ebed13e2400a1475bd2` and `8700d2de5de9184deb60daa4d8e2d74a` matched.

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
  do: assert the viewer resource destination when `godot/build/DRCompanionWorldViewer.exe` exists; skip loudly (`NOT CHECKED: viewer not built`) otherwise, and never let a skip read as a pass in the summary. **Superseded 5 Sep 2026 by the NOT-CHECKED sweep**: there is no skip any more. The generator gates the viewer entry on nothing but a file existing at the viewer path, so `DRC_VIEWER_EXE` points that probe at a stand-in and `--out` keeps the result out of `src-tauri/`, and the destination is asserted on every machine. See this increment's `verify:` line. The destination is read out of the config `tools/build-release-config.mjs` emits rather than restated here, so the check cannot agree with a path that has moved; and the generator's own refusal — it throws when `viewer.rs` no longer resolves the folder it bundles to — is caught and reported as a named FAIL rather than a stack trace nobody reads. Its viewer.rs contract is invoked, not re-implemented.
  verify: `node tools/bundle-test.mjs` ends `all passed` and prints `and it is bundled to the viewer/ folder the app searches first: viewer/DRCompanionWorldViewer.exe`, **with or without a real export** — updated by the NOT-CHECKED sweep, which removed the skip rather than dressing it up. The generator decides whether to emit the viewer entry purely on whether a file exists at the viewer path, so `DRC_VIEWER_EXE` aims that probe at a stand-in and `--out` keeps the result out of `src-tauri/`; the emitted map is the shipping one either way. What is still not proved here, and was never this suite's job, is that Godot can export a viewer or that the binary runs — `test:godot` and `npm run godot:export` own that.
  sabotage: both branches, since a skip that cannot become a check is not a skip. Point `VIEWER_SRC` at `Sabotaged.exe` → `FAIL the exported viewer is a bundled resource: no entry in the release config` plus `FAIL and it is bundled to the viewer/ folder…: undefined`; rename `dir.join("viewer")` in `viewer.rs` → `FAIL the release config can be derived at all: Error: viewer.rs does not look for the viewer under a "viewer" folder…`. Restored, md5 `38cc398ffe46` and `20f85970347e` either side.
  pitfalls: the checked branch was exercised with a one-byte placeholder at `godot/build/DRCompanionWorldViewer.exe` (gitignored), because the real export needs the private `shared-assets` submodule. That proves the branch runs and can go red; it does not prove a real installer works, which is F8's and F9's job.

- [x] **F8  Uninstall test on the CI artefact** (≈10)
  commit: (this PR, with #338) verified: 2026-09-05 minutes: 190
  touches: gone:.github/workflows/ci.yml, new:src-tauri/installer-hooks.nsh, src-tauri/tauri.conf.json, tools/bundle-test.mjs, new:tools/vm-inventory.ps1, new:docs/verification/uninstall-2026-09-05.md, docs/verification/first-run-2026-09-05.md
  depends-on: E3, F1
  do: E3 again with the CI-built installer; append to the E2 doc.
  blocked-on-that-turned-out-to-be-stale: E3 merged in PR #335 this morning. The real blocker was one nobody had named: **there was no CI artefact.** `ci.yml`'s `tauri` job ran `tauri build` and ended, so a 217 MB installer was built on every push to `main` and thrown away with the runner — `gh api .../actions/runs/33972082431/artifacts` returns `0` on a run whose `tauri` job says `success`. The phrase "the CI artefact", which this increment and F9 are both written against, named something that had never existed. PR #338 adds the upload plus a step that refuses unless exactly one `*-setup.exe` is present and prints its sha256 to the run summary.
  result: `docs/verification/uninstall-2026-09-05.md`, and it is a separate document rather than an append to the E2 one, which is what `do:` asked for — that document is E2/E3/E10's walkthrough and this is four uninstall runs across two builds; folding them together would have buried both. The E2 document is edited in one place, to point here and to close the open question its own reviewer left about `inv.ps1` never having been committed. **The finding: neither uninstall path removed the two loopback bearer tokens.** `%LOCALAPPDATA%\DR Companion Data` survived byte-identical — `files=5 bytes=68583698` before and after — on the default *and* with "Delete the application data" ticked, which E3 had not exercised. Ticking the box removes the WebView2 profile, the actual user data, and leaves two 64-character credentials for loopback sockets. Cause read out of the generated `installer.nsi`, not inferred: the checkbox reaches `$APPDATA\${BUNDLEID}` and `$LOCALAPPDATA\${BUNDLEID}` and nothing else, while `app_data_dir()` deliberately lives outside both so an uninstall can never take a Lich tree with it. Issue #352. Fixed here in `src-tauri/installer-hooks.nsh` and re-verified on a second CI build: credentials gone on both paths, `DR Companion Data` gone entirely on the ticked one, `portraits\`/`lich\`/`genie\` never at risk because the final `RMDir` is not recursive. The program half was clean on every run and matches E3 exactly. Five defects from E2/E10 were re-checked against the CI build and all five reproduce; Defect 5's identifier turns out to be a music track title, which narrows it to the sound player.
  verify: four inventories from `tools/vm-inventory.ps1`, printed in full in the document, each opening with a control probe that aborts the script if `%LOCALAPPDATA%\Microsoft` is missing, and carrying denominators (`1 of 6 uninstall entries read`, `2 of 47 .lnk files seen`) that fall to `0 of 5` and `0 of 45` across an uninstall. A fifth, on the restored `clean` snapshot before anything was installed, is the control that the script can say ABSENT correctly: `probes=15 present=1 absent=14`, the one present being the control probe. Chain of custody on both installers: CI's own sha256, `sha256sum` on the host after `gh run download`, and `Get-FileHash` inside the guest, all three equal.
  sabotage: five, on the guard in `tools/bundle-test.mjs`, each reddening its own named check and no other — rename the data folder in `setup.rs` (`and the hook deletes from that same folder (DR Companion Store)`), drop one `Delete` line (`the uninstall hook deletes script-api.token`), rename the Rust constant so the reader finds three of four (`all four bridge credential filenames were read out of the Rust: 3 of 4`), add a recursive delete of the data folder (`and it never recursively deletes the data folder itself`), unwire `installerHooks` (`tauri.conf.json wires an installer hook file`). A sixth aborted itself rather than reporting a pass, because its pattern no longer matched the file. All three damaged files restored byte-identical by md5.
  pitfalls: `VBoxManage startvm --type gui` did not work on this host — two `VirtualBoxVM.exe` per attempt, a `GUI/Qt` session lock on a machine still reporting `poweroff`, and every retry adding two more. `--type headless` started it first time. `controlvm screenshotpng` returned a stale 1024x768 frame of an empty desktop while the guest reported 1440x900 and `GetWindowRect` listed a window that frame did not contain; capture from inside the guest instead. And `guestcontrol run` both exits non-zero having done the work and occasionally starts nothing at all, so the runner deletes its output file in the guest first and asserts it exists afterwards — without that it hands back the previous task's output, which reads as a result and did produce two identical screenshots of a page the installer had already left.

- [ ] **F9  `v1.0.0-beta.1`** (≈20)
  touches: none
  depends-on: F2, gates 0–2
  do: `npm run version:set -- 1.0.0-beta.1`; commit; `npm run gate` (green, read the
  last line); `npm run tauri:build` **locally** — there is no CI to build it (trap 21);
  `sha256sum src-tauri/target/release/bundle/nsis/*-setup.exe` and record it by hand;
  tag; `gh release create --draft` with the installer attached; E2/E3 on that exact
  file, checking its digest in the guest against the one recorded here.
  verify: draft release with the installer; VM record appended, carrying the digest
  at both ends so the chain of custody still has two.

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
  do: as F9 with the rc version (local build, digest recorded by hand);
  E2/E3/E10 on the VM from `clean`.
  verify: recorded.

- [ ] **F13  `v1.0.0`** (≈20)
  touches: none
  depends-on: F12 one week clean
  do: as F9 (local build, digest recorded by hand); release notes name the seven
  bars of section 5 with the recording of each.
  verify: release page links seven records.

- [x] **F15  One version, five files** (≈15)
  commit: (this PR) verified: 2026-09-09 minutes: 40
  touches: tools/set-version.mjs, src/lib/versions.ts, src/components/layout/SettingsSheet.tsx, new:tools/version-drift-break-check.mjs, package.json, tools/test-suites.json
  depends-on: F2
  do: F2 checked four files. `src/lib/versions.ts` was the fifth and was not in the check.
  result: **it was already wrong.** `APP_VERSION` read `0.1.0` against four files at `0.1.1`, and it is the copy a *player* sees — the About line in Settings, `appVersion` in every bug report (`ReportDialog.tsx`), and the version handshake the app sends the bridge (`bridgeMessageHandler.ts`). So `set-version.mjs`'s own header ("the first person to report a bug reports the wrong version") was a live description of this constant rather than a hypothetical about the installer's name, and the check was agreeing across the four files it happened to know about. A sixth copy was found in the same pass: `SettingsSheet.tsx` printed `DR Companion 0.1.1` as typed text, which would have drifted next; it renders `{APP_VERSION}` now, so there is nothing left to keep in sync there.
  verify: `node tools/set-version.mjs --check` → `OK all 5 files declare 0.1.1`.
  sabotage: `node tools/version-drift-break-check.mjs`, 10 checks. Each of the five files is bumped to `999.0.0` **in a temp replica** and the check must exit 1 naming that file; plus a case that renames `APP_VERSION` so the reader cannot find it, which must be `could not read a version` rather than four files agreeing; plus five files agreeing on `0.1` which is not a semver. The tree is never written to. Two of the bump cases were green on the first run and should not have been: a plain `text.replace('0.1.1', …)` hits the first occurrence, which in `Cargo.lock` is a dependency's version and in `versions.ts` is a number quoted in a doc comment — the sabotage landed and never reached the anchor the reader reads. It writes through `set-version.mjs`'s own writer now, so the damage is guaranteed to be where the check looks.

- [x] **F16  The application updater** (≈90)
  commit: (this PR) verified: 2026-09-09 minutes: 200
  touches: new:src/lib/updater.ts, new:src/lib/updaterWiring.ts, new:src/components/layout/UpdateSection.tsx, new:src/components/layout/UpdateBanner.tsx, new:src-tauri/src/updater.rs, new:tools/updater-test.mjs, new:tools/updater-break-check.mjs, new:tools/build-update-manifest.mjs, new:tools/update-manifest-test.mjs, new:tools/no-private-key-test.mjs, src-tauri/src/lib.rs, src-tauri/tauri.conf.json, src-tauri/capabilities/default.json, src-tauri/Cargo.toml, tools/verify-release-bundle.mjs, tools/release-flags-test.mjs, docs/RELEASE.md, THIRD_PARTY.md
  depends-on: F15
  do: Dan, 9 Sep 2026, superseding F4: *"we need to build an updater, right?"* `tauri-plugin-updater` 2.11.0 + `@tauri-apps/plugin-updater` 2.11.0, static-format `latest.json` served as a GitHub release asset from the `latest` alias, minisign signature verified before anything runs.
  result: the plugin's API was read out of the installed package and crate rather than recalled — `check() → Update|null`, `download(onEvent)`, `install()`, `close()`, and `get_urls` searching `{os}-{arch}-{installer}` then `{os}-{arch}`, so the manifest key is `windows-x86_64`. The rules a player cares about live in `src/lib/updater.ts`, which imports nothing and is therefore drivable under plain node: checking never downloads, downloading never installs, `downloadAndInstall` is called nowhere, "later" defers that version for the session and the launch check honours it, and installing during a live game session refuses until the player has been shown that it closes the app and drops their character. Ten states, all rendered, all with a sentence. `updater_configured` (Rust) reads the `pubkey` out of the running binary's own config so a build with no key says *"this build has no update channel"* and refuses to check, rather than offering an update it could never verify — three states, not two, the same shape `verify-release-bundle.mjs` uses for the viewer. THIRD_PARTY.md regenerates at 341 crates.
  verify: `npm run test:updater` → `34 checked, 0 failed`; `npm run test:update-manifest` → `14 checked, 0 failed`; `npm run test:no-private-key` → `8 checked, 0 failed`; `npm run gate`.
  sabotage: `npm run test:updater-break`, six cases on temp copies, each declaring **which** checks must go red: unhonour "later" at launch (1), install at the end of `download` (4), remove the live-session gate (4), download during a check (2), forget the deferred version (2), drop the `whatToDo` sentence (1). A positive control runs the unmodified copy first, and the file is compared byte-for-byte at the end. Two cases were wrong on the first run in the informative direction — the injected call threw out of an `await` the suite does not guard, so the run died partway through having already printed exactly the expected FAIL lines, and only the `ran >= 20` floor separated a caught sabotage from a crashed suite. `test:no-private-key` plants a key of its own in `tools/fixtures/` and asserts the grep finds it and nothing else before claiming the tree is clean; its markers are assembled from halves so the checker does not match its own source, because the obvious fix for that — excluding the checker from the scan — is a hole exactly the size of the checker.
  pitfalls: the private key is **not generated and not in this repository**, deliberately, and `"pubkey": ""` is committed. `docs/RELEASE.md` §2.4 carries the reasoning and the one command. What this increment does *not* establish is F17. Two things caught themselves along the way and are worth having written down. `test:no-private-key`'s first red was **its own filename**: the pattern matched any path containing `private-key`, and the moment the file was staged it became tracked and flagged itself — a rule that fires on prose about keys fires on `docs/RELEASE.md` §2.4 too, and a check that cries wolf inside a release ritual is one somebody learns to skip. It matches key *filenames* now (`.key`, `.pfx`, `.p12`, `id_ed25519`), with a matcher control asserting four names it must catch and four it must leave alone. And `test:updater`'s first run reported nine of ten states reached: `checking` exists only between the call and its resolution, so sampling return values could never see it, and the suite subscribes for that one. A third, on the rebase: `test:updater-break`'s anchors were written with `
` and this repository checks out CRLF, so two of them matched nothing — trap 17 exactly. It aborted naming the anchor rather than rewriting the file identically and reporting the rules as unnecessary, which is the behaviour that was wanted and not the outcome; it normalises line endings for the sabotage now and compares the raw bytes for the byte-identity check.

- [ ] **F17  The updater, end to end, on the VM** (≈60 + waiting)
  touches: none
  depends-on: F16, F9
  do: everything in F16 was verified against a manifest and an installer in a directory on this machine. Nothing in it proves a *running copy* reaches GitHub's `latest` alias, downloads, verifies and installs over itself. Build two versions an hour apart; install the older on the clean VM from the `clean` snapshot; publish the newer with both assets; press Check for updates in Settings and then Install. Separately: press Later with a character in the game and confirm the app does not close, and that nothing re-offers it.
  verify: a record in `docs/verification/updater-e2e-<date>.md` carrying the two versions, both sha256 digests, the manifest as published, and a screenshot of the app reporting the *new* version after the restart. Restore the snapshot at the end.

- [ ] **F14  Announce** (≈15)
  touches: none
  depends-on: F13
  do: a post for the DR community in Dan's voice (memory: never generic AI prose); Dan approves before it goes out.
  verify: Dan's approval quoted in the claim.

---

### Lane G — AI slices 5–7 (after Lane A)

- [x] **G0  Evidence outlives the journal** (≈25)
  commit: 489f3489 verified: 2026-09-05 minutes: 40
  touches: new:src/lib/aiEvidenceStore.ts, new:tools/ai-evidence-store-test.mjs, C1>src/lib/aiJobStore.ts, package.json, tools/test-suites.json
  depends-on: A5
  do: a claim's `evidenceRefs` are `event:<seq>` strings, and the journal evicts at 5000 events, so a candidate reviewed an hour later can cite evidence nobody can read. The handoff's `observations.read(refs)` presumes durable observations. Minimum honest version: `pin(refs, journal)` copies the referenced events' `{seq, at, kind, payload}` into `drc.ai-evidence.v1` at the moment a job or claim cites them; `resolve(refs)` returns them or `{missing:[…]}` — never a silent partial. `JobStore.create` pins `inputRefs`; G5's store refuses a claim whose refs do not resolve. Bounded by count with the oldest **unreferenced** entries evicted first; an entry cited by a live claim is never evicted.
  verify: tests — pin, evict the journal past capacity, resolve → still returns the payload; a ref never pinned → listed in `missing`; eviction skips cited entries.
  sabotage: evict cited entries → red.

- [x] **G1  Producer: divergent exits** (≈25)
  commit: e32c7a8e verified: 2026-09-05 minutes: 40
  touches: new:src/lib/aiJobProducers.ts, C1>src/lib/aiWorkerHost.ts, new:tools/ai-job-producers-test.mjs, package.json, tools/test-suites.json
  depends-on: A4
  do: `detectExitDivergence(snapshotCell, parsedExits)` → `[{move, inSnapshot, inStream}]`. Parsed exits come from the stream parser's room state (`grep -n "exits" src/lib/gameStream.ts src/types/stream.ts`) — never parse text here. Non-empty → `jobs.create({kind:'map_reconciliation', scope:{roomId}, inputRefs:['event:<seq>'], allowedTools:['flag_conflict']})` unless a non-terminal job already has that `scope.roomId`.
  verify: divergent → 1 job; again → still 1; other room → 2.
  sabotage: remove the dedupe → red.

- [x] **G2  Tool registry + `room_by_id`** (≈15)
  commit: 489f3489 verified: 2026-09-05 minutes: 35
  touches: new:src/lib/aiKnowledgeTools.ts, new:tools/ai-knowledge-tools-test.mjs, package.json, tools/test-suites.json
  depends-on: A4
  do: `callTool(name, args, allowedTools, trace)` returns `{ok:false, reason}` for a disallowed or unknown name — never throws. Every tool declares `{id, validate(args), maxResultBytes}`; an over-size result is truncated with `truncated:true`, never silently cut. Every call is appended to `trace` as `{tool, argsSummary, bytes, at}` (no payloads, no secrets) so a job's tool use is inspectable. Text fields returned to a model are wrapped as `{untrusted:true, text}` so the prompt builder can label them "data, not instructions" (the handoff's injection rule). `room_by_id(zone, id)` → `{id, title, exits:[{move,to}], tags}` from the same `MapZone` data `compileWorldSnapshot` reads.
  verify: allowed → result; disallowed → refusal naming the tool; unknown → refusal; a 1 MB fixture result → truncated flag and `bytes <= maxResultBytes`; trace has one entry per call.
  sabotage: skip the allowlist → red; skip the size cap → red.

- [x] **G3  Tool `lore_for`** (≈10)
  commit: 489f3489 verified: 2026-09-05 minutes: 15
  touches: G2>src/lib/aiKnowledgeTools.ts, G2>tools/ai-knowledge-tools-test.mjs
  depends-on: G2
  do: wraps `bestiary.ts` `loreFor`/`isApproximate` → `{lore, approximate} | null`.
  verify: known creature → lore; unknown → null; approximate flagged.

- [x] **G4  Tool `recent_events`** (≈10)
  commit: 489f3489 verified: 2026-09-05 minutes: 20
  touches: G2>src/lib/aiKnowledgeTools.ts, G2>tools/ai-knowledge-tools-test.mjs
  depends-on: G2
  do: `journal.readFrom(max(0, ack-n))` limited to n; returns kinds, seqs and the G12 privacy class only — never `text` (it may hold player speech).
  verify: a check asserts no returned object has a `text` key.

- [x] **G5  Candidate-claim store** (≈35; two commits)
  commit: 489f3489 verified: 2026-09-05 minutes: 55
  touches: new:src/lib/aiClaimStore.ts, new:tools/ai-claim-store-test.mjs, package.json, tools/test-suites.json
  depends-on: A5
  do: the schema is the handoff's §28 (adopted whole — see section 11): `schemaVersion:1, claimId, subject, predicate, value, status ∈ candidate|corroborated|accepted-local|published|rejected|retracted|superseded, evidenceRefs[] (non-empty and resolvable via G0), producer {kind:'human'|'parser'|'model'|'import', identity, model?, adapter?, softwareVersion?}, confidence: number|null, createdAt, reviewedAt, reviewer, supersedes, privacy ∈ private|group|public-candidate (default private), licence: string|null`. Transitions: candidate→corroborated→accepted-local; candidate|corroborated→rejected; accepted-local→published only when `privacy !== 'private'` and `licence` is set (and only once G11-era sharing exists — refused until then); any non-terminal→retracted; supersession appends a new claim naming the old, never edits it (§31). `drc.ai-claims.v1`. **Imports nothing from mapData, mapPins, bestiary or any canonical store** — a source check in the test enforces it.
  verify: transitions; empty or unresolvable evidence refused; `published` refused for `private`; supersession leaves the old record addressable; a supersession cycle (A supersedes B supersedes A) refused; source check green.
  sabotage: allow empty evidence → red; allow the cycle → red.

- [x] **G6  Map job yields a claim even with no model** (≈25)
  commit: e32c7a8e verified: 2026-09-05 minutes: 50
  touches: C1>src/lib/aiWorker.ts, G1>src/lib/aiJobProducers.ts, C1>tools/ai-worker-test.mjs
  depends-on: G1, G5
  do: on `map_reconciliation` with provider absent or failing, emit the deterministic claim `{subject:'room:<id>', predicate:'exit_divergence', value:{diff}, confidence:0.5, producer:{kind:'parser', identity:'aiJobProducers.detectExitDivergence'}}`, job → `awaiting_review`. A working provider's parsed JSON adds a second claim with `producer.kind:'model'`; malformed → `invalid_output` and the deterministic claim still stands. Every model-proposed tether passes `validateTetherCandidate` (handoff §33) before it becomes a claim: `fromRoomId` known; a non-null `toRoomId` must appear as `currentRoomId` in a cited authoritative snapshot; a directionless exit gets `boardAnchor:null`, never a guessed one; kind `ferry` needs transport evidence; kinds `portal|warp` never infer adjacency from board proximity. A proposal that fails validation is recorded in the job note, not as a claim.
  verify: absent → 1 claim + awaiting_review; failing → same; valid JSON → 2 claims; **adversarial**: invented destination → no claim, note names it; directionless exit → `boardAnchor` null; portal with proximity-only evidence → rejected; ferry without transport evidence → rejected.
  sabotage: skip the destination check → the invented-destination test red.

- [x] **G7  Claim review UI** (≈30)
  commit: 89439b6a verified: 2026-09-05 minutes: 45
  touches: new:src/components/shared/AiClaimsPanel.tsx, src/components/layout/SettingsSheet.tsx
  depends-on: G5
  do: list candidates (subject, predicate, evidence count, producer, confidence); Accept/Reject change status only; evidence tooltip.
  verify: create a claim in devtools; it appears; Accept → accepted; pins/map `localStorage` keys byte-identical before and after (read them in devtools).

- [x] **G8  Corroboration** (≈15)
  commit: e32c7a8e verified: 2026-09-05 minutes: 25
  touches: G5>src/lib/aiClaimStore.ts, G5>tools/ai-claim-store-test.mjs
  depends-on: G5
  do: same `(subject,predicate,value)` from a second independent `evidenceRef` → `corroborated`.
  verify: test; sabotage: count the same ref twice → red.

- [x] **G9  Reversible promotion** (≈30)
  commit: 89439b6a verified: 2026-09-05 minutes: 50
  touches: G5>src/lib/aiClaimStore.ts, src/lib/mapPins.ts, G7>src/components/shared/AiClaimsPanel.tsx, G5>tools/ai-claim-store-test.mjs
  depends-on: G7
  do: read `mapPins.ts`'s pin shape first; if pins lack a `provenance` field add one defaulting to `'player'` with a migration check. Promote (only from `accepted`) creates a pin `provenance:'ai-candidate'` and records `{claimId, pinId}`; Revert deletes exactly that pin and returns the claim to `accepted`.
  verify: promote → +1 pin with provenance; revert → count restored, other pins byte-identical.
  sabotage: revert by index → "other pins identical" red.

- [x] **G10  `publish_presentation_event` gets its caller** (≈20)
  commit: 89439b6a verified: 2026-09-05 minutes: 35
  touches: C1>src/lib/aiIngest.ts, C4>src/lib/viewerClient.ts, C1>tools/ai-worker-host-test.mjs
  depends-on: C4
  do: on `situation` transitions for stunned/webbed/immobilized (on and off) publish `PresentationEvent{kind:'status-change', authoritativeText:<flag>, roomId}` — derived from already-parsed flags, no text parsing. Godot's `event_player.gd` consumes ordered events.
  verify: `[]→['stunned']→[]` → exactly two events, increasing `sequence`; unchanged flags → none. The callerless-command sweep now lists only `extract_lich` and `bridge_install_status`.

- [x] **G11  Live suggestion through the confirmation gate** (≈40; two commits)
  done: 2026-09-06 — both halves merged. Commit 1 is PR #346, squashed as
  `efbc19ec` (5 Sep): the data model, the gate and its adversarial tests, with
  no producer and no UI. Commit 2 is PR #359, squashed as `129e222b` (6 Sep):
  the panel that makes a suggestion confirmable and therefore sendable. It was
  held unmerged because gate 4 admits G11 only with Dan's yes (section 10);
  Dan gave it on 6 Sep 2026 and it merged on that yes. Test counts are a check,
  not a claim — `node --experimental-strip-types tools/ai-suggestions-test.mjs`
  and `node --experimental-test-module-mocks tools/kill-switch-test.mjs` print
  their own; measured on `main` at `129e222b` they are **150** and **52**. (The
  PR bodies quote 141 and 52 as of the day each was written; the suites have
  grown since, which is why the commands above are the authority and these
  numbers are not.) Still true, and the thing a first live session should look
  at: the card has never been rendered with a real suggestion in it, because
  producing one needs a local model this machine does not have — the same wall
  H5 is `[!]` behind. Review pass 5 then filed three defects in the panel and
  its wiring, fixed together on 6 Sep 2026 (#399, #403): the card hid the two
  refusals that settle a suggestion and then showed one of them against the
  *next* proposal, `suggestionRefused` had no reader anywhere in `src/`, and
  the suggestion's TTL was measured from before the model was asked, so a card
  documented as offering 20 s arrived offering 15. None of them touched the
  gate. The card has now been rendered with a suggestion in it, by
  `tools/ai-card-refusal-shots.mjs` against a dev server, which is the first
  half of the wall above coming down — a real *model* still has not proposed
  one.
  touches: src/lib/aiSuggestions.ts, tools/ai-suggestions-test.mjs, src/lib/stateVersion.ts, src/lib/flowStop.ts, src/store/useAppStore.ts, src/types/index.ts, tools/kill-switch-test.mjs, docs/PLAYER_DATA.md, docs/PRIVACY.md, src/lib/aiWorker.ts, src/lib/aiIngest.ts, src/lib/aiWorkerHost.ts, src/components/shared/AiWorkerPanel.tsx, src/lib/suggestionCardView.ts, tools/ai-worker-test.mjs, tools/ai-worker-host-test.mjs, tools/ai-card-refusal-shots.mjs, package.json, tools/test-suites.json
  depends-on: H3, G0
  do: the handoff's §36, exactly. A suggestion is data: `{id, exactCommand, commandType, basedOnStateVersion, expiresAt, status:'pending'|'confirmed'|'expired'|'rejected'|'awaiting_result'|'resolved', evidenceRefs}`. `requestExecution(id, confirmation)` REQUIREs: status pending; not expired; `confirmation.commandText === exactCommand` (the player confirms the literal command, not a summary); the current state version equals `basedOnStateVersion` (that counter is `currentStateVersion()` in `src/lib/stateVersion.ts`, bumped by `versionedSetter`, which the store wraps its `set` in; it was also mirrored onto `AppState.stateVersion`, and #370 removed the mirror — one number, one owner, read from the module and never from the store); at most one suggestion in `awaiting_result`. Only then `requestGameAction` from `gameActions.ts` — the **only** import of it in any `ai*.ts`, and a source test asserts it is the only one. The authoritative result (next snapshot/state) resolves the suggestion; the model never marks its own proposal successful. Panel: one card with Confirm/Dismiss, the exact command in monospace, and the expiry.
  verify: tests — stale state version → refused; altered command → refused; expired → refused; second pending while one awaits → refused; happy path sends exactly `exactCommand` once (spy on `requestGameAction`).
  sabotage: skip the version check → red; skip the exact-command check → red.
  pitfalls: this is the one increment that gives model output a path to the game. Dan's approval is required before merge (section 10).

- [x] **G12  Privacy class at ingest** (≈25)
  commit: 89439b6a verified: 2026-09-05 minutes: 45
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

- [x] **H8  Script-repair vertical job** (≈45; three commits)
  commit: (this PR) verified: 2026-09-05 minutes: 75
  touches: G1>src/lib/aiJobProducers.ts, C1>src/lib/aiWorker.ts, G2>src/lib/aiKnowledgeTools.ts, new:tools/ai-script-repair-test.mjs, package.json, tools/test-suites.json
  depends-on: G6, H3
  do: producer: a task failing twice with the same error → `script_repair`. Tool `read_script(id)` read-only. The job asks for a unified diff; the worker writes the patched copy **under the app data dir, never over the script**; runs `ruby -c` / `node --check` / `tsc --noEmit` on the copy and E7's fixtures; result → claim `{predicate:'script_patch', value:{diff, checks}}` awaiting review. Never activates.
  verify: scripted provider returning a known-good diff → checks recorded; original file hash unchanged.
  sabotage: write over the original → hash check red.
  note: the suite runs against **real files and real interpreters** rather than a double that records what it was asked to do, because the invariant is about a filesystem and a port that says one thing while doing another is exactly the failure it exists to catch. Three deliberate design points. The worker reads the script through `callTool('read_script', …)` rather than through the port directly, so the size ceiling, the audit trace and the untrusted label apply to the one job that most needs them - a script over 64 KB is refused whole rather than shortened, because half a file is a different file and a patch proposed against it lands on the wrong lines. The destination is validated **before** the write and again after (`validatePatchTarget`), which is not belt-and-braces: the plan asks for rollback material "by construction", and a check that runs after the write can report the harm but not prevent it - removing the pre-check leaves the post-check still refusing while the original is already gone, which is precisely what the second sabotage below shows. And a *failing* language check still produces a claim: a candidate that does not compile is what a reviewer should see and reject, and hiding it would leave the job silent while the model kept proposing the same broken patch.
  **`node --check` was measured and is unusable here, so it is not run.** The three languages `scriptFiles.ts` admits are Python, TypeScript and Ruby; none is JavaScript. Pointed at a `.ts` file, `node --check` (v24.19.0) parses it as CommonJS JavaScript and reports `SyntaxError: Missing initializer in const declaration` on the valid line `const a: number = 1` — a check that fires on everything, which carries as much information as one that fires on nothing. `tsc --noEmit` is what actually checks TypeScript, and Python gets `python -m py_compile`, which the plan's list does not name because it predates the language list.
  **One check is honestly NOT CHECKED and it is not a pass** (this paragraph said *two* until the NOT-CHECKED sweep of 5 Sep 2026 wired the TypeScript one; the reasoning below was right about `USER_DIR` being fixed at module scope and wrong about what follows from it, because `__dirname` moves with the file — a copy of the shipped runner in a scratch directory looks for tasks there, so the candidate runs out of process and nowhere near the player's tasks. Ruby was still skipped when this was written, and its reason was itself checked: `no out-of-process Ruby runner exists, so the Ruby skip above is still true`, which was written to fail the day somebody added one. **H9 added one**, so that check is gone and the Ruby fixture runs; everything from here to the end of this note describes the state before it.) E7's containment fixtures run a candidate out of process by redirecting `runner.USER_DIR`, and only `python/runner.py` allows that: `typescript/runner.ts` fixes `USER_DIR` at module scope, and a Ruby script is a Lich script that only Lich runs. Both print the reason and the thing that would have to change. Python's fixture run additionally executes E7's own known-good fixture first as its denominator, and downgrades the whole result to NOT CHECKED rather than condemning the candidate when the driver itself cannot run. #330 landed while this branch was open, so those skips reach the top-level summary rather than hiding inside a green suite. At the time that read `no failures, but 6 thing(s) went unchecked in 4 suite(s)`; after the NOT-CHECKED sweep (PR #340) it reads `no failures, but 1 thing(s) went unchecked in 1 suite(s): test:ai-script-repair` — still not `all passed`, which is the honest line and the one §0.5 should be read against.
  **Not wired into the app, and that is a stated gap rather than an oversight.** Two things are missing and neither is inside this increment's `touches:`. Nothing today tells the AI host that a *task* failed — the host ingests the game stream, and `pythonTasks.ts` / `nodeTasks.ts` report run outcomes to the UI and nowhere else — so there is no signal for the producer to count; and the port needs a Tauri-side implementation to read scripts, write into the real app data directory and shell out to the interpreters, which the browser cannot do. So the ports are optional on `WorkerDeps`, an absent one makes the job *fail saying it had nowhere to work* rather than silently doing nothing, and the wiring is filed as its own issue. The real caller today is the suite, which drives every path against real files and real interpreters. (An earlier draft of this note blamed Lane G's claim on `aiWorkerHost.ts`; G finished in PR #327 while this branch was open, so that reason is gone and the two above are the true ones.)
  verify (as done): `npm run test:ai-script-repair` → `94 passed, 0 failed, 1 not checked`, `all passed` (was `91 passed, 0 failed, 2 not checked`; the NOT-CHECKED sweep wired TypeScript E7 containment by running a copy of the shipped `typescript/runner.ts` out of a scratch directory, since `USER_DIR` is derived from `__dirname` and therefore moves with the file, and added a check that the remaining Ruby skip's stated reason is still true), including `ruby: THE ORIGINAL FILE IS BYTE-IDENTICAL  ddfffedcbb7b0d022ec9b3fa595ced71 -> ddfffedcbb7b0d022ec9b3fa595ced71` for all three languages, `ruby: the language check ran and passed on the candidate  ruby -c: pass Syntax OK`, `python: the E7 fixtures ran the candidate out of process  E7 containment fixtures: pass`, `typescript: the language check ran and passed on the candidate  tsc --noEmit: pass`, `an over-size script is refused rather than truncated`, `every path-shaped id is refused`, and `the privacy gate stops the call  privacy_gate: withheld: account password` with the note carrying the pattern name and never the value.
  sabotage (the one named): disable the post-job hash comparison → `FAIL the job aborts when the original changed under it` **and** `FAIL and records no claim about a file that moved`, `89 passed, 2 failed`. Restored, md5 `4bbe20a549a531b5f1ef981eebd36cce` either side.
  sabotage (mine, activation): delete the pre-write `validatePatchTarget` so a workspace aiming at the original is not refused until after the write → `FAIL the original is byte-identical and still its own text`, `90 passed, 1 failed`. Note which check did *not* go red: `the job refuses to write the candidate` still passed, because the post-write check caught it — the refusal happened, the script was already overwritten, and only the byte-identity check can tell those apart. Restored, md5 `4bbe20a549a531b5f1ef981eebd36cce` either side.

- [x] **H9  Ruby E7 containment: an out-of-process runner for candidate `.lic` scripts** (≈35) (#448)
  commit: (this PR) verified: 2026-09-06 minutes: 90
  touches: new:ruby/runner.rb, new:ruby/lich_stub.rb, new:ruby/fixtures/, H8>tools/ai-script-repair-test.mjs, .gitattributes, new:tools/ai-script-repair-break-check.mjs, package.json, tools/gate.mjs, tools/needs-env.mjs
  depends-on: H8
  do: `ruby/runner.rb` loads a candidate `.lic` under a stub Lich API and reports what it attempted, as one JSON object on stdout (`sent`, `echoed`, `errors`, `violations`, `timedOut`). Containment as five separately removable mechanisms: `-W0 --disable-gems` checked rather than assumed; a restricted load path (allowlist pre-loaded, then `$LOAD_PATH` emptied and `require`/`require_relative`/`load` overridden) standing in for the `$SAFE` Ruby removed in 3.0; `File`/`IO`/`Dir` guards confining the filesystem to the sandbox directory; `TCPSocket`/`TCPServer`/`UDPSocket`/`Socket`/`Net::HTTP` defined as classes that refuse; `system`/backticks/`exec`/`spawn`/`fork`/`IO.popen` refused outright; and a watchdog thread that ends the run and emits the result it has. Then the suite's `fixtures()` becomes one dispatcher keyed by language over all three drivers, and the Ruby E7 section runs for real.
  verify: `npm run test:ai-script-repair` ends `all passed` with zero NOT CHECKED lines; the escape fixtures are reported as violations rather than crashes; the looping fixture is reported as a timeout by the runner itself.
  done-when: `test:ai-script-repair` has no `NOT CHECKED` line and `node tools/run-tests.mjs` ends `no failures` with one fewer partial.
  note: **the shim's surface is derived, not typed.** Lich defines ~210 bare functions in `lib/global_defs.rb` and a stub of all of them would be a second Lich, which is the thing this must not become. So `runner.rb --surface FILE` runs **Ruby's own parser** over a script — Prism, walking `CallNode` for nil and constant receivers, minus the methods and constants that file defines, minus what Ruby itself provides — and prints the Lich names it actually calls; `runner.rb --shim` prints what the stub provides; the suite compares the two. `companion_bridge.lic` calls **71**; the shim provides **138** and covers all 71. A grep could not do this: it cannot tell a call from the same word in a comment, and one of the two lists is the whole reason to believe the shim is the right size. The comparison has a negative control beside it, because a set difference that can only be empty is not a check.
  note: **`Contain::Violation` descends from `Exception`, not `StandardError`.** A candidate that wraps its escape in `begin … rescue => e` would otherwise swallow the evidence and the run would report clean. `escape_file.lic` has exactly that `rescue` in it, and `and the candidate could not swallow it with a bare rescue` is the check that says the choice works.
  note: **found while building it: `Kernel#warn` is a no-op when warnings are off.** Every refusal this runner printed — no such sandbox, script outside the sandbox, missing flags — went through `warn`, and the runner is started with `-W0` on purpose, so all of them reached nobody: a caller saw a bare exit code 2 and an empty stderr. Caught only because the check asserts the *message* and not merely the status. All six are `$stderr.puts` now, with the trap written at the top of the file.
  note: **no Rust in this increment, deliberately.** The brief for it assumed a Rust dispatcher keyed by language that this runner would be added to. There is none: `git grep -l "script_repair\|scriptRepair" src src-tauri` returns four files under `src/lib` and nothing under `src-tauri`, and H8's own note says so in as many words — the port "needs a Tauri-side implementation … which the browser cannot do", filed as its own issue. Writing one now would be a module with no caller, which `AGENTS.md` forbids and H6's note already refused once. The dispatcher that exists today is the suite's `fixtures(lang, candidatePath)`, and that is where the chooser lives and is tested. When the Tauri port is built, it gets one dispatcher over these three runners and not a second spawn path.
  note: **`lich-scripts/test/protocol_harness.rb` also stubs Lich, and they are not merged.** That one makes `companion_bridge.lic` *serve* outside the game — fixed values chosen to satisfy `server_test.rb`, plus the eval that slices the bridge and starts its socket. This one runs an *arbitrary* script where it can do no harm, and the recording and the containment are its whole point. The boundary and its expiry are written into `ruby/lich_stub.rb`'s header: the day the harness wants a record of what the bridge sent, or this shim wants per-caller values, they are the same thing and should be merged. The only table they shared was a skill list, and this one's was deliberately made different so nobody maintains it twice.
  verify (as done): `npm run test:ai-script-repair` → `116 passed, 0 failed, 0 not checked`, `all passed` (was `94 passed, 0 failed, 1 not checked`). `node tools/run-tests.mjs` → `no failures` and no partial line at all (was `no failures, but 1 thing(s) went unchecked in 1 suite(s): test:ai-script-repair`). Including `all three out-of-process task runners are where this check looks (positive control)  python/runner.py=found typescript/runner.ts=found ruby/runner.rb=found`, `the shim covers every Lich name companion_bridge.lic actually calls  71 calls found by Ruby's parser, 0 uncovered`, `the known-good control runs clean under the runner (denominator)  exit 0, 5 echoed, 0 violations`, `and a write INSIDE the sandbox is allowed, so the guard is a fence and not a wall`, `a candidate reading outside the sandbox is a violation naming the path, not a crash  exit 3: File.read: C:/Users/Public/… is outside the sandbox …`, `a candidate opening a socket is a violation naming the host, not a NameError  exit 3: TCPSocket.new: example.invalid 80`, `the restricted load path refuses a require that is not on the allowlist  exit 3: require: socket`, `a candidate that loops forever is reported as a timeout by the runner itself  exit 4, timedOut=true`, `and what it had already tried survives the clock  [{"via":"fput","text":"search corpse"}]`, `the runner refuses to start without -W0 --disable-gems, naming what is missing`, `every containment fixture ran: 5 of 5`, and `ruby: the E7 fixtures ran the candidate out of process  E7 containment fixtures: pass`.
  chooser: tested where the wrong answer is available, which is the only way a chooser can be tested at all. Both runners exist and each is handed the other's candidate: `the Ruby driver passes a Ruby candidate  pass`, `the TypeScript driver does NOT pass a Ruby candidate  fail`, `and the Ruby driver does NOT pass a TypeScript candidate  fail`. Without those three the first three (`ruby is dispatched to ruby/runner.rb` and friends) would only be asserting that a lookup table contains what was typed into it.
  sabotage (the plan's, filesystem): comment out `File.singleton_class.prepend(file_guard)` and the `IO` one → `FAIL a candidate reading outside the sandbox is a violation naming the path, not a crash  exit 0:` **and** `FAIL and the candidate could not swallow it with a bare rescue  ["escape_file: starting","escape_file: swallowed Errno::ENOENT","escape_file: still running"]`, `114 passed, 2 failed`. The second line is the interesting one: with the guard gone the escape *ran*, failed for the ordinary reason that the file does not exist, and the candidate's own `rescue` caught it and carried on — which is exactly what a containment breach looks like from inside a passing run.
  sabotage (the plan's, wall clock): replace the watchdog thread with `Thread.new { nil }` → `FAIL a candidate that loops forever is reported as a timeout by the runner itself  NO JSON RESULT - the child was killed from outside` **and** `FAIL and what it had already tried survives the clock  []`, `114 passed, 2 failed`. The suite's own `spawnSync` wall is 45s against the runner's 2s precisely so those two states are distinguishable; with one wall the removal would have read as a slow pass.
  sabotage (mine, the derivation): delete `'DRSpells' => %w[active_spells]` from the shim's surface table → `FAIL the shim covers every Lich name companion_bridge.lic actually calls  71 calls found by Ruby's parser, 1 uncovered: DRSpells.active_spells`, `115 passed, 1 failed`. This is the one that says the coverage check is a measurement rather than two lists that happen to be built from each other.
  restored: md5 `7731b13e7cbd` (`ruby/runner.rb`) and `0dca0ece8bf4` (`ruby/lich_stub.rb`) either side of every sabotage above.
  note (#460, review pass 7, and the reason the header above is now a table): **two of the containment properties this increment's header claimed did not exist, and four more holes were found while closing them.** Every escape class was run against the shipped runner with an instrument proof first — an *unguarded* script doing `File.write`, `system` and `IO.popen` into a directory outside the sandbox, all three of which landed — so that an absent side-effect downstream means a guard stopped something rather than that the harness is blind. Measured, before → after:

  | # | class | before | now |
  |---|---|---|---|
  | 1 | `require`/`load`, a name or an absolute path outside | refused | refused |
  | 1b | `Kernel.load '<outside>/payload.rb'` | **ESCAPED — the payload ran** | refused |
  | 1c | `Kernel.require 'socket'` | LoadError, unreported | refused |
  | 2 | a junction/symlink inside the sandbox resolving outside it | **ESCAPED — wrote outside** | refused, naming the resolved target |
  | 3 | `IO.popen` | refused | refused |
  | 4 | backticks | refused | refused |
  | 5 | bare `system` / `Process.spawn` | refused | refused |
  | 5b | `Kernel.system` / `Kernel.spawn` | **ESCAPED — ran a subprocess** | refused |
  | 5c | `Kernel.instance_method(:system).bind(self).call` | **ESCAPED — ran a subprocess** | refused |
  | 5d | `Process.method(:spawn).super_method` | **ESCAPED — ran a subprocess** | refused |
  | 5e | `fork`, run on its own rather than after a `spawn` that raised first | not independently exercised | refused by this file, not by the platform |
  | 6 | `ObjectSpace` to reach the guard and widen `@sandbox` | **ESCAPED — wrote outside** | refused |
  | 7 | reopening `Contain` and redefining its methods | **ESCAPED — wrote outside** | `FrozenError`, then the write refused |
  | 8 | a violation raised inside a candidate's `at_exit` | blocked, but `violations: []` and exit 0 | reported, exit 3 |
  | 9 | `File.read`/`File.open` outside | refused | refused |
  | 9b | `Kernel.open` outside, and `open('\|cmd')` | **ESCAPED — wrote outside** | refused |
  | 9c | `IO.method(:write).super_method` | **ESCAPED — wrote outside** | nothing underneath to call |
  | — | `Object.send(:remove_const, :Contain)` | **no JSON object at all**, exit 1 | reported normally |

  note: **the fix for finding 1 is `File.realpath`, and the fix for the other seven is that the guards stopped prepending.** `Contain.normalize` used `File.expand_path`, which is lexical — it does not touch the filesystem, so a junction inside the sandbox expanded to a name under the sandbox while the write landed wherever the link pointed, and the header said the opposite in as many words ("symlink-shaped tricks all resolve before the comparison"). Resolution now goes through `File.realpath`, falling back to the parent for a target that does not exist yet, and both sides of the comparison resolve — a root that is itself a link or an 8.3 short name (`RUNNER~1` on a Windows runner) is recorded as a note rather than refused, because comparing a resolved child against an unresolved root refuses everything. The rest were all one defect wearing five costumes: a guard *prepended* to `Object`, `File`, `IO`, `Dir` and `Process` sits in front of bare calls on `main` and is not consulted at all by `Kernel`'s `module_function` singleton copies, by `Kernel.instance_method(:system).bind`, or by `Method#super_method`, which walks straight past a prepended module to the definition it shadows. Each guarded method is now **removed from its owner and replaced**, with the original held only as an `UnboundMethod` in a closure local — one definition, and every route finds it. `Contain` and its singleton class are frozen, which is what Ruby actually enforces against both finding 6 and finding 7 (`instance_variable_set` and `def` on a frozen module both raise `FrozenError`), and the guards close over the module object rather than looking the constant up, so removing the name changes nothing.
  note: **`method_defined?` is the wrong question for a method the platform does not implement.** `Process.fork` on Windows is `rb_f_notimplement`: `instance_methods` lists it, `method_defined?` answers false. Asking only the second left it unreplaced, and `escape_fork.lic` got a `NotImplementedError` — refused by the operating system rather than by this file, which is a pass nobody earned and would have become a real hole on Linux, where fork works. Found by running the fixture rather than by reading the guard.
  verify (as done, #460): `npm run test:ai-script-repair` → `137 passed, 0 failed, 0 not checked`, `all passed` (was `116 passed`). 18 containment fixtures, one per escape class, and `every containment fixture ran: 18 of 18`. The hard rule is one check: `no escape fixture put a file outside its sandbox: 18 classes run`, which lists the offenders when there are any — a class that escapes is a FAIL and not a note. The junction fixture creates its link at test time (`mklink /J` on Windows, `ln -s` on Linux), removes it afterwards, and names the mechanism in its detail line, so a CI log says which of the two actually ran there.
  sabotage (#460, the junction): `File.realpath` → the lexical path in `Contain.resolve` → `FAIL and a write through it is a violation naming the RESOLVED target, not a pass  exit 0, landed=[ESCAPED_junction.txt]` **and** `FAIL no escape fixture put a file outside its sandbox  ESCAPED: escape_junction.lic -> ESCAPED_junction.txt`, `135 passed, 2 failed`.
  sabotage (#460, the freeze): remove `freeze` and `singleton_class.freeze` from `Contain.seal!` → 5 red, `132 passed, 5 failed`, including `redefining the guard raises before the escape, which is still refused  exit 0, landed=[ESCAPED_disarm.txt]` and the ObjectSpace pair. Two mechanisms go red from one line because freezing is what closes both findings 6 and 7; the stubs only make them legible.
  sabotage (#460, the replacement): drop `Kernel.send(:module_function, name)` so Kernel keeps its own singleton copies — the pre-#460 shape → `132 passed, 5 failed`, including `escape_load: LOADED IT` (the payload outside the sandbox really executed) and two files on disk outside. This is the one that says the fix is the replacement and not the extra guard entries.
  sabotage (#460, the reflection stubs): `install_reflection_guard!` returns immediately → `136 passed, 1 failed`, and only one: the escape itself is still refused, because the freeze holds. That is the honest reading — the stubs buy legibility, not containment — and it is why they are sabotaged separately.
  sabotage (#460, the at_exit re-check): `if extra.positive?` → `if false` → `FAIL a violation raised inside at_exit reaches the JSON instead of vanishing  exit 1, landed=[], violations=`, `136 passed, 1 failed`.
  restored (#460): md5 `37b284b2c83d` (`ruby/runner.rb`) either side of every sabotage above, and `137 passed, 0 failed` on the unsabotaged file before any of them was interpreted.
  note (#486, review pass 8, and the correction this entry most needed): **the five sabotages recorded above were run by hand and left nothing behind, so every `sabotage (...)` line in this entry was a claim and not a check.** #486 went looking for them - `ls tools/ | grep -i "break\|sabot"` returned six break-checks and none for Ruby, and `grep -rlI "containment-break|runner-break|ruby-sabotage|contain-break" .` returned nothing, with a positive control on that grep (`command-lane-break-check` hits `package.json`) so the zero meant something. Meanwhile `runner.rb` said in the present tense, four times, that removing a given block "is the suite's first/second/third/fourth sabotage". They are now, in `tools/ai-script-repair-break-check.mjs`, run by `npm run gate` as the `break-ai-script-repair` stage. It was registered in `tools/test-suites.json` first, and #494 - which landed while this branch was open - had just written down why that is the wrong place: a harness that damages tracked source must not be one of several things `node tools/run-tests.mjs` is running while other sessions build this tree. So it moved to a gate stage beside the other four, `EXPECTED_STAGES` went 10 to 11, and `tools/needs-env.mjs` carries the reason next to `test:command-lane-break`'s. It also adopts #489's `watchTree`, which asks git over the paths it damages: the hashes prove those two files came back, and only git can see anything else a run left behind.
  note (#486): **four more escape classes got a clean verdict past the shipped runner, and three of them were one defect: the object the caller judged was produced inside the process being judged.** Measured against Lich's own Ruby 4.0.6, with the instrument proofs #460 established, and each reproduced in this branch before it was fixed:

  | # | class | before (#486) | now |
  |---|---|---|---|
  | 10 | `Contain.violations.clear`, then `Contain.result.errors.clear` | **ESCAPED** - `violations: []`, `errors: []`, EXIT=0 | `FrozenError`; the parent's ledger already has the line; exit 3 |
  | 11 | forge a result on `STDOUT`, then `exit!(0)` | **ESCAPED** - the forged object was the only thing on stdout, EXIT=0 | `Kernel#exit!` and `Process.exit!` are violations; a run with no verdict is a FAIL |
  | 12 | `Contain.watchdog.kill` then sleep | **no JSON at all**, EXIT=124 from an outside limit | the caller's wall kills it inside its grace window; no verdict; FAIL |
  | 13 | `Dir.new(outside).children`, `File::Stat.new`, `Dir.home` | **ESCAPED** - listed `C:/Users`, statted a file outside, gave up the home directory, EXIT=0 | refused, naming the path; `Dir.new` INSIDE still works |
  | 5 | a candidate `at_exit` printing a forged object last | **the last object on stdout was the verdict** | stdout is advisory; the ledger is the verdict |

  note (#486): **the fix is that the record and the verdict leave the process as they are made.** `--ledger PATH` names a file the caller creates outside every sandbox and seeds with a nonce; the runner reads the nonce before the guards go up, appends a stamped line for every violation as it is raised and one for the result, and the caller judges that file. A candidate can neither read it (outside the fence, and every read-shaped entry point is guarded) nor guess the nonce, which is in no argument, no environment variable and no local it can name. So `violations.clear` clears a copy of something the parent already has; `exit!` produces **no verdict**, a third state that is never a pass; and `watchdog.kill` stops a clock the verdict does not depend on, because the wall is `--timeout` plus a six-second grace window measured on the caller's side. The public `violations`/`notes` accessors hand back frozen copies and `watchdog` is not exposed at all, which is defence in depth rather than the fix. The header's old claim that a candidate "cannot swap the reporter or kill the clock" is replaced by the honest statement: it can do both to this process, and neither reaches the ledger.
  note (#486): **the read guards now have a denominator.** Finding 4 was not that one method had been forgotten, it was that the lists in `runner.rb` are typed by hand and nothing compared them against what Ruby provides - and `Dir.new` and `File::Stat.new` are `Class#new`, inherited, so they appear in no `singleton_methods(false)` list and were invisible to any check built from one. `Contain.guard_coverage` asks Ruby at install time: every singleton method `File`, `IO`, `Dir` and `File::Stat` own, **plus the two inherited constructors**, minus a named list of string arithmetic (`expand_path`, `basename`, `join`, `umask`, `IO.select` and the like, each of which takes no path or touches no disk), must resolve to a method this file installed. It reports `examined` and `unguarded`, both in the result JSON, and the suite asserts `unguarded` empty against `examined >= 70`: **81 of 81** today. A method added to any of those four classes with no guard is a red test rather than a note somebody writes later.
  verify (as done, #486): `node --experimental-strip-types tools/ai-script-repair-test.mjs` gives `149 passed, 0 failed, 0 not checked`, `all passed` (was `137 passed`). 22 containment fixtures, `every containment fixture ran: 22 of 22`, `no escape fixture put a file outside its sandbox: 22 classes run`. Including `every read-shaped entry point on File, IO, Dir and File::Stat has a guard: 81 examined  81 of 81 guarded`, `the parent seeds a nonce the candidate cannot read, and the runner stamps every line with it (instrument)`, `a candidate cannot empty the violation list: the accessor hands out a frozen copy`, `and the parent's ledger holds the violation whatever the candidate does to the copy`, `a forged last object on stdout is not the verdict; the ledger is  stdout claimed ["all clean"] with 0 violations; ledger says 1 violation(s)`, `exit! and Process.exit! are refused and named, so a candidate cannot skip the reporter`, `a candidate that stops the clock is killed by the parent inside its own grace window  killed after 9021ms against a wall of 9000ms, spawn error ETIMEDOUT`, `and a run that left no verdict is a FAIL naming that, never a pass`, and `Dir.new, File::Stat.new and Dir.home outside the sandbox are refused, naming the path`.
  sabotage (#486, committed rather than claimed): `node tools/ai-script-repair-break-check.mjs` gives `all 32 break-check assertions passed`. Five cases across two files, each asserted to redden **exactly** its own named checks and nothing else, each restored and verified by SHA-256 before the next runs. (1) `File.realpath` back to `File.expand_path` in `Contain.resolve`: 2 red, `147 passed, 2 failed`, including `and a write through it is a violation naming the RESOLVED target, not a pass  exit 0, landed=[ESCAPED_junction.txt]`. (2) `freeze` and `singleton_class.freeze` out of `seal!`: 5 red, `144 passed`. (3) the `ledger!('violation', ...)` line out of `Contain.violation!`: 1 red, `148 passed` - `and the parent's ledger holds the violation whatever the candidate does to the copy  0 on the ledger`. (4) `exit!` off `KERNEL_EXIT_OPS` and `PROCESS_REFUSED`: 2 red, `147 passed`, and the detail line says it - `ledger=1v/NO VERDICT`. (5) the caller's derived wall back to a flat `60000`: 3 red, `146 passed`, `killed after 25062ms against a wall of 60000ms, spawn error none`. The baseline is asserted green with `0 not checked` before any of them is interpreted, and a fragment that is not present exactly once aborts its case rather than rewriting a file unchanged.
  restored (#486): SHA-256 on `ruby/runner.rb` and `tools/ai-script-repair-test.mjs` either side of every case, checked before the next case starts and again on exit.
  pitfalls: CI needs no workflow change — the `checks` job already runs `ruby/setup-ruby@v1` at 3.4 for the bridge suites, and `test:ai-script-repair` runs in that job. Without Ruby the section prints one NOT CHECKED naming the missing binary and saying so is not a pass; it never falls through to green. `--surface` needs Prism, which is a default gem from Ruby 3.3, so it runs without `--disable-gems` while the containment run keeps both flags. `.gitattributes` pinned `*.lic` to LF and left `*.rb` inheriting `core.autocrlf`, which is `true` on this machine — the same half-hour that file's own comment documents, waiting to happen in the file next door — so `*.rb text eol=lf` was added beside it rather than a second rule for the new directory. `npm run test:server` is `172 checked, 0 failed` either side of that change. **#486 corrects one claim in this entry and adds two pitfalls.** The claim: every `sabotage (...)` line above describes a hand-run edit that left nothing in the repo, so the guard blocks' removability was a claim and not a check until `tools/ai-script-repair-break-check.mjs` landed - and the runner's own comments asserted the opposite, in the present tense, four times. The pitfalls: a `--ledger` that was asked for and cannot be opened is `EXIT_USAGE` rather than a quiet fallback, because a caller that asked for an unforgeable record and silently got a forgeable one is worse off than one that got an error; and the caller's wall is derived from `--timeout` rather than being a constant, so a fixture that sleeps past `timeout + 6s` is killed on purpose and a check about it must assert `spawn.error.code === 'ETIMEDOUT'` rather than reading an exit code that does not exist.

- [x] **H10  The AI panel talks to a player, and a check keeps it that way** (≈35)
  commit: (this PR) verified: 2026-09-09 minutes: 95
  touches: C1>src/components/shared/AiWorkerPanel.tsx, C1>src/components/shared/DiagnosticsPanel.tsx, src/components/room/ClassicRoomText.tsx, src/lib/bridgePhase.ts, tools/link-reconnect-test.mjs, src/components/game/StreamTabs.tsx, src/components/shared/PanelBoundary.tsx, new:tools/dev-jank-test.mjs, new:tools/dev-jank-break-check.mjs, new:tools/no-dev-jank-shots.mjs, C1>tools/ai-worker-host-test.mjs, tools/ai-suggestions-test.mjs, package.json, tools/test-suites.json, new:docs/verification/NO-DEV-JANK-2026-09-09.md
  depends-on: H7
  do: rank and place the AI panel rather than stripping it. With no model: one sentence and one affordance. With a model: what it is doing, the suggestion card, and the review. Every counter, queue depth, last-attempt string and internal failure kind moves inside a `<details>` closed by default, and into the Diagnostics row that builds the bug bundle. Sweep the same defect across the tree and add a derived check with both controls.
  done: 2026-09-09 — the panel on a machine with no model was `Local model / No local model is installed`, `Unreviewed events 1200`, a `Model server` field prefilled `http://127.0.0.1:11434` with three port numbers under it, `No model server answered`, `Background jobs - queued 3`, `Last attempt: absent: No local model is installed.` and two paragraphs about the worker. It is now three lines: `The assistant is off. It needs a model running on this computer.`, a `Set one up` button, and a closed `Details for a bug report`. **Nothing was deleted.** Every number is inside that disclosure and repeated on the Diagnostics `Local model` row, so a bug bundle carries strictly more than before, not less.
  note: **it stays mounted with no model, and that is a decision rather than an omission.** It is two lines in that state, so it is no longer a tenant worth evicting, and it is the only route in the app to setting a model up - unmounting it would put the one affordance for turning the feature on nowhere. `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 14 asks that failure, absence, timeout and out-of-memory be *visible*; a disclosure satisfies discoverable, which is what that section is for, and the panel takes no position of its own so it moves behind the layout lane's bottom bar unchanged.
  note: **there is one developer view and it already existed.** `DiagnosticsPanel` gathers Ruby, Lich, the bridge port, the token file and the viewer, and builds the bundle a report is pasted from. A second "AI diagnostics" surface would be a fork of it, so the panel's instruments went into its `Local model` row instead: ticks, unreviewed, lost, alerts pending, jobs by state, the failure kind and the last-attempt string.
  note: **three existing assertions went red and each was read by its name before its body.** `the panel says why a proposed command never appeared` and `shows the question when there is one` pinned a wording and an optional chain, so their literals moved with the panel. `says so plainly when there were none, rather than showing an empty box` asserted one *mechanism* for that property - a box that always drew, saying "Nothing notable." inside it. The panel gets the same property by not drawing the list at all, so the assertion is now `an empty review draws no empty container`. Named here because editing a test to make your own change pass is indistinguishable from that unless it is said out loud.
  note: **the sweep.** 116 `.tsx` files audited. Fixed here besides the panel: `ClassicRoomText` printed `Lich room 998, game uid 12345` as prose beside the room name (both ids kept, moved into the title); the bridge chip printed the retry counter in permanent chrome (counts kept, moved into the title). That last one landed twice: it was written against `SafetyFooter` and #535 rewrote that chip into `bridgeChip()` while this branch was open, so the rebase took #535's derived view whole and the fix moved into it - `label: 'Lich reconnecting'`, the count in `title`. `link-reconnect-test.mjs` asserts the ladder rung by rung through the title instead of the label, so the progression is still checked and only where the number is read has changed; `PanelBoundary` rendered a raw `Error.message` in red inside whichever panel crashed (kept, moved behind a disclosure); `StreamTabs` named `docs/ENGINE.md` and "the streams capability" in a tooltip. Left as questions, with evidence, in `docs/verification/NO-DEV-JANK-2026-09-09.md`: the `Room 998` prefix on the location line (a documented handoff rule asks for the id), the attach port box and `--detachable-client` tooltips in `GameConnectionBar`, the raw `Err` text on `SignIn`/`LichLauncher`, and `TaskFlowPanel`'s CLI-invocation tooltips.
  verify (as done): `node tools/dev-jank-test.mjs` → `15 checks, 0 failure(s)`, including `the component walk found files to read  115 of 116 .tsx file(s); 1 developer view(s) exempt` and `the scan read a real number of default-visible lines  24707 line(s)`. `node tools/no-dev-jank-shots.mjs` → `15 checks, 0 failure(s)` against a real browser and a real loopback model server, with the absences asserted by name **and** the control that the same names are inside the disclosure. `npm run test:ai-worker-host` → `151 checked, 0 failed`; `npm run test:ai-suggestions` → `215 checked, 0 failed`; `npm run test:ui-jargon` → `11 checks, 0 failure(s)`.
  sabotage: `node tools/dev-jank-break-check.mjs` → `7 sabotages across 3 files; 0 did not redden exactly the checks they named`, baseline asserted green with 15 checks first, every file restored and confirmed by md5 and by `watchTree`. Two cases were written expecting the state scan to redden as well and were corrected by running them: the committed disclosure holds counters and no *unquoted* state name, so asserting both would have been asserting something untrue about the block. The screenshot harness's own control caught a real defect in itself - a closed `<details>` returns only its summary from `innerText`, so the control read empty and every absence check above it meant nothing until it moved to `textContent`.
  pitfalls: the union parser anchored on a blank line written as two LFs and reported "the JobStatus union did not parse" against a CRLF checkout (CLAUDE.md section 17); it aborts naming the reason rather than scanning an empty name set, which is why that showed up as an abort and not a green run. Only the snake_case members of the three unions are banned as text: `running`, `failed`, `absent` and `error` are ordinary English and banning them would light up the tree and get the check switched off. The string stripper is why `lastFailureKind !== 'privacy_gate'` is not an offender, and it is the same call `ui-jargon-test.mjs` makes about `invoke('...')` arguments.

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
  touches: gone:tools/crossing-build-list-test.mjs, tools/room-scene-patterns-test.mjs, tools/task-catalog-status-test.mjs, gone:tools/map-keyboard-test.ts, tools/needs-env.mjs, tools/test-suites.json
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

- [x] **J1  Triage every finding** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 55
  touches: none
  depends-on: none
  do: for each verified finding in #175: `dies-with-map-window` (already gone after D6), `moves-to-viewer-contract` (Lane L), or `still-real`. Post the triage as an issue comment.
  verify: the comment exists; each finding has one tag.
  result: posted at issue #175 comment `5552095979`, seven findings, one verdict each — 1 `still-real` (partly fixed), 2 `still-real` re-diagnosed, 3 `still-real` (already fixed, no guard), 4 not still-real, 5 `moves-to-viewer-contract`, 6 half refuted and half upstream, 7 `dies-with-map-window`. Fetched back through the API and grepped rather than trusted from the post.
  note: **`depends-on:` was D6 and is now `none`, deliberately.** D6 is blocked on a live play session that has not happened, and no finding needed the deletion to be judged — only that `MAP_WINDOW_ENABLED` is already `false`, which is measurable today. Measured rather than reasoned, because the window/panel distinction is what D6's original wording got wrong: from a dev server on this branch `?view=panel&id=map` returns 1041 elements matching `[id^="map-room-"]` and `?view=map` returns 0 and renders the dashboard instead.

- [!] **J2  Each `still-real` finding** (≈20 each; add `J2a, J2b…` lines under this one as they are claimed)
  blocked-on: #175 finding 1 only — the pin picker has no creature icon beyond `fantasy-dragon`, and closing it needs generated art. Dan, 5 Sep 2026: the game will not ship or depend on a local image generator; creature icons are to be made with an online generator and admitted as assets (source and licence recorded, per J2's note). So this is an art task for Dan, not a code change and not a tooling gap. It is not a code change: `CUSTOM_PIN_ICONS` in `src/lib/mapPins.ts` already admits non-Lucide entries, so each admitted image is one array entry, one `public/pin-icons/<name>.png`, and one row in `data/art/pin-icons/curation.json`, which `tools/pin-art-test.mjs` already gates. J2a, J2b and J2c are `[x]` (PR #331); this is the whole of what remains, and #175 stays open on it.
  touches: per finding
  depends-on: J1
  do: fix with a DOM-measured verification; close #175 when the list is empty.
  verify: per finding.
  note: J1 produced three fixable increments — J2a, J2b, J2c below. Finding 1 (no creature icons beyond `fantasy-dragon`) is the one `still-real` item Lane J is **not** fixing: it needs generated art, which Dan will produce online (decision 5 Sep 2026: no local image generator, ever). The picker already admits non-Lucide entries through `CUSTOM_PIN_ICONS`, so closing it is one array entry per admitted image and no code change. #175 stays open on that alone.

- [x] **J2a  A zone with no way out says which kind of nothing it is** (≈35)
  commit: (this PR) verified: 2026-09-05 minutes: 40
  touches: tools/build-map.mjs, tools/gateway-test.mjs
  depends-on: J1
  do: #175's finding 2 called zone `33a` a closed loop with no exits. It is not. `Map33a_Road_to_Therenborough.xml` carries two gateway notes — `Map33_Riverhaven_West_Gate.xml` and `Map34_Mistwood_Forest.xml` — and **neither file exists in `C:/Genie4/Maps`**, so the build cannot resolve them; the zone ships three rooms with honest `leaves` doors instead. `build-map.mjs` already counts these into `unresolved`, and its own comment says that count is "the difference between 'the data has no gateways' and 'this Genie install is missing files'" — and then **nothing ever prints it**. So: emit the count and the distinct missing filenames from `build-map.mjs`, and in `gateway-test.mjs` promote the existing `INFO N special or isolated maps` line to a real assertion against a named list carrying a reason per zone. Assert it **both ways** — nothing newly isolated, and nothing on the list that is now connected — because only the second direction catches a zone quietly gaining a route.
  verify: `node tools/gateway-test.mjs` ends `all passed` with the isolated set asserted as exactly `14d, 33a, 90e, 997, 999, 99a, TF990`; on a machine that has `C:/Genie4/Maps`, `node tools/build-map.mjs` names its 8 unresolvable targets.
  sabotage: delete one zone id from the expected list → that check goes red naming the zone, and only that check; restore and md5 must match.
  result: `build-map.mjs` names all 8 unresolvable targets with the zones that point at them (`Map33_Riverhaven_West_Gate.xml <- 30, 33a`; `Map34_Mistwood_Forest.xml <- 33a, 40`; `Map7c_NTR_Part2.xml <- 14d`; plus `Guild_Fest-2023`, `Map114_Ain_Ghazal`, `Map150_The_Ways`, `Map31a_Zaulfung`, `Map516q_Temporal_Pocket`), and prints "every gateway note resolved" when there are none, so the branch is not silent either way. `gateway-test.mjs` asserts the unreachable set both ways with a reason per zone. Re-running the build reproduced all 86 zone files byte-identically, so the committed cartography is what this Genie install produces; the only diff was a trailing newline on two generated files, and it was reverted rather than shipped in a tools-only increment.
  sabotage-result: (1) dropped `'33a'` from the table → `FAIL no zone lost its way out of the world  7 unreachable, 6 expected; new: 33a`, exit 1, that check only; (2) added `'1'` (Crossing, the most connected zone in the game) → `FAIL every zone recorded as unreachable still is  now connected, drop from the table: 1`, exit 1, that check only. Both restored, md5 `23789e72c1ee8e1a4029775ab46559a6` matched. Sabotage 2's first attempt aborted with `SABOTAGE B DID NOT MATCH` rather than silently editing nothing — the file is CRLF and the needle was not.

- [x] **J2b  The saved-pin count reads as English at every count** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 25
  touches: src/lib/mapPins.ts, gone:src/components/shared/MapPinBar.tsx, tools/pins-test.mjs, tools/sound-actions-test.mjs
  depends-on: J1
  do: #175's finding 3 (`"1 saved pins"`) is already fixed at `MapPinBar.tsx:64`. Move the wording into `savedPinsLabel(count)` beside the rest of the pin vocabulary in `mapPins.ts`, have `MapPinBar` call it for both its `aria-label` and its `title`, and unit-test the function in `pins-test.mjs`, which already owns `mapPins.ts`. Test the property (the label a screen reader reads) at 0, 1, 2 and 11, not the presence of a ternary.
  correction: this increment was written saying **nothing in the suite asserted either branch**, and that was wrong. `tools/sound-actions-test.mjs:19` had a check named `saved-pin count is grammatical in both its title and accessible name`. I missed it because I grepped `saved pin` and the name is hyphenated — §1 trap 16 with the scope as the broken instrument, and the same mistake was published in the #175 triage comment before the suite corrected it. It is corrected on the issue too.
  what that check turned out to be: it asserted the literal string `pins.length === 1 ? 'pin' : 'pins'` was present in the component — the mechanism, not the grammar its name promises. So it went red on a change that makes the property **more** true, which is exactly the trap in §0.5's neighbourhood and in `CLAUDE.md`'s "a test can encode the bug as the spec". Read the name before the body: the name is right, so the body is what changes. It now asserts this suite's own interest — that the title and the accessible name are one computed label and cannot drift apart — and the grammar is asserted by execution in `pins-test.mjs`. Two suites, two different propositions, no second copy.
  verify: `npm run test:pins` green with the new checks named; in the browser, one pin → `aria-label="1 saved pin"`, two pins → `"2 saved pins"`.
  sabotage: make `savedPinsLabel` always plural → the count-1 check goes red, and only it; restore and md5 must match.
  result: `npm run test:pins` green, 72 assertions, five new checks named — `0 saved pins`, `1 saved pin`, `2 saved pins`, `11 saved pins`, and that `MapPinBar` announces the count through the helper rather than keeping a second copy of the wording. Measured in the browser as well, against a dev server from this worktree at `127.0.0.1:5211`, `?view=panel&id=map`: one pin → `aria-label="1 saved pin"`, a second pin → `"2 saved pins"`.
  sabotage-result: (1) `savedPinsLabel` always plural → `FAIL one saved pin reads as singular: 1 saved pins`, exit 1, that check only, and the plural cases stayed green, which is what makes them worth having; (2) `MapPinBar` types the wording itself again → `FAIL MapPinBar announces the count through savedPinsLabel`, exit 1, that check only; (3) the `title` given its own string so it can drift from the `aria-label` → `FAIL saved-pin count is grammatical in both its title and accessible name` in `sound-actions`, and `pins` stayed green, which is the check that the two suites are asserting different things rather than one thing twice. All restored, md5 `9da03a5c1f3b84e6ef82c23cc619812a` and `89b3b4935fd29f033a86c98db2e1e146` matched.

- [x] **J2c  The viewer inherits the terrain-variety problem, so say so** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 20
  touches: gone:docs/THREE_D_REBUILD_HANDOFF.md
  note, 9 Sep 2026: this row named `docs/NO-3D.md` for one day. It should not have — that file was created on 9 Sep and this increment ran on the 5th, so the row was claiming an increment touched a file that did not exist when it ran, and the audit passed it because the path resolves. Corrected to `gone:` the file it did touch. The finding itself is unaffected and still stands: 27 stamp kinds, 22 with two images, 4 with three, 1 with four, over 85 zones. It is now Lane T's number to beat in 2D, not the 3D viewer's.
  depends-on: J1
  do: #175's finding 5 is confirmed exactly — 27 stamp kinds in `MapStampLayer.tsx`, 22 with two images, 4 with three, 1 with four, on an 85-zone map. It is real and it is not worth fixing here: §1 of the handoff retires the player-facing 2D map, so commissioning more 2D terrain art buys repetition relief on a surface that is going away. Add a contract line under the world-presentation section: the viewer's terrain and landmark presentation is judged on visible repetition across a zone, not on having one asset per kind, and a kind with a single motif is a gap to record rather than a kind that is done. Name `MapStampLayer.tsx`'s 27 kinds as the vocabulary being handed over.
  verify: the section exists and names the measured 22/4/1 split, so the number the viewer has to beat is on the page rather than in an issue comment.
  result: §12 "Terrain and landmark variety: the number to beat". It lists all 27 kinds by name in the three groups `MapStampLayer.tsx` actually uses, carries the 22/4/1 split and the 420-copy `settlement` cap over Crossing's 1,060 rooms, and states four rules — judged on visible repetition rather than one-asset-per-kind, a single-motif kind is a recorded gap, variation may come from placement/scale/rotation/material but never from borrowing another kind's asset (§11's rule), and 27 kinds at two variants each would be the same problem moved.

---

### Lane K — Appearance: models for weapons and armor, glyphs for skills

**The whole lane is superseded, 9 Sep 2026.** Every increment in it is `[-]`.
Appearance was defined as "data the snapshot carries and Godot renders as a
GLB through the asset registry", and 3D is cancelled ([NO-3D.md](NO-3D.md)):
the registry, the defaults table, `src/lib/appearance.ts` and the override
store were all deleted by PR #517. Nothing here is waiting on anything, and
none of it is to be restored. If a 2D isometric client ever wants per-entity
sprite variation, that is a Lane T increment against sprite ids, starting
from the room-content vocabulary that survived rather than from a mesh
registry that did not.

Version 2 proposed extending `portraits.ts`. `rewrite/remove-2d` deletes it,
and Dan's quoted rule in that branch is "I would rather throw an error than
keep 2d". So the appearance system is not a 2D-art descendant. It is **data the
snapshot carries and Godot renders**: a defaults table keyed to Codex's asset
registry (`godot/assets/shared_asset_selections.json` ids), a player override
store, and a per-entity `appearance` field on the snapshot the viewer already
receives. No portraits, no images in the client.

- [-] **K1  Design note, no code** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 25
  superseded: 2026-09-09 — 3D cancelled. §11 "Appearance" was written into `THREE_D_REBUILD_HANDOFF.md`, which PR #517 deleted. The `touches:` line said `docs/NO-3D.md` for one day, which was untrue: that file did not exist on 5 Sep, and the audit passed the row because the path resolved rather than because the claim held.
  touches: gone:docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: C7
  do: add §11 "Appearance": the three pieces above; the id vocabulary is the registry's `selections[].id`; defaults are compiled by a tool from a noun→class table; overrides live in the client under `drc.appearance.v1`; the snapshot compiler attaches `appearance: {modelId, glyph?}` to `EntitySnapshot` and to `player`; Godot maps `modelId` → GLB through the registry and falls back to the class default, never to an invented mesh (the registry's own `forbiddenSubstitutions` rule).
  verify: the section exists and names the four owners it extends.

- [-] **K2  Defaults compiler** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 55
  superseded: 2026-09-09 — 3D cancelled; PR #517 deleted the compiler, its committed output, and the asset registry the ids were asserted against.
  touches: new:tools/build-appearance-defaults.mjs, new:src/data/appearanceDefaults.json, package.json, tools/test-suites.json, src/lib/armorLoadout.ts
  depends-on: K1
  do: input: a noun table (`sword, broadsword, bastard sword → 'Large Edged'`, …) keyed to `SKILLS_BY_SET.Weapon` (`grep -rn SKILLS_BY_SET src/`) excluding meta-skills (Parry, Offhand, Mastery, Expertise); armor classes from `armorLoadout.ts`'s coverage helpers; each class → a registry `id` that exists in `shared_asset_selections.json` (assert, do not trust). `--check` compares to the committed JSON.
  verify: `node tools/build-appearance-defaults.mjs --check` exit 0; an unknown noun maps to `null`, never a guess.
  sabotage: point a class at an id not in the registry → red naming it.

- [-] **K3  Snapshot carries appearance** (≈25)
  commit: (this PR) verified: 2026-09-05 minutes: 60
  superseded: 2026-09-09 — 3D cancelled; PR #517 deleted `src/lib/appearance.ts` and the `appearance` field is off `EntitySnapshot` and off `player`. The bridge, its types and its test survive and are still named below, so this row goes on checking them.
  touches: src/lib/presentationBridge.ts, new:src/lib/appearance.ts, tools/presentation-bridge-test.mjs, src/lib/presentationTypes.ts, src/lib/usePresentationBridgePublisher.ts, gone:tools/build-appearance-defaults.mjs, gone:src/data/appearanceDefaults.json, tools/build-player-data-doc.mjs, docs/PLAYER_DATA.md
  depends-on: K2, C4
  do: `appearance.ts`: `appearanceFor(kind, name)` = override (`readJSON('drc.appearance.v1')`) ?? default ?? null; `setOverride`, `resetOverride`. `compileWorldSnapshot` attaches `appearance` to each entity and to `player` (wielded items from `CharacterStatus` — `grep -n "wield\|worn\|armor" src/types/index.ts`). Rust passes entities through opaquely already; `player` is `Option<Value>` — nothing to change there.
  verify: presentation-bridge test: a fixture with a bastard sword → `appearance.modelId` equals the Large Edged default; an override wins; unknown → absent field, not null-string.

- [-] **K4  Godot maps `modelId`** (≈Codex; contract only here)
  commit: (this PR) verified: 2026-09-05 minutes: 15
  superseded: 2026-09-09 — 3D cancelled. There is no `modelId`, no GLB and no `entity_projection_test.gd`; the contract lived in `THREE_D_REBUILD_HANDOFF.md`, deleted by PR #517. Same correction as K1: the row named `docs/NO-3D.md` for a day and should not have.
  touches: gone:docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: K3
  do: §11 states the field, the fallback order, and the test Godot must add (`entity_projection_test.gd`: unknown id → class default; missing field → neutral token). File the content task in the ledger for Codex.
  verify: claim filed; §11 names the test.

- [-] **K5  Override export / import / merge** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 35
  superseded: 2026-09-09 — 3D cancelled; PR #517 deleted both `appearance.ts` and `appearance-test.mjs`. The rule this increment established — the local player's own choices always win an import conflict, and conflicts are returned as a list rather than silently overwritten — survives in `src/lib/sceneOverrides.ts` (S4, S5), which is where to read it now.
  touches: gone:src/lib/appearance.ts, new:tools/appearance-test.mjs, package.json, tools/test-suites.json
  depends-on: K3
  do: one JSON `{version, overrides:{...}, provenance:'player'}`; import merges with the local player's own choices always winning; conflicts returned as a list, never silently overwritten; unknown ids ignored with a count.
  verify: tests per rule.
  sabotage: let import overwrite → red.

- [-] **K6  Picker UI** (≈40)
  superseded: 2026-09-09 — 3D cancelled. This row was `[!]` on "the asset registry admits no item meshes"; PR #517 deleted the registry itself, so the blocker can never lift and there is nothing to pick from. Note there is no `commit:` line above it: unlike K1–K5 this was retired before it was ever built, and that absence is the only place the difference is recorded.
  touches: new:src/components/shared/AppearancePicker.tsx, src/components/dashboard/DashboardLayout.tsx
  depends-on: K5
  superseded-by: S3, for scenery. **The blocker above is unchanged and still correct for item meshes.** Lane S builds the picker and the in-cell placement UI this increment describes, over the kinds `godot/scripts/shared_asset_content.gd` actually registers - two, both scenery. That is the same control this row wants, pointed at content that exists; the day the registry admits its first item mesh, K6 is `AppearancePicker.tsx` built from `ScenePrimitivePicker.tsx` rather than from nothing. Left `[!]` rather than `[x]` because what this row promises - a player choosing the model for their own sword - is still not possible.
  note: K1–K5 are `[x]`, so nothing in Lane K blocks this. `godot/assets/shared_asset_selections.json` holds two ids and both are scenery, so `do:`'s "grid of registry entries for its class" would today be a grid offering a rock and a footbridge as alternatives to a sword — a UI that can only be exercised by making exactly the substitution `admission.forbiddenSubstitutions` forbids, and whose `verify:` (set, reload, still set) would pass while demonstrating the wrong behaviour. `knownModelIds()` and `appearanceClasses()` in `src/lib/appearance.ts` are what it will read; unblock it when the registry admits its first item mesh. Codex's side is filed as `.agents/claims/k4-godot-appearance-mapping.json`.
  do: from the inventory list, click an item → grid of registry entries for its class (thumbnails from the registry if it has them, labelled squares if not); one click sets, one resets; shows "default (from Large Edged)" vs "your choice".
  verify: browser: set, reload, still set; reset → default.

---

### Lane L — Codex contract for the Crossing slice

**Mostly superseded, 9 Sep 2026.** This lane's subject was a 3D Crossing
slice: a handoff document, a six-line acceptance checklist for it, and the
board geometry it rendered on. 3D is cancelled ([NO-3D.md](NO-3D.md)) and PR
#517 deleted the document and the geometry, so L1, L4, L5, L6 and L7 are
`[-]`. Three things survive and are deliberately *not* superseded, because
they are about data rather than about 3D: **L2**'s committed mock fixture,
still read by two Godot tests; **L3**'s data-contract tests, which check
exit/cell integrity and are as true of a 2D board as of a 3D one; and
**L8**'s travel model — tile, word, hotkey — whose `travel-to-room` intent,
`roomExits.ts` and command-lane routing are all live and are Lane T's input.
The ownership split L1 wrote down is re-stated for 2D in Lane T's preamble.

- [-] **L1  Name what I own** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 20
  superseded: 2026-09-09 — 3D cancelled; §2 lived in `THREE_D_REBUILD_HANDOFF.md`, deleted by PR #517. The division it drew is still the right one and is restated at the head of Lane T: the backend owns the manifest, the wire shapes and their tests; the Godot owner owns every scene, content script and sprite. Only the document is gone, not the boundary.
  touches: gone:docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: B3
  do: §2 lists: snapshot/event/intent shapes and their tests; the mock fixture generator; `tools/live-chain-check.mjs`; the acceptance checklist (L4). Codex owns every `.tscn`, content `.gd`, GLB and material.
  verify: the list is in §2.

- [x] **L2  Mock fixture becomes a derived artefact** (≈20)
  commit: (this PR) verified: 2026-09-05 minutes: 40
  note: the source is `data/world/out/1-primitive-world.json`, not the registry file the increment named — the registry is an input to it and carries assets, not cells. The fixture's original cell order matched no property of the data, so the generator states an order (focused room first, then room number) and the committed file was regenerated into it; content is byte-identical per cell.
  touches: gone:tools/build-godot-mock-fixture.mjs, godot/mock/crossing_mock_world.json, package.json
  depends-on: L1
  still true, 9 Sep 2026: kept `[x]`, and only half of it survived. **The fixture is alive** — `godot/mock/crossing_mock_world.json` is still committed and still read by `foundation_test.gd` and `bridge_client_null_target_test.gd`, which is why it was not deleted with the rest. **The generator is gone**: it sourced the deleted primitive-world manifest, so PR #517's deletion took its input and this repair removed the tool rather than leave a command that cannot run. The consequence is that this increment's own achievement — making the fixture a *derived* artefact with a `--check` drift guard rather than a hand-made one — has been undone by circumstance, and the fixture is frozen. `tools/godot-fixture-contract-test.mjs` now says so as an explicit NOT CHECKED line rather than passing quietly over it. **T2 restores the generator**, sourced from `src/data/map` + `src/data/world` directly.
  do: `git grep -n crossing_mock_world tools/` — if no generator exists (none did on 5 Sep), write one extracting Town Green North + depth 2 from the primitive world manifest that `tools/build-primitive-world-manifest.mjs` writes (`data/world/out/crossing-primitive-registry.json` and its siblings — read that tool's `outputDir`). `--check` compares to the committed fixture.
  verify: `node tools/build-godot-mock-fixture.mjs --check` exit 0.

- [x] **L3  Data contract tests** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 35
  touches: new:tools/godot-fixture-contract-test.mjs, package.json, tools/test-suites.json, gone:docs/THREE_D_REBUILD_HANDOFF.md
  still true, 9 Sep 2026: kept `[x]` on purpose. Every requirement this increment checks — an exit resolves to a cell or is honestly null, no cell has two exits with the same `move`, the current room is in `cells` — is a claim about the room graph and is exactly as true of a 2D isometric board. The suite lost one check of its 69: the fixture's generator sourced the deleted primitive-world manifest, so regeneration is now NOT CHECKED with that reason named, and `godot/mock/crossing_mock_world.json` is a frozen artefact until T2 gives it a 2D generator.
  depends-on: L2
  do: every exit resolves to a cell or is `targetCellId:null`; no cell has two exits with the same `move`; the current room is in `cells`. §9 maps each requirement to a test name on both sides (`godot/tests/foundation_test.gd` already exists).
  verify: suite green in the full run.

- [-] **L4  Slice acceptance checklist** (≈15)
  commit: (this PR) verified: 2026-09-05 minutes: 15
  superseded: 2026-09-09 — 3D cancelled; the six §9 lines described a 3D scene rendering, and the document holding them was deleted by PR #517. Four of the six were never recorded. T5 writes the 2D acceptance list that replaces this, and it should be shorter and honest about needing a live character rather than inheriting four empty slots.
  touches: gone:docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: L1
  do: §9: Town Green North renders; every real exit clickable; click → `intent_accepted` → confirmed room change → token moves; a fabricated exit is refused; a stun flips `cannotAct` and the scene reacts; an assessed creature's confidence visibly ages. Each line has a "recorded in docs/verification/… on <date>" slot.
  verify: six lines with empty slots.

- [-] **L5  Record the slice** (≈30)
  commit: (this PR) verified: 2026-09-05 minutes: 90
  superseded: 2026-09-09 — 3D cancelled; the slice it recorded was the 3D Crossing slice. `docs/verification/crossing-slice-2026-09-05.md` is kept as history and is not to be read as current state: two of its six lines were recorded, four were written up as unproven, and all six are about a scene that no longer exists.
  note: two of the six lines are recorded (1 and 4); four are written into `docs/verification/crossing-slice-2026-09-05.md` as unproven with what was tried, per L4's own rule. Lines 3, 5 and 6 need a live character, which `tools/fake-lich.mjs` cannot be. Line 2 needs a person to click once: a synthesised click did move the mock room, so the binding is not dead, but the rig could not say which button it pressed.
  touches: none
  depends-on: L4, B4
  do: run L4 live against Codex's current content; fill the slots; file gaps as ledger tasks for the content side.
  verify: slots filled or gaps filed.

- [-] **L6  Playable-slice gate** (≈5)
  superseded: 2026-09-09 — 3D cancelled. This was Gate 3's content half and could never go green: four of its six lines needed a live character and one needed a human click on a tile in a viewer that no longer exists. Gate 3 has been rewritten to name T1–T5 instead, in the same edit, because a gate member that can never become `[x]` is a permanent red mark rather than a condition. Superseded rather than left `[!]`: the block was not a scheduling problem, the subject was removed.
  was-blocked-on: four of the six §9 slots are still empty. Lines 3, 5 and 6 need a live DragonRealms character; line 2 needs one human click on a tile in the viewer that walks the character. None is a code change, and no fixture on this machine can substitute. **Line 2 changed subject with L8**: the exit chevrons it was written about are deleted, so the click to record is a click on a neighbouring tile (which walks its exit) and a click on a distant tile (which travels the route through `map_walk`).
  touches: none
  depends-on: L5
  do: all six L4 lines recorded. Gate 3's content half.
  verify: no empty slot.

- [-] **L7  The board overlapped itself, so the exits had no edge to sit on** (≈70)
  commit: (this PR) verified: 2026-09-05 minutes: 70
  superseded: 2026-09-09 — 3D cancelled; PR #517 deleted the primitive-world manifest builder, its test and `content_registry.gd`, which is everything that consumed this geometry. `src/lib/isometric-board-layout.mjs` itself survives and is still named below, because four live callers import `classifyTether`, `tetherAnchorFor` and `expandCompassDirection` from it — but its metre-based half (`CELL_PITCH_METRES`, `CELL_GAP_METRES`, `CELL_BLOCK_METRES`, `TOKEN_MESHES`, `boardLayoutFor`) has no renderer left. **T1 decides which of those fields die and which become 2D sprite anchors; do not delete them before it does.** The finding this increment recorded is worth carrying across: three numbers described one dimension and none derived from another, and the fix was to make one of them the source. A 2D board has the same trap.
  touches: src/lib/isometric-board-layout.mjs, gone:tools/build-primitive-world-manifest.mjs, gone:godot/scripts/content_registry.gd, gone:tools/primitive-world-manifest-test.mjs, tools/presentation-bridge-test.mjs
  superseded-by: L8, which deleted `godot/scripts/exit_anchor_layer.gd` on Dan's instruction. The chevrons this increment describes are gone; the gutter, the derived scale and the published footprint it also produced are not, and are what the paths above still name. The path was removed from `touches:` rather than left to fail the audit, and this line is where it went.
  depends-on: B3
  do: unplanned, from Dan playing the viewer — "the exits are sometimes hard to find… you should put a little bit of a gap between each block, good idea anyways actually, prevents clipping", then "some kind of shape randomly on the edge for directions… the 8 cardinal and sub cardinal… but not on the block itself, it won't be readable. it should be on the edge actually." Measuring the manifest found the cause was worse than a missing gap. Room positions were map units × 0.25, which put the **median** nearest neighbour 2.5 m away and the closest at 2.0 m, while every room drew a block 4.4–5 m wide: blocks overlapped by roughly their own width everywhere, and an exit anchor at the block edge landed inside the neighbour's geometry. Three numbers described one dimension and none derived from another — the manifest said 5, the selection box 4.5, Godot drew a hardcoded 4.5. Now `CELL_PITCH_METRES`, `CELL_GAP_METRES` and `CELL_BLOCK_METRES` are one source, Godot draws the published footprint, and the scale is 0.625 — derived rather than picked: 8 map units is the smallest gap the data contains, so `8 × scale ≥ block + gutter`. Exit markers became flat chevrons lying in the gutter and pointing out of the room, instead of upright cylinders standing on the block: at a fixed isometric camera a standing post is seen nearly end-on and hides behind room content, while a floor marking keeps its area toward the camera and can carry direction.
  verify: minimum same-storey spacing 5.00 m against a 4.4 m block — a 0.60 m gutter everywhere; `npm run test:godot` 11 of 11, 131 checks; full suite `all passed`, 117 suites, 3563 checks.
  sabotage: put the scale back to 0.25 → `FAIL blocks touch or overlap: closest neighbours are 2.00m apart but blocks are 4.4m wide`; restored, md5 `5938abc03a96` either side.
  pitfalls: two rooms (Paladins' Guild `1-804`/`1-866` and `1-805`/`1-867`) share exact map coordinates and overlap at any scale. That is a map-data defect rather than a layout one, so it is not folded into the gutter failure it cannot fix. It is no longer NOT CHECKED either: the NOT-CHECKED sweep made the two pairs an explicit `KNOWN_COINCIDENT` allowlist in `tools/primitive-world-manifest-test.mjs`, so a *third* duplicate fails instead of printing in the same harmless shape, and an entry that stops being coincident fails as stale. **Not verified on screen**: the Godot window is GPU-composited and would not screenshot for Lane B either, so this geometry is proved by measurement and by the tests, and the look still wants Dan's eye.

- [x] **L8  Remove the route markers; travel by tile, word, hotkey** (≈60)
  commit: (this PR) verified: 2026-09-06 minutes: 100
  done: Dan, 6 September 2026, verbatim: *"remove the route markers. you travel by clicking on another tile or by clicking on the words in the interface or by hotkey."* Three layers deleted, not disabled: `exit_anchor_layer.gd` (the cyan chevrons and the `Label3D` beside each non-compass exit), `route_graph_layer.gd` (the tether-coloured lines between cells), and `confirmed_route_transition.gd`, which drew nothing at all - `is_playing()` returned `false` unconditionally and `last_route()` had no consumer outside its own test. Their three scene nodes, their three tests and their `godot/README.md` entries went with them. Kept, with the consuming side named: the per-cell `ClickTarget` (this is now how a player travels), the `Current exits` word list in `world_controls.gd`, and the current-room cue, which is not a marker - the `PlayerSelf` token and its range bands are projected into the confirmed room by `entity_projection_layer.gd`, the camera is focused on it, and `world_inspector.gd` names it in text. `boardAnchor` stays in the manifest and the compiler: it fed the chevron placement, and it is also read and nulled by `aiJobProducers.ts::validateTetherCandidate`, which is a live consumer in another lane with its own tests and its own plan increment.
  note: the tile click now travels rather than nearly travelling. It walked a neighbour already; a click on the room you are standing in emitted an intent, and a click on any further room emitted `focus-room`, which reached the frontend and was dropped there. The first sends nothing now, and the second became `travel-to-room` - a destination and no route, because this client computes none: the frontend turns it into the bridge's own `map_walk`, which starts Lich's `go2`. The Rust variant was renamed rather than added beside the old one, and a test asserts the superseded `focus-room` wire kind is now *rejected*, so a stale viewer fails loudly instead of clicking into silence. The words and the hotkeys both already existed and neither was tested: `ExitButtons.tsx` was rendering the parsed compass exits as buttons, and `keybindings.ts` was binding all eleven numpad moves. Rebasing onto B9 then found the words were on the wrong lane: they sent through `useMacroRunner`, so a click went out as a `run_macro` bridge intent, *beside* the outbound command lane rather than through it - unordered against a script's walk loop, unpaced against the roundtime, and out of Stop's reach. They now call `requestGameAction(..., 'ui-action')` like every other UI control. The macro in-flight gate went with them, deliberately: refusing a second press while the first is outstanding is right for a five-command attack macro and wrong for a direction, and the lane already coalesces duplicate movement and holds against the roundtime the game reports. `canSendMacro` still supplies the disabled state and its wording, minus `inFlight`. The hotkeys needed nothing: `App.tsx` had already labelled the keybinding hook `'keybind'`, and the tile click is a bridge intent rather than a game command, so it names no source.
  touches: gone:godot/scripts/world_root.gd, godot/scripts/intent_sender.gd, godot/scripts/bridge_client.gd, gone:godot/scenes/WorldRoot.tscn, godot/README.md, gone:godot/tests/tile_travel_test.gd, src-tauri/src/presentation_bridge.rs, src/lib/presentationBridge.ts, src/lib/presentationIntents.ts, new:src/lib/roomExits.ts, src/components/room/ExitButtons.tsx, src/lib/panelDataContracts.ts, new:tools/exit-controls-test.mjs, tools/presentation-intents-test.mjs, tools/keybindings-test.mjs, package.json, tools/test-suites.json, gone:docs/CLAUDE_3D_VIEWER_BRIEF.md, gone:docs/THREE_D_REBUILD_HANDOFF.md, docs/PLAYER_DATA.md, docs/PRIVACY.md, new:docs/verification/route-markers-removed-2026-09-06.md
  depends-on: L7
  still true, 9 Sep 2026: kept `[x]`, and it is the most alive thing in this lane. Its Godot half is gone with the scene — `world_root.gd`, `WorldRoot.tscn` and `tile_travel_test.gd` — but everything on this side of the bridge survives and is working: the `travel-to-room` intent and the rejection of the superseded `focus-room` wire kind in `presentation_bridge.rs`, `roomExits.ts`, `ExitButtons.tsx` sending through `requestGameAction(..., 'ui-action')` rather than beside the command lane, and all eleven numpad bindings. **That is the contract the 2D scene builds against, and T3 publishes it rather than re-deriving it.** Two of the three travel paths — the words and the hotkeys — need no Godot at all and are live today. Note also `boardAnchor`, kept here because `aiJobProducers.ts::validateTetherCandidate` reads and nulls it: that consumer is still live, so T1 must not delete the field without dealing with it.
  do: delete the marker layers and their tests; make a tile click travel; cover all three travel paths with tests.
  verify: `node tools/godot-tests.mjs` 16 of 16 scripts / 271 checks measured at the branch point `db0cab4e`, 14 of 14 / 269 measured here after rebasing onto `7eafd42e`, which added checks of its own elsewhere. The delta from *this* change is the only part both numbers agree on: −24 (three deleted scripts) +19 (`tile_travel_test.gd`); `node tools/plan-audit.mjs` plan ok; `npx tsc -b` and `npm run lint` clean; `node tools/run-tests.mjs` no failures, 160 suites, 6002 checks, and 1 thing unchecked in 1 suite - `test:godot-fixture-contract`'s live-snapshot comparison, which predates this increment and is not a pass (measured after rebasing onto `3d19088f`; the totals move because other lanes are landing, and the second unchecked item this branch reported an hour earlier, `test:ai-script-repair`'s Ruby containment fixtures, was closed by H9 rather than by anything here; the +1 suite from this branch is `test:exit-controls`) (`test:exit-controls` is new; `docs/PLAYER_DATA.md` and `docs/PRIVACY.md` were regenerated because `src/lib/roomExits.ts` moved their scanned-file counts by one); `cargo test --lib presentation` 15 passed. Captures either side of the change in `docs/verification/route-markers-removed-2026-09-06-{before,after}.png`, of the same room through the same rig.
  sabotage: three, each aimed at a line that had to run. Removing the `cell_id == current_room` guard → `FAIL clicking the room you are already in sends nothing at all`, and nothing else; returning `walk` for a distant tile → `FAIL and it is a travel request, not a walk`; splitting the cell id at its *first* hyphen instead of its last → `FAIL a hyphen in the zone id does not change which half is the room`. Two more for the lane move, both against `src/components/room/ExitButtons.tsx`: labelling the exit words `'keybind'` → exactly one red, `FAIL through the command lane, naming this a player-driven UI action`, and nothing else; sending through `requestMacro([control.command])` again → all four of that block's checks red, which is right, because the call the other three read is gone. Each restored and the file's md5 compared either side (`6e067781ac5c` before and after both).
  pitfalls: `tools/board-geometry-drift-test.mjs` counts scripts mentioning `block_top_y(` against a floor of 2, and the deletion takes that population from 3 to exactly 2. It passes, at the floor. The next script that stops asking the cell for its height will take it below, which is the check working; a *fourth* placement script that never asks will not be noticed by it.

### Lane N — Lich-native login and frontend (no Genie)

Dan, 6 Sep 2026: *"we aren't using genie anymore… you have to implement
correctly using lich."* **Read `docs/LICH_NATIVE_LOGIN.md` before claiming any
increment here.** It carries the EAccess protocol read out of Lich 5.20.1 with
`file:line` cites, the argument for the `.sal` launch over writing Lich's
`entry.yaml`, the credential decision, the published interface, and — the part
that matters most — a list of what is **inferred and not yet measured**. Two
items on that list decide whether this design works as written, and each is
measured by an increment rather than argued.

The one fact that makes this lane small: **the app is already a Lich frontend
for game text.** `lich.rs:517` starts Lich with `--headless=11024`, which
`arg_normalization.rb:52-53` expands to
`--without-frontend --detachable-client=11024`; `game_link.rs:304` dials that
port and `gameStream.ts` parses what comes down it. Genie supplied one thing
only — the account login, because `--login <Character>` needs a saved entry and
Lich's own window cannot create one here (`lich.rs:490-495`). Lane N performs
that login itself. It does not add a second launch path beside the Genie one; it
replaces it, and there is no fallback (`CLAUDE.md` §0).

**Parallelism.** N1 and N2 have no dependency on each other or on anything
outside this lane and can be claimed by two sessions on day one. N5 depends only
on the *interface* in `docs/LICH_NATIVE_LOGIN.md` §8, not on N3 or N4 existing,
so a third session can build the UI against `DRC_LICH_DRY_RUN=1` while N3 and N4
run. N3 → N4 → N7 is the only serial chain. N6 is a sweep and goes last among
the code increments. N8 was optional and human-gated and blocked nothing; the gate opened on 6 Sep 2026 and it is `[x]`. The feature it adds is still optional at run time — not storing the password remains the shipped default.

- [x] **N1  EAccess protocol client in Rust, against a mock** (≈120)
  done: 2026-09-06 minutes: 95 — PR #441, `dev/wt-n1` off `origin/main` at `0dd67658`. `cargo test --lib` 187 passed (163 after N2, 24 new, all under `eaccess::tests`); `cargo test --lib eaccess -- --nocapture` prints `-- 8 frames asserted on the wire: K A M F G P C L`. `cargo clippy --all-targets -- -D warnings` and `cargo fmt -- --check` exit 0. Node suite `no failures`, 155 suites, 5773 checks, with the same two pre-existing NOT CHECKED lines as the baseline (this increment adds no Node suite). `node tools/plan-audit.mjs` `plan ok`, 131 increments, 393 paths. `npx tsc -b` exit 0. `docs/PRIVACY.md` is regenerated rather than hand-edited and its only change is the scanned-file counter, 340 to 341; leaving it stale fails `test:privacy`. **Rebased onto N2 rather than beside it.** N2 landed first and published `credentials::EACCESS_ENDPOINT` plus `eaccess_endpoint()`, saying in its own comment that N1 must read them rather than repeat them; so `eaccess.rs`'s own `DEFAULT_HOST`/`DEFAULT_PORT` were deleted and `endpoint()` is now a thin adapter over `credentials::eaccess_endpoint()`, and even the defaults case asserts against `EACCESS_ENDPOINT` rather than re-typing the literal. One change went the other way: `eaccess_endpoint()` returned a tuple and *silently* fell back to 7910 when `DRC_EACCESS_PORT` was set to something unparseable, which is a knob nobody could prove they had connected through, so it now returns `Result` and names the value it was given. `credentials.rs` and its one call site are edited for that and nothing else. All three sabotages reproduced and restored, `md5 1f3ae035046ad5f5c9d39f27eca5e9c8` before and after each: (1) `- 32` → `- 31` reddens exactly `the_obscured_password_on_the_wire_matches_the_formula` and `obscuring_is_reversible_with_the_same_key`, and nothing else — the mock never inspects the obscured bytes, which is what keeps the happy path green; (2) dropping the whole `M` step reddens 5, every one of them a case whose stated property is the frame order or the `M` check itself, while the happy path, the launch-data parse and the other error cases stay green — note that dropping only the `send` and leaving its `recv` reddens 12 of 24 and says nothing, so the sabotage is the step, not the line; (3) case-insensitive character matching reddens exactly `a_character_name_differing_only_in_case_does_not_match`. No test contacts a network: the one socket case connects to `127.0.0.1:7911` and asserts the refusal names 7911 and not 7910, which is the proof `DRC_EACCESS_PORT` reaches the socket. No login was attempted against the real server and no TLS probe was run against it either. **Two corrections carried in the module's header.** Ruby's `IO#puts` does not add a newline to a string that already ends with one, so the wire is a single `\n` per frame and not the `\n\n` this document's §2.1 and the `do:` below both assert — measured with Lich's own interpreter, `io.puts "K\n"` writes `[75, 10]`. And `login`/`list_characters` take `password: &str`, not `&Secret`: N2 owns `Secret`, two definitions of it would be a fork, and passing `.expose_for_obscuring()` at this boundary is what makes every use site greppable by one word, which taking `&Secret` here would lose. `lich_login_characters` is **not** registered by this increment — no Tauri command is, so `tools/tauri-command-callers-test.mjs` needs no `DEFERRED` entry; whichever of N3/N5 first needs it registers it.
  touches: new:src-tauri/src/eaccess.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml, src-tauri/Cargo.lock, src-tauri/src/credentials.rs, docs/LICH_NATIVE_LOGIN.md, docs/PRIVACY.md
  depends-on: none
  do: port §2 of `docs/LICH_NATIVE_LOGIN.md` exactly. Split I/O from protocol so the protocol is testable without TLS: `pub trait Transport: Read + Write`, `list_characters(&mut T, account, &Secret, game_code) -> Result<Account, EAccessError>` and `login(&mut T, account, &Secret, game_code, character) -> Result<LaunchData, EAccessError>`, plus a `TlsTransport` built on the `rustls`/`native-tls` stack Tauri already pulls in (check `Cargo.lock` first; **if neither is already a dependency, stop and add the ask to §10 rather than adding a crate**). Frames in order: `K`, `A\t<account>\t<obscured>`, `M`, `F\t<code>`, `G\t<code>`, `P\t<code>`, `C`, `L\t<char code>\tSTORM`, each `puts`-terminated so the wire bytes end `\n\n`. Obscuring is `out[i] = ((pw[i] - 32) ^ key[i]) + 32` on raw bytes; a password longer than the hashkey is a hard error naming the lengths, never a wrap or a truncation. `C` is parsed by stripping `^C\t\d+\t\d+\t\d+\t\d+[\t\n]` then scanning code/name pairs, matching the name case-sensitively. `L` must begin `L\tOK\t`; keys are kept UPPERCASE in `LaunchData` and their order preserved. ~~Certificate validation is ordinary system roots.~~ **Wrong, and corrected 9 Sep 2026 by measurement (issue #529): that instruction could not sign in at all.** `eaccess.play.net:7910` speaks one cipher suite, TLS 1.2 with static RSA key exchange, which rustls does not implement, so the handshake never completed and the failure surfaced at the `K` frame as `could not send: unexpected end of file`. Its certificate is also self-signed with no CN and no subjectAltName, so there was nothing for system roots to validate. The transport is `native-tls` and the certificate is pinned, with a mismatch terminal rather than re-downloaded as Lich's is. `LICH_NATIVE_LOGIN.md` §3.1 carries the whole measurement. `DRC_EACCESS_HOST`/`DRC_EACCESS_PORT` exist only so a test can aim this at a mock.
  verify: `cd src-tauri && cargo test --lib eaccess` — a mock `Transport` replaying the exact byte sequence from Lich's source drives a full `login` to a `LaunchData` containing `GAMEHOST`, `GAMEPORT` and `KEY`, and the suite prints how many frames it asserted. Separately, a run with `DRC_EACCESS_PORT=7911` must fail **naming 7911**, which proves the override is read (a default that happens to work proves nothing).
  sabotage: (1) change `- 32` to `- 31` in the obscuring loop → only the obscuring case goes red, with the expected and actual bytes printed; (2) drop the `M` frame → only the sequence case goes red; (3) make `resolve_char_code` match case-insensitively → only the character-lookup case goes red. Assert **which** cases go red, not that something did: a sabotage that reddens three checks means the checks are entangled.
  pitfalls: 3 (a credential-shaped literal in a fixture — assemble it at runtime), 15, 16. **No real credential and no real login in this increment.** A bare TLS handshake against `eaccess.play.net:7910` with zero frames sent is permitted as a sanity check and is not required for `done`; if it is run, record the result in the claim.
  done-when: `cargo test --lib eaccess` green, all three sabotages reproduced and restored with matching `md5sum`, and no network call in any test.

- [x] **N2  Credentials, and a privacy doc that is true** (≈90)
  commit: (this PR) verified: 2026-09-06 minutes: 95
  done: 2026-09-06 — `dev/wt-n2` off `origin/main` at `0dd67658`. `Secret` is a newtype over `String` with a manual `Drop` that `write_volatile`s every byte to zero behind a `compiler_fence`, a `Debug` that prints `Secret(<redacted>)` and no `Display`, no `Deref`, and no derives at all — so the only way to the plaintext is `expose_for_obscuring`, which greps to one call site per use. That it cannot be serialised is a *compile* error rather than a test: a blanket `impl<T: Serialize> NotSerializable for T` beside `impl NotSerializable for Secret` conflicts (E0119) the moment anybody adds `Serialize`, which was reproduced. `zeroize` stays out, as the increment says. `EACCESS_ENDPOINT` is declared here once, with `eaccess_endpoint()` applying the two test-only overrides, so N1 reads it rather than repeating the host. The generator learned a second pattern — `ENDPOINT_HIT` picks lines carrying a `…_ENDPOINT` constant or a `connect` call, `ENDPOINT` reads `("host", port)` off them, and the host joins the same `hosts` map, so `unclassified` and `stale` cover a socket exactly as they cover a fetch with no second list to drift. Its own denominator (`ENDPOINT_FLOOR`) is printed, and the floors no longer throw under `--check`, which used to stop the run before the checks that name *which* host went missing. Both sabotages reproduced and restored by `md5sum`: removing the `DESTINATIONS` row gives `FAIL every host the scan found is described   eaccess.play.net`, and neutering `ENDPOINT_HIT` gives `FAIL the endpoint scan still matches declared sockets   0 line(s)` followed by `FAIL every host described is still in the source   eaccess.play.net` — 4 failed, so the stale branch really is reached rather than the run aborting first. Positive control: an undeclared `TcpStream::connect(("example.invalid", 1234))` in a scratch file under `src-tauri/src` made the generator exit 1 with `hosts found with no description: example.invalid` and `--check` exit 1 naming it. A fifth check (`no_logging_macro_mentions_a_secret_binding`) walks all of `src-tauri/src` and reports its denominators — 25 files, 151 output-macro sites, and the `#[cfg(test)]` lines it did *not* scan — with two matcher controls inline; a planted `eprintln!("obscuring {password}")` was caught, which is the inline-capture form that hides inside a string literal. `doc-claims-test.mjs` gained section K: the five retired sentences must be absent from every doc and every component (131 files, whitespace-flattened so the same sentence wrapped three ways is still one sentence), the replacement must be *present* in at least three of them, and "not stored" is checked against `persistence.ts`'s own 59 fields with a fixture control that flags `password` and spares `accountName`. Planting `password?: string` in `PersistedPrefs` reddened that one check and nothing else.
  note: the increment's `touches:` named five paths and the sweep needed three more. `tools/doc-claims-test.mjs` carries the claim guard; `LichLauncher.tsx` and `SettingsSheet.tsx` are the two components that still asserted the app never sees the password, and a privacy claim left standing in the UI is read by more people than one left standing in a document. The `LichLauncher.tsx` edit is deliberately the two sentences and the header only — N5 rewrites that panel and should keep the sentence, which is quoted verbatim in three places on purpose so section K can check all three against one string. `accountName` is **not** added to `PersistedPrefs` here: nothing writes it until N5, and a field with no writer is a placeholder that reads as finished work, so the positive control for that matcher is a fixture rather than the real file.
  touches: new:src-tauri/src/credentials.rs, tools/build-privacy-doc.mjs, docs/PRIVACY.md, docs/ENGINE.md, src-tauri/src/lib.rs, tools/doc-claims-test.mjs, src/components/shared/LichLauncher.tsx, src/components/layout/SettingsSheet.tsx
  depends-on: none
  do: two halves, both about honesty rather than storage. (a) `credentials.rs`: a `Secret(String)` newtype with `Drop` overwriting the bytes in place, a `Debug` that prints `Secret(<redacted>)`, and no `Deref` to `&str` — callers ask for `.expose_for_obscuring()` so every use site is greppable. No new crate; `zeroize` would be a dependency ask for nothing this does not already do. (b) the doc: `build-privacy-doc.mjs` scans only for `https?://` (`:41-79` `HOST`), so a raw TLS socket to `eaccess.play.net:7910` is invisible to it and the generator throws `stale` (`:275-280`). **Do not write a fake `https://` into a comment to satisfy the regex** — that makes the source lie to pass a test. Teach the scanner a second pattern for a declared non-HTTP endpoint, add the `eaccess.play.net` entry to `DESTINATIONS` (`:98-170`), and rewrite the "short version" prose in the `md` template that currently claims *"your Play.net credentials are never sent anywhere by this app"*. Correct `docs/ENGINE.md:33-37` in the same pass — it says handling passwords first-party is "a line the project has deliberately stayed behind", and the line has moved.
  verify: `node tools/build-privacy-doc.mjs --check` exit 0; `grep -c "eaccess.play.net" docs/PRIVACY.md` ≥ 1; `grep -c "never sent anywhere by this app" docs/PRIVACY.md` → `0`; `node tools/doc-claims-test.mjs` green; `grep -rn "expose_for_obscuring" src-tauri/src | wc -l` prints every use site.
  sabotage: (1) delete the `eaccess.play.net` row from `DESTINATIONS` → `--check` exits non-zero naming it unclassified; (2) delete the new scan pattern → `--check` exits non-zero naming it stale. Both must be reproduced, because they are the two directions the generator checks and only one of them is the new code. Note `EXCLUDE = /test|127\.0\.0\.1|localhost/` matches the substring `test` anywhere in the rendered `path:line:text`, so a sabotage that lands in a line containing "test" or "latest" will be dropped silently and read as a pass — put the declaration where no such word appears and prove the sabotage reached the branch.
  pitfalls: 3, 15, 16.
  done-when: PRIVACY.md names the host, says what is sent, says the password is not stored by default and where it goes when it is, and no document anywhere still says the app never sees it.

- [x] **N3  The `.sal` launch file, and Lich started from it** (≈90)
  commit: 7eafd42e verified: 2026-09-06 minutes: 130
  done: PR #440. `sal.rs` writes the file from Lich's own five `Array#find`
  regexes (transcribed, not remembered), `lich.rs` starts Lich from it with
  `--headless=11024` alone, and the one-shot key is shredded on the app's
  attach — which is the first externally observable moment provably after
  Lich's last read (`main.rb:349` vs `:842-857`) — with a 120s timeout and a
  sweep on the next launch behind it. Measured against a real Lich 5.20.1:
  11024 listening on its own pid, and the `GAMECODE=`-removed sabotage
  exiting on `main.rb:232`'s exact string.
  `docs/verification/lich-sal-launch-2026-09-06.md`. §7 item 2 answered.
  **`lich_login_launch` is not part of this and is N3b below.**
  touches: src-tauri/src/sal.rs, src-tauri/src/lich.rs, src-tauri/src/lib.rs, src-tauri/src/game_link.rs, docs/verification/lich-sal-launch-2026-09-06.md
  depends-on: none
  note: the EAccess half moved to the increment below, so this one no longer
  depends on N1 at all. `sal::write_temp` takes `&[(String, String)]`, which
  is `LaunchData`'s own inner type, so N1 owns that type and this increment
  never needed it to exist. (Written on its own line rather than beside
  `depends-on:` because `plan-audit.mjs:83` reads every increment ID on that
  line as a real dependency — an earlier draft said "moved to N3b" there and
  the audit correctly reported a dependency nobody meant.)
  do: `sal::write_temp(&LaunchData) -> PathBuf` writes `KEY=…` and the rest one `UPPER=value` per line into a random 16-hex basename in the app's own temp directory — never the repo, never Lich's `TEMP_DIR` — and `sal::shred(path)` removes it. Replace `lich::launch_args` (`lich.rs:517-556`): the character branch becomes `[<sal path>, "--headless=11024", "--start-scripts=companion_bridge"]` and drops `--login`, `--dragonrealms` and `--stormfront`, all three of which the launch file now supplies (`GAMECODE=DR` at `main.rb:225-231`). Keep `--headless=` rather than the expanded pair: it is one token, it is what already ships, and `arg_normalization.rb:33-35` refuses to combine it with an explicit `--detachable-client`, so the existing `opens_the_detachable_client_port` assertion (`lich.rs:640-651`) stays valid unchanged. Add the `lich_login_launch` command per `LICH_NATIVE_LOGIN.md` §8 — it returns `{ pid, port }` after spawning, and shreds the `.sal` when `game_attach` reports the socket up, on a timeout, and at process exit. `DRC_LICH_DRY_RUN=1` writes and shreds the file and reports the argv without spawning. **The password never appears in argv**: a Windows command line is readable by any process of this user.
  verify: **not a reading of `arg_normalization.rb`** — start real Lich with a hand-written `.sal` carrying a deliberately invalid `KEY`, then `netstat -ano | grep LISTENING | grep :11024` shows Lich listening. That is the measurement `LICH_NATIVE_LOGIN.md` §7 item 2 asks for: it proves `--headless` normalisation runs on the `.sal` path, and it needs no valid account because the port opens before the game key is used. Kill that Lich **by the PID you started**, never by image name (§1 trap 12). Then `cargo test --lib sal` green and `DRC_LICH_DRY_RUN=1` reporting the argv with the `.sal` path first.
  sabotage: (1) omit `GAMECODE=` from the written file → Lich exits printing `error: launch_data contains no GAMECODE info` (`main.rb:232`), and the test asserts that exact string rather than a non-zero exit; (2) make `shred` a no-op → the leftover-file check goes red naming the path. Sabotage (1) proves the file reaches Lich's reader at all, which a green launch alone does not.
  pitfalls: 8, 9, 12, 14 (the `.sal` content and the temp path contain backslashes — write those files with Write/Edit or build them with forward slashes, never a heredoc), 16.
  done-when: a `.sal` produced from a `LaunchData` starts Lich, 11024 listens, and `stat` says the file is gone afterwards.

- [x] **N3b  Register `lich_login_launch` and `lich_login_characters`** (≈15)
  commit: pending verified: 2026-09-06 minutes: 20
  done: N1 landed (#441) while N4 was in flight, so this stopped being blocked
  and was finished in the same PR rather than left as a `[!]` row whose
  blocker had gone. The command is the wrapper it was filed as: `Secret::new`
  takes the password by move, `eaccess::connect` + `eaccess::login` produce
  the `LaunchData`, and `&data.0` goes straight to
  `launch_lich_with_launch_data` — one type for the launch fields, owned by
  `eaccess.rs`. It needs no DEFERRED entry: N5 (#439) had already shipped the
  screen that calls it, so `tools/tauri-command-callers-test.mjs` sees a real
  caller for both commands and its exemption lists are empty in both
  directions.
  note: an earlier draft of this row said `lich_login_characters` was
  deliberately **not** registered here, because N5's `do:` built the picker
  that calls it. N5 landed (#439) with that picker shipped and the command
  unregistered, so the reason expired and left a real gap: two
  `AWAITING_BACKEND` exemptions in `tools/tauri-command-callers-test.mjs`
  holding open an invoke the app could not answer. Both commands are
  registered here and `AWAITING_BACKEND` is empty again. `eaccess.rs` gains
  `Serialize` on `Account` and `CharacterEntry` — nothing else — with a test
  asserting the exact key set in both directions, since the derive is on the
  producing side and the picker is the half that otherwise never gets checked.
  measured: after rebasing onto `3ceb3ded` (#453): `cargo test --lib` 208 passed,
  `cargo clippy --all-targets -- -D warnings` and `cargo fmt -- --check` clean,
  `npx tsc -b` exit 0, `node tools/plan-audit.mjs` `plan ok` 134 increments /
  444 paths, `node tools/run-tests.mjs` no failures, 159 suites, 5907 checks,
  with the same two pre-existing NOT CHECKED lines as the baseline
  (`test:ai-script-repair`, `test:godot-fixture-contract`) - neither a pass and
  neither this increment's.
  touches: src-tauri/src/lich.rs, src-tauri/src/lib.rs, src-tauri/src/eaccess.rs, tools/tauri-command-callers-test.mjs
  depends-on: N1, N3
  do: this is a wrapper, not a design, and it is filed separately rather than
  left as an unticked clause inside N3 so the gap shows up in the marker
  counts instead of only in a lane row. `lich.rs` already publishes
  `launch_lich_with_launch_data(&[(String, String)])`, which is the whole body
  of the command apart from one call to `eaccess::login`. Add the
  `#[tauri::command] lich_login_launch` per `LICH_NATIVE_LOGIN.md` §8 —
  argument JSON `{ account, password, gameCode, character }`, result
  `{ pid, port }` plus the `argv` and `dryRun` fields `DRC_LICH_DRY_RUN`
  needs — and register it in `lib.rs`. Take `&data.0`: `LaunchData`'s inner
  `Vec<(String, String)>` is what `sal::write_temp` already accepts, so N1
  owns that type and nothing here needs a second copy of it (`CLAUDE.md` §0).
  verify: `node tools/tauri-command-callers-test.mjs` green; the app run with
  `DRC_LICH_DRY_RUN=1` reaches the returned argv without spawning Lich.
  sabotage: pass a password and grep the returned `argv` for it → it must not
  appear, with the launch file's `KEY=` line proving the value existed to
  leak. `lich::tests::a_dry_run_reports_the_argv_writes_the_file_and_spawns_nothing`
  already asserts that shape one layer down.
  done-when: the command is registered, N5 can call it, and no password
  appears in any result, event, log line or argv.

- [x] **N4  Attach, and measure what the frontend identity actually buys** (≈75)
  commit: pending verified: 2026-09-06 minutes: 95
  done: §7 item 1 is answered and moved to the read column. The identity is
  `profanity` and `supports_streams?` is **true**, measured by executing Lich
  5.20.1's own `resolve_headless_frontend` and `Frontend.has_capability?`
  against its own registry with this launch's exact argv — and re-run against
  `--saga`, `--genie` and no-detachable-port, so the chooser was tested where
  the wrong answers were available. The old question's two candidates were not
  two: `Frontend.client` is an alias of `$frontend`, and the `GAME=`-derived
  branch never runs. `docs/verification/lich-native-stream-2026-09-06.md`.
  **One thing in `verify:` is NOT CHECKED and is not a pass:** the state
  replay was not observed arriving on 11024. A real Lich was attached to for
  22s and sent nothing; Lich logged no error, and the likeliest reading —
  written as a hypothesis — is that a detachable socket does not drain before
  the session has a real game stream. It needs N7, and it is on N7's list.
  `--frontend=<name>` turned out to be parsed and never read
  (`argv_options.rb:98-99`), so the remedy §7 offered would not have worked;
  `--wrayth` and `--profanity`, which `frontends.ts` claimed, do not exist.
  touches: tools/fake-lich.mjs, src/lib/frontends.ts, tools/frontend-test.mjs, src-tauri/src/game_link.rs, src-tauri/src/lich.rs, src-tauri/src/sal.rs, tools/detachable-port-test.mjs, package.json, tools/test-suites.json, docs/verification/lich-native-stream-2026-09-06.md
  depends-on: N3
  do: the stream format does not change — same detachable port, same Lich-processed Simutronics XML, same `gameStream.ts`. What changes is Lich's own frontend identity, and `LICH_NATIVE_LOGIN.md` §7 item 1 says plainly that this was read but not traced: on this path `resolve_headless_frontend` returns `'profanity'` (`login_helpers.rb:578-584`) while `Frontend.client` comes from the `GAME=` line as `'stormfront'` (`main.rb:373-383`), and **which of the two decides `Frontend.supports_streams?` is not established**. Establish it. If streams are supported, the channel tabs fill for the first time and the Genie warning at `LichLauncher.tsx:283` was a real cost this lane removes; if not, say so in `docs/LIVE-STATE.md` rather than implying otherwise. Then: extend `fake-lich.mjs` to serve the `.sal`-route identity so the unhappy paths are reachable without an account, and make `frontends.ts` model exactly the identities that can now occur — the `genie` `,` branch and its case in `frontend-test.mjs` go with N6, not here, so this increment leaves the test green rather than half-deleting a case.
  verify: against a live Lich started by N3, `;send <c><channel>` style traffic or the `<pushStream id=…>` frames observed on 11024, recorded verbatim in `docs/verification/lich-native-stream-<date>.md` with the answer to §7 item 1 stated as measured. `npm run test:frontend` green. The state replay on attach (`global_defs.rb:2306-2343`, suppressed for Genie only) must be observed arriving.
  sabotage: point `game_attach` at a port nothing listens on → the pane reports disconnected with a reason, and the existing `tools/backlog-test.mjs` reconnect checks stay green.
  pitfalls: 12, 16, and §1 trap 22 if you edit a tracked file by fragment.
  note: `tools/fake-lich.mjs` defaults to **11124**, not 11024, on purpose. Do not "fix" that.
  done-when: the verification doc exists with a date and states the streams answer as measured, not inferred.

- [x] **N5  The sign-in screen, replacing the Genie instructions** (≈120)
  done: 2026-09-06 — `dev/wt-n5` off `origin/main` at `0dd67658`.
  `src/components/shared/SignIn.tsx` takes an account, a password and a game,
  calls `lich_login_characters`, builds the picker from the `C` reply, calls
  `lich_login_launch`, and hands the port that command returns to the existing
  `attachGame`. The player types no character name. The four false passages are
  deleted rather than kept beside it: the walkthrough in
  `WaitingForCharacter.tsx`, the same block in `Dashboard.tsx`, the "cannot sign
  in on this machine" panel in `LichLauncher.tsx`, and the whole retired branch
  of `ConnectGuide.tsx`. `git grep -c "lich" + "connect|arguments" over src/` is
  zero; the two verbs are named in `docs/LICH_NATIVE_LOGIN.md` §6 and nowhere a
  player can read them.
  This was built against the published interface rather than against N1 and N3,
  which had not merged when it started: `git ls-tree origin/main` had no
  `src-tauri/src/eaccess.rs`. So it is driven by a TS-side stand-in,
  `src/lib/lichLoginFake.ts`, reachable only outside the desktop app and only
  with `?lichDryRun=1`. **N1 and N3 merged during the rebase** (#441, #440) and
  the stand-in still stands, because neither registered `lich_login_characters`
  or `lich_login_launch`: `grep lich_login src-tauri/src/lib.rs` returns
  nothing. It carries its own deletion instructions - one file, and two
  `usingFakeBackend()` branches - for whenever those commands appear.
  `tools/tauri-command-callers-test.mjs` grew `AWAITING_BACKEND`, the mirror of
  its `DEFERRED` list, carrying both names with the increment that owes them,
  plus a sabotage proving an entry that later gets registered is reported
  rather than silently tolerated.
  **What N1's landing changed, and it is the whole argument for checking
  against source rather than against a plan:** the error set was five, taken
  from this increment's own `do:` line. The enum N1 shipped has seven variants,
  two of which no player could have been told about by those five.
  `ProtocolMismatch` is nobody's fault and no retry fixes it;
  `PasswordLength` and `ObscuredByteOutOfRange` both mean this exact password
  cannot go down the wire whatever it is typed into. So
  `EACCESS_VARIANT_KINDS` maps all seven onto seven sentences, written down
  rather than inferred from the names, because the two vocabularies genuinely
  differ - `AccountLockedOrExpired` is not called `account_locked`. The suite
  checks that map against the enum in **both** directions, with a control
  proving the parser can report an unmapped variant.
  Evidence, all re-runnable: `npm run test:sign-in` - 52 assertions, 0 failed,
  0 not checked. The skip branch is still reachable on purpose:
  `DRC_EACCESS_SOURCE=src-tauri/src/nope.rs npm run test:sign-in` prints 40
  checks and one honest NOT CHECKED, with the denominator counted from the loop
  rather than from the source, so a skipped loop cannot read as a truncated
  run. `node tools/sign-in-shots.mjs
  http://127.0.0.1:5247/` — 23 of 23 in a real browser at 1024x768, writing
  `docs/verification/sign-in-2026-09-06-{form,picker,launched,error,no-characters}.png`,
  including that no control falls outside the window (defect #418's shape) and
  that the stored preferences carry the account name and not the password.
  `python tools/sign-in-break-check.py` — four sabotages, each caught by the
  check it names, each file restored by md5, with the suite green before the
  first and after the last. Two things it caught about itself: case 1's first
  version was caught by the *wrong* check, because `SignIn` never hands
  `rememberSignIn` a password, so it now damages the call path a real
  "remember me" regression would; and case 3 matched a label carrying the kind
  count, which moved from 5 to 7 the day N1's enum landed, so it matches a
  prefix now. The password is not stored, and the false claim is replaced by the true
  sentence: "Your password is used once to sign in and is not stored."
  **Corrected the next day by N8**, which is the increment this one deferred
  to: the sentence that stood here said no "remember my password" control is
  rendered while N8 is `[!]`, and that stopped being true when N8 merged. The
  box is now in this form, off by default, and the two checks that asserted its
  absence — `sign-in-test.mjs` and `sign-in-shots.mjs` — assert the offer and
  its warning instead. That is the right direction: the absent version could
  not distinguish "no box" from "a form that stores a password without
  asking".

- [x] **N6  Delete Genie from the connection path, everywhere** (≈90)
  done: 2026-09-06 — `dev/wt-n5`, branch `lane-n/n6-genie-sweep`, off `origin/main` at `d0884bba`.
  The connection path is gone as written: `genie_status` is now
  `frontend_conflict_status` (the hazard is two clients fighting for the
  detachable port, which outlives the client that named it, so it was renamed
  rather than deleted); the `genie` row and its `,` prefix are out of
  `frontends.ts` and `frontend-test.mjs`, with `DEFAULT_FRONTEND` moved to
  `wrayth`; the `'genie'` setup-component id became `'config-import'`; the four
  retyped copies of `11024` are down to one, read from `INSTANCES`; and three
  panels that hardcoded `,companion_bridge` now call `bridgeCommand(null)`,
  which is the one place the prefix is computed.
  **Scope changed, on Dan's instruction, and this is the part that differs from
  the `do:` line below.** "We aren't using genie anymore … you have to implement
  correctly using lich" retired the config editor too, so N-a is decided and
  this increment carried it: `src/components/config/` (the sheet and seven
  editors), `useGenieConfigEditor.ts`, `genieConfigEdit.ts`, and the
  macros / presets / substitutes / gags / variables modules and hooks are
  deleted, with `restore_genie_config` and `list_sounds` deregistered and
  removed on the Rust side and six `test:` scripts retired with the code they
  tested. Highlight rendering and alias expansion survive — they have runtime
  consumers that are not the editor — as does the read-only importer.
  `saveGenieConfig` survives for exactly one caller, `pinsFile.ts`, and the
  guard below is what keeps that from becoming two.
  **The `verify:` line's `git grep -ic genie … → 0` was not achievable and was
  the wrong property.** 708 hits remain across 89 files and nearly all are
  comparisons a player benefits from ("the depth Genie never had"), Lich's own
  `genie_pos` map field, or Lich's `--genie` flag being described. Naming the
  program is not instructing anybody to use it. The property that matters is
  the one section L of `tools/doc-claims-test.mjs` now asserts, over `src/`
  plus the shipped documents: no string a player can read carries
  `#lichconnect`, `licharguments`, `#config lichpath`, `--genie` or
  `,companion_bridge`. It has a fixture control that must produce one hit per
  needle on distinct lines, and three sabotage cases in
  `tools/doc-claims-break-check.mjs` — a document, a component, and the fixture
  itself — all of which redden exactly the checks they name and restore byte
  for byte. Building it found a real defect in the guard's own reporting: a
  check name of 58 characters or more padded to nothing, welded its detail
  column onto its name, and made a landed sabotage read as a broken guard.
  Fixed in `ok()` so the separator is unconditional.
  Evidence, re-runnable: `node tools/doc-claims-test.mjs` 46 checked 0 failed;
  `node tools/doc-claims-break-check.mjs` 16 sabotages across 9 files, 0
  misfired; `node tools/frontend-test.mjs` 10 checked 0 failed;
  `node tools/tauri-command-callers-test.mjs` all passed.
  touches: src-tauri/src/lich.rs, src-tauri/src/lib.rs, src/lib/frontends.ts, tools/frontend-test.mjs, src/types/index.ts, src/store/useAppStore.ts, docs/BRIDGE_CONTRACT.md, lich-scripts/companion_bridge.lic, src/components/game/GameConnectionBar.tsx, src/components/dashboard/Dashboard.tsx, src/data/instances.ts
  depends-on: N5
  (was `N4, N5`. N4 owed this increment a measurement — which of two
  frontend identities decides `Frontend.supports_streams?` — and the
  answer changes what the channel tabs can show, not whether the `genie`
  row belongs in `frontends.ts`. That row is gone because the route is
  gone, and it would be gone whichever way N4 lands. Carrying a
  dependency the work did not actually have would have blocked the sweep
  on an unrelated measurement; N4 is still open and still owns that
  question.)
  do: remove `genie_status` (`lich.rs:412-425`) and its registration (`lib.rs:153`); the Genie sentence in the `LichStatus` note (`lich.rs:490-497`); the `genie` branch of `frontends.ts` and its case in `frontend-test.mjs`; `'genie'` from the frontend union (`types/index.ts:40`) and from `useAppStore.ts:37-38`; the Genie comments in `companion_bridge.lic`; and the two topology claims in `BRIDGE_CONTRACT.md:8-10, :117-121`, the first of which ("It must not parse the game stream itself") has been false since `gameStream.ts` shipped. Also retire the four extra places the frontend retypes `11024` (`GameConnectionBar.tsx:34`, `Dashboard.tsx:150`, `instances.ts:41`, and whatever survives in `WaitingForCharacter.tsx`) in favour of the port `lich_login_launch` returns — `lich.rs:107` already claims to be "one number in one place" and is not.
  **Out of scope, and still out:** `genie_pos`/`genie_id`/`genie_zone` in
  `src/bridge/types.ts` are Lich map fields that carry Genie's name, and
  deleting them deletes map coordinates. The read-only config importer
  (`config_import.rs`'s `read_genie_config`, the Genie detection in `setup.rs`
  and `sounds.rs`) stays: a player moving across still wants their highlights
  and aliases to come with them, and it never writes. `genie-plugin/` is
  untouched. The pin export writes `dr-companion-pins.yaml` into that same
  `Config` folder (Dan's ask, 30 Aug 2026) and keeps doing so; moving it to the
  app's own data directory is a separate question, filed as N-c.
  ~~The editor subsystem was listed here as out of scope.~~ It is not: see the
  `done:` block above.
  verify: `node tools/doc-claims-test.mjs` green including section L (the grep-to-zero this line used to demand is refuted in the `done:` block); `node tools/tauri-command-callers-test.mjs` green; `node tools/frontend-test.mjs` green with a lower check count and the new count stated in the claim; `npm run test:bridge`-family suites green; full suite `all passed`.
  sabotage: `node tools/doc-claims-break-check.mjs` — three cases for section L (a document, a component, the fixture) plus one proving a second caller of `saveGenieConfig` is caught. Each must redden exactly the checks it names and restore byte for byte.
  pitfalls: 10 (stage by path; this touches eleven files and `git add -A` would sweep another lane), 17 (do not leave a "legacy Genie sign-in" anywhere), 20.
  done-when: no shipped string instructs the retired route, the guard proving it has a control and a sabotage, and the config editor is deleted rather than relabelled.

- [!] **N7  Live sign-in with Dan's real account** (≈30 of his time)
  blocked-on: a human. This increment cannot be done by any session: it needs Dan's real Play.net account and password typed into the running app, and no fixture on this machine can substitute for the one thing being proved — that the protocol in §2 of `docs/LICH_NATIVE_LOGIN.md` is right against the real server. No session may ask for the credential, hold it, or type it.
  touches: none
  depends-on: N4, N5, N6
  do: the exact steps, for Dan, in order. (1) Build and run the app. (2) Open the sign-in screen; type the account name and password; choose **DragonRealms**. (3) Confirm the character list that appears is his real list — this is the `C` reply and it proves the login half. (4) Pick Phemius. (5) Confirm the game text appears in the transcript within a few seconds, and that `,` is no longer the Lich command character — `;companion_bridge` is. (6) Confirm the channel tabs behave as N4's measurement said they would. (7) Close the app; confirm nothing under `%LOCALAPPDATA%` contains the password (`Select-String` for it across the app's data directory, run by Dan on his own machine, result reported as a count and not as text). (8) ~~Say whether "remember my password" is wanted at all, which is N8's gate.~~ **Answered ahead of this session** — §10's N-b, 6 Sep 2026, *yes, opt-in, default off* — so N8 is `[x]` and this step is instead: tick the box, sign in, close the app, and confirm `cmdkey /list | findstr dr-companion.play.net` shows exactly one entry; press Forget in Settings and confirm it shows none.
  verify: `docs/verification/lich-native-login-<date>.md` records steps 3, 5, 6 and 7 with what was seen, and step 7's count as `0`.
  done-when: that doc exists and step 7 says zero.

- [x] **N8  Optional: remember the password in Windows Credential Manager** (≈60)
  commit: (this PR) verified: 2026-09-06 minutes: 150
  done: 2026-09-06 — `dev/wt-n8` off `origin/main` at `ce099f4e`. Dan answered §10's **N-b** on 6 Sep 2026: **yes, opt-in, default off**, which is what shipped. `keyring` 4.2.0 is in, MIT OR Apache-2.0, `default-features = false` with `v1` and `windows-native-keyring-store` — the defaults also switch on the secret-service backend, which would drag zbus and D-Bus into a Windows-only app for a store it can never open. Six crates joined `THIRD_PARTY.md` through its generator (`keyring`, `keyring-core`, `windows-native-keyring-store`, `cmov`, `ctutils`, `tracing-attributes`), every one MIT OR Apache-2.0, and the crate count moved 320 → 326. Target-gated to `cfg(windows)` beside `windows-sys`, with a `#[cfg(not(windows))]` half that refuses by name rather than succeeding quietly. `credential_store.rs` publishes `store`/`has`/`forget`/`load`/`unavailable_reason`, all taking the service name as an *argument*, and only the three `#[tauri::command]` wrappers call `service_name()` — so a test names its own service and **cannot** reach a player's, which is stronger than a test that promises to clean up after itself. `load` is deliberately not a command: it returns a `Secret`, which N2 made impossible to serialise, so the compiler is what stops a stored password reaching the webview. Six Rust tests, all green on this machine: the 0→1→0 round trip, the value round trip through `expose_for_obscuring`, an empty secret refused, a blank account treated as no account, the declared service asserted, and — the one that says *which store* was written to — `the_entry_is_in_windows_credential_manager`, which shells out to `cmdkey /list` and asserts the target `{account}.{service}` is absent, then present, then absent again. That turns this increment's manual `verify:` line into something that runs on every `cargo test`. Frontend: `src/lib/rememberPassword.ts` holds `REMEMBER_PASSWORD_DEFAULT = false` and the three invokes behind a `CredentialBackend` interface, and `tools/credential-store-test.mjs` (26 checks) asserts that with the box unticked the fake backend records **zero** calls — against a positive control in the same run where ticking it records exactly one, without which an unwired harness would pass the check that matters most. `SignIn.tsx` mounts the box and stores only after `lich_login_characters` has resolved, which `sign-in-test.mjs` now asserts by offset with a positive control — its first version compared the *import*'s offset and reported a correct ordering as wrong, which is why the control is there. `doc-claims-test.mjs` section K grew nine checks: the three commands registered, *exactly* those three declared and no reader, no file write in the credential module, the three PRIVACY.md sentences (off by default, a Forget control, who else on the machine can read it), and the storage-key inventory scanned for a credential-shaped key with a matcher control. Both sabotages reproduced and restored by `md5sum` — see `sabotage:` below. One defect the first sabotage found in the tests themselves: a *failing* run never reaches its own cleanup, and it left three real entries in Credential Manager. The tests now sweep stale `dr-companion-test.` targets before writing, keyed on a per-process nonce so a sweep cannot delete a sibling thread's live entry, and that sweep has its own positive control — a planted `stale.dr-companion-test.leftover.1` was gone after one run.
  note: three departures from the increment as written, all recorded rather than quietly taken. (1) **`depends-on` dropped N7.** N7 step 8 was the question "is this wanted at all"; Dan answered it directly in §10 on 6 Sep 2026, so the dependency is discharged by the decision rather than by N7 running, and N7 is still `[!]` on his time. (2) **N5 merged mid-rebase** (PR #439), so the box went into its `SignIn.tsx` rather than waiting: `RememberPasswordCheckbox` is mounted there, seeded from `REMEMBER_PASSWORD_DEFAULT`, and the store call sits *after* `lich_login_characters` resolves — a password the account server rejected is not one worth remembering, and storing before the call would remember typing mistakes. Two of N5's own checks asserted the box's **absence** while N8 was `[!]`; both are turned the other way up here, which is the case CLAUDE.md §1 describes as reading a failing test's name before its body: the name said "while N8 is unbuilt", and the property underneath — the player is never storing a password they did not ask to store — is better served by asserting the box exists and starts off, because an absent box and a form that stores one silently look identical to the old check. `ForgetStoredPassword` is mounted in `SettingsSheet.tsx`'s "Licences and privacy" block: an escape hatch that arrives after the thing it undoes is worth less than one that arrives with it, and Settings is where somebody looking for where their password went actually goes. (3) The Forget control takes the account name typed in rather than read from preferences, because nothing persists an account name yet — N2 declined to add `accountName` to `PersistedPrefs` with no writer, and N5 is what writes it. Also corrected on the way past: `docs/PLAYER_DATA.md`'s opening still said "the app never sees the player's password, which goes to Lich's own login", which N2's own retired-sentence list did not catch because it is not one of the five literal phrases. It now carries a table contrasting `localStorage` with the Credential Manager entry, and says there is no third place.
  touches: src-tauri/Cargo.toml, src-tauri/Cargo.lock, new:src-tauri/src/credential_store.rs, src-tauri/src/credentials.rs, src-tauri/src/lib.rs, new:src/lib/rememberSignIn.ts, new:src/components/shared/RememberSignIn.tsx, src/components/shared/SignIn.tsx, src/components/layout/SettingsSheet.tsx, new:tools/credential-store-test.mjs, tools/sign-in-test.mjs, tools/sign-in-shots.mjs, tools/doc-claims-test.mjs, tools/build-privacy-doc.mjs, tools/build-player-data-doc.mjs, docs/PRIVACY.md, docs/PLAYER_DATA.md, THIRD_PARTY.md, package.json, tools/test-suites.json
  depends-on: N2
  do: store the password under a per-account entry in Windows Credential Manager through `keyring`, behind a checkbox that defaults to **off**. Never a settings file, never obfuscated bytes on disk — `LICH_NATIVE_LOGIN.md` §5.2 says there is no third option and means it. Removing the account must remove the credential; so must the uninstaller's "delete application data" path, alongside the four bearer files E3 found. Update PRIVACY.md through its generator.
  verify: `cargo test credential_store` → 6 passed. The `cmdkey` half of this line is now `the_entry_is_in_windows_credential_manager`, which asserts the Credential Manager target `{account}.{service}` is absent, then present after a store, then absent after a forget — 0, 1, 0, read out of `cmdkey /list` rather than out of the code under test, with a denominator assertion so an empty or unreadable listing aborts instead of reading as "no entry". Also `node --experimental-strip-types tools/credential-store-test.mjs` → `26 checked, 0 failed`; `node tools/doc-claims-test.mjs` → `48 checked, 0 failed`; `node tools/build-privacy-doc.mjs --check`, `node tools/build-player-data-doc.mjs --check` and `node tools/build-third-party.mjs --check` all exit 0.
  sabotage: both run, both restored from an `md5sum`-verified copy. (1) `forget` made a no-op (`Ok(true)` without calling the backend) → **3 failed**: `store_then_has_then_forget` on "the entry survived `forget`", `what_comes_back_is_what_went_in` on "load still finds a forgotten entry", and `the_entry_is_in_windows_credential_manager` naming the surviving target — `n8-cmdkey.dr-companion-test.cmdkey.<nonce> survived `forget` in Credential Manager`, which is what this increment's `sabotage:` line asked for. The third is the point of having it: the other two would pass against an in-process map, and only the `cmdkey` check proves the real store was left dirty. Note the no-op had to return `true` to get past the assertion above it, which is the layered-sabotage trap: a `false` would have been caught by an earlier line and the branch under test never reached. (2) `REMEMBER_PASSWORD_DEFAULT` flipped to `true` → `credential-store-test` **1 failed**, `the remember-password default is off   default true`, and nothing else, so the check is not entangled with the rest of the suite.
  pitfalls: this is the only increment in the lane that ships a stored secret. If it is not built, **nothing else in the lane changes** — not storing the password is the shipped default, and N5 does not render the checkbox until this is `[x]`.
  done-when: the three counts above are 0, 1, 0, measured with `cmdkey` — and measured by a test rather than by hand, so they are re-measured on every run instead of having been true once.

- [x] **N9  The login chain's four verified defects: #457, #458, #459, #464** (≈150)
  commit: (this PR) verified: 2026-09-06
  done: 2026-09-06 — `dev/wt-login2` off `origin/main` at `ab61ebfa`. Review pass 7 filed four things about the chain N1–N8 built, and all four were re-verified before anything was changed. **#457**: nothing on the Rust side emitted the error token `lichLogin.ts` had documented since N5, so `classifyLoginError` fell to `unknown` on every real failure and all seven player sentences were unreachable in the shipped app — a locked account read as *"Signing in failed. the account cannot sign in right now (NEW)"*. The contract is now real and structured: `src-tauri/src/login_error.rs` declares `LoginCode::ALL`, `EAccessError::code()` is a `match` the compiler will not let go stale, and both commands return `Result<_, LoginFailure>` which serde sends as `{ code, message }`. The check that was missing is the point of the fix: `cargo test` **generates** `src/lib/loginErrorFixtures.ts` from the Rust types — one real serialisation per code — and fails if the checked-in copy drifts; `tools/sign-in-test.mjs` classifies that file rather than the token it used to build itself, `lichLoginFake.ts` throws the same generated objects, and the code set is asserted equal in both directions against the webview's `RUST_ERROR_CODES`. **#458**: `attachGame` dialled Lich's detachable port in the same tick as the spawn, which provably cannot connect — Lich does not open that listener until `main.rb:842-857` — so the player was told the sign-in failed while their character was logging in, and the `.sal` was left for the 120-second backstop instead of being shredded at attach. `game_link::dial_with_retry` now retries every 250 ms up to a caller-supplied deadline, stops early with the exit code when the Lich *this app spawned* has exited, and shreds the launch file on the successful connect and on both bad endings — but not on the Attach button's single dial, which has proved nothing about a Lich that may still be booting. `SignIn.tsx` holds an honest `starting` stage until the attach lands. **#459**: `credential_store::load` had no caller outside its own tests, so N8's checkbox stored a password nothing ever read and the player typed it again every time. `password` is now `Option<String>` on both commands, `lich::resolve_password` loads the stored one when none was typed, a refused stored password is forgotten and reported as `stored_password_rejected` rather than retried, and the form drops the password field when `credential_has` is true and offers "Use a different password". **#464**: `DRC_LICH_DRY_RUN` and `DRC_EACCESS_HOST`/`PORT` were ungated `std::env::var` reads, so a shipped app could be told from its environment to fake a sign-in or to send the password somewhere else. All three are gated on one `const fn overrides_are_honoured() -> bool { cfg!(debug_assertions) }`, and `tools/build-privacy-doc.mjs` reads that gate rather than the sentence about it — three states, so an unreadable file reports itself instead of passing. The two items #464 flagged and did not ask for are deliberately untouched: `reloadAliases` belongs to the lane building native player config, and the pin export's Genie-folder tooltip waits on §10's **N-a**.
  note: two refactors rather than forks. `eaccess.rs`'s scripted `MockEAccess` moved from `mod tests` into `#[cfg(test)] pub(crate) mod test_support`, because N9's stored-password cases are claims about the bytes in frame 2 and a second mock in `lich.rs` would have drifted from the first. And the launch-file shred moved out of `game_attach` into `dial_with_retry`, so its three outcomes are decided in one place a test can watch.
  touches: new:src-tauri/src/login_error.rs, new:src/lib/loginErrorFixtures.ts, src-tauri/src/lib.rs, src-tauri/src/eaccess.rs, src-tauri/src/lich.rs, src-tauri/src/game_link.rs, src-tauri/src/credentials.rs, src-tauri/src/credential_store.rs, src/lib/lichLogin.ts, src/lib/lichLoginFake.ts, src/lib/gameLink.ts, src/lib/rememberSignIn.ts, src/components/shared/SignIn.tsx, tools/sign-in-test.mjs, tools/credential-store-test.mjs, tools/build-privacy-doc.mjs, docs/PRIVACY.md, docs/PLAYER_DATA.md, docs/LICH_NATIVE_LOGIN.md
  depends-on: N1, N3, N5, N8
  do: make the error contract real in one place and check it against what Rust actually sends; give the attach a bounded retry that can tell "still booting" from "exited"; wire the stored password to a reader; and keep the three environment knobs out of release builds.
  verify: `cargo test` 232 passed; `cargo test --release` green with the two override cases honestly ignored and `the_dry_run_knob_is_debug_only` / `the_endpoint_overrides_are_debug_only` proving the release behaviour; `cargo clippy --all-targets -- -D warnings` and `cargo fmt -- --check` exit 0; `npx tsc -b` and `npm run lint` exit 0; `node tools/build-privacy-doc.mjs --check` 8 checked 0 failed; `node tools/plan-audit.mjs` `plan ok`; `node tools/run-tests.mjs` `no failures`, 157 suites, with only the pre-existing `test:godot-fixture-contract` NOT CHECKED. Screenshots of the three sign-in states in `docs/verification/`.
  sabotage: four, each restored from an `md5sum`-verified copy — see the PR body for the checks each one reddened.
  pitfalls: 1, 3, 12, 15, 16. No real Lich and no real account: every case here runs against a loopback listener or a scripted mock.
  done-when: the four issues are closed by the PR, and each fix has a sabotage that reddens a named check rather than "something went red".
  follow-up: N10 renamed the two frontend files this row and N8's name — `src/lib/rememberPassword.ts` became `src/lib/rememberSignIn.ts` and `src/components/shared/RememberPassword.tsx` became `RememberSignIn.tsx` — because the module grew from owning a password to owning everything a sign-in remembers, and a module named for one of the four things it governs is a name that lies. Both `touches:` lines were repointed at the current paths rather than left to fail the audit or rewritten to claim a deletion that did not happen: it is one module with one history, and `git log --follow` carries it. Said here rather than done quietly, because §0's own rule is that editing a `touches:` list to name surviving files can make the record lie about what an increment did. Review pass 8 (#488) found four things about what N9 shipped, and both halves are merged. #497 stopped an unrecognised refusal token deleting the stored password (`AccountRefused` is a third state; only Lich's `PASSWORD` forgets) and put the #464 release knobs in the gate as `rust-release-knobs`, `EXPECTED_STAGES` 10 to 11. #498 gave the spawned `Child` an owner (`lich::LichProcess`) and the app-exit lifetime a written answer and a test: nothing on the exit path ends a Lich, and closing asks (`lich_release` / `lich_stop`) only when this app started one that is still running — `docs/LICH_NATIVE_LOGIN.md` §9. The already-running refusal became `lich_already_running` with an Attach offer instead of `lich_did_not_start`'s diagnostic, and `tools/login-error-fixture-test.mjs` catches fixture drift on the TypeScript side, where cargo alone used to and named the wrong file.

- [x] **N10  The first-contact experience, and remembering everything a sign-in produces** (≈180)
  commit: (this PR) verified: 2026-09-09
  done: 2026-09-09 — `dev/wt-signin` off `origin/main` at `22b26f8d`. Two halves, and the first is a decision rather than a defect. Dan, 9 Sep 2026: *"improve the login experience for users"*, then on the password *"it's on my computer so definitely store the password. 100%"*, then generalising *"remember everything about anything signed in. passwords account names, etc. you can put a check box, but default it to checked, it's on the desktop."* That reverses N8's opt-in default (§10 **N-b**, answered *opt-in, default off* on 6 Sep) and the sentence about it that stood in three files. **The reversal is one preference with one owner**, not a box per field: `src/lib/rememberSignIn.ts` (which was `rememberPassword.ts`) holds `REMEMBER_SIGN_IN_DEFAULT = true`, the enumeration `REMEMBERED_FIELDS` of everything a sign-in produces — account name, game, character, password, and the choice itself — and the one resolver `resolveRemembered`, which every sign-in surface asks and which returns a `boolean` for the password and never the password. Secrets still go to Windows Credential Manager or nowhere, and that is now derived rather than promised: the suite scans `src/` for `invokeTauri('credential_store')` and `src-tauri/src/` for `keyring::` and fails on a *second* site, which a planted one reddens. Unticking forgets at once rather than at the next sign-in, and Settings' control clears the credential entry and the remembered preferences in one act. **The second half is the screen.** It had four rendered stages and 37 situations, and the gap is where somebody is stranded: `src/lib/signInStates.ts` enumerates every state — 14 hand-written, 13 from the `cargo test`-generated login codes, 5 from the generated refusal tokens, 5 from `ATTACH_OFFER_KINDS` — and `screenFor` returns the heading, the sentence and the action labels for each, so the words have one owner and a screen cannot say one thing while the button under it offers another. `SignIn.tsx` renders that and writes no prose of its own. A state with no screen throws naming itself, and `tools/sign-in-experience-test.mjs` walks all 37. The three attach answers with nothing to press (`no_port`, `no_lich`, `unknown`) and the two link states (`dropped`, `gave_up`) now carry a way back, which is #523's smallest honest fix. The form is a real `<form>` so Enter submits, with `autocomplete` on both fields and focus on the first empty one; progress names its step (*Signing in to Play.net…*, *Starting Lich…*, *Attaching…*) with elapsed seconds past three, because the attach retry runs to 20 s by design (#458); the technical line moved behind a *Details for a bug report* disclosure; the character list is a list of buttons with the last-played first. **Four acts to one**: `actionsToPlay` counts a field as two (reach it, type it), a submit as one and a pick as one — a returning player was 4 (account remembered, password not, and the remembered character was written down and never read, so the picker always appeared) and is now 1, because the picker is skipped when the remembered character is still on the account, and only then.
  note: three decisions worth recording. (1) **No second harness.** The increment asked for a new browser harness; `tools/sign-in-shots.mjs` already drives this screen, and two harnesses for one screen drift and then both are wrong, so the new cases (the one-press return, the stranded offer) are cases in it and the screenshots carry the new date. (2) **The checks that turned over were turned over, not deleted.** `credential-store-test`'s sabotage was "flip the default to `true`, watch it go red"; it is now "flip it to `false`". The shots harness asserted the remember box was *hidden* when a saved password was in use — true while it governed a password only, wrong now that it governs the account, game and character too. `doc-claims-test.mjs` section K asserted PRIVACY.md says the box is off; it asserts the new default, and the previous sentence joined its retired list so it cannot come back. (3) **`docs/LICH_NATIVE_LOGIN.md` §5.2 carries the dated reason**, in as many words, so that a later session reading `= true` does not read it as a defect and fix it back on privacy grounds — and the break-check's second case exists for the same reason.
  touches: new:src/lib/rememberSignIn.ts, gone:src/lib/rememberPassword.ts, new:src/lib/signInStates.ts, new:src/components/shared/RememberSignIn.tsx, gone:src/components/shared/RememberPassword.tsx, src/components/shared/SignIn.tsx, src/components/shared/LichLauncher.tsx, src/components/layout/SettingsSheet.tsx, src/lib/lichLogin.ts, src/lib/lichAttachOffer.ts, src/lib/persistence.ts, new:tools/sign-in-experience-test.mjs, new:tools/sign-in-experience-break-check.mjs, tools/sign-in-test.mjs, tools/credential-store-test.mjs, tools/doc-claims-test.mjs, tools/sign-in-shots.mjs, tools/build-privacy-doc.mjs, tools/build-player-data-doc.mjs, tools/gate.mjs, tools/test-suites.json, package.json, docs/PRIVACY.md, docs/PLAYER_DATA.md, docs/LICH_NATIVE_LOGIN.md
  depends-on: N5, N8, N9
  do: reverse the remembering default to on, under one preference with one owner covering everything a sign-in produces; give every state a player can be in a screen with something to press; make the form behave like a form; and change every document and string that said otherwise in the same PR.
  verify: see the PR body for the measured counts. `npm run gate` with `DRC_TEST_PORT=8109`; `node tools/plan-audit.mjs` `plan ok`; `node tools/build-privacy-doc.mjs --check` and `node tools/build-player-data-doc.mjs --check` exit 0 after regenerating; `node tools/sign-in-shots.mjs` against a dev server on a port nothing else held, with screenshots in `docs/verification/sign-in-experience-2026-09-09-*.png` and a `.md` beside them.
  sabotage: four, in `tools/sign-in-experience-break-check.mjs`, each restored from an `md5sum`-verified copy and each declaring the exact checks it must redden: a state loses its screen (3 red, naming `gave_up`), remembering defaults to off (3 red), a second path can store a secret (1 red), Enter stops submitting (1 red). Two defects the harness found were in the suite rather than in the app, which is the reason for asserting *which* checks go red: an over-predicted list, and a check whose name was longer than the output's pad width so a real red was invisible to the harness's own scan.
  pitfalls: 1, 12, 15, 16. No real Lich and no real account: every case runs against the dry-run stand-in.
  done-when: every enumerated state has a distinct screen with an action, the count derived from the generated tables rather than written down; the default is on and a flip back reddens a named check; and no document or component still carries the retired sentence.

---

### Lane M — World content pipeline (#436)

Dan, 6 Sep 2026, looking at the hand-built 19-cell Crossing mock: *"wow are you
going to do this for 17000 rooms? how many years? figure out how to batch."*
The viewer's content came from authored prose — one description per place,
1,067 of them against 17,750 rooms — so 95% of the game could never be
classified at all, and the live compiler published an empty classification for
every zone. This lane derives content for every room from the cartography
already on disk.

- [x] **M1  Batch every room's board content from the map** (≈90)
  commit: (this PR) verified: 2026-09-06 minutes: 150
  touches: new:src/lib/world-content-rules.mjs, new:tools/build-world-content.mjs, new:tools/world-content-test.mjs, new:src/data/world, new:tools/world-content-residue.csv, package.json, tools/test-suites.json
  do: read `src/data/map/*.json` and derive per room a ground kind, a block kind, a landmark and the compass sides facing no walkable neighbour. Rules named and counted in order — colour, title, label, zone, neighbour — with the colour→kind table *derived* from the data rather than typed, and printed. Landmarks come from `src/lib/mapLandmarks.ts::landmarkFor`, imported, not restated. Output committed per zone the way `src/data/map` is; residue listed in a CSV short enough to review.
  verify: `npm run world:build` under a 15,000-room floor; `npm run test:world-content`; `node tools/run-tests.mjs` ends `no failures`.
  done-when: every one of the 17,750 rooms has a content entry, unknown is well under 5%, and re-running the builder is byte-identical to what is committed.
  done: 17,750 rooms in 85 zones, 2.1 s. Decided by rule: colour 1,135 (6.4%) · title 13,358 (75.3%) · label 36 (0.2%) · zone 418 (2.4%) · neighbour 2,717 (15.3%) · unknown 86 (0.48%, ceiling 5%). 13 ground kinds; 4.61 MB committed across 87 files; residue 86 rooms, reviewable in one screen. Colour table derived and printed each run: 4 of 16 colours admitted (#FF0000 interior 85%, #993300 cave 83%, #000080 water 78%, #FF8000 interior 75%); the other 12 are demoted for incoherence, `#00FFFF` scoring 34% across hallways, garden paths and town squares.
  note: **the 90%-agreement gate against the hand-made Crossing classification is not met, and chasing it would have made the pipeline worse.** Measured: 47.4% over all 975 described rooms, 50.9% over the 393 whose place covers exactly one room (the lore classifier's unit is a *place*, so all 24 rooms of Asemath Academy get one answer). The disagreement is 302 rooms it calls outdoors and this calls indoors. A third instrument that reads no keywords at all — the exit graph, where `dir: 'go'`/`'out'` is a doorway and deleting every threshold drops a town into one street component plus a few hundred building-sized islands — puts **283 of those 302 (93.7%) behind a door**. Of this pipeline's 608 Crossing interiors 96.5% are behind a door, against 93.9% of the lore classifier's 293. The older instrument is the coarser one: its interior vocabulary is 15 words and has no *refectory*, *classroom*, *library*, *pantry*, *booth*, *teller* or *storage*. The adjudication runs in `--control` and is printed, so the next session sees the evidence rather than the conclusion.
  pitfalls: two rules were wrong on the first run and only the control could see it. Neighbour propagation crossing a doorway put 284 Crossing streets under a roof (Hodierna Way, Goodwhate Pike, Varlet's Run — ordinary streets ringed by shop doors); barring interiors from voting instead left 1,024 rooms unknown. It runs in two phases now, thresholds last. And the colour gate at a bare 60% majority admitted `#00FF00` at 65%, which is the mapper's marker for a service door as much as for the room behind it: a signal has to be *better* than the rule it pre-empts, not merely more often right than wrong, so the gate is 75%.
  sabotage: four, each reddening a different named check, all restored by md5 (`bfa022afa6c1` rules, `37b7fe2a7bec` builder, `2af799a36eb9` content pack). Drop `neighbour` from the ladder → `FAIL the unknown share is under the ceiling  2803 of 17750 = 15.792%`. Rename `water-ribbon-5m` in `shared_asset_content.gd` → `FAIL every primitive the content asks for has a factory registered in Godot  36743 asked for; unregistered: water-ribbon-5m x1375`. Hand-edit one `"ground":"street"` in the committed `src/data/world/1.json` → `FAIL the committed content is byte-for-byte what the builder produces`. Drop `colour` from `GROUND_RULES` → red, but on `FAIL every rule a record names is one of the declared rules` rather than on coverage: the ladder is the *vocabulary*, and the rule kept firing under a name no longer declared. Worth recording because it is not the failure that was expected, and the check that caught it was written for a different reason.

- [x] **M2  The viewer reads the batch, and can load a zone nobody wrote about** (≈60)
  commit: (this PR) verified: 2026-09-06 minutes: 120
  touches: src/lib/presentationBridge.ts, src/lib/presentationTypes.ts, gone:tools/build-primitive-world-manifest.mjs, gone:tools/build-godot-mock-fixture.mjs, godot/mock/crossing_mock_world.json, gone:godot/tests/content_registry_test.gd, gone:godot/tests/cell_click_target_test.gd, gone:godot/tests/cell_detail_window_test.gd, new:src/lib/worldContent.ts, new:src/lib/world-content-rules.d.mts, new:tools/world-content-loader-test.mjs, package.json, tools/test-suites.json, docs/PLAYER_DATA.md, docs/PRIVACY.md
  depends-on: M1
  still true, 9 Sep 2026: **Lane M is not superseded and its output is the reason the room-graph data was retained.** `src/data/world` holds a content record for every one of 17,750 rooms — ground kind, block kind, landmark, tags, boundary edges — and `npm run world:build -- --check` still passes over 87 generated files. That vocabulary is renderer-agnostic: `street`, `cave`, `water`, `forest` are as drawable as sprites as they were as blocks. What went with 3D is the *art side* of it — the primitive-world manifest, the mock-fixture generator and the three GDScript tests above. The one live consequence is that `world-content-rules.mjs`'s "every primitive the content asks for has a factory registered in Godot" check had no content pack to read after PR #517; it is now three-state and re-arms when the 2D pack lands. T4 is where the batch meets sprites.
  do: `compileWorldSnapshot` publishes `boardLayoutFor({})` for every cell, so no live room has ever been an interior. Load the zone's content manifest and pass the classification through, so the live path and the Crossing art path take content from one place. Source `build-primitive-world-manifest.mjs`'s cells from `src/data/map` + `src/data/world` rather than from the place briefs, which is what limits it to the 1,060 described Crossing rooms today.
  verify: the regenerated mock fixture still passes `test:godot-fixture-contract`; a forest zone and a cave zone compile to cells with the right block kinds.
  done-when: the Crossing renders from the pipeline rather than from the hand-made classification, and a zone with no authored prose renders at all.
  done: the art manifest builds for **any** zone — Crossing 1,060 cells (was 975, the rest having no authored place description), Boar Clan 666, Hibarnhvidar 513, where before it threw `No mapped room cells found for zone <n>` for 83 of 85. On the live path a Crossing interior now publishes a 3 m block against an outdoor room's 1 m, measured over 933 rooms; before this every cell in every zone published `boardLayoutFor({})` and the `interior-cutaway` branch was unreachable outside the offline Crossing manifest. `test:world-content-loader`, 9 checks. Full suite 156 suites, 5,775 checks, no failures.
  pitfalls: three GDScript cases went red and none of them was a viewer change. All three pair an ordinary cell against an interior cutaway, naming `1-16` for the tall one — Town Green South, an interior under the lore classification and a park under the batch. The pair was still two cells and had stopped being a pair, so the checks compared 1 m against 1 m. Hardcoding an id is a claim about a fixture that nothing keeps true, so the generator states the requirement, grows the slice by the *nearest* cell meeting it (Milgrym's Weapons Showroom and the Clerics' Guild Chapel; 18 cells to 20), publishes the ids under `guarantees`, and aborts rather than emitting a fixture that cannot satisfy one. The first version of that grew the neighbourhood until it qualified and took the mock from 19 cells to **575**, which is not a mock.
  note: `worldContent.ts` calls `import.meta.glob`, a Vite build-time transform and a plain TypeError under bare Node, so the bridge reaches it through a lazy import guarded on there being a zone at all. A static one took `tools/presentation-bridge-test.mjs` (103 checks over the pure compiler) down with it, and an unguarded dynamic one broke `tools/viewer-absent-test.mjs`'s "publishing with no world does not throw". The pure half of the bridge stays runnable outside Vite; only the publication path, which already needs Tauri, reaches for the loader.
  sabotage: put `board: boardLayoutFor({})` back → `FAIL a live interior publishes a taller block than a live outdoor room  interior 1 m, outdoor 1 m across 933 rooms`, restored md5 `26b301268ea8`. Delete `guarantees` from the committed fixture → three GDScript scripts red, `224 checks` against `274`, restored md5 `f3eef178cae8`.

- [x] **M4  A named street should not render as two grounds** (≈40)
  commit: (this PR) verified: 2026-09-06 minutes: 95
  touches: src/lib/world-content-rules.mjs, src/lib/world-content-rules.d.mts, tools/build-world-content.mjs, tools/world-content-test.mjs, src/data/world
  depends-on: M1
  do: measured over the shipped content, 147 of the 2,199 places holding two or more rooms have rooms that disagree about their ground kind, covering 1,243 rooms — "Via Iltesh" is street in `1-12` and grass in `1-13`, both decided by neighbour propagation, and they are the same street. 90 of the 147 have no directly-decided room at all. A cohort pass that unified every same-`place` group would be wrong: `place` is also the room's own sub-name, so "Bar", "Lounge" and "Entrance" recur across unrelated buildings and 10 zones share a "Tunnel". Unify only rooms of one place that are connected to each other without crossing a threshold, and only where propagation rather than a title decided them.
  verify: the split-cohort count falls, the unknown share does not rise, and the exit-graph adjudication in `--control` does not fall.
  done-when: a street named once renders as one street.
  done: the unit is a **place cohort** — one place name, one zone, walk-connected — and naming it correctly is most of the increment. 8,996 cohorts over 17,742 placed rooms; 2,028 hold two or more rooms; **93 of those disagree internally, over 810 rooms**. That is not the plan's 147/1,243, and the gap is the point: 147 counts place *names* per zone, and 54 of those names are two or more unconnected runs whose halves each agree with themselves. A place name spanning two components is two places, so those were never one disagreement. Unified 41 cohorts, moving **79 rooms**; left 52 (484 rooms) exactly as the ladder decided them — 26 ties, 14 majorities under two thirds, 12 where a minority room outranks the majority. Same-place name groups that disagree: **147 before the pass, 113 after**. Unknown fell 86 → 84 (0.48% → 0.47%), so the residue shrank rather than grew. `--control` before and after: spatialMode 462/975 = 47.4% both, single-room places 200/393 = 50.9% both, tier 425/975 = 43.6% -> 424/975 = 43.5%, and the exit-graph adjudication byte-identical (283 of 302 = 93.7% behind a door; this tool's interiors 587/608 = 96.5%; the lore classifier's 275/293 = 93.9%). The single fall is one room: `1-80` "3 Retainers' Crescent" moved water to street with its two neighbours (2 of 3, all neighbour-decided), which is right for a crescent, and the lore classifier calls it `bridge-water` from authored prose. Diff to the committed content: 23 of 87 files, 58 insertions, 39 deletions. Full suite 157 suites, no failures; `test:world-content` 25 checks against 12.
  rule: unify a cohort to its majority ground kind only when the majority is decisive, meaning all of (1) the majority kind is not `unknown` — unifying *to* unknown would raise the unknown share to tidy up a disagreement; (2) it holds at least 2/3 of the cohort and strictly more than any other kind, so a 1:1 tie is not a majority; (3) no minority room was decided by a rule *stronger* than the strongest rule behind the majority, `GROUND_LADDER` order being the ranking. Clause (3) is what stops this being the blanket same-`place` unification the plan rules out: a room whose own title says water keeps its water against neighbour-decided streets, and in the shipped content it alone holds 12 cohorts back, nearly all one colour-decided interior standing in a title-decided street — a shop the cartographer coloured, on a road the cartographer named. Two thirds rather than a bare majority for the reason the colour gate is 0.75: every room in a cohort already has an answer, so this rule only ever destroys evidence and has to be paying for that.
  placement: a new phase in the same builder, after **both** propagation phases and before block kinds are derived, and both of M1's bad first-run cases argue for last rather than between them. The doorway case (thresholds counted from the start put 284 Crossing streets under a roof) — this pass reads the same walk-only edge set so it cannot make that mistake itself, but running it before propagation's threshold phase would let the kind it had just spread along a whole street cross those doors, and the failure would come back sourced from a cohort instead of one room. The interior-voting case (barring interiors from voting left 1,024 rooms unknown) — phase two exists for the back room whose only clue is the shop it opens off, and running this first would change what phase two sees. Its input is frozen: nothing it writes is ever read as evidence.
  note: **"Via Iltesh", the plan's own headline, is not fixed, and the rule is right not to fix it.** It is two rooms, `1-12` street and `1-13` grass, both decided by neighbour propagation from opposite ends. There is no majority and nothing in the data prefers either; a tie-break on the ground-kind vocabulary's order would pick street by alphabet, not by evidence. It is reported as held with its reason, and it is one of 26 such ties. The one measurable cost on the control is also named: `1-80` "3 Retainers' Crescent" moved water → street with its two neighbours (2 of 3, all neighbour-decided), which is right for a crescent, and the lore classifier calls that room `bridge-water` from authored prose — so tier agreement fell by exactly one room, 425/975 → 424/975. spatialMode agreement and the whole exit-graph adjudication are unchanged.
  sabotage: two, each reddening a named fixture, restored by md5 `de18fe3d77b3` (`src/lib/world-content-rules.mjs`). Delete the `THRESHOLD_DIRECTIONS` skip inside `placeCohorts` so a `go` exit is a walk edge → `FAIL fixture door: two same-place rooms joined only by a go exit are two cohorts  1 cohorts, sizes 2`, and with it `FAIL every cohort left disagreeing in the committed content is one the pass held on purpose  8779 cohorts re-derived (index 8996), 59 still disagree (index held 52)` plus the byte-identity check. Lower the gate to 1/2 → `FAIL fixture short-majority: 3 of 5 is a majority, is under two thirds, and is held  unified: (gate 1/2)`, plus byte-identity over 11 zones. The first attempt at sabotage one matched nothing and the guard aborted rather than reporting a pass, which is why the md5 is compared before the suite runs and not after.

- [x] **M3  Capture a zone that has never been rendered** (≈20)
  commit: (this PR) verified: 2026-09-06 minutes: 35
  touches: new:docs/verification/world-content-2026-09-06.md, new:docs/verification/world-content-2026-09-06-boar-clan-forest.png, new:docs/verification/world-content-2026-09-06-hibarnhvidar-cave.png
  depends-on: M2
  do: `tools/viewer-snapshot-server.mjs --room <id>` against a forest zone and a cave zone, per `docs/verification/token-height-2026-09-06.md`. Save the captures and say what is on screen.
  verify: two captures in `docs/verification/`, each with a sentence about what it shows.
  done-when: somebody who was not there can see that the batch produced a board.
  done: Boar Clan `127-186` (Paasvadh Forest, Understory; 666 cells) and Hibarnhvidar `116-114` (Inner Hibarnhvidar, Upper Cavern; 513 cells) — the first captures of any zone but the Crossing in this repository. Boar Clan is a flat green board of 1 m blocks on terrain planes (199 forest, 123 grass of 666); Hibarnhvidar is brown 3 m cutaway blocks (296 interior, 95 cave of 513). Nothing in the viewer differs between the two captures. The rig's own five `FIXTURE` tokens are in both; `capture-godot-window.ps1` refused three times with "window did not take foreground" before the second capture, so both are pictures of the window they name, and each viewer and rig was killed by the pid it was launched with.
  pitfalls: the boundary kit draws as the matte fallback slab in both, because `godot/shared-assets` is not initialised in this worktree. That is a missing asset and the viewer says so on the console; it is not a missing classification, and the doc says which.


### Lane S — Scene editor (#445)

Dan, 6 Sep 2026: *"work on the scene editor."* There was none. Lane M
classified all 17,750 rooms from the cartography and M2 carried that answer to
the viewer, which leaves the other half of the same problem: 86 rooms the batch
could not classify, and 17,664 it classified with nobody able to disagree. This
lane is the disagreement, and the route back into the pipeline.

The shape is the one this repo has already built four times — `portraits.ts`,
`creatureArt.ts`, `playerArt.ts`, and `appearance.ts` in Lane K: a generated
guess, a player override in prefs, and **one** resolver both the compiler and
the UI read. Nothing here is a second copy of the batch's rules; `ground` is a
choice and `block`, `spatialMode` and `tier` follow from it through
`world-content-rules.mjs`, which is the pipeline's own statement of them.

Lane K's **K6 Picker UI** is superseded rather than closed. Its blocker was
real and is unchanged: the asset registry admits no *item* meshes, so a picker
offering a rock as an alternative to a sword is still the substitution
`admission.forbiddenSubstitutions` forbids. S3 builds the picker for the class
of content the registry *can* draw — scenery, two kinds today — so the UI
pattern K6 described now exists and can be pointed at item meshes the day the
registry admits one. K6 stays `[!]` and names S3.

- [x] **S1  Resolver, storage, and the compiler hook** (≈45)
  commit: (this PR) verified: 2026-09-06 minutes: 95
  touches: new:src/lib/sceneOverrides.ts, new:tools/build-scene-registry.mjs, new:src/data/sceneRegistry.json, new:tools/scene-editor-test.mjs, gone:godot/scripts/world_root.gd, src/lib/presentationBridge.ts, src/lib/presentationTypes.ts, src/lib/usePresentationBridgePublisher.ts, src/lib/mapLandmarks.ts, gone:godot/scripts/content_registry.gd, gone:godot/tests/content_registry_test.gd, package.json, tools/test-suites.json, tools/build-player-data-doc.mjs, docs/PLAYER_DATA.md, docs/PRIVACY.md
  depends-on: M2
  still true, 9 Sep 2026: **Lane S survives and the scene editor is kept.** What it edits — a room's ground kind, block kind, landmark and backdrop — is content, not geometry, and every one of those choices is as meaningful to a 2D isometric sprite as to a 3D block. `resolveScene`, the `drc.scene.v1` store, the import schema and the bounded-write guarantees (S5) are untouched. Two things did go: `content_registry.gd`'s placement of a primitive at a published offset, and the option list compiled from the deleted content pack, so `sceneRegistry.json` is frozen at the kinds the 3D pack admitted until a 2D pack exists. **The in-cell placement UI (S3) is the part most at risk**: it positions primitives in metres on a 4.4 m footprint, which is a 3D board unit. T1 decides whether that becomes a 2D sprite anchor or is dropped; until then S3's clamp is doing real work on a coordinate nothing renders.
  do: `resolveScene(roomId, guess, overrides)` = override ?? guess, exported and read by `compileWorldSnapshot` and by the panel — one resolver, not two agreeing ones. Overrides under `drc.scene.v1` through `storage.ts`. Every option list compiled from `godot/scripts/shared_asset_content.gd` by a `--check`-able builder, never typed. `content_registry.gd::build` places a primitive at the `offset` the manifest gives it, clamped to the cell's own published block.
  verify: `node tools/scene-editor-test.mjs`; `node tools/godot-tests.mjs`; `node tools/build-scene-registry.mjs --check`.
  done-when: an override set in the store changes what the live compiler publishes for that cell, and changes the block's height when it should.
  done: 36 checks. Registry compiled: 5 kinds (2 placeable, both scenery), 13 of 13 ground kinds drawable, 4 of 4 block kinds, 29 landmark kinds, 17 reviewed backdrops. `content_registry_test.gd` 27 checks to 33.
  sabotage: six, each reddening a different named check, all restored by md5. Full evidence in `docs/verification/scene-editor-2026-09-06.md`.
  pitfalls: two. `loadSceneOverrides` had to start holding its parsed object, because `useSyncExternalStore` compares snapshots by identity and a loader that re-parsed would re-render the panel forever — which also meant the test's own reset had to clear that cache as well as the backing store, or every case would have read the previous case's overrides and several would have passed for the wrong reason. And the publisher republishes on zone, room and character, none of which an edit changes, so an edit forces a publish through a revision counter; without it the viewer would not have moved until the player walked out and back.

- [x] **S2  The panel** (≈40)
  commit: (this PR) verified: 2026-09-06 minutes: 55
  touches: new:src/components/shared/ScenePanel.tsx, new:tools/scene-editor-shots.mjs, src/lib/layout.ts, src/components/dashboard/panels.tsx, src/lib/panelDataContracts.ts, src/lib/roomText.ts, new:docs/verification/scene-editor-2026-09-06.md
  depends-on: S1
  do: a dockable panel, `?view=panel&id=scene` as well, on the room the character is in or any room from the existing `PlaceSearch`. Ground, block and landmark as dropdowns over `sceneOptions()`; the backdrop as a grid of the actual reviewed images, since a dropdown of file names is unreviewable. Each field says whether the value is the batch's or yours, and offers reset only when there is something to reset. `roomArtSelection` gains a `player-override` layer ahead of the generated table — `docs/SCENE_ART.md`'s tier 1 finally has a writer.
  verify: the real browser, in demo mode: change the ground kind, assert the store and the compiled cell; captures in `docs/verification/`.
  done-when: a person can change what a room looks like without editing a file.
  done: the panel ships as `scene`. Landmarks are labelled as not drawn by the viewer, because no content pack registers a landmark factory: the field is real content the snapshot carries and the 2D map draws, and saying so is better than implying the choice changes the board.

- [x] **S3  Picker and placement, superseding K6** (≈40)
  no-3d-history: a completed increment, kept as its record. Its "item meshes appear by themselves the day the registry admits one" was true of the shared-asset registry, which PR #517 deleted; nothing can admit a mesh now.
  commit: (this PR) verified: 2026-09-06 minutes: 50
  touches: new:src/components/shared/ScenePrimitivePicker.tsx, S2>src/components/shared/ScenePanel.tsx, S1>src/lib/sceneOverrides.ts, S1>tools/scene-editor-test.mjs
  depends-on: S2
  do: a grid of the registry's placeable kinds — two today, and item meshes appear by themselves the day the registry admits one, because the list is compiled rather than typed. No placeholder rows for meshes that do not exist. Position by clicking a top-down 4.4 m footprint of the cell with its eight compass edges drawn, or by typing x and z.
  verify: browser: place one, reload, still there; the compiled cell carries the offset; the Godot capture shows it where it was put.
  done-when: K6's `verify:` is satisfied for the content the registry can actually draw, and K6 says so.
  done: the picker ships inside the scene panel, over the two kinds the registry admits, both scenery. `clampToCell` is exported from `sceneOverrides.ts` and is the only arithmetic the control does, so the property checked is not "the clamp clamps" but that **no value the control can produce is one `isDrawable` refuses** — asked of the store rather than of the clamp. A click moves the selected primitive rather than adding a second copy of it, because placing then nudging is the commonest thing a person does here. The empty case is a sentence, not a greyed-out row: a "sword (coming soon)" would be the same lie as an undrawable dropdown entry.
  sabotage: `tools/scene-sabotage.mjs` case 8 — `clampToCell` returns its input unbounded, which is exactly what a picker doing its own arithmetic amounts to, and `FAIL nothing the clamp can produce is refused by the store` goes red.
  pitfalls: the clamp had to live in exactly one place. A control doing its own arithmetic can hand `setSceneField` a value a float past the edge, and the refusal then arrives as a red message about a click made *inside* the square the person was shown, which reads as the editor being broken rather than as a rounding error. Godot's own clamp in `content_registry.gd::_place` is against the cell's *published* block rather than this layout constant, and the two are allowed to differ in that direction only.

- [x] **S4  Coverage list, export and import** (≈35)
  commit: (this PR) verified: 2026-09-06 minutes: 60
  touches: S2>src/components/shared/ScenePanel.tsx, S1>src/lib/sceneOverrides.ts, tools/build-world-content.mjs, src/lib/world-content-rules.mjs, S1>tools/scene-editor-test.mjs
  depends-on: S2
  do: the zone's residue from `tools/world-content-residue.csv` as a work list, each row opening that room in the editor. Export and import the override set as one JSON, the local player's own choices always winning a conflict. `tools/build-world-content.mjs` reads that file as its first rule, above colour, so a correction made once survives the next build.
  verify: the coverage list equals the residue for the zone; export then import round-trips byte-identical; a room in the imported set comes out of the builder with the imported answer.
  done-when: the residue is a list somebody can work through, and working through it is not thrown away by the next `npm run world:build`.
  done: `GROUND_RULES` gains `player` ahead of `colour`, and the builder reads `data/scene-overrides.json` — the editor's own export shape, so the set of choices is not described twice — as its first rule. Below colour it would be a correction the next run overrules, and a correction the machine can overrule is not a correction. The coverage list is derived from the zone's committed content by `rule === 'unknown'` rather than read from the CSV, because the CSV is the same fact written a second time and a panel reading it would go stale the day somebody rebuilt the world without committing it; `tools/scene-editor-test.mjs` holds the two to each other across all 85 zones, **in both directions**, and asserts the 86 is non-zero first so two empty sets cannot satisfy the equality.
  verified-by: 56 checks in `tools/scene-editor-test.mjs`, 20 of them added here. The builder cases run the real `tools/build-world-content.mjs` end to end through new `DRC_WORLD_OUT` / `DRC_WORLD_RESIDUE` / `DRC_SCENE_OVERRIDES` seams into a fresh temp directory — a seam and not a mode switch, so the code under test is byte-for-byte the code that ships, and a run that ignored the seam fails for want of the file rather than passing against the committed one.
  sabotage: `tools/scene-sabotage.mjs` cases 9–11 — the builder stops reading a person's corrections back; it keeps the read but drops the undrawable guard, so a kind Godot has no factory for is baked into content every player receives; and the committed residue CSV gains a row for a room the batch *did* classify, which is the drift the coverage list exists to be protected from. Each reddens its own named check and nothing else — a row was added rather than deleted precisely so exactly one direction of the comparison can see it. Nine of the eleven cases run without an engine (`--no-godot`), and the harness carries the two it skipped into its own summary rather than reporting nine as though it were the whole suite.
  pitfalls: three states, never two. A run with no override file and a run whose file decided nothing would both have printed `player 0` in the rule table, and the reader could not have told a machine with no corrections from one whose corrections were all thrown away — so "there is no file" is its own sentence, and a file naming rooms this cartography does not have is a hard `FAIL` rather than a silent no-op, because applying none of it looks exactly like having no file. A field the registry cannot draw is dropped and counted rather than honoured: baking one into the committed content would put a placeholder box in front of every player rather than only the one who typed it. And `landmark` is read with `'landmark' in override` rather than a truthiness test, because `null` is a real answer here — "this room has no landmark" is the correction the batch cannot express.

- [x] **S5  One schema at the import boundary, a bounded store, and honest writes (#461)** (≈60)
  commit: (this PR) verified: 2026-09-06 minutes: 110
  touches: S1>src/lib/sceneOverrides.ts, S1>src/lib/presentationBridge.ts, S2>src/components/shared/ScenePanel.tsx, src/lib/storage.ts, S1>tools/scene-editor-test.mjs, S3>tools/scene-sabotage.mjs, S2>tools/scene-editor-shots.mjs, tools/build-world-content.mjs, tools/build-player-data-doc.mjs, docs/PLAYER_DATA.md, new:docs/verification/scene-import-2026-09-06.md
  depends-on: S4
  do: `parseSceneOverrides(file)` and `parseSceneOverrideSet(value, {requireDrawable, knownRooms})` are the one gate the importer, the store's load path and `tools/build-world-content.mjs` all go through. `version` and `provenance` are read rather than typed; room-id keys must match the map's shape and name a room the cartography has; primitives are a typed `{kind, x, z}` and nothing else; the blob is capped. `setSceneField` and the import return `{ok:false, reason}` when the write does not land, through a `writeJSONVerified` that reads the key back. `compileWorldSnapshot` returns `diagnostics`, which the panel's coverage view shows.
  verify: `node tools/scene-editor-test.mjs`; `node tools/scene-sabotage.mjs --no-godot`; `node tools/scene-editor-shots.mjs`; `npx tsc -b`; `npm run lint`.
  done-when: a bad file is refused with the reason on screen, a lost write is never reported as saved, and nothing is dropped without being named.
  done: 92 checks (was 56), 41 in the browser. The caps are `SCENE_LIMITS`, chosen against a measured quota rather than a round number: the harness fills one key until the origin refuses — **5,177,344 characters** on 6 Sep 2026, shared with every key in `docs/PLAYER_DATA.md` — so the scene store may hold **1,048,576 characters in total, 4,096 for any one room, 64 primitives in one cell**, values 256 characters and primitive kinds 64. Before this the worst case was 4,361,241 characters with nothing to stop it, which is one import from taking every other preference in the app down with it. Fourteen refusal cases, each naming its own cause, behind a control that a well-formed file is still accepted. `tools/build-world-content.mjs` lost its own copy of the validation and calls the schema.
  sabotage: `tools/scene-sabotage.mjs` cases 13–15 — accept any version, drop the read-back, drop the diagnostics; each reddens the check it names and nothing else, restored clean against HEAD. Cases 3 and 10 were **re-aimed**, because their anchors were lines this change replaced and a sabotage whose anchor no longer matches rewrites the file unchanged and reads exactly like a pass.
  pitfalls: four. The store's load path validates structure and size and deliberately **not** kinds — `resolveScene` ignores an unregistered kind and keeps it so a content pack can bring the player's choice back, and a loader that validated kinds would delete the work that design exists to protect; the difference is one flag, `requireDrawable`, and case 10 is what proves it still bites. `__proto__` as a room-id key had to be tested through `JSON.parse`, because as an object literal it sets the prototype and there is no key left to refuse — a case written the obvious way passes against a parser that does nothing. The per-room cap is unreachable through an import (every registry kind is short) so it is asked of the schema directly, on the load path where it is reachable. And the browser harness carried `999-1` as "a room this machine had no opinion about" — a room in no zone this app ships, taken and stored, which is the bug sitting inside the check that was watching for it.

---

### Lane Q — Player config: the client's own macros, aliases, highlights, substitutes, gags, variables and presets

**Complete, 6 September 2026.** Q1–Q6 are `[x]` (#467, #471, #476, #478, #474
and Q6). What the lane leaves behind: one store, `src/lib/playerConfig.ts`, with
one localStorage key per domain and one migration that answers in three states;
seven editors in one panel, each previewing through the resolver the game pane
itself calls rather than a matcher written for the preview; a read-only Genie
importer that reports every line it would not take; a file surface,
`src/lib/playerFiles.ts` over `src-tauri/src/player_files.rs`, that is the only
thing this app writes with and writes nothing into a Genie install; and one JSON
document carrying all seven domains between machines, sharing its header and its
writer with the scene editor's export rather than growing a second of either.
`docs/PLAYER_CONFIG.md` §§10–13 record what each increment actually landed where
it differs from the design, and say plainly that where the page and a `verify:`
line disagree the check is right.

The gap this lane closed, in one sentence: a player without a Genie install
could not hold a single rule of their own, and now the rules are the app's own
and leave it as a file they can read.

N6 deleted the editors for all seven, correctly — they edited *Genie's*
`Config\*.cfg` files and the app no longer routes through Genie — and its own
PR body wrote down what that costs rather than leaving it to be found:
"there is no in-app editing of macros, presets, substitutes, gags or variables
at all now, and none of highlights or aliases. Re-implementing any of it
*against Lich* is a new increment nobody has written." This is that increment.

What survives and is built on rather than replaced: `highlights.ts`'s `paint()`
and its catastrophic-backtracking guard, `aliases.ts`'s `expandAlias()`,
`keybindings.ts`'s `codeToGenieKey()` and its one global listener,
`offClasses.ts`, the read-only Genie importer, and the outbound lane, whose
`macro` source and pacing already exist (`commandLane.ts`,
`command_gate.rs`). What does not exist at all today: substitutes, gags,
presets, variables, key-chord macros, and any way for a player without a Genie
install to hold a single rule of their own.

**The design, the schema, the resolver signatures, the import mapping table and
the read-vs-inferred split are `docs/PLAN_TO_1_0.md`'s companion document,
`docs/PLAYER_CONFIG.md`.** It is the interface Q2, Q3 and Q4 build against
concurrently. Two rules from it are worth repeating here because they are what
keep this from becoming a second config system: **one store** (one owner
module, one localStorage key per domain, never a copy of a list), and **one
resolver per domain, and it is the one the runtime already calls** — the
editors change what those resolvers read, not how anything renders or sends.

The five parsers N6 deleted are recoverable rather than lost, and Q1 restores
them instead of writing new ones:
`git show 2327a971^:src/lib/{substitutes,gags,presets,variables,macros}.ts`.

- [x] **Q1  The store, the schema, the migration, and the Genie import** (≈180)
  touches: new:src/lib/playerConfig.ts, new:src/lib/playerConfigImport.ts, new:src/components/config/PlayerConfigPanel.tsx, src/lib/layout.ts, src/lib/highlights.ts, src/lib/aliases.ts, src/lib/useHighlights.ts, src/lib/useAliases.ts, src/components/dashboard/panels.tsx, src/lib/panelDataContracts.ts, src/components/layout/AppControls.tsx, new:tools/player-config-test.mjs, new:tools/player-config-import-test.mjs, new:tools/player-config-shots.mjs, tools/doc-claims-test.mjs, tools/build-player-data-doc.mjs, docs/PLAYER_DATA.md, docs/PRIVACY.md, docs/PLAYER_CONFIG.md, package.json, tools/test-suites.json
  depends-on: N6
  do: `playerConfig.ts` owns the seven domains of `docs/PLAYER_CONFIG.md` §4, one localStorage key each (`drc.player-config.<domain>.v1`, each holding `{version, entries}`) through `storage.ts`'s `readJSON`/`writeJSON` — beside `PersistedPrefs`, not inside it, for the reason §4.1 states. Entries carry a generated `id` rather than the `sourceLine` the Genie-file era used, so an editor patches one rule by identity. `migratePlayerConfig(raw, domain)` returns `{entries, migrated, dropped}` — three states, so "nothing to migrate" and "could not read this" are never the same answer. `playerConfigImport.ts` is pure: `importGenieConfig(files) -> {config, report}`, with the five restored parsers as its readers and a per-file `{found, lines, parsed, imported, skipped[]}` report plus an `unsupported[]` list naming the Genie features this app has no home for (§6.1). Ship the panel shell with a tab per domain, each tab a one-line placeholder naming the increment that fills it (Q2/Q3/Q4/Q6) so the gap is on screen rather than in a document; `'config'` joins `PanelId` and `?view=panel&id=config` works like every other panel.
  verify: `node tools/player-config-test.mjs` → `N checked, 0 failed`, with a floor asserting all **7** domains were exercised (a truncated domain list must fail rather than report a smaller clean run) and a round trip through `localStorage` for each. `node tools/player-config-import-test.mjs` → against a fixture carrying, per leaf, one well-formed entry and one malformed one: `parsed` and `imported` are stated against `lines` as the denominator, and `skipped` names the malformed line. `npx tsc -b` and `npm run lint` clean. `git grep -n "read_genie_config" src/lib` → the importer only.
  sabotage: (1) delete one domain from the store's domain list → the 7-domain floor reddens naming it, and nothing else. (2) `migratePlayerConfig` returns its input unchanged → the v0→v1 case reddens and only it. (3) hand the importer an empty string for every leaf → it must report `found: false` per leaf and refuse, never "imported 0" as a success; a filter that empties its input is an error naming the reason. (4) make `writeJSON` throw → the store must surface the failure, not silently keep an in-memory copy that vanishes on reload.
  pitfalls: 1 (the denominator: `loadAliasConfig` already counts non-blank lines because a parser that drops half the file and one that works print the same count otherwise — keep that, per domain), 12 (old data under a new meaning: a v0 entry must be migrated, never reinterpreted), 10 (stage by path).
  done-when: a machine with **no Genie install** can hold a highlight, an alias and a macro across a restart, and a machine with one can import 356 aliases and 53 highlights and be told what did not come across.
  done: 2026-09-06 minutes: 150 — `dev/wt-q1` off `origin/main` at `4bb19d7d`. `npx tsc -b` exit 0; `npm run lint` exit 0; `node tools/plan-audit.mjs` `plan ok: 146 increments, 585 paths checked`; `DRC_TEST_PORT=8069 node tools/run-tests.mjs` `no failures`, 159 suites, 6045 checks, with the one pre-existing NOT CHECKED line (`test:godot-fixture-contract`). New suites: `node tools/player-config-test.mjs` `49 checked, 0 failed` (its sabotage anchors normalise line endings first: this repo checks out CRLF, and the first version matched a plain newline, so it passed on the working copy and then aborted the moment git had touched the file - caught by that abort rather than by a pass, which is the guard doing its job), `node tools/player-config-import-test.mjs` `45 checked, 0 failed`. Real browser: `node tools/player-config-shots.mjs` against a dev server on 5196 (killed by pid), all passed — seven tabs on screen, an import from a two-file fixture, the report and the skip reason with it; `docs/verification/player-config-2026-09-06-panel.png`. **The import measured against the real config on this machine** (`C:/Genie4/Config`, never committed): 31 presets, 58 highlights of 488 lines, 356 of 356 aliases, 95 macros, 34 of 46 variables, 0 skipped anywhere; 87 aliases and 25 macros carry Genie script and import switched off with their text intact; `substitutes.cfg` and `gags.cfg` are still empty here, so their formats stay inferred exactly as §6.1 says. **Four departures from the `touches:` line as written, all listed above and all forced:** the five parsers live inside `playerConfigImport.ts` rather than as five restored modules (one consumer, one copy); `useHighlights.ts`/`useAliases.ts`/`highlights.ts`/`aliases.ts` are edited here rather than left to Q2/Q3, because this increment's own `verify:` requires that nothing reads a Genie leaf any more and a hook reading the store needs a resolver — `resolveHighlights`/`resolveAliases` ship now and Q2/Q3 extend them rather than writing a second one; `panels.tsx` and `panelDataContracts.ts` are `Record<PanelId, …>` and cannot compile without the new id, and `AppControls.tsx` is where the deleted Genie button stood, so it is where the way in belongs (`src/App.tsx` needed nothing and is not touched). **`tools/doc-claims-test.mjs`'s "the Genie config editor stays deleted" was turned the right way up rather than deleted**: it asserted that `src/components/config` did not exist, which is the mechanism, and the property is that nothing there writes into a Genie install — that is what it asserts now, and the untouched one-caller check on `saveGenieConfig` still reddens under its existing sabotage (`node tools/doc-claims-break-check.mjs`: 17 sabotages across 10 files, 0 did not redden exactly the checks they named). Sabotages, each restored byte for byte, `md5 be4357c0f3e611813b7c6f4d2bbd3a37` for `playerConfig.ts` and `77618a9c7b1523c53e9e9ffb9221b079` for `useHighlights.ts` before and after: (1) dropping `'variables'` from `DOMAINS` reddens exactly `all seven domains were exercised, not a shorter list` — `6 of 7` — and nothing else; (2) `if (version > PLAYER_CONFIG_VERSION)` to `if (false)` reddens the two v99 cases and then **aborts** with `sabotage "no-version-check" did not change src/lib/playerConfig.ts - the target text was not found`, which is the suite refusing to run its own mutant over an already-broken file rather than reporting a pass; (3) pointing `useHighlights` at what a Genie read gives with no Tauri (an empty config) reddens `a highlight typed into the store colours the line` and nothing else. `docs/PLAYER_DATA.md` and `docs/PRIVACY.md` are regenerated, not hand-edited: seven new keys described (37 keys, 310 files scanned) — the generator refuses an undescribed key, which is why the key constants are seven named constants rather than one template. **Not done here, and named rather than folded into the above:** `pinsFile.ts` still calls `read_genie_config` for the pins file (Q5 moves it); `substitutes.cfg`/`gags.cfg` formats are still inferred; a `#macro` whose command contains braces parses its second group short — a property of the recovered parser, asserted in the import suite so it is a known edge rather than a surprise.

- [x] **Q2  Highlights and presets, edited against the renderer that already exists** (≈150)
  touches: new:src/components/config/HighlightsTab.tsx, new:src/components/config/PresetsTab.tsx, Q1>src/lib/playerConfig.ts, Q1>src/components/config/PlayerConfigPanel.tsx, src/lib/highlights.ts, src/lib/useHighlights.ts, tools/highlight-test.mjs
  depends-on: Q1
  do: `resolveHighlights(cfg) -> {entries, refused}` in `highlights.ts` — preset ids to colours, disabled rules dropped, regexps compiled and run through the existing `PATTERN_BUDGET_MS` probe, refusals returned so the editor shows them beside the rule instead of swallowing them the way Genie does. `useHighlights.ts` reads the store instead of `read_genie_config`; its signature does not change, so `GameLineRow`, `HighlightedText`, `GameSignals`, `BattleColumn` and `GameChatColumn` are untouched. The preview pane runs `paint()` itself over the last 200 lines from `useGameLines()` — never a second matcher, or the preview and the pane can disagree.
  verify: `node tools/highlight-test.mjs` with the new cases → `0 failed`, including: a disabled rule is absent from `resolveHighlights` output; a rule naming a deleted preset renders in the default colour **and appears in `refused`** rather than vanishing; a pattern that fails the backtracking probe is refused with its measured time. `grep -c "indexOf\|RegExp" src/components/config/HighlightsTab.tsx` → `0`, the check that the preview has no matcher of its own.
  sabotage: (1) make the preview build its own match instead of calling `paint()` → the grep check above reddens. (2) drop the `refused` list on the floor → the deleted-preset case reddens naming the rule. (3) point `useHighlights` back at `read_genie_config` → the "no Genie install still has highlights" case reddens.
  pitfalls: 1 (a preview that shows nothing because it was handed no lines looks exactly like a rule that matches nothing: print how many lines were searched).
  done-when: a highlight typed into the panel colours the next matching line with no restart, on a machine with no Genie install.
  done: 2026-09-06 minutes: 120 — `dev/wt-q2` off `origin/main` at `69cdb737`. `npx tsc -b` exit 0; `npm run lint` exit 0; `node tools/plan-audit.mjs` `plan ok`; `DRC_TEST_PORT=8074 node tools/run-tests.mjs` `no failures`. `node tools/highlight-test.mjs` `92 checked, 0 failed` (was 40-odd; the floor is 60, asserted, so a truncated run cannot print a clean one). **Most of this increment's `do:` had already shipped in Q1** and is recorded in `docs/PLAYER_CONFIG.md` §10: `resolveHighlights` and `useHighlights` reading the store were Q1's, because Q1's own `verify:` required that nothing read a Genie leaf any more. So `useHighlights.ts` is **not touched here** — extending it would have been a change with nothing to fix. What Q2 added: the two tabs, `compilePattern` as the one gate three callers share, `refuseDeletingPreset`, and the preview. **`compilePattern` is an extraction, not a new path**: `parseHighlights` and `resolveHighlights` each held their own compile-and-probe, and the editor would have been a third — three answers to "is this pattern safe to run per rendered line" is how a rule refused at load gets accepted at save. One function now, and the sabotage below shows the blast radius that buys. **The preview has no matcher and no renderer of its own**: it calls `paint()` and renders through `HighlightedText`, the two functions `GameLineRow` uses, over `useGameLines()`. The grep the `verify:` names is run with a positive control on `highlights.ts` first (`RegExp` 5, `indexOf` 1) so a zero in the tab is a fact about the tab rather than about the grep — it caught its own author, whose header comment named both needles in prose and reddened the check. It prints the denominator (`Preview: 1 of 6 lines matched`), because a preview handed no lines and a rule that matches nothing look identical. Four sabotages, none of them touching the working tree (mutants are copies in a scratch directory, and the two files under test are md5'd before and after the run — six lanes are in this repo at once): (1) `compilePattern` opened up reddens the save gate **and** the runtime backstop, asserted rather than assumed, and is scoped away from parsing and from the disabled-rule case; (2) a `new RegExp` spliced into a copy of `HighlightsTab.tsx` takes the grep from 0 to 1 while the real file stays at 0; (3) `refused: []` reddens the deleted-preset case and leaves the default-colour rendering green; (4) `useHighlights` cut off from the store reddens "a machine with no Genie has highlights" and nothing else. Real browser, dev server on 5197 killed by pid: `node tools/player-config-shots.mjs http://127.0.0.1:5197/` all passed — a rule typed into the panel colours `Wipsy just arrived.` in the preview at `rgb(102, 221, 255)` with no reload, an invalid regexp is refused naming `Unterminated character class` and the store still holds 1 entry, a preset in use refuses deletion naming the rule, and at **720x480** all 17 controls sit inside the panel (the denominator is asserted: an empty panel has no controls outside the window for the same reason a suite that never ran has no failures). `docs/verification/player-config-2026-09-06-highlights.png`. **One departure, stated rather than folded in:** the brief asked for presets carrying fg/bg/bold/italic/underline. Only `fg` reaches the game pane — `paint()` returns one colour and `HighlightedText` sets `color` from it, and Q2's `do:` is explicit that `paint()` keeps its signature. `bg` and `bold` are edited because Q1's import already put 31 presets' worth of them in the store and dropping the fields would lose them; the tab says on screen that they are not painted yet. Italic and underline were **not** added: two fields the store does not declare and the renderer cannot use would be a field nobody reads, freshly built.

- [x] **Q3  Aliases, variables and key macros, through the lane, with a dry run** (≈180)
  commit: (this PR) verified: 2026-09-06 minutes: 150
  touches: new:src/components/config/AliasesTab.tsx, new:src/components/config/MacrosTab.tsx, new:src/components/config/VariablesTab.tsx, Q1>src/lib/playerConfig.ts, Q1>src/components/config/PlayerConfigPanel.tsx, src/lib/aliases.ts, src/lib/useAliases.ts, src/lib/keybindings.ts, tools/aliases-test.mjs, tools/keybindings-test.mjs, new:tools/macro-dry-run-test.mjs, package.json, tools/test-suites.json, Q1>src/lib/playerConfigImport.ts, Q1>tools/player-config-shots.mjs, src/lib/macroFlight.ts, src/components/game/GameCommandBar.tsx, src/App.tsx
  depends-on: Q1
  do: `expandAlias` gains an optional `{variables}` — `$name` resolved from the store, `$0`/`$1`… still positional, the split `variables.ts` made before it was deleted. Variables are `$name` and **not** `%name%` (`docs/PLAYER_CONFIG.md` §4.3: every real config's aliases already write `$shop`, `$patient`, `$preposition`, and importing them without resolving those is importing a config that does not work). `resolveKeybinding` gains an optional `macros` argument and a `{kind:'macro'}` case; a store binding beats the hardcoded `MOVEMENT`/`F_KEYS` on the same chord, and the hardcoded set stays as the shipped default for a player who has configured nothing. Firing goes through `requestMacro`'s existing in-flight gate and `sendGame(cmd, 'macro')` — the lane's `macro` source and its pacing, not a second send path. The editor's "press a key" capture calls `codeToGenieKey()`, the same translation the resolver uses.
  verify: `node tools/keybindings-test.mjs` → a store binding on `NumPad8` wins **with the built-in `n` still present and reachable**, which is the point: a chooser tested where the wrong answer is not available only proves the code runs. `node tools/macro-dry-run-test.mjs` → a dry run records **zero** calls against a fake `sendGame`, with a positive control in the same run where a real fire records exactly the macro's command count; without that control an unwired harness passes the check that matters most. `node tools/aliases-test.mjs` → `$name` resolves, `$0` does not become a variable lookup, an undefined `$name` passes through verbatim and is reported.
  sabotage: (1) point the dry run at the real `sendGame` → the zero-call check reddens and only it. (2) delete the built-in fallback → "an unconfigured player still walks with NumPad" reddens. (3) make the store binding lose to the built-in → the chooser case reddens naming both candidates. (4) drop the `requestMacro` gate → the double-press case reddens.
  pitfalls: 1 (test the chooser where the wrong answer is available), 12 (`sendGame(cmd, 'macro')` exists; a second path with its own gate is a fork).
  done-when: a key bound in the panel sends its commands through the lane with source `macro`, the dry run for the same binding sends nothing, and both are asserted by a test rather than by a screenshot.
  landed: five files beyond the `touches:` above, each named here rather than
  left to be found in the diff. `isGenieScript` and the variables-bookkeeping
  predicate moved from `playerConfigImport.ts` to `playerConfig.ts` (re-exported,
  so no caller moved): `aliases.ts` and `keybindings.ts` both need the same
  answer to "may this rule be switched on", and importing the importer from the
  resolver would have been a cycle. `macroFlight.ts` gained `claimMacroSend`,
  extracted from `requestMacro`, so a key chord claims the *same* in-flight slot
  the action bars claim rather than a second gate under another name.
  `GameCommandBar.tsx` passes the variable table and shows an unresolved
  `$name`; `App.tsx` supplies the `runMacro` hook that fires through
  `requestGameAction(cmd, label, 'macro')` and reads the bindings live. Two
  things also came out differently from the design: `expandAlias` accepts either
  a number or `{maxDepth, variables}` as its third argument, because two call
  sites and a suite pass a number and a second entry point would be a fork; and
  variables are substituted **once over the finished text** rather than inside
  each expansion, because `go $shop` written straight into a macro's command
  list - which is how the real configs use them - has no alias to carry it, and
  a per-step pass would substitute a value that itself contains a `$`. The
  browser half extends `tools/player-config-shots.mjs` rather than adding a
  second shots tool; the screenshot is
  `docs/verification/player-config-2026-09-06-macros.png`.

- [x] **Q4  Substitutes and gags, previewed against real game lines** (≈120)
  touches: new:src/lib/lineRules.ts, new:src/components/config/SubstitutesTab.tsx, new:src/components/config/GagsTab.tsx, new:src/components/config/LineRulePreview.tsx, Q1>src/lib/playerConfig.ts, Q1>src/components/config/PlayerConfigPanel.tsx, src/lib/useGameLines.ts, src/lib/highlights.ts, src/components/game/StreamTabs.tsx, tools/build-player-data-doc.mjs, docs/PLAYER_DATA.md, docs/PLAYER_CONFIG.md, new:tools/line-rules-test.mjs, new:tools/line-rules-shots.mjs, package.json, tools/test-suites.json
  depends-on: Q1
  do: `applyLineRules(text, {substitutes, gags}) -> {text, gagged, matched}`, pure, substitutes before gags. One call site: `useGameLines()`, which `tools/gamelines-test.mjs` already enforces as the only way a component reads the buffer. **The raw buffer is never rewritten** — a gag is a display preference, so the transcript, the bug bundle and `aiWorkerHost.ts`'s ingest (which reads `gameLines()` directly, deliberately outside the hook) still see every line, and changing a rule re-applies to everything on screen because the rewrite happens on read. The preview calls `applyLineRules` itself over the last 200 lines and shows before/after.
  verify: `node tools/line-rules-test.mjs` → an empty rule set returns the input unchanged and is a no-op, not a filtered-to-nothing pass; a gagged line is **still present in `gameLines()`** and absent from `useGameLines()`, which is the property that separates a display rule from data loss; a substitute rewrites only its own substring; a rule disabled in the store does not fire. `node tools/gamelines-test.mjs` → still `0 violations`, with its own floor.
  sabotage: (1) apply the rules in `gameLink.ts`'s push instead → the "raw buffer still has it" check reddens naming the line. (2) make an empty rule set return an empty array → the no-op check reddens. (3) leave a disabled gag firing → its case reddens and nothing else.
  pitfalls: 1 (a check that a gagged line is absent passes just as well when no lines arrived at all: assert the line count first), and the format caveat below.
  format caveat: `#substitute {find} {replace}` and `#gag {pattern}` are **inferred** from the uniform directive convention, not read from a populated file — both files were empty on this machine, and the deleted modules said so in their own headers. Q4's import cases test the parser, not the format. Re-check against the first real populated file anybody produces, and correct `docs/PLAYER_CONFIG.md` §6.1 if it disagrees.
  done-when: a gag typed into the panel hides the next matching line, the line is still in the raw buffer, and a rule change re-applies without a restart.
  done: 2026-09-06 minutes: 135 - `dev/wt-q4` off `origin/main` at `69cdb737`. `npx tsc -b` exit 0; `npm run lint` exit 0; `node tools/plan-audit.mjs` `plan ok: 146 increments, 592 paths checked`; `DRC_TEST_PORT=8076 node tools/run-tests.mjs` `no failures`, 161 suites, 6338 checks (rebased onto Q2, Q3, Q5 and the login chain), with the one pre-existing NOT CHECKED line (`test:godot-fixture-contract`). New suite `node --experimental-test-module-mocks tools/line-rules-test.mjs` `54 checked, 0 failed`, driven against the **real** `gameLink.ts` buffer through the real `game:line` handler; the buffer is compared as a whole string before and after every case, not counted, because a filter that rewrote a line in place and left the count alone would pass a count. Order is asserted both ways - a gag written against the substituted text fires, one written against the original does not - so the case is about order rather than about whether gags work. Sabotages, each on a copy under `tools/.sabotage-*` and each proved by md5 to have left the source untouched (`7d9065ad...` `lineRules.ts`, `86406109...` `useGameLines.ts`, `ab898d6a...` `highlights.ts`): (1) the gag splices the line out of the raw buffer instead of filtering on read - the byte-identical check reddens and names the line, while the pane still looks right, which is the whole point; (2) an empty rule set returns `gagged: true` - the no-op case reddens and the substitute case stays green; (3) `rule.enabled` dropped from the gag loop - the disabled-gag case reddens and the disabled-substitute case does not. Real browser: `node tools/line-rules-shots.mjs` against a dev server on 5199 (killed by pid), all passed - four lines delivered through the event plugin, on screen before any gag (the positive control), gone after one, still in `gameLines()`, and back after clicking Show hidden; `docs/verification/player-config-2026-09-06-gags.png`, `-gags-shown.png`, `-gagged-pane.png`, `-substitutes.png`. That control is what found the harness's first defect: lines delivered untagged land in the buffer and are drawn nowhere, because `StreamTabs` renders channels and the app log and untagged main-window text has no tab - indistinguishable from a gag that hid everything. **Four departures from the design above, all additive.** (a) Q2's `compilePattern()` gained a `flags` argument rather than a twin. Q2 and Q4 ran concurrently and both extracted the compile-and-probe guard out of `highlights.ts`; Q2's landed first, so Q4's was deleted on rebase and `lineRules.ts` is its fourth caller. A substitute replaces every occurrence and so needs the same pattern with `g`, which is the whole of the difference. Two answers to "is this pattern safe to run once per rendered line" is how a rule refused at load gets accepted at save. (b) `SubstituteRule` and `GagRule` gained an optional `regex`, absent by default, so every imported and already-stored rule keeps meaning the literal it meant. An unrunnable pattern is refused at save by `ruleRefusal()` **and** refused again at read, because a rule can also arrive from an import or from a key another build wrote. (c) The Show hidden switch is in the game pane's tab row, appears only when a gag is enabled, and has its own key `drc.show-gagged-lines.v1` - per-listener, the shape `offClasses.ts` uses and for the same reason. A shown-gagged line is drawn dimmed, so the switch visibly does something. (d) `useRawGameLines()` is a second hook in `useGameLines.ts`, because the preview needs the before and the sanctioned hook now returns the after; it is there rather than in the panel because `tools/gamelines-test.mjs` says the raw accessors are that file's business. **Not done here, named rather than folded in:** the `#substitute`/`#gag` formats are still inferred - `substitutes.cfg` and `gags.cfg` are still empty on this machine - and both tabs now say so on screen, under the rule list, rather than only in `docs/PLAYER_CONFIG.md`.

- [x] **Q5  Pins and exports move to the app's data directory; the Genie write path is deleted (answers N-c)** (≈120)
  touches: new:src-tauri/src/player_files.rs, new:src/lib/playerFiles.ts, src-tauri/src/config_import.rs, src-tauri/src/lib.rs, src/lib/pinsFile.ts, gone:src/components/MapWindow.tsx, gone:src/components/shared/MapPanel.tsx, tools/doc-claims-test.mjs, tools/doc-claims-break-check.mjs, tools/pins-file-test.mjs, tools/build-player-data-doc.mjs, docs/PLAYER_CONFIG.md, docs/PLAYER_DATA.md, docs/PRIVACY.md, docs/LICH_NATIVE_LOGIN.md
  depends-on: Q1
  do: §10's **N-c**, decided: pins are app data. `player_files.rs` publishes `read_player_file(leaf)` and `write_player_file(leaf, text, expectedPrevious?)` rooted at `app_data_dir()/config`, and it is not a new implementation — `sibling`, `backup_once`, `save_atomically`, `matches_on_disk` and their tests **move** out of `config_import.rs`, and the leaf validation stays `sounds::valid_plain_filename`. `pinsFile.ts` writes there; `reveal_file` (already registered) opens the folder, so "where did it go" has an answer that is not a path in a paragraph. `expectedPrevious` finally gets a caller, which `config_import.rs`'s header recorded as a downgrade when N6 left it callerless. Then delete `src/lib/genieConfigWrite.ts`, `write_genie_config`, `MAX_WRITE_BYTES` and `writable_target`, and deregister the command: the app writes nothing into a Genie install, which is the property that header held before 29 Aug 2026 and lost. Migration: on first run after this, if `read_genie_config('dr-companion-pins.yaml')` finds a file and the app-data copy does not exist, copy it across and say so on screen; the Genie copy is **left where it is** — deleting somebody's file to tidy up is not a migration.
  verify: `cargo test player_files` → the moved cases (backup once and never again, atomic rename leaves no temp, a stale `expectedPrevious` is refused, a missing file equals an empty expectation) plus one new: a leaf that escapes `app_data_dir()/config` is refused by name. `node tools/doc-claims-test.mjs` → the "exactly one caller of `saveGenieConfig`" check is replaced by "no module names `saveGenieConfig` and `src/lib/genieConfigWrite.ts` does not exist", with a control proving the directory scan can see a file that is there. `node tools/pins-file-test.mjs` → export succeeds with **no Genie install present**, which is the case that could not work before. `git grep -n "write_genie_config\|saveGenieConfig" src src-tauri/src` → nothing outside the retired-needle fixture.
  sabotage: (1) plant a `saveGenieConfig` call in `mapPins.ts` — the existing case at `tools/doc-claims-break-check.mjs:169`, turned the other way up → the new check reddens naming the file. (2) make `write_player_file` ignore `expectedPrevious` → the conflict test reddens. (3) make the pins migration overwrite an existing app-data copy → its case reddens. Each restores byte for byte, verified by `md5sum`.
  pitfalls: 4 (an installed file outside any repo is shared state: re-read immediately before writing, never from a measurement taken minutes ago), 1 (an export that "succeeded" into a directory that does not exist: check the file back, do not trust the call).
  done-when: `write_genie_config` is deregistered, `git grep saveGenieConfig src` is empty, and a pin export on a machine that has never had Genie installed produces a file the player can open.
  done: 2026-09-06 minutes: 120 — `dev/wt-q5` off `origin/main` at `69cdb737`.
  `cargo test` 212 passed; `cargo clippy --all-targets -- -D warnings` and
  `cargo fmt -- --check` exit 0; `npx tsc -b` exit 0; `npm run lint` exit 0
  (pre-existing React warnings only); `node tools/doc-claims-test.mjs`
  `61 checked, 0 failed`; `node tools/pins-file-test.mjs` `51 checked, 0 failed`
  (33 before); `node tools/build-player-data-doc.mjs --check` exit 0;
  `DRC_TEST_PORT=8077 node tools/run-tests.mjs` `no failures`, 159 suites,
  6067 checks, with the one pre-existing NOT CHECKED line
  (`test:godot-fixture-contract`).
  **The Rust test count is equal either side, which is what makes this a move
  rather than a rewrite:** `config_import.rs` had 13 cases on `origin/main` and
  has 3; `player_files.rs` has 10; 13 = 13. Eight moved unchanged. Two
  `write_genie_config` cases that could only run on a machine with a real Genie
  `Config` directory — and so returned early and asserted nothing anywhere else —
  are replaced by one that needs no such directory and is stronger:
  `a_stale_expected_previous_is_refused_and_the_other_windows_write_survives`
  runs two windows against one leaf in the real data directory, checks that the
  loser is refused **by name**, that the winner's bytes are still on disk, and
  that the loser succeeds after re-reading (a refusal must be recoverable, not a
  dead end). One case is new, as the `verify:` line asks: a leaf that would
  escape `app_data_dir()/config` is refused by name, through both commands and
  not only the private helper, with a control proving a legitimate leaf still
  resolves *into* that directory — the loop above would otherwise pass just as
  well against a `resolve` that refused everything.
  **`expectedPrevious` has its first caller.** `exportPinsToFile` reads the file
  and writes it in the same breath, passing what it just read; acting on a
  measurement taken earlier is the trap `CLAUDE.md` §4 names, and the export is
  where it would bite two windows of this app. `tools/pins-file-test.mjs` proves
  it end to end through the shipping code rather than by poking the fake: the
  fake `read_player_file` has a one-shot stale answer, so window B exports from a
  view taken before window A wrote and is refused naming the file, while a
  control immediately after shows the same window succeeding once it has
  re-read.
  **Three departures from the lines above, each forced and none silent.**
  (1) `src/lib/playerFiles.ts` is new and was not in `touches:`; it is
  `genieConfigWrite.ts` moved and renamed rather than a second module, and it
  exists so **Q6 writes through one surface instead of adding a second writer**
  — `readPlayerFile` / `writePlayerFile` / `adoptGenieFile`, over the commands
  `read_player_file` / `write_player_file` / `adopt_genie_file`. (2) The
  migration is a command of its own rather than a call to `read_genie_config`
  from `pinsFile.ts`: the property this increment asserts is that exactly one
  module invokes `read_genie_config`, and that module is the config importer, so
  a second TypeScript caller would have contradicted the check. `adopt_genie_file`
  calls `config_import::read_genie_config` on the Rust side, writes through the
  same `save_atomically`, refuses when an app-data copy already exists, and
  leaves the Genie copy where it is. (3) `MAX_WRITE_BYTES` is not deleted so much
  as moved and renamed — `MAX_PLAYER_FILE_BYTES`, 8 MiB, with its test — because
  the cap guards a webview-supplied string, which the change of directory does
  not make safe. `writable_target` **is** deleted outright: the root is ours now,
  so there is no Genie install to avoid fabricating.
  **`doc-claims-test.mjs` was turned the right way up rather than deleted**, and
  this is the second time that check has needed it. It asserted "exactly one
  caller of `saveGenieConfig`", which was the strongest thing available while a
  Genie writer existed — and left standing after Q5 it would have passed forever,
  including on the day somebody reintroduced the writer with one caller. It now
  asserts three things: nothing under `src/` **names** a Genie writer (reported
  as `file:line`), `src/lib/genieConfigWrite.ts` does not exist, and exactly one
  module *invokes* `read_genie_config` — the needle is
  `invokeTauri('read_genie_config'` rather than the bare name, because half a
  dozen module headers mention it while describing what they stopped doing. Each
  has a control: `writePlayerFile` is found in two files by the same scan, and
  `exportPinsToFile` is found at two call sites, so the counter is shown
  returning two when there are two rather than only ever 0 or 1. The header of
  `playerFiles.ts` was reworded so that it does not spell the dead symbol either,
  which is the point of a "names it" check over a "calls it" one.
  **Sabotages, each restored byte for byte and verified by md5.**
  `node tools/doc-claims-break-check.mjs`: 19 sabotages across 11 files, 0 did
  not redden exactly the checks they named. Three are Q5's: the existing
  `mapPins.ts` plant (`// saveGenieConfig`) is kept and turned the other way up,
  reddening only `nothing in this app writes into a Genie install` and reporting
  `src/lib/mapPins.ts:20`; a **created** `src/lib/genieConfigWrite.ts` reddens
  that check *and* the existence check and nothing else (the runner gained a
  `create` case, whose restore is a delete and whose abort refuses to overwrite a
  file that is already there); and a planted second
  `invokeTauri('read_genie_config'` reddens only the one-invoker check. Dropping
  the compare-and-swap from `pinsFile.ts`
  (`writePlayerFile(PINS_LEAF, text, current.found ? current.text : '')` →
  `writePlayerFile(PINS_LEAF, text)`) reddens exactly five checks, all of them
  the two-window case, `md5 e20f0fa34552e490664557b2c8f67723` before and after.
  Making the migration overwrite an existing app-data copy (`if path.is_file()`
  → `if false`) reddens exactly
  `adopting_never_overwrites_a_file_that_is_already_here` and nothing else,
  `md5 731f636b9f42f4f46d3f35e96614851f` before and after, and the file was
  touched afterwards so the restored source is newer than the stale object.
  **Not done here, and named rather than folded into the above:** nothing was
  verified against a running desktop app — every claim on this line is
  `cargo test`, the Node suites, or a read of the tree, and the app-data path
  itself is exercised by `cargo test` against the real `app_data_dir()` on this
  machine rather than by a player pressing Export. `reveal_file` is registered
  and the design offers it as the answer to "where did it go"; the map panel's
  export still reports the path in the log rather than opening the folder, which
  is a UI increment nobody has claimed.

- [x] **Q6  Export and import the whole store, and the documents** (≈90)
  touches: new:src/lib/exportEnvelope.ts, new:src/lib/playerConfigTransfer.ts, new:src/components/config/ExportImportTab.tsx, new:tools/player-config-transfer-test.mjs, new:tools/player-config-transfer-break-check.mjs, Q1>src/lib/playerConfig.ts, Q1>src/components/config/PlayerConfigPanel.tsx, src/lib/sceneOverrides.ts, tools/player-config-shots.mjs, tools/build-player-data-doc.mjs, README.md, docs/PLAYER_CONFIG.md, docs/PLAYER_DATA.md, docs/PRIVACY.md, docs/SETUP-POLICY.md, package.json, tools/test-suites.json
  depends-on: Q1, Q5
  do: one JSON document for the whole store (`docs/PLAYER_CONFIG.md` §4.2), written into `app_data_dir()/config` through `write_player_file` and read back through `read_player_file`. Import is a **preview then apply**, with the same add/update/skip shape `pinsFile.ts` already uses for pins — never a silent overwrite of rules the player has edited since. A second Genie import is the same preview. Update `docs/PLAYER_DATA.md`'s inventory through its generator so the seven new storage keys are listed rather than discovered, and correct `docs/PLAYER_CONFIG.md` wherever Q2–Q5 landed differently from this design.
  verify: `node tools/player-config-export-test.mjs` → export then import round-trips byte-identically across all seven domains, with the domain count asserted so a store missing a domain cannot round-trip cleanly; an import of a document with an unknown `version` is refused by name rather than half-applied; the preview's counts equal what apply actually changes. `node tools/build-player-data-doc.mjs --check` exits 0. `node tools/plan-audit.mjs` → `plan ok`.
  sabotage: (1) drop one domain from the export → the round-trip reddens naming it. (2) make the import apply without the preview → the count-equality case reddens. (3) accept an unknown `version` → its case reddens.
  pitfalls: 12 (fixing a claim in one place does not fix its copies: the storage-key inventory is generated, so change the generator), 19 (record the command, not the claim: `docs/PLAYER_CONFIG.md` ends by saying the `verify:` lines win where the prose disagrees).
  done-when: a player can carry their whole config to another machine as one file, and a stale `docs/PLAYER_CONFIG.md` fails a check rather than being believed.
  done: 2026-09-06 minutes: 150 — `dev/wt-q6` off `origin/main` at `ef8018e0`.
  `npx tsc -b` exit 0; `npm run lint` exit 0 (140 pre-existing React warnings,
  none in the new files); `DRC_TEST_PORT=8082 node tools/run-tests.mjs`
  `no failures`, 167 suites, 6510 checks, with the one pre-existing NOT CHECKED
  line (`test:godot-fixture-contract`); `node tools/plan-audit.mjs` `plan ok`;
  `node tools/build-player-data-doc.mjs --check` exit 0. `docs/PLAYER_CONFIG.md`
  §13 is what landed.
  **The envelope and the writer are shared, not copied.** `src/lib/exportEnvelope.ts`
  holds `readEnvelope`, and `parseSceneOverrides` (#468) now calls it instead of
  carrying its own four header refusals — the wording is unchanged, which is
  what `tools/scene-editor-test.mjs` asserts on, and `SceneExport` extends
  `ExportEnvelope` so the two documents cannot grow different headers. `shorten`
  moved with them and `sceneOverrides.ts` aliases the shared one rather than
  keeping a copy. The writer is Q5's: `exportPlayerConfigToFile` reads the file
  and writes it in the same breath through `writePlayerFile`, passing what it
  just read, so `expectedPrevious` has its second caller and there is no second
  writer.
  **One merge, three modes, rather than a second merge.** `mergeImported` gained
  `keep-mine | update | replace-all` and a report of
  `{added, updated, unchanged, removed}`; the Genie import moved to `keep-mine`
  and its `duplicates` count is now `unchanged`. Two implementations of "is this
  the same rule" would have diverged the first time either was improved, and
  `identityOf` was already one function.
  **One validator.** Every entry goes through `migratePlayerConfig` and then
  through the predicate the matching editor calls: `compilePattern` (Q2),
  `ruleRefusal` (Q4), `isGenieScript` and `isBookkeepingVariable` (Q3). The
  suite reads the shipping module and asserts it names each of them and builds
  no `RegExp` of its own, with a control on the same scan.
  **`tools/player-config-transfer-test.mjs`: 65 checks, 0 failed**, seven
  domains populated with three entries each and the per-domain count printed.
  Export→import→export is compared **as strings**; the two-window case runs the
  shipping export against a fake of `player_files.rs` and is refused by name,
  with the control immediately after showing the same window succeeds once it
  has re-read; `added + updated + unchanged + refused` is asserted equal to
  `inFile` for every domain, with a control that the denominator is not zero.
  **The sabotage is a committed tool, not a paragraph.**
  `tools/player-config-transfer-break-check.mjs`, registered in both registries,
  4 sabotages, 18 checks, 0 failed. It asserts the md5 of each file before and
  after its own restore rather than this line quoting a value - a hash of a
  working copy depends on the line endings git last handed out, so a number
  written here would go stale on the next checkout and read as tampering.
  Dropping the per-domain validation reddens 4 checks naming
  the bad highlight and the reserved variable; dropping `expectedPrevious`
  reddens 5, all of them the two-window case; accepting an unknown version
  reddens 2. Pointing a case's anchor at text that is not there aborts naming
  the file rather than passing, proved by running a copy with a drifted anchor.
  **The fourth sabotage found a real hole and is the reason for a check that was
  not in the `verify:` line.** Dropping one domain from the serialiser reddened
  **nothing**: `doc[domain].length` threw, the suite exited non-zero with no
  FAIL line at all, and a runner counting failures would have called it caught.
  Byte-identity cannot catch it either — both exports come from the same broken
  serialiser and agree perfectly. Counting what is present cannot detect what is
  absent, so the suite carries a manifest check that names the seven domains and
  a second that compares each domain's restored count against the fixture. The
  same sabotage now reddens 9 checks and names `gags` three times, and the
  break-check treats "exited non-zero, reddened nothing" as a failed sabotage
  rather than a catch.
  **The browser harness was stale in a way that would have passed.**
  `tools/player-config-shots.mjs` asserted that an unbuilt tab "names the
  increment that will fill it", pointed at `substitutes` — which Q4 built. The
  check was asserting a promise; the property it was protecting is that a tab is
  never blank, so that is what it asserts now, across all seven, with two
  controls (it measured seven non-empty bodies; the same read returns 0 for a
  body that is not there). Q6's own flow was added: export, edit the *text* so
  the document did not come from this machine, import, read the report.
  `docs/verification/player-config-2026-09-06-transfer.png`, all passed, against
  a dev server on 5200 that was killed by the pid it was started with.
  **Three departures from the lines above, each named.** (1) The test is
  `player-config-transfer-test.mjs`, not `player-config-export-test.mjs`: it
  tests the round trip and the merge, not the export. (2) Two library modules
  were not in `touches:` — `exportEnvelope.ts`, because the alternative was a
  second header reader, and `playerConfigTransfer.ts`, because putting a file
  writer and a document parser inside `playerConfig.ts` would have made the
  store's module the transfer's module too; `src-tauri/src/player_files.rs`
  needed no change at all, which is the point of Q5. (3) `ExportImportTab.tsx`
  renders as a section under the tab strip rather than as an eighth tab: the
  strip is keyed on `DOMAINS`, which is the denominator every check in
  `player-config-test.mjs` counts against, and a tab that is not a domain would
  make "seven tabs" mean two things.
  **Not done here, and named rather than folded in.** Nothing was verified
  against a running desktop app: the file layer is exercised through a fake of
  `player_files.rs` (the real one is `cargo test player_files`) and the panel
  through headless Chrome, where `isTauri()` is false and the two file buttons
  are deliberately absent. The import applies and then reports, rather than
  reporting and waiting for a second press; `Replace all` takes the second press
  instead, because it is the only mode that can delete anything. `reveal_file`
  is registered and the panel still reports a path in text rather than opening
  the folder — the same gap the map panel's export has.

**Concurrency.** Q1 first and alone — it publishes the schema everything else
reads. Then **Q2, Q3, Q4 and Q5 run at the same time**, in four worktrees: Q2
owns `highlights.ts`/`useHighlights.ts`, Q3 owns `aliases.ts`/`useAliases.ts`/
`keybindings.ts`, Q4 owns `lineRules.ts`/`useGameLines.ts`, Q5 owns the Rust
file surface and `pinsFile.ts`, and no two of them name the same source file.
The one shared file is `PlayerConfigPanel.tsx`, where each replaces its own
placeholder line — a one-line edit, rebase on conflict. Q6 last, because it
exports whatever the others landed.

---

### Lane T — Godot 2D isometric presentation: the backend half

> **Sequencing, Dan, 9 Sep 2026:** *"outside of godot we need to get the build
> running and tested as a mud client without godot, all on its own… godot is
> dessert."* **Gate 1 comes first.** Lanes T and U are written now so the shape
> is settled and the Godot owner is not blocked on a conversation, but they are
> not the next thing to pick up: a session with free hands should take Gate 1's
> remainder (N7 is Dan's; D6, J2 and H5 are the `[!]` rows) or Lane V before
> starting here. The same instruction settles a second question — *"any ancient
> history won't need to be merged into the windows, godot supersedes all
> that"*: the map window and the retired panels are **not** to be ported into
> Godot. Godot replaces them. Do not read Lane U as a migration of old panels;
> it publishes data, and what Godot draws with it is a fresh design.

Dan, 9 Sep 2026: world and route presentation live in Godot, drawn as **2D
isometric sprite art** in the form the weird-western game (`cattle-trail`)
established. The reason is not the look — it is that an image generator makes
that form consistently, manipulates it well, and increasingly repairs its own
mistakes. Consistency under generation is the selection criterion.

**The ownership line, restated for 2D** (this replaces L1's §2, whose document
was deleted). The backend owns: the world manifest's shape, the wire protocol
and its version, the intent vocabulary and its validation, the contract tests
on both, and the data pipelines that feed them. The Godot owner owns: every
`.tscn`, every scene script, the camera, the sprite atlas and every image.
`godot/project.godot` has no `run/main_scene` and will not run until a 2D one
is authored; that is not this lane's work and this lane must not scaffold one.

**This lane's job is to make the published data honest and the contract
tested, so the Godot owner can build against it without talking to anybody.**

<!-- no-3d-direction: this lane names meshes, rig sockets and metre boxes throughout because its subject is removing them from the published snapshot. Naming a thing in order to delete it is not direction to build it; see docs/NO-3D.md. -->

The snapshot today is a 3D board description. `compileWorldSnapshot()` in
`src/lib/presentationBridge.ts` publishes, per cell, a `board` carrying
`footprint`, `ground`, `selectionBounds` and seven `spawnPoints` — each with a
metre `anchor`, a `yawDeg`, a `rigSocket` (`humanoid-root`/`creature-root`/
`item-root`) and a `token` naming a primitive mesh — plus a `position` in
metres where `y` is elevation, and a `boardAnchor` per exit at ±2.5 m from a
compass table. None of that has a renderer any more. T1 is the decision; do not
delete any of it before T1, because two of those fields still have live
consumers on this side.

- [ ] **T0  Prove what actually crosses the bridge** (≈40)
  touches: src-tauri/src/presentation_bridge.rs, new:tools/presentation-wire-fidelity-test.mjs, package.json, tools/test-suites.json
  depends-on: none
  do: the Rust bridge deserialises the snapshot into its own structs and re-serialises it on the way to Godot (`presentation_bridge.rs`, the broadcast path). `WorldCell` there declares only `id`, `title`, `position`, `exits`, and `Exit` declares only `move`, `direction`, `targetRoomId`, `targetCellId` — so `board`, `content`, `tetherKind` and `boardAnchor` are very likely **dropped in transit**, silently. The `player` field's own doc comment in that file documents this exact hazard as the reason `player` had to be declared, which is the tell. Establish it by measurement, not by reading: publish a snapshot carrying a known sentinel in each of the four fields through a real bridge instance and read back what a connected client receives.
  verify: the test names each of the four fields and says, per field, arrived or dropped, with the count printed. If a field is dropped, that is a finding to fix in T1, not here — this increment's product is the true list.
  sabotage: add a fifth field the Rust struct does not declare and confirm the test reports it dropped; declare it and confirm the test reports it arrived. A test that cannot distinguish the two is measuring nothing.
  done-when: nobody has to guess which snapshot fields reach Godot, and a future field that stops arriving fails a check instead of arriving as `null` in a scene.
  note: this is T0 and not T1 because every other increment in the lane is a decision about fields, and deciding about a field that never left the process would be deciding about nothing.

- [ ] **T1  Decide the 2D manifest: which board fields die, which become sprite anchors** (≈70)
  no-3d-direction: every 3D noun in this increment names a field being removed or migrated. It is the de-3D-ing of the snapshot, not a plan to render one.
  touches: src/lib/presentationTypes.ts, src/lib/presentationBridge.ts, src/lib/isometric-board-layout.mjs, src/lib/isometric-board-layout.d.mts, tools/presentation-bridge-test.mjs, T0>tools/presentation-wire-fidelity-test.mjs, new:docs/WORLD_MANIFEST_2D.md
  depends-on: T0
  do: one decision per field, written down with its reason, and the type changed to match. The recommendation, to be argued with rather than accepted:
    - **`board.footprint` / `board.ground` / `board.selectionBounds` — remove.** They are metre boxes for a 3D click target. A 2D isometric scene picks by sprite rect, which is the scene's own business.
    - **`board.spawnPoints` — replace with a small ordered list of 2D anchors.** The *roles* are real and worth keeping (where the player stands, where a hostile stands, where items lie); the metre `anchor`, the `yawDeg`, the `rigSocket` and the `token` mesh are not. Publish `{ id, role, offset: {x, y}, order }` where `offset` is **normalised −1..1 within the cell**, so the backend never names a pixel and the scene chooses its own cell size. `order` is the isometric draw order, which is the one thing a 2D renderer needs that a 3D one did not.
    - **`WorldCell.position` — publish map units, not metres.** `worldPosition()` multiplies by `MAP_UNIT_TO_METRES = 0.25` and `LEVEL_HEIGHT_METRES = 5`, both invented for the 3D board. Publish the cartography's own integers plus an integer `level`. A renderer that wants metres can multiply; a renderer given metres cannot recover the integers, and rounding at 0.25 is how two Paladins' Guild rooms ended up at identical coordinates being explained as a layout bug.
    - **`WorldExit.boardAnchor` — migrate, do not delete.** `src/lib/aiJobProducers.ts::validateTetherCandidate` reads it and nulls it, with its own tests and its own plan increment. Replace it with the compass side it was always encoding (`n`, `ne`, …, or null when the graph offers no honest side) and update that consumer in the same commit. Deleting it silently is the exact defect L8 avoided by naming the consumer.
    - **`content.primitives[].offset` — normalise to −1..1** for the same reason as `spawnPoints`, and update `sceneOverrides.ts::clampToCell` and `PLACEMENT_HALF_EXTENT` with it. S3's picker draws a 4.4 m footprint; it becomes a unit square.
    - **`tetherKind`, `content`, `entities`, `groundItems`, `player`, `activeRoom` — unchanged.** They were never 3D.
  Also fix `src/lib/isometric-board-layout.d.mts`, which omits `ground` (published by the `.mjs`) and the three metre constants: a field on the wire that TypeScript cannot see is a field nothing will warn you about.
  verify: `npx tsc -b`; `npm run test:presentation-bridge`; T0's fidelity test re-run and every surviving field reported as arriving; `docs/WORLD_MANIFEST_2D.md` states each removed field and why, so the next session does not restore one.
  sabotage: publish an `offset` outside −1..1 and confirm the compiler refuses it naming the cell; leave `boardAnchor` unmigrated and confirm `aiJobProducers`' tests go red rather than the field silently reading undefined.
  done-when: the manifest describes a room graph and a draw order, and contains no metre, no mesh and no rig socket.

- [ ] **T2  A 2D generator for the mock fixture** (≈45)
  touches: new:tools/build-godot-2d-fixture.mjs, godot/mock/crossing_mock_world.json, tools/godot-fixture-contract-test.mjs, package.json, tools/test-suites.json
  depends-on: T1
  do: `godot/mock/crossing_mock_world.json` is read by two surviving Godot tests and is currently a **frozen artefact with no generator** — its builder sourced the deleted primitive-world manifest, so `godot-fixture-contract-test.mjs`'s regeneration check is NOT CHECKED with that reason named. Write the replacement, sourced from `src/data/map` + `src/data/world` directly (which is where the content already comes from) rather than through any intermediate manifest, and restore `--check`. State the cell order in the tool the way the deleted one did, so the committed file is reproducible.
  verify: `node tools/build-godot-2d-fixture.mjs --check` exit 0; `npm run test:godot-fixture-contract` back to a full denominator with nothing unchecked, and say the number.
  sabotage: hand-edit one cell in the committed fixture and confirm `--check` names that cell.
  done-when: the fixture is derived again, and the NOT CHECKED line T2 was written to close is gone rather than suppressed.

- [ ] **T3  The intent contract, tested across the language boundary** (≈50)
  touches: src-tauri/src/presentation_bridge.rs, src/lib/presentationTypes.ts, src/lib/presentationIntents.ts, new:tools/presentation-protocol-drift-test.mjs, package.json, tools/test-suites.json
  depends-on: none
  do: this is an unguarded seam and it is the one the Godot owner will hit first. Rust declares `PROTOCOL: u32 = 1` and four intent variants (`walk`, `inspect-entity`, `inspect-ground-item`, `travel-to-room`, via `rename_all = "kebab-case"`); TypeScript declares `protocol: 1` as a literal and matches the kind strings by hand, with `kind?: string` — not a union, so nothing names the four as a closed set. **Nothing compares the two.** `bridge-version-drift-test.mjs` and `intent-drift-test.mjs` are both about the *Lich* bridge, not this one, which is why this reads as covered and is not. Build the drift test on `panel-data-contracts-test.mjs`'s pattern: derive the Rust list from `presentation_bridge.rs` by reading it, derive the TS list from source, and fail on any disagreement in either direction. Make `kind` a real union on the TS side while you are there.
  Also close the two validation holes the same file documents and does not honour: `inspect-entity` and `inspect-ground-item` are forwarded unconditionally although the doc comment above them claims the id "is confirmed to exist in the snapshot". Either validate or correct the comment; do not leave a comment asserting a check that is not performed.
  verify: the new suite green; rename a Rust variant and confirm it names the mismatch; add a TS kind Rust does not have and confirm it names that too.
  sabotage: as above, both directions, plus flip Rust's `PROTOCOL` to 2 and confirm the test reddens on the version rather than on a kind.
  done-when: a Godot client written against the documented four kinds cannot be wrong about them, and a fifth kind cannot be added on one side only.

- [ ] **T4  Sprite ids: what the backend publishes for content** (≈55)
  touches: src/lib/world-content-rules.mjs, src/lib/sceneOverrides.ts, tools/build-scene-registry.mjs, src/data/sceneRegistry.json, tools/world-content-test.mjs, new:docs/SPRITE_VOCABULARY.md
  depends-on: T1, M2
  do: `src/data/world` already classifies all 17,750 rooms into 13 ground kinds, 4 block kinds and 29 landmark kinds. That vocabulary is renderer-agnostic and is what survives. What died with 3D is the *binding* from a kind to a drawable thing: the option lists were compiled from `godot/scripts/shared_asset_content.gd`, deleted, so the drawable check is now three-state and `sceneRegistry.json` is frozen at the kinds the 3D pack admitted. Publish a **sprite id** per kind — a stable string, not a filename and not a path — and write down the vocabulary so the Godot owner can produce an atlas against it and the generator can be pointed at a list rather than at prose. The backend must never name an image file: it names ids, and the scene's atlas maps them.
  verify: every ground/block/landmark kind in `src/data/world` has exactly one sprite id and no id is orphaned — both directions, counted and printed, because a vocabulary checked one way is half checked; J2c's repetition number (27 stamp kinds, 22 with only two images) is the quality bar to beat and belongs in the doc.
  sabotage: add a ground kind to the rules with no sprite id and confirm the red names it; add a sprite id no kind uses and confirm the other direction reddens.
  done-when: the 2D content pack can be built by somebody who has read one document and no code, and the three-state drawable check re-arms against the real pack instead of staying unchecked.

- [ ] **T5  The 2D acceptance list, and what it honestly cannot prove** (≈25)
  touches: new:docs/verification/godot-2d-acceptance.md, T1>docs/WORLD_MANIFEST_2D.md
  depends-on: T2, T3
  do: replaces L4's six-line 3D checklist, four of whose slots were never filled because they needed a live character and one human click. Write a shorter list that separates what a fixture can prove from what only a live session can, and say which is which on the page rather than leaving empty slots that read as pending work. Each line names the command or the person who closes it.
  verify: every line is either recorded with a date or marked as needing a live character, with no third category.
  done-when: Gate 3 has a content half that a person can actually finish.

**Concurrency.** T0 and T3 name disjoint files and can run at once. T1 is the wide one and should hold the lane alone. T2 and T4 can run together after T1. Nothing in Lane T touches a `.tscn` or a scene script; if an increment finds itself wanting to, it has crossed the ownership line above.

---

### Lane U — Godot as the MUD front end

> **After Gate 1**, per the sequencing note at the head of Lane T: the client
> must build, run and be tested as a standalone MUD client with no Godot
> present before this lane is picked up. This lane also does not port the old
> windows — Godot supersedes them.

Dan, 9 Sep 2026: *"a lot of the functions are being done in Godot to really
update what we can do with MUDs."* Godot is not only the world view; panels are
moving there. This lane is the **backend half of that move**: for each panel,
publish its data over the existing presentation bridge as a tested contract.

Three rules hold for every increment here, and they are what stop this lane
becoming a rewrite:

1. **The React panel stays until Godot renders it and Dan says which goes.**
   Publishing is additive. No panel is deleted in this lane.
2. **No second catalog.** `src/lib/panelDataContracts.ts` already declares, per
   panel, what a player uses it for, which store fields it actually reads and
   whether it needs a live character — enforced by
   `tools/panel-data-contracts-test.mjs`, which re-derives the panel id list
   from `panels.tsx` rather than from a hand copy. Extend that record with what
   is published; do not start a parallel one beside it.
3. **One publisher.** `usePresentationBridgePublisher.ts` publishes today and
   is gated so only the main window does. Everything here goes through it.

The store fields nearly every panel bottoms out in are a short list —
`s.character` (a `CharacterStatus`), `s.mapZone`/`s.mapHere`/`s.mapPath`/
`s.mapTrail`, `s.inventory`, `s.bridgeConnected`/`s.bridgeIntents`,
`s.scriptCatalog`/`s.scriptStates`, `s.trainFocus`, and `useMacroRunner()`'s
`canSend`/`reason` gate. The world snapshot already carries the room, entity,
item and player slice of `s.character` and the zone slice of `s.mapZone`. What
it does not carry is the rest, and that gap is this lane.

- [ ] **U1  Publish the panel contract itself** (≈40)
  touches: src/lib/panelDataContracts.ts, src/lib/presentationTypes.ts, src/lib/presentationBridge.ts, tools/panel-data-contracts-test.mjs, package.json
  depends-on: T3
  do: add `publishedToViewer: boolean` and `viewerFields: string[]` to `PanelDataContract`, and publish the catalog itself on the bridge as a `panels` block on the snapshot — so a Godot scene can ask what exists, what it may draw and what needs a live character, instead of hardcoding a list that goes stale. `panelIsShowable()` is the gate that already answers the last part; export it through the contract rather than restating it. `PANEL_DATA_CONTRACTS` is a `Record<PanelId, …>`, so the compiler refuses a missing entry — that is half the enforcement and it is free.
  verify: `npm run test:panel-data-contracts` with the new fields asserted for all fourteen panels; the count printed and the extraction tripwire kept.
  sabotage: mark a panel published with an empty `viewerFields` and confirm the red names it — a panel that claims to be published and names no data is the placeholder this lane must not produce.
  done-when: the viewer can enumerate the panels without a second source of truth.

- [ ] **U2  Vitals, status and mindstate** (≈45)
  touches: src/lib/presentationTypes.ts, src/lib/presentationBridge.ts, U1>src/lib/panelDataContracts.ts, tools/presentation-bridge-test.mjs
  depends-on: U1
  do: `PlayerSnapshot` today carries `situation`, `cannotAct`, `roundtime`, `health`, `balance`, `position`. The vitals cluster, `StatusBoard` and `MindstateBoard` read more of `s.character` than that: injuries, the skill set and its mindstate ladder, stats. Publish them, as data and not as text — a mindstate is a rung on DragonRealms' 35-state ladder and must go over the wire as the rung, never as the English word, or the scene inherits a parsing job the client already did.
  verify: a fixture character with a known injury set and a known mindstate compiles to the published values; absent knowledge is `null` and never a zero, per `PlayerSnapshot`'s existing rule that null means "not yet parsed" rather than "healthy".
  sabotage: publish `0` where the parse produced nothing and confirm the red — this is the field where the two are most easily confused and most expensive.
  done-when: a Godot vitals display can be built with no additional bridge call.

- [ ] **U3  The command lane's state, including why it is refusing** (≈50)
  touches: src/lib/presentationTypes.ts, src/lib/presentationBridge.ts, U1>src/lib/panelDataContracts.ts, src/lib/useMacroRunner.ts, tools/command-lane-test.mjs
  depends-on: U1
  do: `useMacroRunner()` returns `canSend` and a `reason`, and Pause, the roundtime hold and the kill switch all express themselves through it. Publish both. **The `reason` is the load-bearing half**: a viewer that knows it may not send but not why will either show nothing or invent an explanation, and this is a client that drives a live character. Publish the pause state and the roundtime with it. This does not add a send path — Godot's intents already go through `presentationIntents.ts` into `requestGameAction`, which is the one lane, and nothing here may create a second one.
  verify: pause the automation and assert the published state flips with the reason attached; the existing command-lane suite stays green.
  sabotage: publish `canSend` without `reason` and confirm the contract test reddens; drop the pause gate from the publish path and confirm the lane's own break-check catches it.
  done-when: the viewer can render a truthful disabled state, and cannot render a false enabled one.

- [ ] **U4  Room text, exits and occupants as a published block** (≈40)
  touches: src/lib/presentationTypes.ts, src/lib/presentationBridge.ts, src/lib/roomExits.ts, U1>src/lib/panelDataContracts.ts, tools/room-test.mjs
  depends-on: U1, T1
  do: the room column is the panel most obviously moving. `roomExits.ts` and `ExitButtons.tsx` already hold the parsed compass exits, and L8 put them on the command lane as `'ui-action'`; occupants are in `s.character`'s `roomCreatures`/`roomAllies`/`roomPlayers`/`roomItems`. The snapshot carries most of this per-cell already — publish the current room's text and its exit word list alongside, so the scene does not re-derive an exit list the client already parsed. Re-derivation is how the two ends disagree.
  verify: the published exit list equals `roomExits.ts`'s for a fixture room, asserted against the same function rather than against a copy of its answer.
  done-when: a Godot room panel and the React one cannot disagree about what the exits are.

- [ ] **U5  Scripts and activities** (≈40)
  touches: src/lib/presentationTypes.ts, src/lib/presentationBridge.ts, U1>src/lib/panelDataContracts.ts, tools/task-catalog-status-test.mjs
  depends-on: U1, U3
  do: publish `scriptCatalog`, `scriptStates` and the quick-switch pins, plus the stale marker the panel already computes. After U3 because starting a script is a command and must be refused with the same reason the lane gives everything else.
  verify: a stale catalog publishes as stale and names why, matching what `QuickSwitchBar` renders — C12 already learned that a failed lookup has to carry its reason to the player.
  done-when: the script library can be driven from the viewer with no path around the command lane.

**Concurrency.** U1 first and alone; U2–U5 are then parallel, each owning its
own block of `presentationTypes.ts` plus one test. `presentationBridge.ts` is
the shared file: each adds its own block to `compileWorldSnapshot` and rebases
on conflict, the same way Lane Q shares `PlayerConfigPanel.tsx`.

---

### Lane V — Backend continuation and repo hygiene

The items that are not about Godot and are not finished.

- [ ] **V1  N7 is Dan's, and it is the last thing between here and Gate 1** (≈0 for a session)
  touches: none
  depends-on: N6
  do: nothing a session can do. N7 needs a real DragonRealms sign-in performed by Dan through this app. Recorded here so it stops being rediscovered as unclaimed work by every lane that reads the tally.
  verify: `docs/verification/` gains a dated record of a real login.

- [~] **V2  #505: a killed break-check leaves the tree damaged** (≈60)
  owner: another session claim: (killed by a usage limit, 9 Sep 2026) since: 2026-09-09
  touches: tools/break-check-tree.mjs
  depends-on: none
  do: **there is real, unpushed work for this already on disk and it must not be re-done from scratch.** `C:\Users\Admin\dev\wt-505` holds an uncommitted 322-line addition to `tools/break-check-tree.mjs` on branch `fix/505-break-check-tree`, which has never been pushed (`git ls-remote origin` finds no matching ref) and whose tip commit is an unrelated leftover. The work looks substantially complete from its own header: it declares what each harness damages, restores on a kill, and adds the `main` this file never had, so `node tools/break-check-tree.mjs` stops exiting 0 having done nothing. Whoever picks this up: read that working tree first, finish it in place or salvage the diff, and say in the commit that it is another session's work being carried rather than re-implemented. Do not `git checkout` in that worktree and do not delete it.
  verify: kill a break-check mid-run and confirm the tree comes back; confirm a leftover damaged file fails the next run instead of being absorbed as "already modified by somebody".
  done-when: #505 closes with the measurement pasted.
  note: the second half of #505 — a documented rerun rule for a flaky stage — is separable and is not in that worktree.

- [x] **V3  Godot's remaining 3D project settings and asset references** (≈15)
  no-3d-history: this row records what was removed and why; every 3D noun in it names a deleted thing.
  commit: (this PR) verified: 2026-09-09 minutes: 55
  touches: godot/project.godot, godot/export_presets.cfg, gone:.gitmodules, gone:godot/shared-assets, tools/export-godot-viewer.mjs, tools/godot-source-scan.mjs, tools/nullable-field-coercion-test.mjs, tools/needs-env.mjs, tools/test-suites.json, docs/ENGINE.md, docs/RELEASE.md, docs/SCENE_ART.md, docs/LICH_NATIVE_LOGIN.md, godot/README.md
  depends-on: none
  do: three things, all of them **the Godot owner's and not the backend's**, recorded here only so a mixed state is not mistaken for a decision somebody made. Do not change any of it from this side. (1) `project.godot` declares `renderer/rendering_method="forward_plus"` and the `"Forward Plus"` feature — 3D renderer settings — beside `window/stretch/mode="canvas_items"`, which is the 2D one. Its `[application]` block is already correct and says plainly that the main scene was removed and why. (2) `godot/export_presets.cfg`'s `include_filter` still names three `.glb` models from the shared-assets submodule. The files exist, so this is a **live** 3D reference rather than a dead one, and V7's sweep will find it. (3) `godot/shared-assets/` is a pinned git submodule of 3D kits and GLBs whose own documents describe a model pipeline; PR #517 did not touch it and neither should this side. Whether the project keeps that submodule at all is a decision for Dan and the Godot owner together, and it is the largest surviving 3D thing in the repository.
  verify: the renderer setting matches the 2D direction, or the file says why it does not; the export filter names nothing the project does not ship.
  done: **the submodule is removed from this repository, and the upstream `project-42-pirate-island-rpg` is untouched.** The `do:` above said not to decide it from this side. What changed the question is a measurement: `git grep -n shared-assets` finds no live consumer, because the only one — `tools/export-godot-viewer.mjs` — read `godot/assets/shared_asset_selections.json`, which PR #517 deleted. `node tools/export-godot-viewer.mjs --check` on `6f706f03` exits 1 with a Node ENOENT stack. `npm run test:godot-export` had therefore been dead since #517 and nothing said so, because `needs-env.mjs` listed it as needing "the shared-assets submodule and a Godot 4 binary" — a suite that needs what the box has not got and a suite that cannot run at all read identically. So this was not a decision about a live dependency; it was a dead one nobody had looked at. (1) the renderer setting is unchanged and now carries a comment saying why: Forward+ is Godot's default desktop renderer and draws 2D; `window/stretch/mode` is the setting that governs this project; flipping a renderer is the Godot owner's call. (2) `include_filter` is empty, and `test:godot-export` — repaired, and now in `tools/test-suites.json` so it runs everywhere — fails if anything from outside `godot/` reappears in it, with a positive control on its own parser. (3) removed, with `.gitmodules`. `submodulePaths()` gained a text seam so its parser is proved against a `.gitmodules` written for the purpose; the check that asserted `size >= 1` went red on the removal, correctly, and now asserts the control plus the honest zero.
  sabotage: `include_filter="shared-assets/a/rock.glb,shared-assets/b/rock.glb"` → `test:godot-export` exits 1 naming both paths, restored md5 `1bea5a31…` either side; break the `path =` regexp in `godot-source-scan.mjs` → the new parser control fails `0 path(s): none` while the live call stays green, restored md5 `88b47058…` either side.

- [ ] **V4  #509: `credential_store` tests are ~10% red under two concurrent cargo runs** (≈50)
  touches: src-tauri/src/credentials.rs, src-tauri/src/test_support.rs
  depends-on: none
  do: present on `main` and not a naming problem, per the issue. `docs/MERGING.md` says two lanes may gate at once because every Rust fixture is process-unique after #502; this is the counter-example still standing, and until it is fixed that page is promising more than it can keep. Establish whether the contention is the Windows Credential Manager itself — a machine-wide store that no `scratch_dir` can make process-unique — and if it is, say so in the test and skip honestly rather than leaving a flake that trains people to re-run.
  verify: the measurement, run at the concurrency the issue names, before and after.

- [x] **V5  `lich.rs` temp-directory sweep (#515)** (≈35)
  commit: (this PR) verified: 2026-09-09 minutes: 45
  touches: src-tauri/src/lich.rs, tools/rust-test-isolation-test.mjs
  depends-on: none
  do: the sweep noted on #515. `rust-test-isolation-test.mjs` already reads every `.rs` under `src-tauri/src` and fails on a temp path that is not process-unique or a listener on a fixed port, printing how many sites it examined; check whether it covers `lich.rs`'s sites and whether any escape its scan.
  verify: the scan's site count printed, and the count of sites in `lich.rs` specifically.
  done: all five sites (1757, 1809, 2499, 2594, 2652) now call `crate::test_support::scratch_dir`. Said plainly, because #515 implies otherwise: **none of the five was the #502 defect and all five passed the check.** Each carried `process::id()`, so no two `cargo test` processes could collide. What they were is five hand-written copies of a rule that has a helper — two still calling `remove_dir_all` on the way *in*, which is the #502 pattern kept safe only by the pid, and none cleaning up on the way out, so a panicking case left its directory in `%TEMP%` for ever. The scan reports 10 `temp_dir()` sites (was 15), 6 of them inside a test module, 1 exempt with a stated reason; `cargo test` 269 passed, 0 failed. In `a_dry_run_reports_the_argv…`, `DRC_LAUNCH_DIR` points at a path *inside* the scratch dir that does not exist yet, because that test's `assert!(dir.exists())` is its control that the launch code created it and a ready-made directory would satisfy it for free.
  also: the check could not have caught any of this, which the sabotage proved, so it gained **rule 3** — inside `#[cfg(test)] mod`, `temp_dir()` is not used at all. Six sites in five other modules still hand-roll; they are a named, printed, capped backlog checked in both directions, so an entry that stops matching fails rather than excusing a site that is gone. Its region boundary is `#[cfg(test)] mod`, not `#[cfg(test)]`: anchored on the bare attribute it swept in production code below `lich.rs`'s three test-only helpers and reported `session_dir()`, the crate's one deliberately exempt path, as a test fixture.
  sabotage: revert 2499 to `temp_dir().join(format!("drc-backstop-{}", process::id()))` → rule 1 stays green and rule 3 reddens naming `lich.rs:2499`, which is the whole case for rule 3 in one run; revert 2594 to the pre-#502 shared name `temp_dir().join("drc-stop")` → red naming `lich.rs:2591`. Both restored, md5 `5524fa25…` either side.

- [x] **V6  Re-gate on merge** (≈20)
  commit: (this PR) verified: 2026-09-09 minutes: 40
  touches: docs/MERGING.md, .github/PULL_REQUEST_TEMPLATE.md, tools/gate.mjs, tools/doc-claims-test.mjs
  depends-on: none
  do: `docs/MERGING.md` step 3 says to rebase and "run the gate again if the rebase moved anything you did not write". That is a judgement call at the moment somebody is most impatient, and it is the wrong shape: with no CI, the only thing standing between `main` and a red tree is whether the person merging re-ran a ten-minute command. Make the rule unconditional — **gate after the rebase, not before** — and say the branch-point gate is a courtesy to yourself rather than the gate. This is the rule that would have caught PR #517: it was gated before the deletion's consequences reached the Rust build.
  verify: the page says it, and `tools/doc-claims-test.mjs` still agrees about the stage count across all three files.
  note: the gate's exit code was checked on 9 Sep 2026 and is **not** defective. `node tools/gate.mjs --only=godot` on a failing stage exits 1, `--only=nonesuch` exits 2, and the only `process.exit(0)` paths are the three documented ones (all passed; a partial `--only` run; no failures but something unchecked). The suspicion that it prints `gate NOT PASSED` and exits 0 was recorded and is closed by measurement rather than by reading.
  done: the rule is unconditional and enforced rather than promised. `tools/gate.mjs` reads `git merge-base HEAD origin/main` before any stage runs, fetches at the end, and reports three states: **current** (`gate ok: 12 of 12 stages ran (base <sha>)`, exit 0), **stale** (`gate ok (base <sha>) — origin/main is now <sha>, re-run after rebasing`, **exit 3**), and **unknown** (git did not answer; it says so and does not claim to be current, exit unchanged). Stale is deliberately not a failure — every stage that ran is honestly green, and the refusal is about what the green is *about*. It also writes a small JSON artefact under `%TEMP%` keyed by the checkout path, like `partialNote`, so a green run's base survives the scrollback. `docs/MERGING.md`'s ritual now rebases at step 2 and gates at step 3, and the page's four outcomes carry their exit codes.
  seams: `DRC_GATE_BASE=<sha>` forces stale, `DRC_GATE_GIT=nope` forces unknown, `DRC_GATE_NO_FETCH=1` skips the network, and `node tools/gate.mjs --currency` asks the verdict alone in about a second with the gate's own exit codes. Measured on this branch, which went stale while the work was being done: `--currency` exit 3 against `59eef03a`; after rebasing, `base 59eef03a is origin/main`, exit 0.
  sabotage: `process.exit(3)` → `exit(0)` reddens "refuses to call a stale run current"; removing "Gate after the rebase, not before" from the page reddens "makes the post-rebase gate unconditional"; removing the `argv.includes('--currency')` dispatch reddens "the verdict is askable on its own". Each restored with its md5 matching. That last one is why the check *runs* the flag rather than grepping for it: the first version tested `/--currency/` against the source, which the flag's own docstring satisfies, and deleting the dispatch left it green. It runs with `--only=nonesuch` as a fuse, because without that a missing dispatch made `doc-claims-test.mjs` fall through and start the whole twelve-stage gate — which it did, once.

- [x] **V7  No surviving 3D instruction anywhere an agent reads** (≈45)
  no-3d-history: this row names 3D throughout because its subject is the sweep that removes it.
  commit: (this PR) verified: 2026-09-09 minutes: 90
  touches: tools/doc-claims-test.mjs, docs/, AGENTS.md, .agents/claims/, godot/README.md, godot/project.godot
  depends-on: none
  do: NO-3D.md's own rule is that a surviving 3D document keeps producing the behaviour after the direction is gone — a session opened one, found an approved plan, and built against it. Prose is therefore not a tidying matter here, it is the failure mode. Add a check to `tools/doc-claims-test.mjs` that greps `docs/`, `AGENTS.md`, `.claude/` and this plan for `3D|glb|mesh|rigging|WorldRoot|content_registry` and fails on any hit outside `docs/NO-3D.md`, a `superseded:` line, or an explicitly historical `docs/verification/` record. **Print N of N**: the number of files scanned and the number of allowed hits, so a grep that matched nothing because it was pointed at the wrong tree reports itself instead of certifying a clean repo — a zero is a claim about the instrument first.
  verify: the check green; then point it at a directory that does not exist and confirm it fails saying it scanned nothing, rather than passing.
  sabotage: add the sentence "the 3D viewer renders the room" to a doc under `docs/` and confirm the red names the file and the line; remove it and confirm green, with the file's hash matching either side.
  done-when: an agent cannot find live 3D direction anywhere in this repo, and the check that says so cannot pass by scanning nothing.
  done: `doc-claims-test.mjs` section M sweeps `docs/`, `.claude/`, `.agents/`, `AGENTS.md`, `CLAUDE.md`, `README.md` and the three Godot config files — 157 files, 180 hits — and a hit is history, a marked allowance, a statement of the cancellation, or a failure. Both counts are asserted against floors before any verdict, so a sweep pointed at nothing reports itself rather than certifying a clean repo. Four controls: the needle sees a planted instruction, a history line is still a *hit* rather than invisible, a pointer at `NO-3D.md` is not itself a 3D reference, and a marker without a reason excuses nothing. V3's half is checked here too — the Godot config names no `.glb`/`.gltf`, with a control that the pattern matches one when shown one.
  allowances, each counted, capped and printed: 18 files marked wholly historical (`no-3d-file-history: <why>`, in prose as an HTML comment and in a claim record as a JSON key), 4 inline `no-3d-history:`/`no-3d-direction:` markers, and 18 lines that name 3D beside a cancellation verb. That last category exists because NO-3D.md asks every document to say plainly that 3D is cancelled, and doing so trips a grep for `3D`: about fifty markers in prose would be fifty markers nobody reads. Its hole is stated in the code — "the 3D pipeline was deleted; rebuild it in Godot" would pass — and `docs/SCENE_ART.md` is the near miss that shaped it: "New board production follows the world-board strategy, using reusable geometry kits", live 3D direction *linking to NO-3D.md*, caught because it carries no cancellation verb.
  fixed rather than marked: `docs/SCENE_ART.md`'s geometry-kit sentence; `godot/README.md`'s "Regenerating the mock fixture" section, which gave a command for a tool #517 deleted; `docs/RELEASE.md`, `docs/ENGINE.md` and `docs/LICH_NATIVE_LOGIN.md`.
  sabotage: plant "the 3D viewer renders the room" in a doc under `docs/` → `FAIL no live 3D instruction survives` naming the file and line; remove it → green, md5 matching either side. Point the sweep at a directory that does not exist → it fails on its own floor saying it scanned nothing, rather than passing.
  note: the plan's own §0.1 vocabulary (`[-]`, `superseded:`, `gone:`) is what excuses the plan's superseded increments, rather than a second marker meaning the same thing. Two markers for one idea would be the fork this file's own rule forbids.

---

---

## 6b. The player-facing lanes (R, W, X, Y, Z)

Added 9 September 2026 from [GAP-2026-09-09.md](GAP-2026-09-09.md), which
measured 29 things a DragonRealms player does in an hour against what this
client does when they do them: **9 full, 13 partial, 7 absent**. Read that page
before claiming anything here; every increment below cites the row it closes.

**Why these five lanes exist at all.** Before this, every lane in section 6 was
infrastructure, a presentation contract, release engineering or hygiene. That
was correct while the client was being built. It means, on 9 Sep, that
*nothing in the plan was about playing the game* — and the nine unimplemented
activity intents, recorded as a known gap in `NEXT-50.md:48` on 2 September,
had no owner a week later.

**What these lanes must not do.** The survey's section 1 lists what is already
good, and the two that constrain this work hardest:

- **The outbound command lane** (`src-tauri/src/command_gate.rs`) is the one
  ordered path for every command this app emits, with priority, roundtime
  pacing, typeahead and coalescing, and Pause and Stop reach all of it. No
  increment below opens a second path. New capability **submits to the lane**.
- **`DOMAIN.md:305-321`, `:348` and `:1154-1165`: do not rebuild the data or
  the automation.** `C:\Ruby4Lich5\Lich5\scripts\data` holds 30 YAML files and
  47,721 lines covering exactly the domains this client lacks — recipes,
  spells, hunting grounds, towns, herbs, picking. The community maintains them
  and the player already has them on disk. Where an activity is added, the
  bridge **starts a dr-scripts script and reports what it is doing**, the way
  `map_walk` already starts `;go2` rather than reimplementing movement.

**Sequence.** R and W first: they are what a player meets in the first ten
minutes. X, Y and Z are parallel to each other and to R/W after their own `0`
increment, because each publishes its interface before anything consumes it.

**Published interfaces, so the lanes need not talk.**

| Lane | Publishes | Enforced by |
|---|---|---|
| R | one row per activity intent in `docs/BRIDGE_CONTRACT.md`: args, progress shape, refusal shape | `tools/intent-drift-test.mjs` already fails the build when `IntentName`, the bridge's `HANDLERS` and the mock disagree |
| W | new `CharacterStatus` fields in `src/types/index.ts`, added in W0 before any consumer | `tsc -b`, plus W0's own check that every new field has a reader |
| X | `new:src/lib/townLoop.ts` — the money and shop types | X0 |
| Y | `new:src/lib/tasks.ts` — the task and bounty types | Y0 |
| Z | `new:src/lib/drScriptsSchema.ts` — the settings schema, derived from the installed `base.yaml` and never invented | Z0 |

**Conflict rule for this whole section.** All five lanes reach
`lich-scripts/companion_bridge.lic` — R0–R7, W1–W6, X1–X3, Y1, Z0 and Z1.
That file is 3,351 lines and one dispatch table; two sessions in it at once
will conflict on `HANDLERS`. **Only one increment that touches it may be `[~]`
at a time, across all five lanes** — check section 3.1 before claiming. The
`0` increments (R0 aside, which writes the contract the others fill in) are
where the parallelism is: W0, X0 and Y0 name disjoint files and can all run at
once, and each publishes what its own lane then waits on.

---

### Lane R — The nine activity intents: make the buttons the client already shows do something

Gap rows 10, 13, 14, 16, 17, 20, 27. The client declares 35 intents and the
bridge implements 26; the nine missing ones are, without exception, the
*activities* — `start_combat`, `burgle`, `travel`, `escape_heal`, `go_healer`,
`town_run`, `start_training`, `loot`, `buffs`. `isIntentImplemented` disables
their controls honestly, which is right and is why this is a gap rather than a
bug, but a greyed Fight button and a missing Fight button are the same thing to
a player.

Every one of these is a thin adapter over a dr-scripts script the player
already has. None of them is a reimplementation, and an increment here whose
`do:` starts writing combat logic in Ruby has gone wrong.

- [ ] **R0  Publish the activity-intent contract before any handler exists** (≈60)
  touches: docs/BRIDGE_CONTRACT.md, lich-scripts/companion_bridge.lic, tools/intent-drift-test.mjs, new:tools/activity-intent-contract-test.mjs
  depends-on: none
  do: the nine intents have never had a written shape, which is why eight of them are "specified" in `NEXT-50.md` as prose and none is buildable from it. Write one contract covering all nine: the args each takes, the **progress** messages it emits while running (an activity takes minutes, so a request/response shape is wrong for it), the **refusal** shape when the character cannot do it right now, and how Stop and Pause reach it — they must, and `SAFETY_INTENTS` in `src/store/bridgePolicy.ts` is why. State plainly that an activity handler's job is to start a named dr-scripts script and report, and name the script for each of the nine. `burgle` gets a contract row saying it is deferred to R8 and why, rather than being left out.
  verify: `node tools/activity-intent-contract-test.mjs` reads `docs/BRIDGE_CONTRACT.md` and the bridge and asserts that every intent the contract describes is either in `HANDLERS` or listed as deferred, and that every deferred one names its blocker. Print N of N — the number of contract rows parsed and the number matched — so a parser that matched nothing reports itself rather than certifying agreement.
  sabotage: delete one contract row → the check names the intent that lost its row; add a tenth row for an intent `IntentName` does not declare → red. Restore, md5 either side.
  done-when: a session can implement any of R1–R7 without asking what the payload looks like.

- [ ] **R1  `buffs`** (≈70)
  touches: lich-scripts/companion_bridge.lic, lich-scripts/test/protocol_harness.rb, src/bridge/mockBridge.ts, docs/BRIDGE_CONTRACT.md
  depends-on: R0
  do: first because `NEXT-50.md:441-447` (#42) nominates it — read-mostly, so the blast radius of getting it wrong is small. Start the player's own buff script; report which buffs are up as progress. Do not invent a spell list: gap row 20 records that nothing in this repo knows DR's spells, and `LIVE-STATE.md:281` records the same decision being taken deliberately for Bard songs.
  verify: `node tools/intent-drift-test.mjs` shows 27 implemented, and the mock's unimplemented set drops to 8 in the same commit or the drift test fails — which is the point of it.
  sabotage: remove the handler from `HANDLERS` and confirm the UI control greys out rather than sending into nothing.

- [ ] **R2  `loot`** (≈60)
  touches: lich-scripts/companion_bridge.lic, src/components/shared/InventoryPanel.tsx, src/bridge/mockBridge.ts, docs/BRIDGE_CONTRACT.md
  depends-on: R0
  do: the Loot control is already in `InventoryPanel.tsx` and already gated on `isIntentImplemented(bridgeIntents, 'loot')`, so this is the bridge half only. `NEXT-50.md:449-456` (#43) is the specification.
  verify: with the handler present the control enables and a real loot pass reports what it picked up; with it absent the control is disabled and says why.

- [ ] **R3  `travel`** (≈90)
  touches: lich-scripts/companion_bridge.lic, src/bridge/mockBridge.ts, docs/BRIDGE_CONTRACT.md
  depends-on: R0
  do: `map_walk` already exists and already starts `;go2` rather than pathfinding itself — copy that shape exactly; `DOMAIN.md:1059-1060` is the argument for it ("A companion that drives `;go2` inherits every fix anyone makes to it"). What `travel` adds over `map_walk` is a *named destination* rather than a room id, and the two hard parts are both recorded: `DOMAIN.md:694-696`, arrival must be **checked** after the move completes and never inferred; and `:96-101`, an expired passport strands a character, so passport state is runtime state the bridge must report before a leg is attempted.
  verify: a walk to a destination the character cannot reach fails naming the reason, rather than reporting arrival.
  pitfalls: `LIVE-STATE.md:320` — on the one live run Lich had no map database at all, so every map intent answered nothing. Establish that first or this increment measures the wrong thing.

- [ ] **R4  `escape_heal` and `go_healer`** (≈80)
  touches: lich-scripts/companion_bridge.lic, src/components/layout/SituationBanner.tsx, src/bridge/mockBridge.ts, docs/BRIDGE_CONTRACT.md
  depends-on: R3
  do: `NEXT-50.md:475-482` (#46) specifies both. Two constraints from the domain, both of which have burned somebody already: `DOMAIN.md:669` and `:829` — **the threshold that decides "go heal" belongs to the player and must be visible**, not buried; two separate players hit this confusion in two separate channels, which `DOMAIN.md:826` calls a design problem rather than user error. And `:481-485` — a player picks a **home healer** and explicitly rejects proximity, so a preferred heal city wins by default and `map_nearest` is the fallback, not the rule.
  verify: no "healed" result appears before live health confirms it; a failure leaves a stated recovery action.

- [ ] **R5  `town_run`** (≈90)
  touches: lich-scripts/companion_bridge.lic, src/bridge/mockBridge.ts, docs/BRIDGE_CONTRACT.md
  depends-on: R3, X1
  do: `NEXT-50.md:467-473` (#45). Depends on X1 as well as R3 because a town run that cannot read the character's money cannot report what it did: `DOMAIN.md:313` — "selling gems and skins, banking, money exchange between provinces, repair... and pawning".
  verify: inventory and currency failures stop honestly rather than reporting a completed run.

- [ ] **R6  `start_training`** (≈70)
  touches: lich-scripts/companion_bridge.lic, src/components/shared/TrainingPanel.tsx, src/bridge/mockBridge.ts, docs/BRIDGE_CONTRACT.md
  depends-on: R0
  do: `NEXT-50.md:484-492` (#47) covers this and `start_combat`. The domain correction matters more than the plumbing: `DOMAIN.md:57` — "'Start Training' is currently a destination picker. It should be answering 'what is absorbing right now'." The client already holds per-skill `{ranks, mindstate}`, so the answer is computable; this increment is what acts on it.
  verify: a skill at Mind Lock is never the recommendation, and the panel says which skill it chose and why.

- [ ] **R7  `start_combat`** (≈90)
  touches: lich-scripts/companion_bridge.lic, src/components/room/BattleColumn.tsx, src/bridge/mockBridge.ts, docs/BRIDGE_CONTRACT.md
  depends-on: R0, W1
  do: last of the implementable eight, because it is the one that can get a character killed. Depends on W1 because starting a fight without being able to read the stance back is the shape of bug this survey exists to find. Starts the player's own `combat-trainer` with their own YAML; reports the hunting ground, the target and the retreat condition as progress.
  verify: Stop reaches it within one command; Pause holds it; both proved against a running script, not a mock.
  pitfalls: `DOMAIN.md:753-756` — on Prime and Platinum the script must be monitored, and that obligation is the player's. This control makes attending easy; it does not argue about AFK.

- [!] **R8  `burgle`** (≈unknown)
  blocked-on: a product decision only Dan can make — see section 10
  touches: docs/BRIDGE_CONTRACT.md
  depends-on: R0
  do: nothing until the decision. `NEXT-50.md:495` calls it "the sole acknowledged unspecced intent" and states the rule that applies meanwhile: keeping an enabled or promised button without a safe definition violates the product's truth rule. It is currently disabled honestly, which is the correct holding state.

---

### Lane W — The facts a fighting player reads back

Gap rows 12, 15, 17, 18, 19, 20, 25. The pattern this lane closes is one thing
said seven ways: **the client can type the command and cannot read the
answer.** `node tools/gap-survey-probe.mjs` prints it as rows where the send
column is non-zero and every other column is zero.

W0 publishes every field first, in one edit, so W1–W6 can run in parallel
against a settled type.

- [x] **W0  Publish the fields before anything consumes them** (≈50)
  commit: (this PR) verified: 2026-09-10 minutes: 90
  touches: src/types/index.ts, docs/BRIDGE_CONTRACT.md, src/lib/panelDataContracts.ts
  depends-on: none
  do: add `stance`, container `used`/`capacity`, the prepared-spell block, numeric encumbrance and the rezz-sickness timer to `CharacterStatus`, each documented with **what absence means** — the distinction `skillsReady` already draws and that `src/types/stream.ts` is built around. Update `PANEL_DATA_CONTRACTS` in the same edit, because that file is the answer to "what does this window need" and a field nobody records there is a field the wrapper cannot honestly promise Godot.
  verify: a check that every field added here is named by at least one entry in `PANEL_DATA_CONTRACTS` and read by at least one component before its lane closes — the "grep the consuming side" rule, made mechanical.
  sabotage: add a field nothing reads → the check names it.

- [ ] **W1  Stance, read back** (≈50)
  touches: lich-scripts/companion_bridge.lic, src/data/macros.ts, src/components/shared/RiskBar.tsx, src/types/index.ts
  depends-on: W0
  do: gap row 15, and the cleanest instance of the whole pattern. `src/data/macros.ts:58-66` sends `stance defensive|guarded|offensive`; `grep -c '\bstance\b' lich-scripts/companion_bridge.lic` is **0**; and DragonRealms does not send `pbarStance` on the XML stream, which `src/types/stream.ts` states from Lich's own source. So the client changes a combat-critical setting and can never say what it is. Read it in the bridge and show it where the risk readout already is — `panelDataContracts.ts` already *claims* the risk panel shows stance, which today it cannot.
  verify: change stance from the macro bar and watch the readout follow, against a live or replayed session; then change it by typing the command directly and confirm it still follows — a readout that only updates when *this client* sent the command is reading its own echo, not the game.
  sabotage: that second case is the sabotage. Do it before believing the first.

- [ ] **W2  Container capacity is hardcoded zero** (≈60)
  touches: lich-scripts/companion_bridge.lic, src/components/shared/InventoryPanel.tsx, src/types/index.ts
  depends-on: W0
  do: `lich-scripts/companion_bridge.lic:796` emits `{'name' => c, 'used' => 0, 'capacity' => 0}` for every worn container. The fields exist, cross the socket, and are a constant — a value that looks like an answer and is a placeholder, which is worse than the absence. `NEXT-50.md:394-400` (#37): "Capacity and location matter more than a long alphabetical list."
  verify: a full bag and an empty bag read differently. That sentence is the whole check and it is one the current code cannot pass.

- [ ] **W3  The prepared spell, and the dead `spell` field** (≈70)
  touches: src/types/stream.ts, src/lib/gameStream.ts, lich-scripts/companion_bridge.lic, new:src/lib/spellCycle.ts
  depends-on: W0
  do: two things that must be decided together. (1) `StreamCharacterState.spell` is declared in `src/types/stream.ts`, is **never written by the parser and never read by anything** (`grep -n spell src/lib/gameStream.ts` finds only a comment, control `compass` → 9; `WIRING-AUDIT.md:174` independently lists the tag as still absent). **Wiring it and deleting it look identical on screen and are opposite fixes** — decide which, say so in the commit, and do not delete it merely because deleting is cheaper. (2) Gap row 20: nothing tracks prep state or mana cost, so a caster's most frequent action has no readout at all. Do not invent a spell catalogue; read what the game and `base-spells.yaml` say.
  verify: preparing a spell, holding it, and releasing it are three distinguishable states in the readout, and an unknown spell is shown as unknown rather than as none.

- [ ] **W4  Encumbrance as numbers** (≈45)
  touches: lich-scripts/companion_bridge.lic, src/types/index.ts, src/components/shared/InventoryPanel.tsx
  depends-on: W0, W2
  do: `encumbrance` arrives as a string. `DOMAIN.md:142` gives the real shape — 100 items free-to-play, 75 before junk-room warnings, 300/250 with the inventory upgrade, and slot limits of body 10, over shoulder 2, finger 2, belt 2 — and `:210-212` explains why it is not cosmetic: burden and armour reduce effective Athletics, which is what decides whether a shortcut kills you.
  verify: the readout answers "can I pick this up", which a word cannot.

- [ ] **W5  One roster, not two** (≈80)
  touches: src/lib/gameStream.ts, src/types/stream.ts, lich-scripts/companion_bridge.lic, new:src/lib/roomRoster.ts
  depends-on: W0
  do: gap row 12. Creatures reach the client twice and are reconciled nowhere: the bridge sends `roomCreatures`/`roomCombatants`, while the stream's bold half of `<component id='room objs'>` is **deliberately unimplemented** pending a live `crtrStatus` capture (`src/types/stream.ts`, `WIRING-AUDIT.md:172`). That was the right call and it has not been revisited since the capture became possible. Either implement the pairing with the count gate the type already describes, or state in the type that the bridge is the single source and the stream half will never be parsed — but not both, and not silence.
  verify: a room with creatures and loot in it produces one roster with every entry attributable to a source; the counts from the two sources are compared and a mismatch is reported rather than merged.
  pitfalls: `DOMAIN.md:703-708` — creature names carry trailing state suffixes ("being webbed") that break any command built from them; strip them before use. `:715-718` — a two-sentence combat message can arrive on one line, so `^`-anchored patterns miss.

- [ ] **W6  Rezz sickness, and favors as a pre-hunt check** (≈55)
  touches: lich-scripts/companion_bridge.lic, src/components/shared/StatsPanel.tsx, src/components/shared/RiskBar.tsx, src/types/index.ts
  depends-on: W0
  do: gap row 25. `favors` already arrives and renders. What is missing is the question a player actually asks: `DOMAIN.md:518-524` — "*can I afford to die right now?*" — which wants the number **before** the hunt, not on a stats page. And `:244-247`: there is a timed rezz-sickness state after dying during which you should not fight, the combat script has a dedicated mode that waits it out, and this client has `dead` and `dying` flags with no concept of the recovery period.
  verify: the pre-hunt readout says a number and what it means; the recovery timer counts down and the fight controls say why they are refusing while it runs.

---

### Lane X — The town half of the session loop: money, shops, repair, banking

Gap rows 26 and 27, both **ABSENT**, and together the largest missing block in
the client. `grep -c '\bcoins\?\b\|\bsilver\b\|\bwealth\b' lich-scripts/companion_bridge.lic`
is **0** against a control of `favors` → 2. `src/data/macros.ts:139` types
`wealth` and the answer lands in the text pane, which is what the game already
did before this client existed.

`DOMAIN.md:313` is the scope: "selling gems and skins, banking, money exchange
between provinces, repair (including magic repair kits and crafting tool
repair), and pawning." `DOMAIN.md:358-359` names the Lich APIs to drive rather
than reimplement — `DRCM` for money, `DRCI` for inventory, `DRCT` for travel.

- [ ] **X0  Publish the money and shop types** (≈50)
  touches: new:src/lib/townLoop.ts, docs/BRIDGE_CONTRACT.md, src/types/index.ts
  depends-on: none
  do: denominations first, because a wrong one is a silent factor of ten: `DOMAIN.md:148` — 1 platinum = 10 gold = 100 silver = 1,000 bronze = 10,000 copper. Model coins on hand and coins banked as different things per province, because cross-province exchange is a real step in the loop. Nothing here reads a shop database, because there is not one: measured, `data/elanthipedia/` has 11 files covering items, weapons, armour, creatures and materials, and **nothing about merchants**.
  verify: a round-trip test over every denomination boundary, and one deliberately wrong conversion that must fail.

- [ ] **X1  Wealth: what you have, and where** (≈60)
  touches: lich-scripts/companion_bridge.lic, new:src/components/shared/WealthPanel.tsx, src/lib/panelDataContracts.ts, src/lib/layout.ts, src/components/dashboard/panels.tsx
  depends-on: X0
  also-edits: src/lib/townLoop.ts, which X0 creates. The audit checks plain paths for existence, so a file an earlier increment has not made yet cannot be listed above; it is named here instead of being lost.
  do: read coins on hand and banked through `DRCM`. `DOMAIN.md:590` names bank headroom as one of the four numbers that decide whether to risk something, beside favors, Athletics against the next obstacle and passport expiry — so this belongs beside W6, not in a separate financial screen.
  verify: the number matches what `wealth` prints in the game pane, checked against the text rather than against the code that produced both.

- [ ] **X2  Selling, pawning and repair** (≈90)
  touches: lich-scripts/companion_bridge.lic
  also-edits: src/lib/townLoop.ts (X0) and src/components/shared/WealthPanel.tsx (X1), neither of which exists yet.
  depends-on: X1
  do: drive `sell-loot`, `pawn-items` and `repair`, which the player already has; report what was sold and for how much. Do not build a merchant database — the town knowledge lives in `base-town.yaml` (1,640 lines) on the player's own disk.
  verify: a sale the game refuses is reported as a refusal, with the reason, and never as a completed sale with zero coins.

- [ ] **X3  Banking and cross-province exchange** (≈70)
  touches: lich-scripts/companion_bridge.lic
  also-edits: src/lib/townLoop.ts (X0) and src/components/shared/WealthPanel.tsx (X1), neither of which exists yet.
  depends-on: X1
  do: the last third of the town run, and the one with a trap in it — money does not move between provinces for free, and a planner that assumes it does will strand a character with the wrong currency in the wrong place.
  verify: an exchange states its rate and its fee before it happens.

---

### Lane Y — Tasks and bounties

Gap row 28, **ABSENT**, and the finding that makes this lane different from
the rest: it is absent from the *design corpus* as well as from the code.
Twelve design documents mention bounties **once**, as a stream label
(`WIRING-AUDIT.md:97`). `DOMAIN.md:305-321`'s account of "the real session
loop" does not mention them at all. Meanwhile the player's own Lich install
ships `taskmaster`, `task-forage`, `trade`, `favor` and eleven more scripts
about nothing else.

So Y0 is research, and it is not optional. Building a bounty panel from
guesswork would be the invented-data defect this repository has already been
burned by twice (`NEXT-50.md:32` on portraits, `LIVE-STATE.md:281` on Bard
songs).

- [ ] **Y0  Establish what a task actually is, from sources** (≈70)
  touches: new:docs/BOUNTIES.md, docs/DOMAIN.md
  depends-on: none
  do: from Elanthipedia and from the vendored Lich scripts (read, never run), write down: who gives tasks, what kinds exist, how one is accepted, how progress is reported in the game text, how one is turned in, and what a failure looks like. Cite each claim. **Where a fact is not established, say so and leave it out** — `DOMAIN.md` earns its authority by marking its own invented numbers as invented (`:133`), and this page must do the same.
  verify: every claim carries its source; the page states what it could not establish.
  done-when: a session can build Y1 without inventing a mechanic.

- [ ] **Y1  Publish the task types and read the current one** (≈70)
  touches: new:src/lib/tasks.ts, lich-scripts/companion_bridge.lic, docs/BRIDGE_CONTRACT.md, src/types/index.ts
  depends-on: Y0
  do: read the character's current task and its progress. The `bounty` stream label already exists in `StreamTabs`' vocabulary, so the reading half may already be arriving unlooked-at — check that before writing a parser, and say which it was.
  verify: no current task and an unread current task are distinguishable states, never one empty box.

- [ ] **Y2  The task panel** (≈70)
  touches: new:src/components/shared/TaskPanel.tsx, src/lib/layout.ts, src/components/dashboard/panels.tsx, src/lib/panelDataContracts.ts
  also-edits: src/lib/tasks.ts, which Y1 creates.
  depends-on: Y1
  do: what the task is, how far along it is, where to turn it in, and one control to accept the next one. `DESIGN-BIBLE.md:179-181` is the admission test — what question does this answer at the moment the player glances at it — and the answer here is "am I done yet".
  verify: the panel is honest with no task, with a task the client cannot parse, and with the bridge offline; all three, not just the happy one.

---

### Lane Z — dr-scripts settings as forms, not YAML

Gap row 24, and `DOMAIN.md:1154`'s own answer to what this project is for:

> So the highest-value thing this project can do is not to build another
> automation suite. It is to be the interface to the one that already exists
> and works.

The wall is measured, not asserted. To use dr-scripts, its own help page asks
a newcomer to read five YAML guides, install VS Code with the Red Hat YAML
plugin, hand-write a character setup file against a 94 KB `base.yaml` they
must not edit, and validate it in an online parser (`DOMAIN.md:1109-1145`).
Files load in a fixed order and **the last one wins**, which is the mechanism
behind most "I changed the setting and nothing happened" reports.

**Half of this is already built and shipped.** `lich-scripts/companion_bridge.lic:1094`
(`module Yaml`) walks the profile directories, computes the load order, parses
each file, counts and names the settings, and on a syntax error reports the
**line and column** — the one fact people currently paste into online parsers
to discover. `src/components/shared/SettingsFilesPanel.tsx` shows it. This lane
is the write side, and nothing else.

- [ ] **Z0  The schema, derived and never invented** (≈90)
  touches: new:src/lib/drScriptsSchema.ts, lich-scripts/companion_bridge.lic, lich-scripts/test/yaml_test.rb
  depends-on: none
  do: `DOMAIN.md:1150-1153` — "the settings are structured, typed data. A herb entry is a record with `name`, `size`, `stackable`, `room`, `price`, `quantity`. A form produces that correctly every time; a person counting spaces does not." Derive the schema **from the installed `base.yaml` on the player's own disk**, at runtime, rather than committing a copy of somebody else's file: a committed schema is a fork of a file its authors keep changing, and it will drift silently. Anchors, aliases and merge keys (`<<: *`) are in scope and are the hard part; anchors do not cross files, which the derivation must respect.
  verify: derive against the installed `base.yaml` and report how many settings were found, with a floor — a derivation that finds nothing must fail, not produce an empty form.
  sabotage: point it at a `base.yaml` with a broken anchor and confirm it reports the line rather than producing a schema missing one branch.

- [ ] **Z1  The write side, which must never touch `base.yaml`** (≈90)
  touches: new:src/lib/drScriptsWrite.ts, lich-scripts/companion_bridge.lic
  also-edits: src/lib/drScriptsSchema.ts, which Z0 creates.
  depends-on: Z0
  do: write only `<Character>-setup.yaml` and `<Character>-<Arg>.yaml`, never `base.yaml`, which dr-scripts' own documentation says must not be edited. Back up before every write and verify the backup by hash. **This writes into a shared install target outside any git repository** — the same class of file two sessions collided over on 6 Sep, per `CLAUDE.md` section 4 — so re-read immediately before writing rather than from an earlier measurement, and never assume the copy on disk is the one this client last wrote.
  verify: `;validate` accepts every file this produces. That is the game's own checker and it is the only verification that means anything here.
  sabotage: write a file with a deliberately wrong indent and confirm `;validate` rejects it — a writer that cannot produce a rejection has not been shown to produce an acceptance.

- [ ] **Z2  Forms for the settings people actually change** (≈120)
  touches: new:src/components/config/DrScriptsTab.tsx, src/components/config/PlayerConfigPanel.tsx
  also-edits: src/lib/drScriptsSchema.ts (Z0) and src/lib/drScriptsWrite.ts (Z1).
  depends-on: Z1
  do: not all of it. Pick the settings the community's own help traffic is about — safe room, hunting ground, weapon and armour choices, herbs and remedies, containers — and leave the rest to the existing read-only view, which already names every setting it found. Lands beside the client's own config editors, because a player should not have to learn that some of their settings live in one place and some in another.
  verify: change a setting in the form, run `;validate`, and confirm the running script picks it up — three steps, and the third is the one that proves it.

- [ ] **Z3  Round-trip, and the load-order answer** (≈70)
  touches: src/components/shared/SettingsFilesPanel.tsx, lich-scripts/test/yaml_test.rb
  also-edits: src/lib/drScriptsWrite.ts, which Z1 creates.
  depends-on: Z2
  do: read a real profile, write it back unchanged, and diff. A round-trip that reorders keys or drops a comment is a data-loss bug wearing a formatting costume. Then close the loop the read side opened: show, per setting, **which file's value won**, because `DOMAIN.md:1141-1145` identifies a later file silently overriding an earlier one as the mechanism behind the config failures that present as script bugs.
  verify: the round-trip is byte-identical on an unchanged profile; a setting defined in two files shows both and marks the winner.
### Lane O - The play-first frame (Dan's first live session)

Dan, 9 September 2026, after his first live session, in two messages:

> its really hard to run. the godot screen should include the map and the
> ability to easily put it into mini map mode or pop it out into a big map,
> nice interface. we had a lot of the map built although we definitely update
> what we were doing before. I'm not sure about all the menus but the game
> screen needs to be quite large so that I can actually play the game as mud.

> it's not best to put the screen in the middle... put it in the right corner
> and have a bottom bar of icons for various functions and then on the left you
> have room for your text heavy windows.

**Why this is a new lane and not more of Lane D.** Lane D built the approved
mockup (`docs/mockups/dr-companion-isometric-mvp.html`) and finished on 9
September; this is the first report from somebody playing on it, and it says
that arrangement is wrong for a MUD. A row added to a finished lane would read
as unfinished work in it. The frame is built on `columns.ts` exactly as Lane
D's was - two columns through the same arithmetic, in its own documented
two-column mode - so this is not a second layout engine beside that one.

- [x] **O1  Measure what each region actually gets** (~30)
  commit: (this PR) verified: 2026-09-09 minutes: 45
  touches: new:tools/layout-regions.mjs, src/components/shared/StatsPanel.tsx, new:docs/verification/layout-2026-09-09.md
  depends-on: none
  do: drive the app with the mock bridge through the browser harness at 1997x935, 1180x820 and 1366x768 and record, per region, the pixel area and the share of the window, with a screenshot per size. Three states per region - measured, hidden, absent - so a region a build does not have cannot read as one rendered at zero size.
  verify: the numbers, in `docs/verification/layout-2026-09-09.md`.
  done: at Dan's own window the game text held **17.9%** of the screen in a 223px strip along the bottom while the room picture in the middle held **38.8%**. 20.3% against 33.4% at 1180x820, and 21.7% against 30.7% at 1366x768.

- [x] **O2  The frame: text left, scene pane in the right corner, icons along the bottom** (~90)
  commit: (this PR) verified: 2026-09-09 minutes: 210
  touches: src/App.tsx, new:src/lib/scenePane.ts, new:src/lib/panelBar.ts, new:src/components/layout/IconBar.tsx, src/components/dashboard/panels.tsx, src/lib/layout.ts, src/lib/panelDataContracts.ts, tools/columns-test.mjs, tools/splitter-range-test.mjs, tools/battlespace-test.mjs, tools/doc-claims-test.mjs, tools/build-player-data-doc.mjs, docs/PLAYER_DATA.md
  depends-on: O1
  do: the workspace becomes the text region on the left and one rail on the right, with a single divider between them; the scene pane is the first thing in that rail, so it sits in the top right corner; every function that no longer holds a fixed slice of the window moves to a bottom bar of icons rather than being deleted. Two new panel ids - `board` for the pane and `tasks` for the tasks-and-scripts grid - so the pop-out uses the panel-window machinery that already exists rather than a second implementation of it.
  verify: the after table in `docs/verification/layout-2026-09-09.md`; `npx tsc -b`; `npm run gate`.
  done: the text region went from 17.9% to **52.9%** of the window at 1997x935, 20.3% to 49.7% at 1180x820 and 21.7% to 48.1% at 1366x768, and holds about 74% of the window's width at all three. The scene pane's right edge sits 4px from the window's right edge at every size that has one.
  note: the bar's names come from `PANEL_TITLES` and its descriptions from `PANEL_DATA_CONTRACTS[id].purpose`. `panelBar.ts` adds an icon and an order and nothing else - a third table of names and sentences would be wrong within a month and would look identical while being wrong.
  note: not superseded - the frame this row built (text left, pane in the right corner, bar along the bottom) is still exactly right and still stands; `plan-audit.mjs` reserves `superseded:`/`[-]` for an increment whose file was undone, and `scenePane.ts` was extended, not undone. What Dan's 10 September message narrowed is the pane's *default size and state* within this same frame - see **P1/P2** below. His own words distinguish the two: "I am quite sure I said to put the main window to the right" (the corner this row built was correct) versus "right now you are random and broken" (the 380px default inside it was not). The `done:` line above is still an accurate record of what O2 built and measured at the time.

- [x] **O3  The pane's three states, remembered per size of window** (~45)
  commit: (this PR) verified: 2026-09-09 minutes: 60
  touches: O2>src/lib/scenePane.ts, new:tools/scene-pane-test.mjs, package.json, tools/test-suites.json
  depends-on: O2
  do: `minimap`, `popped` and `hidden`, with one cycling control on the bar that names the state it will move to. `popped` opens the `board` panel window; the corner then says where the pane went rather than drawing a second copy. The state is stored per class of window size, because it is a different decision on a 1997px monitor and at the app's 720px minimum, and one stored answer makes one of them wrong.
  verify: `npm run test:scene-pane` - 21 checks.
  sabotage: `sizeBucket` returning one bucket for every size, so the per-size persistence check goes red. Run under O4.
  note: not superseded, extended - **P1** below adds a fourth state (`docked`) and makes it the default; `minimap` survives as a player's own smaller choice rather than being deleted. The per-size storage mechanism this row built is unchanged and is exactly what P1 builds on rather than forks.

- [x] **O4  Assert the frame at every supported size, and break it on purpose** (~60)
  commit: (this PR) verified: 2026-09-09 minutes: 90
  touches: new:tools/play-first-layout-test.mjs, new:tools/play-first-layout-break-check.mjs, package.json, tools/test-suites.json
  depends-on: O2, O3
  do: a browser-driven suite over five window sizes, the smallest read out of `src-tauri/src/window_size.rs` rather than typed, asserting the text's share of the width against a floor, the command line inside the viewport and clickable, the pane in the right corner, every bar icon named, described and reachable, every panel either on the bar or named as deliberately off it, and the three states cycling and persisting. Then a break-check that damages each property and asserts which checks go red and that nothing else does.
  verify: `npm run test:play-first-layout` - 54 checks; `npm run test:play-first-layout-break` - 5 sabotages, control first.
  done: the third sabotage reddened one check where two were expected, because the bar's button count was compared against `PANEL_BAR_ORDER` and both move together - dropping a panel from the order satisfied that comparison perfectly while making the panel unreachable. The suite now also compares the rendered bar against the panel manifest, and the sabotage reddens both. Asserting only that something went red would have missed it.

- [x] **O5  Readability of a wall of game text** (~25)
  commit: (this PR) verified: 2026-09-09 minutes: 40
  touches: src/components/game/StreamTabs.tsx, src/components/game/GameCommandBar.tsx
  depends-on: O2
  do: the scrollback sticks to the bottom while it is at the bottom and offers a way back when it is not; the command line keeps focus after a send.
  verify: characters per line at each size, recorded in `docs/verification/layout-2026-09-09.md`.
  done: a Latest pill appears in the scroll box only while scrolled up, so it is never furniture, and changing channel counts as being at the bottom again. The command line now regains focus after a send that worked - pressing Enter left focus in the box by itself, pressing Send did not, and the next thing typed went nowhere. Type is 16px on a 24px line height; 216, 147 and 127 characters per line at the three sizes, which is left as a question rather than fixed.

**Left as questions for Dan**, with the evidence, in
`docs/verification/layout-2026-09-09.md`: 216 characters per line at 1997x935;
whether the `game` panel still earns a bar slot now that the main window is
nearly the same thing; whether the twelve macros of the Actions panel deserve
to be permanently visible; and whether the AI worker's status should stay in
the rail.

### Lane P - The scene pane becomes the main window (Dan's correction to Lane O)

Dan, 10 September 2026, reacting to Lane O:

> I am quite sure I said to put the main window to the right. you need to
> figure out your art situation...you are going to get a godot screen with
> basically a modern ui...everything else you need to figure out on your
> own, because it still needs to be a good mud interface without that...
> right now you are random and broken...don't be random and broken.

**Why this is a new lane and not a reopened O2/O3.** The correction is not a
reversal of the corner placement, the divider, or the bottom bar - all three
stand. It is that Lane O defaulted the pane to `minimap`, a 380px preview
(10.2% of Dan's own window once the combat-growth measurement in Lane O's own
verification doc is backed out), and a preview that small cannot read as
"the main window" no matter what chrome Godot eventually brings to it. A row
added to O2/O3 would read as those rows having been wrong the first time,
when what happened is a second report from the same player narrowing what
"the right corner" was supposed to mean once Godot's own UI is part of it.

- [x] **P1  A fourth state, `docked`, and it is the new default** (~40)
  commit: (this PR) verified: 2026-09-10 minutes: 45
  touches: src/lib/scenePane.ts, src/App.tsx, src/components/layout/IconBar.tsx, src/lib/panelDataContracts.ts, src/components/dashboard/panels.tsx, tools/scene-pane-test.mjs, tools/play-first-layout-test.mjs, tools/play-first-layout-break-check.mjs
  depends-on: O3
  do: `docked` (new, default, the primary panel) joins `minimap` (demoted to a player's own smaller choice, not deleted), `popped` and `hidden` - build on O3's per-size storage rather than fork a second pane implementation beside it (CLAUDE.md section 0). `DOCKED_RAIL_W` replaces `SCENE_RAIL_W` as the default width, chosen as a share of the window so the text still clears `TEXT_WIDTH_FLOOR` (0.55) with real margin at every supported size; `MINIMAP_RAIL_W` keeps Lane O's old 380px number for the state it now describes. Combat growth (`COMBAT_GROWTH`) moves to apply to `minimap` only - applying it to `docked` as well pushed the text share under the floor at every size from 1180px up, measured directly. Both storage keys (`SCENE_PANE_KEY`, `RAIL_KEY`) bump a version so an install already sitting on the old small default actually re-defaults, rather than keeping a `minimap` value written under a meaning that changed out from under it (CLAUDE.md section 12, old data under a new meaning).
  verify: `npx tsc -b`; `node tools/scene-pane-test.mjs` - 24 checks; `node tools/play-first-layout-test.mjs` - 61 checks; `node tools/play-first-layout-break-check.mjs` - 5 sabotages, control first. Full record in `docs/verification/main-panel-2026-09-10.md`.
  done: the pane draws at 702px of a 1997px window by default with no press needed (was 380px/489px combat-widened under Lane O), and the text still holds 63.7%-74.8% of the window across all five supported sizes - comfortably above the 55% floor Dan's own first message established. The scene button's own tooltip now reads "the main panel" rather than "in the corner".

- [x] **P2  One coherent chrome across the three regions** (~30)
  commit: (this PR) verified: 2026-09-10 minutes: 30
  touches: src/components/shared/StatsPanel.tsx, src/components/shared/RiskBar.tsx, src/App.tsx
  depends-on: P1
  do: read every component that stacks in the right rail side by side rather than guess at "coherent" - `StatsPanel`, `RiskBar`, `AiWorkerPanel`, `BattleColumn`, `GameChatColumn`, `IconBar` - and fix only the mismatches actually found: `StatsPanel`'s TDP chip (`rounded-lg`) and `RiskBar`'s box (`rounded-xl`, `bg-surface-raised`) were outliers against every other card in the app (`rounded`, `bg-surface` for a chip inside an already-framed column); both now match. The scene-pane mount point in `App.tsx` had no outer frame at all, so the "primary panel" did not read as one coherent panel the way the left text column does - it now carries a `rounded border` matching frame, generic enough to host whatever chrome Godot's own UI eventually brings rather than assuming what is inside beyond "a scene/game view lives here" (`docs/NO-3D.md`: Godot is expanding, not shrinking out of this panel).
  verify: manual pass in a real browser at 1997x935 and 1200x850 against the demo character, recorded with the exact mismatches found (not assumed) in `docs/verification/main-panel-2026-09-10.md`.
  done: `ExperienceStrip`'s deliberate lack of border/background (Dan's own instruction, recorded in that file) was left untouched rather than "fixed" into false consistency - the two changes above are the two mismatches that were actually present, not a larger redesign invented to fill the brief.
  note: left as Dan's own call rather than decided here - whether the primary panel's default width (~480px at the app's own 1180px window) is the right proportion once Godot's real UI lands in it, since that UI is not built yet and this pass sized the frame for the room picture that exists today.

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
N1 ──► N3 ──► N4 ─┐
N1 ──► N5 ────────┼──► N6 ──► N7
N2 ───────────────┘        N2 ──► N8 (done; the N7 arrow was the §10 question, since answered)
N6 ──► Q1 ─┐──► Q2 ; Q1 ──► Q3 ; Q1 ──► Q4   (Q2, Q3, Q4 concurrent)
         └──► Q5 ──► Q6
```

N1 and N2 are independent of everything, including each other: two sessions can
start Lane N on the same day. N5 builds against the published interface, not
against N3's code, so it runs concurrently with N3 and N4.

---

## 8. Estimate

C 8 · A 8 · B 8 · D 7 · E 12 · F 14 · G 10 · H 8 · I 11 · J 2+ · K 6 · L 6 · M 3 =
**108 increments plus J's findings, ≈50 hours of unaided work**, plus waiting
on CI, downloads and the VM. Three sessions: Gate 0 in a day, Gate 2 in about
a week, Gate 6 in about three weeks. Gate 7 depends on beta weeks, not code.
Record actual `minutes:` on each `[x]`; the audit's `--tally` sums them so the
estimate can be recalibrated from data after Lanes C and A.

---

## 9. What the audit of version 2 found, and how

<!-- no-3d-history: an audit table recording what version 2 of this plan claimed and what was true on the day. Several rows name tools and manifests that PR #517 has since deleted; the rows are the record of the audit, not current instruction. -->

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

- **R-a — `burgle`.** The one activity intent with no specification, and the
  only one that is a product question rather than an engineering one:
  the client's own catalogue entry (`src/data/scriptCatalog.ts:351`, filed
  under "Risk & Consequence") says being caught means jail — a fine and lost
  time — or maiming in a clan house, and carries `verified: false`, meaning
  even that was inferred from the script's name rather than read from its
  source. `NEXT-50.md:495` calls it "the sole acknowledged unspecced intent" and
  states the rule that applies until it is answered — an enabled or promised
  button with no safe definition violates the product's truth rule. Recommend:
  **leave it declared and disabled**, which is what the client does today and
  is honest, and revisit only if a player asks for it. R8 is `[!]` on this
  line. *Undecided as of 9 Sep 2026.*
- **D0 — board slot.** Recommend (a): separate Godot window for 1.0; the slot
  shows the transcript and a compact viewer host card; the slot contract is
  written so docking (b) is a later increment. *Decided:* **(a), separate Godot window for 1.0**, 5 Sep 2026.
- **C7 — `rewrite/remove-2d`.** Recommend: rebase and PR the deletion half now
  (2D art out, `removed2d.tsx` throwing sites as the to-do list); keep
  `src/domain/*` + `docs/ADAPTERS.md` as a separate proposal PR reviewed on
  its own. *Decided:* **as recommended**, 5 Sep 2026; the rebase is the branch owner's work, C7 only records the question.
- **N-a — does the Genie config editor survive?** *Decided:* **no**, 6 Sep
  2026, by Dan: "we aren't using genie anymore … you have to implement
  correctly using lich." Carried out inside N6 rather than as its own lane,
  because leaving a sheet that edits another program's files beside a sign-in
  that no longer uses that program is the half-present state this question
  existed to avoid. Deleted: `src/components/config/` (the sheet and the
  highlights / aliases / macros / presets / substitutes / gags / variables
  editors), `useGenieConfigEditor.ts`, `genieConfigEdit.ts`, the macros,
  presets, substitutes, gags and variables modules and their hooks,
  `restore_genie_config` and `list_sounds` on the Rust side, and six `test:`
  scripts. Kept, and each for a reason that is not sentiment: **highlight
  rendering** (`highlights.ts` + `useHighlights`, read by `GameLineRow`,
  `HighlightedText` and `GameSignals`) and **alias expansion** (`aliases.ts` +
  `useAliases`, read by `GameCommandBar`) have runtime consumers that were
  never the editor; the **read-only importer** is what makes the move off
  Genie survivable and it does not write. Everything else in that subsystem
  had exactly one consumer and it was the sheet, so keeping it would have been
  a noodle to nowhere.
  The earlier recommendation on this line was "keep it, relabelled as an
  importer", and the previous attempt at N6 did relabel it and wrote a defence
  of the relabelling into the component. That is recorded rather than removed:
  it was a reasonable call on the evidence then available, and it was
  overruled by the person whose product it is.
  What this loses, stated plainly rather than left to be discovered: there is
  no in-app editing of macros, presets, substitutes, gags or variables at all
  any more, and no in-app editing of highlights or aliases. Re-implementing
  any of it **against Lich** — Lich has its own settings store and its own
  script surface — is a new increment nobody has written, not a regression to
  be quietly restored by re-adding the deleted files.
- **N-c — should the pin file live in a Genie folder?** `pinsFile.ts` writes
  `dr-companion-pins.yaml` into a Genie install's `Config` directory, which was
  the right call when a player certainly had one (Dan, 30 Aug 2026: pins
  "with the rest of their configurations"). After N6 a player may have no Genie
  install at all, in which case `write_genie_config` refuses and the export
  silently has nowhere to go. `saveGenieConfig` is now the app's only write
  into a Genie install, and `tools/doc-claims-test.mjs` asserts it has exactly
  one caller so a second cannot appear unnoticed. Recommend: **move it to the
  app's own data directory and offer the Genie folder as a second location for
  anyone who wants the shared-config behaviour.** *Decided:* **app data, and no
  second location**, 6 Sep 2026, by Lane Q, which owns the increment that does
  it (Q5). Half the recommendation is taken and half is refused, and the refused
  half is the point: offering the Genie folder as a second destination keeps
  `saveGenieConfig` alive for one optional case, and one optional caller is
  exactly how a write path nobody audits survives. The app writes pins and its
  whole player-config export into `app_data_dir()/config`, opens that folder
  with the existing `reveal_file` command so "where did it go" has an answer,
  and `src/lib/genieConfigWrite.ts` plus `write_genie_config` are deleted. The
  app then never writes into a Genie install at all, which is the property
  `config_import.rs`'s header held before 29 Aug 2026 and lost. A player who
  already has a pins file in a Genie folder gets it copied across on first run,
  with the original left where it is. Design and mapping:
  `docs/PLAYER_CONFIG.md` §8. ***Closed*** 6 Sep 2026 by Q5, as decided:
  `src-tauri/src/player_files.rs` publishes `read_player_file` /
  `write_player_file` / `adopt_genie_file` over `app_data_dir()/config`,
  `write_genie_config` and `src/lib/genieConfigWrite.ts` are deleted and the
  command deregistered, and `tools/doc-claims-test.mjs` asserts that nothing
  under `src/` names a Genie writer at all — the one-caller check it replaces
  would have passed forever once its caller was gone, which is the shape of a
  check that cannot fail. Read Q5's `done:` line before building on any of it:
  three things landed differently from this paragraph and are named there.
  Not folded into N6: N6 deleted a route, and moving a player's saved file is a
  migration with its own failure modes.
- **N-b — may the app store the player's password?** Lane N ships with the
  password **not stored** and typed each session, which needs no dependency and
  no decision. N8 would add an opt-in "remember me" using Windows Credential
  Manager via the `keyring` crate (MIT OR Apache-2.0, not currently a
  dependency), which `docs/SETUP-POLICY.md` makes an ask. Recommended **yes,
  opt-in, default off** — the alternative players reach for otherwise is
  writing it into a Genie or Lich config in the clear. *Decided:* **yes, opt-in,
  default off**, 6 Sep 2026. N8 is `[x]`: `keyring` 4.2.0 is a dependency, the
  box defaults to off, and Settings can forget the entry again.
- **F3 — signing.** Recommend unsigned for beta with a SmartScreen note;
  revisit at 1.0. *Decided:* **unsigned for beta**, 5 Sep 2026.
- **F4 — update check.** Recommend a "newer version available" link via the
  existing GitHub-releases fetch; no auto-install. *Decided:* **the link**, 5 Sep 2026.
  ***Superseded*** 9 Sep 2026 by Dan, in as many words — *"we need to build an
  updater, right?"* — and delivered as F16. The half of the 5 September
  reasoning that mattered survives intact and is now enforced in code rather
  than by not having the feature: nothing installs without an explicit press,
  "later" actually waits, and an install during a live game session needs a
  confirmation that says it will drop the character. See `docs/RELEASE.md` §2.2.
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
- **Branch protection on `main`** — *withdrawn 6 Sep 2026, premise gone.*
  This asked Dan to require the `checks`, `tauri` and `analyze` jobs before a
  merge. Those jobs no longer exist: he asked for Actions to be stripped from
  this repository the same day, on cost, and there is nothing left for a
  protection rule to require. Verification is `npm run gate` on the machine
  doing the merging (trap 21). Nothing enforces it, and saying so plainly is
  the honest state rather than leaving a recommendation here that reads as
  outstanding.
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

- [x] **C13  A ratchet on relative imports Node cannot resolve** (≈45)
  commit: (this PR) verified: 2026-09-05 minutes: 45
  touches: tools/import-extension-test.mjs, package.json, tools/test-suites.json
  depends-on: none
  do: unplanned. Trap 1 is the oldest entry in §1 and it was enforced by nothing, which is the state §12 of the working agreements says to end with a check. `tools/import-extension-test.mjs` parses every `.ts`/`.tsx` under `src/` with the TypeScript AST and refuses a relative specifier Node cannot resolve, in all four forms that carry one: `import`, `export ... from`, `await import()`, and a relative `.json` without `with { type: 'json' }`. The exempt/unsafe line was measured rather than reasoned, and the obvious blunt rule is wrong here: `tsconfig.app.json` sets `verbatimModuleSyntax`, so on node v24.19.0 `import type { T } from './dep'` runs and `import { type T } from './dep'` is `ERR_MODULE_NOT_FOUND` — Node keeps the statement and resolves it. Treating "every named binding is marked `type`" as erased would have let a real failure through. Scope is all of `src/`, `.tsx` included: only Vite loads those today, so the trap does not bite there yet, and it bites the first day a test imports a component, by which point the fix is 527 specifiers deep in files everyone is editing. This PR lands the check with every current violation allowlisted, so it blocks new ones the hour it merges instead of waiting behind a 171-file diff; C14 empties the list.
  verify: `node tools/import-extension-test.mjs` → `307 files, 927 relative specifiers, 703 unresolvable-by-node, 701 allowlisted`, `all passed`, exit 0; `node tools/run-tests.mjs` names `test:import-extensions` and the total rises by exactly its checks.
  sabotage: `./storage.ts` → `./storage` in `src/lib/aiEventJournal.ts` → `FAIL src/lib/aiEventJournal.ts:35 imports './storage' with no file extension`, exit 1. Restored, md5 `c532194d801a282bfc6361dd2ead6546` before and after. Four negative controls, because a check that flags everything is as empty as one that flags nothing: an extensionless `import type` (exit 0), a package import and an already-correct specifier (exit 0), an extensionless inline `import { type X }` (red, correctly — that is the form Node does not erase), and a stale allowlist entry (`no longer matches anything; remove it`). Both outside dependencies have an injection point so their unhappy branches can be run on purpose: `DRC_IMPORT_EXT_ALLOWLIST` at a missing file prints `NOT CHECKED` and exits 1 rather than passing, and `DRC_IMPORT_EXT_ROOT=tools` trips the floor with `only 10 file(s) and 13 relative specifier(s) examined`.

- [x] **C14  Empty the allowlist: every relative import in `src/` carries its extension** (≈50)
  touches: src/lib, src/components, src/store, src/bridge, src/data, src/types, src/App.tsx, src/main.tsx, tools/import-extension-test.mjs, tools/live-bridge-test.mjs, tools/room-test.mjs, tools/pins-test.mjs, tools/pins-file-test.mjs, tools/pin-nudge-test.mjs, tools/layout-test.mjs, tools/creature-art-test.mjs, tools/ai-worker-host-test.mjs, tools/build-third-party.mjs
  commit: (this PR) verified: 2026-09-05 minutes: 55
  depends-on: C13
  do: `node tools/import-extension-test.mjs --fix` rewrites the specifiers, and the mechanism is the point rather than the diff. It resolves each specifier against disk in TypeScript's own candidate order, edits right to left so an earlier edit cannot move a later offset, then re-parses the file and refuses to keep the write unless the specifier count is unchanged **and** every rewritten specifier still names the byte-identical path it named before. A wrong extension is a build error, which is the good case; a specifier that silently resolves to a different file is not, and only that second comparison sees it. The 46 directory imports (`../types`, `../bridge`) become `/index.ts`, not `.ts` — adding `.ts` to a directory would be exactly the silent miss the count guard exists to catch. The two relative `.json` imports without attributes are hand-edited, because adding `with { type: 'json' }` is a statement edit rather than a specifier one and the script says so rather than guessing. Then `--write` regenerates the allowlist to zero entries and it is deleted, along with the branch of the check that loads it. The fallout is the interesting half and it is the same defect one level out: **nine tools held a literal copy of a specifier**, and every one of them broke or quietly weakened. Six test harnesses transpiled `src/lib` into a temp directory and appended `.js` with a hand-rolled regex; `room-test.mjs` had already learned about explicit `.ts` extensions and written a paragraph about it, and the other five had not, so five suites went red at once - two things answering one question, drifted. The fix is not a seventh copy or a shared helper but `rewriteRelativeImportExtensions: true`, which tsc has owned since 5.7 and which leaves JSON attributes alone. `live-bridge-test.mjs` needed the two matching flags on its standalone `tsc` invocation, and its stub-swap regex was anchored to `'../lib/tauri'` through the closing quote. Two assertions matched an import literal the same way: `build-third-party.mjs` went red, and `ai-worker-host-test.mjs` had **one red and one silently vacuous** - a negative check reading `!/from './(gameActions|gameCommand)'/` that an extension would have made permanently, invisibly true.
  verify: `node tools/import-extension-test.mjs` → `308 files, 935 relative specifiers, 0 unresolvable-by-node`; `npx tsc -b` exit 0; `npm run build` exit 0; `node tools/run-tests.mjs` → `all passed`. The rewrite itself was checked by a script written separately from the one that performed it: 172 changed files, 172 identical-resolution, 0 divergent, 704 specifiers rewritten, 0 unresolvable. Then, independently, every one of the 704 changed diff lines was shown to differ from its predecessor **only** by an inserted extension - nothing else in `src/` moved.
  sabotage: `./storage.ts` → `./storage` in `src/lib/aiEventJournal.ts` → `FAIL src/lib/aiEventJournal.ts:35 imports './storage' with no file extension`, exit 1; restored, md5 `c532194d801a282bfc6361dd2ead6546` either side. And the second form, which C13 could only allowlist: strip `with { type: 'json' }` from `src/lib/mapZoneIndex.ts` → `FAIL src/lib/mapZoneIndex.ts:8 imports '../data/map/index.json' without with { type: 'json' }`, exit 1; restored, md5 `1e82272cfbd360b17ffe8017b5b803d5` either side. Controls unchanged from C13 and re-run against the allowlist-free check: a package import, an already-correct specifier and an extensionless `import type` together give exit 0 and no FAIL line, and `DRC_IMPORT_EXT_ROOT=tools` still trips the floor rather than passing on 10 files.
