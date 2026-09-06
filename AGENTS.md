# NO-FORK RULE — READ THIS FIRST

AI contributors must never fork the product, repository, implementation, code path, subsystem, or history. Do not create GitHub forks, parallel implementations, duplicate systems, shadow code paths, alternate "temporary" versions, competing branches, or disconnected commits to avoid integrating with work that already exists.

Solve each problem in the existing product line. Inspect the current implementation plus all relevant concurrent work. Choose the strongest behavior, then produce one coherent result. Build on the existing solution when it is sound. Replace it when the replacement is better. Delete the implementation or remove the feature when deletion is the correct product decision.

Uncertainty is not permission to route around a problem. Preserve valuable user work. Use repository evidence, tests, product requirements, plus engineering judgment. Resolve conflicts in place. Commit the unified result to the existing repository history. Push it so every contributor works from the same source of truth.

Do not leave noodles to nowhere: no unused scaffolds, orphaned modules, speculative adapters, dead feature flags, abandoned compatibility layers, or alternate flows without a current caller and an explicit product purpose.

## Operating standard

1. Read this file before planning or editing. Read narrower `AGENTS.md` files when working below their directories. The nearest file may add local constraints; it does not weaken this rule.
2. Inspect the live repository first: current branch, status, upstream, recent history, open work, relevant tests, existing architecture, plus the actual caller path. Never design from a stale summary when the current state is available.
3. Treat uncommitted changes as another contributor's work. Preserve them. Understand overlapping edits before touching them. Integrate complementary work into one implementation instead of choosing by author or recency.
4. Fix root causes. Keep one owner for each responsibility, one canonical data flow, one source of truth, plus one truthful user-facing state. Prefer established project patterns, standard libraries, small interfaces, explicit schemas, deterministic behavior, plus searchable names.
5. Keep instructions local. Put a rule beside the system it governs. Put cross-project rules here. Do not scatter the same requirement through unrelated files.
6. Do not add placeholders that can be mistaken for finished work. Mark unavoidable stand-ins clearly with ownership, intended replacement, acceptance criteria, plus machine-readable metadata where assets or generated content are involved.
7. Validate in proportion to risk. Run the narrow test first, then the relevant suite, build, static checks, format checks, plus diff checks. Inspect visible behavior for UI or art changes. A command that was not run is not a pass.
8. Report state truthfully. Distinguish local edits, committed work, pushed branches, open pull requests, a green `npm run gate` on this branch, plus merged code. Never claim publication or success before verifying it. There is no CI on this repository: Actions is disabled and every workflow is deleted, so "pending CI" and "passing CI" are not states that exist here, and `gh pr checks` reporting nothing is indistinguishable from checks that have not started. See `docs/MERGING.md`.
9. Make cohesive commits at meaningful checkpoints. Stage only intended files. Sync before publication. Push often enough that collaborators share the same history, without interrupting the work for empty or trivial commits.
10. Never commit credentials, private keys, tokens, personal data, unlicensed assets, or uncertain provenance. Record source, license, authorship, transformations, approval state, plus usage restrictions for every admitted external or generated asset.

## Merging — there is no CI

`npm run gate` is the gate. Nothing off this machine runs anything against a branch, so a pull request with no evidence in it has been verified by nobody. The ritual — worktree, gate, rebase, squash merge, deleting the remote branch when the local step declines, and verifying by content rather than by SHA — is **[`docs/MERGING.md`](docs/MERGING.md)**, and that is its only copy. Read it before merging anything, and put the gate's summary block in the pull request.

## Work ledger — mandatory check-in and check-out

Before editing, read `.agents/README.md` plus every active record in `.agents/claims/`. Create or update your task record with the exact paths and responsibilities you intend to touch. Do not claim the whole repository unless the task truly spans it.

Treat an overlapping active claim as a coordination requirement, not a reason to fork. Inspect the claimed work, contact the owner when possible, then agree on one implementation path. If the owner is unavailable, preserve their work and integrate from the evidence in the repository.

At every meaningful scope change, update the claim. At completion, set its status to `completed`, record the resulting commit plus validation performed, then commit that checkout update with the work. Blocked work remains `blocked` with the exact condition required to resume. Never delete another agent's claim merely because it looks stale.
