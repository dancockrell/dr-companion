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
21. **`gh pr merge --auto` merges immediately here. It is not "merge when
    green".** `main` has no branch protection and no rulesets
    (`gh api repos/dancockrell/dr-companion/branches/main/protection` → 404,
    `.../rulesets` → `[]`), and auto-merge has no rule to wait for, so it
    merges on the spot. Measured on PR #318: merged 12:04:47, its `tauri` job
    finished 12:07:41 — nearly three minutes later. It passed, so nothing
    broke, and that is exactly why this is worth writing down: the mechanism
    is invisible until the day a job fails. Always
    `gh pr checks <n> --watch --fail-fast` first, confirm every row passes,
    and only then `gh pr merge <n> --squash --delete-branch`. Enabling branch
    protection would make the safe thing automatic; it is a repository setting
    and therefore Dan's to turn on (section 10).
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
| **N** | Lich-native login and frontend (no Genie) | new `src-tauri/src/eaccess.rs`, new `src-tauri/src/sal.rs`, `lich.rs`, `LichLauncher.tsx`, `WaitingForCharacter.tsx`, `tools/build-privacy-doc.mjs` | none |

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
| `src-tauri/src/lich.rs` | N3, N6 | N3 replaces `launch_args`; N6 removes `genie_status` and the note field. N3 first. Nobody outside Lane N edits it while either is `[~]`. |
| `src/components/shared/LichLauncher.tsx`, `WaitingForCharacter.tsx` | N5, N6, D2–D6 | N5 rewrites both, N6 sweeps what is left. Lane D waits for N6 `[x]` — its own increments only move these components, N's rewrites them. |
| `tools/build-privacy-doc.mjs`, `docs/PRIVACY.md` | N2 | N2 alone. The generated doc is never hand-edited; change the generator. |

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
| N | N3, N4 | `lane-n/n3-sal-launch` | `dev/wt-n3` | 2026-09-06 |
| N | N5, N6 | `lane-n/n5-sign-in` | `dev/wt-n5` | 2026-09-06 |

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
**N3 and N5 both depend only on N1, and N8 only on N2**, so two sessions can
pick this lane up now and a third can follow on N6. N1 published
`src-tauri/src/eaccess.rs` - read its header before N3 or N5, because it records
two corrections to the design document, one of them to the protocol itself.

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
#318, and now H8), with **H5** left `[!]`: it needs a model runtime this
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

**D6 is free to claim**, and needs one thing this fleet cannot supply on its
own: D5's measurements were all taken against the mock bridge, and D6 depends
on the new layout having survived a real play session. Whoever picks it up
should read D6's own `blocked-on` and `note` lines first — its `do:` as written
would remove the `'map'` panel id, which is still live. **J no longer waits on
D6** — that line used to stand here and was too strict. Triage needed only the
fact that `MAP_WINDOW_ENABLED` is already `false`, which is measurable today,
and none of #175's seven findings turned out to need the deletion to be judged.
J1's `note:` records the measurement. J2a–J2c touch none of D6's files.

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
  N1–N7 (N8 only with Dan's yes on a new Rust dependency).
  Check: `grep -c "kind === 'map'" src/App.tsx` → `0`; kill-switch suite (E5)
  green; a full play session recorded with viewer and AI absent, **signed in
  from this app with no other game client installed or running**;
  `git grep -ic genie -- src/components src-tauri/src/lich.rs src/lib/frontends.ts`
  → `0`.

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
- **Gate 3 — Viewer optional:** B4–B8, L1–L6.
  Check: `node tools/live-chain-check.mjs` passes against the running app;
  Crossing slice walk/stun/decay recorded.
- **Gate 4 — AI optional:** G0–G10, G12, H1–H8 (G11 only with Dan's yes — given
  6 Sep 2026, and G11 merged on it).
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
  touches: .github/workflows/ci.yml, new:src-tauri/installer-hooks.nsh, src-tauri/tauri.conf.json, tools/bundle-test.mjs, new:tools/vm-inventory.ps1, new:docs/verification/uninstall-2026-09-05.md, docs/verification/first-run-2026-09-05.md
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
  **One check is honestly NOT CHECKED and it is not a pass** (this paragraph said *two* until the NOT-CHECKED sweep of 5 Sep 2026 wired the TypeScript one; the reasoning below was right about `USER_DIR` being fixed at module scope and wrong about what follows from it, because `__dirname` moves with the file — a copy of the shipped runner in a scratch directory looks for tasks there, so the candidate runs out of process and nowhere near the player's tasks. Ruby is still skipped, and its reason is now itself checked: `no out-of-process Ruby runner exists, so the Ruby skip above is still true`, which fails the day somebody adds one.) E7's containment fixtures run a candidate out of process by redirecting `runner.USER_DIR`, and only `python/runner.py` allows that: `typescript/runner.ts` fixes `USER_DIR` at module scope, and a Ruby script is a Lich script that only Lich runs. Both print the reason and the thing that would have to change. Python's fixture run additionally executes E7's own known-good fixture first as its denominator, and downgrades the whole result to NOT CHECKED rather than condemning the candidate when the driver itself cannot run. #330 landed while this branch was open, so those skips reach the top-level summary rather than hiding inside a green suite. At the time that read `no failures, but 6 thing(s) went unchecked in 4 suite(s)`; after the NOT-CHECKED sweep (PR #340) it reads `no failures, but 1 thing(s) went unchecked in 1 suite(s): test:ai-script-repair` — still not `all passed`, which is the honest line and the one §0.5 should be read against.
  **Not wired into the app, and that is a stated gap rather than an oversight.** Two things are missing and neither is inside this increment's `touches:`. Nothing today tells the AI host that a *task* failed — the host ingests the game stream, and `pythonTasks.ts` / `nodeTasks.ts` report run outcomes to the UI and nowhere else — so there is no signal for the producer to count; and the port needs a Tauri-side implementation to read scripts, write into the real app data directory and shell out to the interpreters, which the browser cannot do. So the ports are optional on `WorkerDeps`, an absent one makes the job *fail saying it had nowhere to work* rather than silently doing nothing, and the wiring is filed as its own issue. The real caller today is the suite, which drives every path against real files and real interpreters. (An earlier draft of this note blamed Lane G's claim on `aiWorkerHost.ts`; G finished in PR #327 while this branch was open, so that reason is gone and the two above are the true ones.)
  verify (as done): `npm run test:ai-script-repair` → `94 passed, 0 failed, 1 not checked`, `all passed` (was `91 passed, 0 failed, 2 not checked`; the NOT-CHECKED sweep wired TypeScript E7 containment by running a copy of the shipped `typescript/runner.ts` out of a scratch directory, since `USER_DIR` is derived from `__dirname` and therefore moves with the file, and added a check that the remaining Ruby skip's stated reason is still true), including `ruby: THE ORIGINAL FILE IS BYTE-IDENTICAL  ddfffedcbb7b0d022ec9b3fa595ced71 -> ddfffedcbb7b0d022ec9b3fa595ced71` for all three languages, `ruby: the language check ran and passed on the candidate  ruby -c: pass Syntax OK`, `python: the E7 fixtures ran the candidate out of process  E7 containment fixtures: pass`, `typescript: the language check ran and passed on the candidate  tsc --noEmit: pass`, `an over-size script is refused rather than truncated`, `every path-shaped id is refused`, and `the privacy gate stops the call  privacy_gate: withheld: account password` with the note carrying the pattern name and never the value.
  sabotage (the one named): disable the post-job hash comparison → `FAIL the job aborts when the original changed under it` **and** `FAIL and records no claim about a file that moved`, `89 passed, 2 failed`. Restored, md5 `4bbe20a549a531b5f1ef981eebd36cce` either side.
  sabotage (mine, activation): delete the pre-write `validatePatchTarget` so a workspace aiming at the original is not refused until after the write → `FAIL the original is byte-identical and still its own text`, `90 passed, 1 failed`. Note which check did *not* go red: `the job refuses to write the candidate` still passed, because the post-write check caught it — the refusal happened, the script was already overwritten, and only the byte-identity check can tell those apart. Restored, md5 `4bbe20a549a531b5f1ef981eebd36cce` either side.

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
  touches: src/lib/mapPins.ts, src/components/shared/MapPinBar.tsx, tools/pins-test.mjs, tools/sound-actions-test.mjs
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
  touches: docs/THREE_D_REBUILD_HANDOFF.md
  depends-on: J1
  do: #175's finding 5 is confirmed exactly — 27 stamp kinds in `MapStampLayer.tsx`, 22 with two images, 4 with three, 1 with four, on an 85-zone map. It is real and it is not worth fixing here: §1 of the handoff retires the player-facing 2D map, so commissioning more 2D terrain art buys repetition relief on a surface that is going away. Add a contract line under the world-presentation section: the viewer's terrain and landmark presentation is judged on visible repetition across a zone, not on having one asset per kind, and a kind with a single motif is a gap to record rather than a kind that is done. Name `MapStampLayer.tsx`'s 27 kinds as the vocabulary being handed over.
  verify: the section exists and names the measured 22/4/1 split, so the number the viewer has to beat is on the page rather than in an issue comment.
  result: §12 "Terrain and landmark variety: the number to beat". It lists all 27 kinds by name in the three groups `MapStampLayer.tsx` actually uses, carries the 22/4/1 split and the 420-copy `settlement` cap over Crossing's 1,060 rooms, and states four rules — judged on visible repetition rather than one-asset-per-kind, a single-motif kind is a recorded gap, variation may come from placement/scale/rotation/material but never from borrowing another kind's asset (§11's rule), and 27 kinds at two variants each would be the same problem moved.

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
  pitfalls: two rooms (Paladins' Guild `1-804`/`1-866` and `1-805`/`1-867`) share exact map coordinates and overlap at any scale. That is a map-data defect rather than a layout one, so it is not folded into the gutter failure it cannot fix. It is no longer NOT CHECKED either: the NOT-CHECKED sweep made the two pairs an explicit `KNOWN_COINCIDENT` allowlist in `tools/primitive-world-manifest-test.mjs`, so a *third* duplicate fails instead of printing in the same harmless shape, and an entry that stops being coincident fails as stale. **Not verified on screen**: the Godot window is GPU-composited and would not screenshot for Lane B either, so this geometry is proved by measurement and by the tests, and the look still wants Dan's eye.

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
the code increments. N8 is optional and human-gated and blocks nothing.

- [x] **N1  EAccess protocol client in Rust, against a mock** (≈120)
  done: 2026-09-06 minutes: 95 — PR #441, `dev/wt-n1` off `origin/main` at `0dd67658`. `cargo test --lib` 187 passed (163 after N2, 24 new, all under `eaccess::tests`); `cargo test --lib eaccess -- --nocapture` prints `-- 8 frames asserted on the wire: K A M F G P C L`. `cargo clippy --all-targets -- -D warnings` and `cargo fmt -- --check` exit 0. Node suite `no failures`, 155 suites, 5773 checks, with the same two pre-existing NOT CHECKED lines as the baseline (this increment adds no Node suite). `node tools/plan-audit.mjs` `plan ok`, 131 increments, 393 paths. `npx tsc -b` exit 0. `docs/PRIVACY.md` is regenerated rather than hand-edited and its only change is the scanned-file counter, 340 to 341; leaving it stale fails `test:privacy`. **Rebased onto N2 rather than beside it.** N2 landed first and published `credentials::EACCESS_ENDPOINT` plus `eaccess_endpoint()`, saying in its own comment that N1 must read them rather than repeat them; so `eaccess.rs`'s own `DEFAULT_HOST`/`DEFAULT_PORT` were deleted and `endpoint()` is now a thin adapter over `credentials::eaccess_endpoint()`, and even the defaults case asserts against `EACCESS_ENDPOINT` rather than re-typing the literal. One change went the other way: `eaccess_endpoint()` returned a tuple and *silently* fell back to 7910 when `DRC_EACCESS_PORT` was set to something unparseable, which is a knob nobody could prove they had connected through, so it now returns `Result` and names the value it was given. `credentials.rs` and its one call site are edited for that and nothing else. All three sabotages reproduced and restored, `md5 1f3ae035046ad5f5c9d39f27eca5e9c8` before and after each: (1) `- 32` → `- 31` reddens exactly `the_obscured_password_on_the_wire_matches_the_formula` and `obscuring_is_reversible_with_the_same_key`, and nothing else — the mock never inspects the obscured bytes, which is what keeps the happy path green; (2) dropping the whole `M` step reddens 5, every one of them a case whose stated property is the frame order or the `M` check itself, while the happy path, the launch-data parse and the other error cases stay green — note that dropping only the `send` and leaving its `recv` reddens 12 of 24 and says nothing, so the sabotage is the step, not the line; (3) case-insensitive character matching reddens exactly `a_character_name_differing_only_in_case_does_not_match`. No test contacts a network: the one socket case connects to `127.0.0.1:7911` and asserts the refusal names 7911 and not 7910, which is the proof `DRC_EACCESS_PORT` reaches the socket. No login was attempted against the real server and no TLS probe was run against it either. **Two corrections carried in the module's header.** Ruby's `IO#puts` does not add a newline to a string that already ends with one, so the wire is a single `\n` per frame and not the `\n\n` this document's §2.1 and the `do:` below both assert — measured with Lich's own interpreter, `io.puts "K\n"` writes `[75, 10]`. And `login`/`list_characters` take `password: &str`, not `&Secret`: N2 owns `Secret`, two definitions of it would be a fork, and passing `.expose_for_obscuring()` at this boundary is what makes every use site greppable by one word, which taking `&Secret` here would lose. `lich_login_characters` is **not** registered by this increment — no Tauri command is, so `tools/tauri-command-callers-test.mjs` needs no `DEFERRED` entry; whichever of N3/N5 first needs it registers it.
  touches: new:src-tauri/src/eaccess.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml, src-tauri/Cargo.lock, src-tauri/src/credentials.rs, docs/LICH_NATIVE_LOGIN.md, docs/PRIVACY.md
  depends-on: none
  do: port §2 of `docs/LICH_NATIVE_LOGIN.md` exactly. Split I/O from protocol so the protocol is testable without TLS: `pub trait Transport: Read + Write`, `list_characters(&mut T, account, &Secret, game_code) -> Result<Account, EAccessError>` and `login(&mut T, account, &Secret, game_code, character) -> Result<LaunchData, EAccessError>`, plus a `TlsTransport` built on the `rustls`/`native-tls` stack Tauri already pulls in (check `Cargo.lock` first; **if neither is already a dependency, stop and add the ask to §10 rather than adding a crate**). Frames in order: `K`, `A\t<account>\t<obscured>`, `M`, `F\t<code>`, `G\t<code>`, `P\t<code>`, `C`, `L\t<char code>\tSTORM`, each `puts`-terminated so the wire bytes end `\n\n`. Obscuring is `out[i] = ((pw[i] - 32) ^ key[i]) + 32` on raw bytes; a password longer than the hashkey is a hard error naming the lengths, never a wrap or a truncation. `C` is parsed by stripping `^C\t\d+\t\d+\t\d+\t\d+[\t\n]` then scanning code/name pairs, matching the name case-sensitively. `L` must begin `L\tOK\t`; keys are kept UPPERCASE in `LaunchData` and their order preserved. Certificate validation is ordinary system roots — Lich's `simu.pem` pin is deliberately not reproduced, and `LICH_NATIVE_LOGIN.md` §3.1 says why. `DRC_EACCESS_HOST`/`DRC_EACCESS_PORT` exist only so a test can aim this at a mock.
  verify: `cd src-tauri && cargo test --lib eaccess` — a mock `Transport` replaying the exact byte sequence from Lich's source drives a full `login` to a `LaunchData` containing `GAMEHOST`, `GAMEPORT` and `KEY`, and the suite prints how many frames it asserted. Separately, a run with `DRC_EACCESS_PORT=7911` must fail **naming 7911**, which proves the override is read (a default that happens to work proves nothing).
  sabotage: (1) change `- 32` to `- 31` in the obscuring loop → only the obscuring case goes red, with the expected and actual bytes printed; (2) drop the `M` frame → only the sequence case goes red; (3) make `resolve_char_code` match case-insensitively → only the character-lookup case goes red. Assert **which** cases go red, not that something did: a sabotage that reddens three checks means the checks are entangled.
  pitfalls: 3 (a credential-shaped literal in a fixture — assemble it at runtime), 15, 16. **No real credential and no real login in this increment.** A bare TLS handshake against `eaccess.play.net:7910` with zero frames sent is permitted as a sanity check and is not required for `done`; if it is run, record the result in the claim.
  done-when: `cargo test --lib eaccess` green, all three sabotages reproduced and restored with matching `md5sum`, and no network call in any test.

- [x] **N2  Credentials, and a privacy doc that is true** (≈90)
  commit: (this PR) verified: 2026-09-06 minutes: 95
  done: 2026-09-06 — `dev/wt-n2` off `origin/main` at `0dd67658`. `Secret` is a newtype over `String` with a manual `Drop` that `write_volatile`s every byte to zero behind a `compiler_fence`, a `Debug` that prints `Secret(<redacted>)` and no `Display`, no `Deref`, and no derives at all — so the only way to the plaintext is `expose_for_obscuring`, which greps to one call site per use. That it cannot be serialised is a *compile* error rather than a test: a blanket `impl<T: Serialize> NotSerializable for T` beside `impl NotSerializable for Secret` conflicts (E0119) the moment anybody adds `Serialize`, which was reproduced. `zeroize` stays out, as the increment says. `EACCESS_ENDPOINT` is declared here once, with `eaccess_endpoint()` applying the two test-only overrides, so N1 reads it rather than repeating the host. The generator learned a second pattern — `ENDPOINT_HIT` picks lines carrying a `…_ENDPOINT` constant or a `connect` call, `ENDPOINT` reads `("host", port)` off them, and the host joins the same `hosts` map, so `unclassified` and `stale` cover a socket exactly as they cover a fetch with no second list to drift. Its own denominator (`ENDPOINT_FLOOR`) is printed, and the floors no longer throw under `--check`, which used to stop the run before the checks that name *which* host went missing. Both sabotages reproduced and restored by `md5sum`: removing the `DESTINATIONS` row gives `FAIL every host the scan found is described   eaccess.play.net`, and neutering `ENDPOINT_HIT` gives `FAIL the endpoint scan still matches declared sockets   0 line(s)` followed by `FAIL every host described is still in the source   eaccess.play.net` — 4 failed, so the stale branch really is reached rather than the run aborting first. Positive control: an undeclared `TcpStream::connect(("example.invalid", 1234))` in a scratch file under `src-tauri/src` made the generator exit 1 with `hosts found with no description: example.invalid` and `--check` exit 1 naming it. A fifth check (`no_logging_macro_mentions_a_secret_binding`) walks all of `src-tauri/src` and reports its denominators — 25 files, 151 output-macro sites, and the `#[cfg(test)]` lines it did *not* scan — with two matcher controls inline; a planted `eprintln!("obscuring {password}")` was caught, which is the inline-capture form that hides inside a string literal. `doc-claims-test.mjs` gained section K: the five retired sentences must be absent from every doc and every component (131 files, whitespace-flattened so the same sentence wrapped three ways is still one sentence), the replacement must be *present* in at least three of them, and "not stored" is checked against `persistence.ts`’s own 59 fields with a fixture control that flags `password` and spares `accountName`. Planting `password?: string` in `PersistedPrefs` reddened that one check and nothing else.
  note: the increment’s `touches:` named five paths and the sweep needed three more. `tools/doc-claims-test.mjs` carries the claim guard; `LichLauncher.tsx` and `SettingsSheet.tsx` are the two components that still asserted the app never sees the password, and a privacy claim left standing in the UI is read by more people than one left standing in a document. The `LichLauncher.tsx` edit is deliberately the two sentences and the header only — N5 rewrites that panel and should keep the sentence, which is quoted verbatim in three places on purpose so section K can check all three against one string. `accountName` is **not** added to `PersistedPrefs` here: nothing writes it until N5, and a field with no writer is a placeholder that reads as finished work, so the positive control for that matcher is a fixture rather than the real file.
  touches: new:src-tauri/src/credentials.rs, tools/build-privacy-doc.mjs, docs/PRIVACY.md, docs/ENGINE.md, src-tauri/src/lib.rs, tools/doc-claims-test.mjs, src/components/shared/LichLauncher.tsx, src/components/layout/SettingsSheet.tsx
  depends-on: none
  do: two halves, both about honesty rather than storage. (a) `credentials.rs`: a `Secret(String)` newtype with `Drop` overwriting the bytes in place, a `Debug` that prints `Secret(<redacted>)`, and no `Deref` to `&str` — callers ask for `.expose_for_obscuring()` so every use site is greppable. No new crate; `zeroize` would be a dependency ask for nothing this does not already do. (b) the doc: `build-privacy-doc.mjs` scans only for `https?://` (`:41-79` `HOST`), so a raw TLS socket to `eaccess.play.net:7910` is invisible to it and the generator throws `stale` (`:275-280`). **Do not write a fake `https://` into a comment to satisfy the regex** — that makes the source lie to pass a test. Teach the scanner a second pattern for a declared non-HTTP endpoint, add the `eaccess.play.net` entry to `DESTINATIONS` (`:98-170`), and rewrite the "short version" prose in the `md` template that currently claims *"your Play.net credentials are never sent anywhere by this app"*. Correct `docs/ENGINE.md:33-37` in the same pass — it says handling passwords first-party is "a line the project has deliberately stayed behind", and the line has moved.
  verify: `node tools/build-privacy-doc.mjs --check` exit 0; `grep -c "eaccess.play.net" docs/PRIVACY.md` ≥ 1; `grep -c "never sent anywhere by this app" docs/PRIVACY.md` → `0`; `node tools/doc-claims-test.mjs` green; `grep -rn "expose_for_obscuring" src-tauri/src | wc -l` prints every use site.
  sabotage: (1) delete the `eaccess.play.net` row from `DESTINATIONS` → `--check` exits non-zero naming it unclassified; (2) delete the new scan pattern → `--check` exits non-zero naming it stale. Both must be reproduced, because they are the two directions the generator checks and only one of them is the new code. Note `EXCLUDE = /test|127\.0\.0\.1|localhost/` matches the substring `test` anywhere in the rendered `path:line:text`, so a sabotage that lands in a line containing "test" or "latest" will be dropped silently and read as a pass — put the declaration where no such word appears and prove the sabotage reached the branch.
  pitfalls: 3, 15, 16.
  done-when: PRIVACY.md names the host, says what is sent, says the password is not stored by default and where it goes when it is, and no document anywhere still says the app never sees it.

- [~] **N3  The `.sal` launch file, and Lich started from it** (≈90)
  owner: lane-n/n3-sal-launch claim: wt-n3 since: 2026-09-06
  progress: the launch file, the launch itself and the measurement are done and
  merged. **The `lich_login_launch` command is not registered**, because it
  performs the EAccess login and `src-tauri/src/eaccess.rs` does not exist yet:
  N1 had no commits and no working-tree changes when this was built, so it was
  neither waited for nor worked around. Everything here that does not need
  `LaunchData` is built; the command is the whole of what is left, and
  `lich::launch_lich_with_launch_data(&[(String, String)])` is its entire body
  minus one call to `eaccess::login`, so finishing it is a wrapper rather than a
  design. `sal::write_temp` takes `&[(String, String)]` rather than `&LaunchData`
  on purpose: that is `LaunchData`’s own inner type, so N1 owns the type and this
  module needs no second copy of it (`CLAUDE.md` §0).
  touches: src-tauri/src/sal.rs, src-tauri/src/lich.rs, src-tauri/src/lib.rs, src-tauri/src/game_link.rs, docs/verification/lich-sal-launch-2026-09-06.md
  depends-on: N1
  do: `sal::write_temp(&LaunchData) -> PathBuf` writes `KEY=…` and the rest one `UPPER=value` per line into a random 16-hex basename in the app's own temp directory — never the repo, never Lich's `TEMP_DIR` — and `sal::shred(path)` removes it. Replace `lich::launch_args` (`lich.rs:517-556`): the character branch becomes `[<sal path>, "--headless=11024", "--start-scripts=companion_bridge"]` and drops `--login`, `--dragonrealms` and `--stormfront`, all three of which the launch file now supplies (`GAMECODE=DR` at `main.rb:225-231`). Keep `--headless=` rather than the expanded pair: it is one token, it is what already ships, and `arg_normalization.rb:33-35` refuses to combine it with an explicit `--detachable-client`, so the existing `opens_the_detachable_client_port` assertion (`lich.rs:640-651`) stays valid unchanged. Add the `lich_login_launch` command per `LICH_NATIVE_LOGIN.md` §8 — it returns `{ pid, port }` after spawning, and shreds the `.sal` when `game_attach` reports the socket up, on a timeout, and at process exit. `DRC_LICH_DRY_RUN=1` writes and shreds the file and reports the argv without spawning. **The password never appears in argv**: a Windows command line is readable by any process of this user.
  verify: **not a reading of `arg_normalization.rb`** — start real Lich with a hand-written `.sal` carrying a deliberately invalid `KEY`, then `netstat -ano | grep LISTENING | grep :11024` shows Lich listening. That is the measurement `LICH_NATIVE_LOGIN.md` §7 item 2 asks for: it proves `--headless` normalisation runs on the `.sal` path, and it needs no valid account because the port opens before the game key is used. Kill that Lich **by the PID you started**, never by image name (§1 trap 12). Then `cargo test --lib sal` green and `DRC_LICH_DRY_RUN=1` reporting the argv with the `.sal` path first.
  sabotage: (1) omit `GAMECODE=` from the written file → Lich exits printing `error: launch_data contains no GAMECODE info` (`main.rb:232`), and the test asserts that exact string rather than a non-zero exit; (2) make `shred` a no-op → the leftover-file check goes red naming the path. Sabotage (1) proves the file reaches Lich's reader at all, which a green launch alone does not.
  pitfalls: 8, 9, 12, 14 (the `.sal` content and the temp path contain backslashes — write those files with Write/Edit or build them with forward slashes, never a heredoc), 16.
  done-when: a `.sal` produced from a `LaunchData` starts Lich, 11024 listens, and `stat` says the file is gone afterwards.

- [ ] **N4  Attach, and measure what the frontend identity actually buys** (≈75)
  touches: tools/fake-lich.mjs, src/lib/frontends.ts, tools/frontend-test.mjs, src-tauri/src/game_link.rs
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
  prefix now. The password is not stored, no "remember my password" control is
  rendered while N8 is `[!]`, and the false claim is replaced by the true
  sentence: "Your password is used once to sign in and is not stored."

- [ ] **N6  Delete Genie from the connection path, everywhere** (≈90)
  touches: src-tauri/src/lich.rs, src-tauri/src/lib.rs, src/lib/frontends.ts, tools/frontend-test.mjs, src/types/index.ts, src/store/useAppStore.ts, docs/BRIDGE_CONTRACT.md, lich-scripts/companion_bridge.lic, src/components/game/GameConnectionBar.tsx, src/components/dashboard/Dashboard.tsx, src/data/instances.ts
  depends-on: N4, N5
  do: remove `genie_status` (`lich.rs:412-425`) and its registration (`lib.rs:153`); the Genie sentence in the `LichStatus` note (`lich.rs:490-497`); the `genie` branch of `frontends.ts` and its case in `frontend-test.mjs`; `'genie'` from the frontend union (`types/index.ts:40`) and from `useAppStore.ts:37-38`; the Genie comments in `companion_bridge.lic`; and the two topology claims in `BRIDGE_CONTRACT.md:8-10, :117-121`, the first of which ("It must not parse the game stream itself") has been false since `gameStream.ts` shipped. Also retire the four extra places the frontend retypes `11024` (`GameConnectionBar.tsx:34`, `Dashboard.tsx:150`, `instances.ts:41`, and whatever survives in `WaitingForCharacter.tsx`) in favour of the port `lich_login_launch` returns — `lich.rs:107` already claims to be "one number in one place" and is not.
  **Out of scope, deliberately, and each for a reason stated in `LICH_NATIVE_LOGIN.md` §6:** `genie_pos`/`genie_id`/`genie_zone` in `src/bridge/types.ts` are Lich map fields that carry Genie's name and deleting them deletes map coordinates; the whole Genie config-editor subsystem (`genieConfigEdit.ts`, `config_import.rs`, the highlights/aliases/macros/variables/presets/substitutes/gags/keybindings modules and editors, the Genie detection in `setup.rs` and `sounds.rs`) and `genie-plugin/` are a shipped feature whose retirement is a product decision, filed in §10. This increment adds one sentence in the config importer's UI saying it reads Genie's own files and has nothing to do with signing in — so a player is not left wondering why Genie is half-present.
  verify: `git grep -ic genie -- src/components src-tauri/src/lich.rs src/lib/frontends.ts src/types/index.ts src/store/useAppStore.ts` → `0`; `node tools/tauri-command-callers-test.mjs` green; `node tools/frontend-test.mjs` green with a lower check count and the new count stated in the claim; `npm run test:bridge`-family suites green; full suite `all passed`.
  sabotage: none — this is a deletion. Its guard is the `git grep -ic genie` in Gate 1's check, which fails the moment any of it comes back.
  pitfalls: 10 (stage by path; this touches eleven files and `git add -A` would sweep another lane), 17 (do not leave a "legacy Genie sign-in" anywhere), 20.
  done-when: the grep is zero and nothing in the app mentions Genie except the config importer, which says what it is.

- [!] **N7  Live sign-in with Dan's real account** (≈30 of his time)
  blocked-on: a human. This increment cannot be done by any session: it needs Dan's real Play.net account and password typed into the running app, and no fixture on this machine can substitute for the one thing being proved — that the protocol in §2 of `docs/LICH_NATIVE_LOGIN.md` is right against the real server. No session may ask for the credential, hold it, or type it.
  touches: none
  depends-on: N4, N5, N6
  do: the exact steps, for Dan, in order. (1) Build and run the app. (2) Open the sign-in screen; type the account name and password; choose **DragonRealms**. (3) Confirm the character list that appears is his real list — this is the `C` reply and it proves the login half. (4) Pick Phemius. (5) Confirm the game text appears in the transcript within a few seconds, and that `,` is no longer the Lich command character — `;companion_bridge` is. (6) Confirm the channel tabs behave as N4's measurement said they would. (7) Close the app; confirm nothing under `%LOCALAPPDATA%` contains the password (`Select-String` for it across the app's data directory, run by Dan on his own machine, result reported as a count and not as text). (8) Say whether "remember my password" is wanted at all, which is N8's gate.
  verify: `docs/verification/lich-native-login-<date>.md` records steps 3, 5, 6 and 7 with what was seen, and step 7's count as `0`.
  done-when: that doc exists and step 7 says zero.

- [!] **N8  Optional: remember the password in Windows Credential Manager** (≈60)
  blocked-on: Dan's yes on a new Rust dependency. `keyring` (MIT OR Apache-2.0) is not in `src-tauri/Cargo.lock` — `grep -in "^name = \"keyring\"" src-tauri/Cargo.lock` returns nothing — and `docs/SETUP-POLICY.md` is ask-before-install. Also blocked on N7 step 8: if Dan does not want the feature, this increment is dropped rather than built.
  touches: src-tauri/Cargo.toml, N2>src-tauri/src/credentials.rs, N5>src/components/shared/SignIn.tsx, tools/build-privacy-doc.mjs, docs/PRIVACY.md
  depends-on: N2, N7
  do: store the password under a per-account entry in Windows Credential Manager through `keyring`, behind a checkbox that defaults to **off**. Never a settings file, never obfuscated bytes on disk — `LICH_NATIVE_LOGIN.md` §5.2 says there is no third option and means it. Removing the account must remove the credential; so must the uninstaller's "delete application data" path, alongside the four bearer files E3 found. Update PRIVACY.md through its generator.
  verify: with the box unticked, the credential store has no entry for the account after a full sign-in (checked by `cmdkey /list` filtered to this app's target name); with it ticked, exactly one; after removing the account, zero again.
  sabotage: make the delete path a no-op → the third check goes red naming the surviving target.
  pitfalls: this is the only increment in the lane that ships a stored secret. If it is not built, **nothing else in the lane changes** — not storing the password is the shipped default, and N5 does not render the checkbox until this is `[x]`.
  done-when: the three counts above are 0, 1, 0, measured with `cmdkey`.

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
  touches: src/lib/presentationBridge.ts, src/lib/presentationTypes.ts, tools/build-primitive-world-manifest.mjs, tools/build-godot-mock-fixture.mjs, godot/mock/crossing_mock_world.json, godot/tests/content_registry_test.gd, godot/tests/cell_click_target_test.gd, godot/tests/cell_detail_window_test.gd, new:src/lib/worldContent.ts, new:src/lib/world-content-rules.d.mts, new:tools/world-content-loader-test.mjs, package.json, tools/test-suites.json, docs/PLAYER_DATA.md, docs/PRIVACY.md
  depends-on: M1
  do: `compileWorldSnapshot` publishes `boardLayoutFor({})` for every cell, so no live room has ever been an interior. Load the zone's content manifest and pass the classification through, so the live path and the Crossing art path take content from one place. Source `build-primitive-world-manifest.mjs`'s cells from `src/data/map` + `src/data/world` rather than from the place briefs, which is what limits it to the 1,060 described Crossing rooms today.
  verify: the regenerated mock fixture still passes `test:godot-fixture-contract`; a forest zone and a cave zone compile to cells with the right block kinds.
  done-when: the Crossing renders from the pipeline rather than from the hand-made classification, and a zone with no authored prose renders at all.
  done: the art manifest builds for **any** zone — Crossing 1,060 cells (was 975, the rest having no authored place description), Boar Clan 666, Hibarnhvidar 513, where before it threw `No mapped room cells found for zone <n>` for 83 of 85. On the live path a Crossing interior now publishes a 3 m block against an outdoor room's 1 m, measured over 933 rooms; before this every cell in every zone published `boardLayoutFor({})` and the `interior-cutaway` branch was unreachable outside the offline Crossing manifest. `test:world-content-loader`, 9 checks. Full suite 156 suites, 5,775 checks, no failures.
  pitfalls: three GDScript cases went red and none of them was a viewer change. All three pair an ordinary cell against an interior cutaway, naming `1-16` for the tall one — Town Green South, an interior under the lore classification and a park under the batch. The pair was still two cells and had stopped being a pair, so the checks compared 1 m against 1 m. Hardcoding an id is a claim about a fixture that nothing keeps true, so the generator states the requirement, grows the slice by the *nearest* cell meeting it (Milgrym's Weapons Showroom and the Clerics' Guild Chapel; 18 cells to 20), publishes the ids under `guarantees`, and aborts rather than emitting a fixture that cannot satisfy one. The first version of that grew the neighbourhood until it qualified and took the mock from 19 cells to **575**, which is not a mock.
  note: `worldContent.ts` calls `import.meta.glob`, a Vite build-time transform and a plain TypeError under bare Node, so the bridge reaches it through a lazy import guarded on there being a zone at all. A static one took `tools/presentation-bridge-test.mjs` (103 checks over the pure compiler) down with it, and an unguarded dynamic one broke `tools/viewer-absent-test.mjs`'s "publishing with no world does not throw". The pure half of the bridge stays runnable outside Vite; only the publication path, which already needs Tauri, reaches for the loader.
  sabotage: put `board: boardLayoutFor({})` back → `FAIL a live interior publishes a taller block than a live outdoor room  interior 1 m, outdoor 1 m across 933 rooms`, restored md5 `26b301268ea8`. Delete `guarantees` from the committed fixture → three GDScript scripts red, `224 checks` against `274`, restored md5 `f3eef178cae8`.

- [ ] **M4  A named street should not render as two grounds** (≈40)
  touches: src/lib/world-content-rules.mjs, tools/build-world-content.mjs, src/data/world
  depends-on: M1
  do: measured over the shipped content, 147 of the 2,199 places holding two or more rooms have rooms that disagree about their ground kind, covering 1,243 rooms — "Via Iltesh" is street in `1-12` and grass in `1-13`, both decided by neighbour propagation, and they are the same street. 90 of the 147 have no directly-decided room at all. A cohort pass that unified every same-`place` group would be wrong: `place` is also the room's own sub-name, so "Bar", "Lounge" and "Entrance" recur across unrelated buildings and 10 zones share a "Tunnel". Unify only rooms of one place that are connected to each other without crossing a threshold, and only where propagation rather than a title decided them.
  verify: the split-cohort count falls, the unknown share does not rise, and the exit-graph adjudication in `--control` does not fall.
  done-when: a street named once renders as one street.

- [x] **M3  Capture a zone that has never been rendered** (≈20)
  commit: (this PR) verified: 2026-09-06 minutes: 35
  touches: new:docs/verification/world-content-2026-09-06.md, new:docs/verification/world-content-2026-09-06-boar-clan-forest.png, new:docs/verification/world-content-2026-09-06-hibarnhvidar-cave.png
  depends-on: M2
  do: `tools/viewer-snapshot-server.mjs --room <id>` against a forest zone and a cave zone, per `docs/verification/token-height-2026-09-06.md`. Save the captures and say what is on screen.
  verify: two captures in `docs/verification/`, each with a sentence about what it shows.
  done-when: somebody who was not there can see that the batch produced a board.
  done: Boar Clan `127-186` (Paasvadh Forest, Understory; 666 cells) and Hibarnhvidar `116-114` (Inner Hibarnhvidar, Upper Cavern; 513 cells) — the first captures of any zone but the Crossing in this repository. Boar Clan is a flat green board of 1 m blocks on terrain planes (199 forest, 123 grass of 666); Hibarnhvidar is brown 3 m cutaway blocks (296 interior, 95 cave of 513). Nothing in the viewer differs between the two captures. The rig's own five `FIXTURE` tokens are in both; `capture-godot-window.ps1` refused three times with "window did not take foreground" before the second capture, so both are pictures of the window they name, and each viewer and rig was killed by the pid it was launched with.
  pitfalls: the boundary kit draws as the matte fallback slab in both, because `godot/shared-assets` is not initialised in this worktree. That is a missing asset and the viewer says so on the console; it is not a missing classification, and the doc says which.

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
N1 ──► N5 ────────┼──► N6 ──► N7 ──► N8
N2 ───────────────┘        N2 ──► N8
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
- **N-a — does the Genie config editor survive?** Genie is gone from the
  connection path (Lane N). It is *not* gone from the app: `genieConfigEdit.ts`,
  `genieConfigWrite.ts`, `useGenieConfigEditor.ts`, the highlights / aliases /
  macros / variables / presets / substitutes / gags / keybindings modules and
  their editors, `src-tauri/src/config_import.rs`, the Genie install detection in
  `setup.rs` and `sounds.rs`, and the C# `genie-plugin/` are a shipped feature
  that reads a player's *existing* Genie files. Whether "we aren't using genie
  anymore" retires that too is a product call, not a connection one, so Lane N
  deliberately leaves it alone rather than half-deleting it. Recommend: **keep
  it, relabelled as an importer** — a player moving off Genie wants their
  twenty highlights and forty macros to come with them, and the code already
  works; retire it once nothing has read a Genie file for a release or two.
  *Undecided as of 6 Sep 2026.* If the answer is "delete it", that is its own
  lane and its own PR, not an appendix to N6.
- **N-b — may the app store the player's password?** Lane N ships with the
  password **not stored** and typed each session, which needs no dependency and
  no decision. N8 would add an opt-in "remember me" using Windows Credential
  Manager via the `keyring` crate (MIT OR Apache-2.0, not currently a
  dependency), which `docs/SETUP-POLICY.md` makes an ask. Recommend: **yes,
  opt-in, default off** — the alternative players reach for otherwise is
  writing it into a Genie or Lich config in the clear. *Undecided as of
  6 Sep 2026*; N8 stays `[!]` until answered, and nothing else in the lane waits
  on it.
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
- **Branch protection on `main`** — the one item here that is not a
  recommendation because it is not mine to make. `main` has no protection and
  no rulesets, so nothing requires CI to pass before a merge and
  `gh pr merge --auto` merges on the spot rather than waiting (trap 21; PR
  #318 merged three minutes before its `tauri` job finished). Every lane is
  told to watch the checks by hand, which works and depends on everyone
  remembering. A protection rule requiring the existing `checks`, `tauri` and
  `analyze` jobs would make the safe path the only path, at the cost of
  needing a pull request for every change to `main`. Turning it on is a
  repository setting and yours. *Decided:* —

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
