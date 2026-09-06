<!--
There is no CI on this repository. Nothing off the author's machine has run
anything against this branch, and `gh pr checks` reporting nothing looks
exactly like checks that have not started. The boxes below are the only
evidence a reviewer or a merger gets. Tick them because you ran the thing.
Full ritual: docs/MERGING.md
-->

## What and why



## Verification

- [ ] `npm run gate` was run on this branch, after the last commit on it, and
      its final line read **`gate ok: 12 of 12 stages ran`**. Paste it below.
      (`node tools/gate.mjs --list` prints the stages. A `--only=` run is not
      the gate and says so.)
- [ ] Rebased on `origin/main`, and if the rebase moved anything I did not
      write, the gate was run again afterwards.
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
