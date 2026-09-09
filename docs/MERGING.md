# Merging

**There is no CI. `npm run gate` is the gate, and somebody has to run it.**

GitHub Actions is disabled for this repository (`gh api
repos/dancockrell/dr-companion/actions/permissions` → `enabled: false`) and
every workflow file is deleted, so nothing off this machine verifies anything.
`gh pr checks <n>` reports no checks, which looks exactly like checks that have
not started yet. Do not wait for them.

This page is the ritual. It is one page on purpose: a five-command list spread
across three documents is a list of which somebody runs three.

## The ritual

```bash
# 1. Your own worktree. Never merge from a checkout another session may be in.
cd /c/Users/Admin/dev/dr-companion
git fetch origin
git worktree add /c/Users/Admin/dev/wt-<id> -b <type>/<id>-<slug> origin/main
cmd //c "mklink /J C:\\Users\\Admin\\dev\\wt-<id>\\node_modules C:\\Users\\Admin\\dev\\dr-companion\\node_modules"

# 2. Rebase FIRST, on whatever landed while you were working.
cd /c/Users/Admin/dev/wt-<id>
git fetch origin && git rebase origin/main

# 3. The gate, AFTER the rebase. Redirect and read $? — a pipe reports the last
#    command's status, so `npm run gate | tail` is always a success.
DRC_TEST_PORT=<your port> npm run gate > /tmp/gate.log 2>&1; echo "gate exit: $?"
tail -20 /tmp/gate.log

#    If `main` moved while the gate was running, exit 3 says so. Rebase and
#    run it again. `node tools/gate.mjs --currency` asks the same question in
#    a second, without re-running anything.

# 4. Commit and push. Stage by path: the index is shared between worktrees.
git commit -m "<type>(<area>): <what and why>" -- <the paths you touched>
git show --stat HEAD | tail -n +2
git push -u origin <type>/<id>-<slug>

# 5. Open it, merge it, delete the branch.
gh pr create --fill
gh pr merge <n> --squash --delete-branch
```

## Gate after the rebase, not before

**The gate runs after the final rebase. Every time, not when the rebase looks
like it moved something.**

A branch's green gate is a statement about the tree it was cut from, and nothing
else. A check somebody added on another branch in the meantime is invisible to
it: your run never executed that check, so it cannot have passed it. That is not
a hypothetical — it is how PR #513 reintroduced the exact class #512 had just
fixed, and how PR #517 merged green while leaving the Rust build red, having
been gated before the deletion's consequences reached it.

The old rule here was "run the gate again if the rebase moved anything you did
not write". That is a judgement call, made at the moment somebody is most
impatient, about a question they cannot answer from the rebase output. The
branch-point gate is a courtesy to yourself — it catches your own mistakes
early. It is not the gate.

This is checked rather than promised. `npm run gate` records the base it ran
against (`git merge-base HEAD origin/main`), fetches at the end, and compares:

- base **is** `origin/main` → `gate ok: 16 of 16 stages ran (base <sha>)`,
  exit 0. This is the one you may merge on.
- base **is not** `origin/main` → `gate ok (base <sha>) — origin/main is now
  <sha>, re-run after rebasing`, **exit 3**. Nothing failed; every stage that
  ran is honestly green. The gate is refusing to call itself current, which is
  a different thing from calling itself red.
- git could not answer → it says so and does not claim to be current. A gate
  that cannot check must not pretend it checked, and must not block a merge
  over its own blindness either.

It writes the same facts to a small JSON artefact under `%TEMP%`, keyed by this
checkout's path — the summary names it — so "what was that green run about?"
has an answer after the scrollback is gone.

```bash
node tools/gate.mjs --currency   # the verdict alone, no stages, ~1 second
```

The three branches are runnable on purpose rather than waited for:
`DRC_GATE_BASE=<an old sha>` forces stale, `DRC_GATE_GIT=nope` forces unknown,
`DRC_GATE_NO_FETCH=1` compares without touching the network.

## What "the gate passed" means

The last line must read

```
gate ok: 16 of 16 stages ran
```

followed by the base it was a statement about. Both halves of the count matter. `16` is asserted against `EXPECTED_STAGES` in
`tools/gate.mjs` rather than against the list it came from, so a stage list
trimmed by an edit fails instead of printing a smaller number calmly. If your
change adds or removes a stage, change `EXPECTED_STAGES`, this page and
`.github/PULL_REQUEST_TEMPLATE.md` in the same commit —
`tools/doc-claims-test.mjs` checks that the three agree, so a stale number here
turns the gate red rather than quietly misinforming the next merger.

`node tools/gate.mjs --list` prints the stages and the things the gate
knowingly does not cover, each with its reason. Read that list rather than
assuming what ran.

Four outcomes, and only the first is a merge:

- **`gate ok`** (exit 0) — every stage ran and passed, over the current
  `origin/main`.
- **`gate NOT PASSED`** (exit 1) — something failed, or a stage could not run.
  *A stage that could not run is not a stage that passed*: a missing `cargo`
  means the Rust half was not checked, and merging on "the parts I have
  installed passed" is exactly what a CI runner used to make impossible.
- **`gate ok (base …) — origin/main is now …`** (exit 3) — nothing failed, and
  the result is out of date. Rebase and run it again. See the section above.
- **`no failures — but N thing(s) went unchecked`** (exit 0) — a suite declined
  a rule. Nothing failed, so this does not block a merge; read the skip and
  decide.

`--only=<stage>` re-runs one stage after a fix. Its summary says plainly that a
partial run is not the gate, and it is not a substitute for a full one before
merging.

## Two lanes may gate at once

Yes. `npm run gate` is safe to run while another lane is running it.

It was not, until issue #502. `npm run gate` runs `cargo test`, and the Rust
suite built its scratch directories from constant names under `%TEMP%`,
deleting them on the way *in* — so two test processes shared one directory and
each one's setup destroyed the other's fixture mid-test. Measured on
`0d34dff1`, running the built lib test binary from `src-tauri/`:

```
1 process   x  5 runs of vendor_tests     0 of   5 failed
6 processes x 25 runs of vendor_tests    54 of 150 failed
6 processes x 25 runs of bridge_token    54 of 150 failed
4 processes x  4 full-suite runs          2 of  16 failed
```

A single process was green every time. Every one of those reds was a false
red aimed at code that is fine, which costs a peer's time and a round trip to
withdraw.

The rule that keeps this true, and it is checked rather than promised:

> **Every test fixture must be unique to the process that made it.** A Rust
> test that needs a directory calls `crate::test_support::scratch_dir(label)`
> — unique per process *and* per call, deleted on drop, never on entry. A
> test that needs a port binds `127.0.0.1:0` and reads the port back.

`npm run test:rust-isolation` (`tools/rust-test-isolation-test.mjs`, part of
`test:all`, so the gate already runs it) reads every `.rs` file under
`src-tauri/src` and fails naming the file and line if a temp path is not
process-unique or a listener claims a fixed port. It prints how many sites it
examined and refuses to pass on a scan that found too few, so a broken scan
reports itself rather than reporting a clean tree.

**Still one `cargo build` at a time.** That ceiling is about the machine —
linking is what saturates it — and it is unchanged. This section is about
`cargo test`, which is now isolated; it is not permission to run two builds.

`DRC_TEST_PORT` is still per-lane: the JavaScript suites that bind a port read
it, and two lanes passing the same value collide there for reasons that have
nothing to do with the Rust suite.
## If `--delete-branch` fails

`gh pr merge --squash --delete-branch` prints `main is already used by
worktree` on this machine and merges anyway — that message is about the local
branch it declined to check out, not about the merge. The remote branch can
survive it. Check, and delete it by API if it did:

```bash
gh api repos/dancockrell/dr-companion/git/refs/heads/<branch> --silent 2>/dev/null \
  && gh api -X DELETE repos/dancockrell/dr-companion/git/refs/heads/<branch>
```

## Verify by content, not by SHA

A merge SHA answers *did a commit land*. It does not answer *is my change in
the file*, and those come apart whenever work moves between worktrees, gets
rebased, or is reconstructed by hand after a conflict. Fetch the file back from
`main` and grep it, with a control on the same fetch so a zero means something:

```bash
gh api repos/dancockrell/dr-companion/contents/<path>?ref=main --jq .content \
  | base64 -d > /tmp/landed.txt
grep -c "<the thing you added>"  /tmp/landed.txt   # must be > 0
grep -c "zzz-definitely-not-here" /tmp/landed.txt   # must be 0
```

Then remove your worktree — the junction first, or `git worktree remove` takes
`node_modules` with it:

```bash
cmd //c "rmdir C:\\Users\\Admin\\dev\\wt-<id>\\node_modules"
git -C /c/Users/Admin/dev/dr-companion worktree remove /c/Users/Admin/dev/wt-<id>
```

## Regenerating `src/lib/loginErrorFixtures.ts`

It is generated from the Rust types by `login_error.rs`'s
`the_fixture_is_the_real_serialisation`, and checked in. Regenerate it whenever
you add, remove or rename a `LoginCode`, or change any message an
`EAccessError` prints:

```
cd src-tauri && DRC_WRITE_LOGIN_FIXTURE=1 cargo test --lib login_error
```

**That run fails on purpose** (issue #488 §5). It rewrites the file and then
reports that it did, because a run that both repairs a drift and passes leaves
no trace of the drift anywhere - the pattern #464 gated everywhere else,
arriving in the test that guards the contract. Commit the regenerated file and
run the tests again *without* the variable; that pass is the proof the repair
worked.

Never hand-edit the file. `npm run test:login-fixture` compares it against the
Rust source in four directions - the code vocabulary, both sides of the
boundary, the rendering, and whether each message is a shape any Rust format
string can print - so a hand edit reddens on the TypeScript side, naming the
TypeScript file.

## Related

- `docs/TESTING.md` — what the suites are, and the negative suites the gate
  does not cover (`node tools/command-lane-break-check.mjs`,
  `python tools/sign-in-break-check.py`).
- `docs/RELEASE.md` — the installer build, which the gate deliberately skips.
- `docs/PLAN_TO_1_0.md` §2.4 — the increment ritual this sits at the end of.
