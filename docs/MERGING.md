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

# 2. The gate. Redirect and read $? — a pipe reports the last command's status,
#    so `npm run gate | tail` is always a success.
cd /c/Users/Admin/dev/wt-<id>
DRC_TEST_PORT=<your port> npm run gate > /tmp/gate.log 2>&1; echo "gate exit: $?"
tail -20 /tmp/gate.log

# 3. Rebase on whatever landed while you were working, then run the gate again
#    if the rebase moved anything you did not write.
git fetch origin && git rebase origin/main

# 4. Commit and push. Stage by path: the index is shared between worktrees.
git commit -m "<type>(<area>): <what and why>" -- <the paths you touched>
git show --stat HEAD | tail -n +2
git push -u origin <type>/<id>-<slug>

# 5. Open it, merge it, delete the branch.
gh pr create --fill
gh pr merge <n> --squash --delete-branch
```

## What "the gate passed" means

The last line must read

```
gate ok: 12 of 12 stages ran
```

Both halves matter. `10` is asserted against `EXPECTED_STAGES` in
`tools/gate.mjs` rather than against the list it came from, so a stage list
trimmed by an edit fails instead of printing a smaller number calmly. If your
change adds or removes a stage, change `EXPECTED_STAGES`, this page and
`.github/PULL_REQUEST_TEMPLATE.md` in the same commit —
`tools/doc-claims-test.mjs` checks that the three agree, so a stale number here
turns the gate red rather than quietly misinforming the next merger.

`node tools/gate.mjs --list` prints the stages and the things the gate
knowingly does not cover, each with its reason. Read that list rather than
assuming what ran.

Three outcomes, and only the first is a merge:

- **`gate ok`** — every stage ran and passed.
- **`gate NOT PASSED`** — something failed, or a stage could not run. *A stage
  that could not run is not a stage that passed*: a missing `cargo` means the
  Rust half was not checked, and merging on "the parts I have installed passed"
  is exactly what a CI runner used to make impossible.
- **`no failures — but N thing(s) went unchecked`** — a suite declined a rule.
  Nothing failed, so this does not block a merge; read the skip and decide.

`--only=<stage>` re-runs one stage after a fix. Its summary says plainly that a
partial run is not the gate, and it is not a substitute for a full one before
merging.

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

## Related

- `docs/TESTING.md` — what the suites are, and the negative suites the gate
  does not cover (`node tools/command-lane-break-check.mjs`,
  `python tools/sign-in-break-check.py`).
- `docs/RELEASE.md` — the installer build, which the gate deliberately skips.
- `docs/PLAN_TO_1_0.md` §2.4 — the increment ritual this sits at the end of.
