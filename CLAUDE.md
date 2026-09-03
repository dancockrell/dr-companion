# Instructions for AI agents working in this repository

## Rule 0 — Never fork. Solve the problem.

**In no case is an AI ever to fork — not in code, not in commits.** A problem is
always something to be solved, never something to be dodged. You are trusted to
use your own judgement, so use it.

When you hit something that does not work, you have exactly three legitimate
moves:

1. **Build on the existing solution.** Fix it, extend it, correct it in place.
2. **Replace it.** Delete the old implementation in the same change that
   introduces the new one, and move every caller across.
3. **Delete it and eliminate the feature.** Sometimes this is the best option.
   A feature that does not work and is not worth fixing should leave the
   codebase, not linger.

Forking is any move that leaves two answers to one question standing side by
side, and it is forbidden. Concretely, do not:

- add `thing_v2`, `thing_new`, `thing_ex`, or a "convenience" wrapper that
  duplicates an existing entry point instead of changing it;
- copy a file or a function to avoid editing the original;
- leave a parallel code path, flag or shim in place "for compatibility" when
  nothing outside this repository depends on it;
- leave branches, PRs or working copies to diverge and rot instead of merging
  or closing them;
- work around a broken component by routing past it and leaving it broken.

The failure mode this exists to stop: you do not want to step on something that
already works, so you quietly build a second path beside it. That is a noodle to
nowhere. Nobody can safely delete it later, because nobody can prove what still
depends on it.

If replacing something means changing many call sites, change them. If deleting
a feature means telling the user it is gone, tell them. Churn in one honest
change is cheaper than a second half-solution.

The one thing that is never acceptable is silently shipping both.

---

## The rest of the contract

This is a DragonRealms companion app: a Tauri/Vite/React front end over a Lich
bridge, with Python and TypeScript task tooling beside it.

- `docs/DESIGN.md` and `docs/DESIGN-BIBLE.md` — what the app is and how it is
  meant to feel.
- `docs/ENGINE.md`, `docs/DOMAIN.md`, `docs/BRIDGE_CONTRACT.md` — the runtime
  and the contract with the game bridge.
- `docs/TESTING.md` — how to prove a change. `npm test` runs the suite; the
  individual `test:*` scripts in `package.json` are the fast path.
- `docs/SETUP-POLICY.md`, `docs/PACKAGING.md`, `docs/RUNBOOK.md` equivalents —
  environment and release expectations.

Do not claim a check passed that you did not run. If the environment cannot run
it, say so plainly and say what you verified instead.
