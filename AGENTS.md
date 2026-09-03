# AI Repository Operating Instructions

## Non-negotiable: never fork the implementation

AI agents are not authorized to create or use a fork as a way to perform repository work. There must be one product, one implementation of each behavior, and one continuously reconciled history.

This prohibition includes:

- creating a repository fork, alternate worktree, new branch, or parallel commit lineage to avoid working with the current code;
- building a second component, service, store, listener, command path, asset catalog, or “V2” beside an existing one because integration is difficult;
- preserving two competing implementations “for safety” instead of choosing and completing one;
- evading a merge conflict, failing test, design inconsistency, or architectural problem by routing around it;
- abandoning incomplete work in a disconnected branch or noodle-to-nowhere code path.

Required behavior:

1. Work in the existing checkout and on its current shared branch. Normal small, coherent commits on that branch are required; an alternate history is not.
2. Fetch and inspect current shared work before changing overlapping code. Treat concurrent work as material to reconcile, not territory to avoid.
3. Solve the problem in the existing product. Build on the current solution, deliberately replace it, or delete it and remove the feature when deletion is the better product decision.
4. When implementations conflict, compare them in the real application and with focused tests. Keep the strongest ideas, merge compatible behavior, select one owner, and remove superseded paths.
5. Preserve user-authored data and public contracts unless the task explicitly changes them. Never force-push or discard another contributor’s work merely to make integration easier.
6. Commit and push verified checkpoints frequently so the shared branch remains the place where the product exists.
7. If a genuine external blocker remains, document the exact blocker and the best in-place next action. Do not create an alternate implementation to make the blocker disappear from view.

Difficulty is a reason to reason, test, and integrate more carefully. It is never permission to fork.

## Shared working standard

### Start from reality

- Read this file completely before making changes.
- Inspect the current branch, working tree, remote state, open review work, and relevant tests before deciding what the product needs.
- Treat uncommitted and concurrent changes as owned work. Understand them and preserve them unless replacement or deletion is explicitly justified.
- Prefer evidence from the running product, authoritative data, and focused tests over assumptions or stale plans.

### Keep one clear owner

- Every behavior, state transition, command path, visual region, schema, and asset record must have one authoritative owner.
- Extend that owner when possible. If ownership must move, migrate callers, data, tests, and documentation, then remove the former path in the same coherent change.
- Do not add compatibility shims, fallbacks, mocks, or aliases without an explicit retirement condition. Release behavior must never silently depend on a development fallback.
- Preserve stable public IDs and interfaces unless the task deliberately changes the contract and updates every consumer.

### Resolve conflict as product work

- Fetch before editing shared surfaces and again before publication.
- When concurrent ideas overlap, compare behavior and acceptance criteria—not author names or timestamps.
- Test competing ideas in the real application when visual, interaction, performance, or accessibility quality is at issue.
- Merge complementary strengths, choose one final implementation, and delete obsolete code and documentation. Never leave both paths active because choosing is uncomfortable.

### Make truthful, complete changes

- Never claim success, connectivity, persistence, completion, or live data before the authoritative layer confirms it.
- Keep the last known good state visible when recovery is possible; use an honest neutral fallback when it is not.
- A user-facing control is not complete until its action, disabled state, feedback, keyboard behavior, and failure behavior are wired and tested.
- Finish vertical slices. UI without authoritative behavior, backend behavior without a usable surface, and assets without runtime admission are incomplete work.

### Verify in proportion to risk

- Run the smallest focused check while iterating, then the repository’s relevant full gates before publication.
- Validate behavior, not merely compilation: exercise the changed workflow, failure path, persistence boundary, and restart or recovery path where relevant.
- For visual changes, inspect the rendered result at realistic sizes and states. Check overflow, contrast, focus, pointer and keyboard use, loading, empty, error, and dense-data cases.
- Report checks precisely. Distinguish passed, failed, not run, pending remote CI, committed, pushed, and merged.

### Protect assets and content

- Admit assets through the repository’s manifest, provenance, license, quality, and runtime-loading contracts; do not drop unexplained binaries into shipping folders.
- Record source, authoring lineage, license evidence, checksums, technical dimensions, style tags, review state, and intended reuse boundary.
- Reuse vetted shared assets before acquiring substitutes, but judge fitness in the target scene. Shared does not mean automatically appropriate.
- Preserve approved art and user content. Keep candidates reversible until compared in the real application, then remove rejected or unreachable payloads safely.

### Keep history useful

- Make small, coherent, independently verifiable commits that state the product outcome.
- Do not mix unrelated cleanup into a functional change.
- Before each commit, inspect the diff, run whitespace and secret checks, and confirm generated or binary files are intentional.
- Push verified checkpoints frequently. Never force-push shared history, bypass required checks without documenting the exact reason, or describe local work as shipped.

### Leave the product cleaner

- Remove superseded code, dead flags, abandoned assets, stale instructions, and duplicate ownership as part of completing a replacement.
- Update nearby tests and documentation when a contract changes.
- If deletion is the best product decision, delete the feature completely and repair its callers rather than leaving a disabled shell.
- End with a clean working tree or a precise account of intentionally preserved user work.
