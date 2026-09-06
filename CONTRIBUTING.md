# Contributing

## Before you merge anything: `npm run gate`

There is no CI on this repository. Actions is disabled and every workflow is
deleted, so `gh pr checks` reports nothing — which is indistinguishable from
checks that have not started yet. The whole gate is one command run by the
person merging:

```bash
npm run gate > /tmp/gate.log 2>&1; echo "gate exit: $?"; tail -20 /tmp/gate.log
```

**[docs/MERGING.md](docs/MERGING.md) is the ritual**: the worktree, the gate,
the rebase, the squash merge, deleting the remote branch when the local step
declines, and verifying by content rather than by SHA. It is one page, and it
is the only copy — this file points at it rather than repeating it, because two
documents describing one procedure disagree eventually and then both are wrong.

## The rest

- `docs/TESTING.md` — the suites, how to run one, and the negative suites the
  gate does not cover.
- `docs/PLAN_TO_1_0.md` — the shared plan. Claim an increment; do not re-plan.
- `AGENTS.md` — how several sessions work this tree at once without treading on
  each other.
- `docs/RELEASE.md` — the installer build.

## Two house rules worth knowing before your first PR

**A check that cannot fail is not a check.** Anything asserting a property
carries a floor on how much it checked, and a negative suite proving it can go
red. `tools/*-break-check.*` are those; every one of them is either run by the
full suite or named in `tools/gate.mjs`, and `tools/needs-env.mjs` fails if a
new one is added and registered nowhere.

**Stage by path.** Several sessions work this tree at once and the git index is
shared between worktrees, so `git add -A` and a bare `git commit` will take
somebody else's half-finished work. `git commit -m "..." -- <paths>`, then
`git show --stat HEAD` to see what actually went in.
