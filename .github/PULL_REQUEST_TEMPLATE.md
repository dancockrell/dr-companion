<!--
There is no CI on this repository. Nothing off the author's machine has run
anything against this branch, and `gh pr checks` reporting nothing looks
exactly like checks that have not started. The boxes below are the only
evidence a reviewer or a merger gets. Tick them because you ran the thing.
Full ritual: docs/MERGING.md
-->

## What and why



## Verification

- [ ] Rebased on `origin/main` **first**, then `npm run gate` was run on this
      branch after the last commit on it, and its final line read
      **`gate ok: 14 of 14 stages ran`** with the base it was about.
      Paste it below. (`node tools/gate.mjs --list` prints the stages. A
      `--only=` run is not the gate and says so.)
- [ ] The gate did not end on exit 3 — `gate ok (base …) — origin/main is now
      …`. That means `main` moved while it ran and the green is about a tree
      nobody is merging into. `node tools/gate.mjs --currency` re-asks in a
      second.
- [ ] Anything skipped or NOT RUN is named below with its reason. *A stage that
      could not run is not a stage that passed.*

```
paste the gate's summary block here
```

## If this touches a guard or a test

- [ ] The sabotage was run and the named check went red, and only the named
      check. Paste the red line and the restore-hash match.
- [ ] Any file the harness damages is restored, verified by hash, and
      `git status` is clean over those paths.

```
paste the sabotage output here
```

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
