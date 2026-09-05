# Release dry run — 5 September 2026

Increments F1 and E4. The point of a throwaway tag is to make the release
workflow execute steps that had never executed, and it worked: the first run
found a blocker that would have failed every release since the wiring landed.

## Run 1 — failed, and this is the finding

Tag `v0.0.0-ci-check` on `c8c3bb77`. Run
[33958412845](https://github.com/dancockrell/dr-companion/actions/runs/33958412845).

```
X clone of 'https://github.com/dancockrell/project-42-pirate-island-rpg.git'
  into submodule path '.../godot/shared-assets' failed
X repository 'https://github.com/dancockrell/project-42-pirate-island-rpg.git/' not found
```

The job died at `actions/checkout` with `submodules: recursive`, before
installing Node, before `npm ci`, before anything was built.

**Diagnosis.** The repository exists and is **private**
(`gh repo view … --json isPrivate` → `true`, pushed the same morning). A
workflow's built-in `GITHUB_TOKEN` is scoped to the repository running the
workflow, so it cannot clone a different private repository. "Not found" is
what GitHub returns for a private repository you cannot see, which is why the
message reads like a deleted repo and is not one.

**Not a flake, and not new.** Every tagged release since this workflow landed
would have failed identically. Nothing had ever run it.

## The fix

`.github/workflows/release.yml` no longer asks checkout for submodules. A
dedicated step fetches them only when a `SHARED_ASSETS_TOKEN` secret exists,
and publishes one output every later step reads:

| Condition | Result |
|---|---|
| Token set, submodule fetches | Godot installed, viewer exported, `release:config --require-viewer` and `release:verify --expect-viewer` both insist on it |
| No token | No Godot, no viewer, installer built anyway, release body says so |
| Token set, fetch fails | Run fails. A viewer was asked for; shipping the smaller installer quietly is the one unacceptable outcome |

An installer with no viewer is a supported build — the plan ships beta.1 with
the viewer disabled — so absence had to become a state rather than a crash.

## Run 2 — green

Tag `v0.0.0-ci-check` re-pointed at `34556d98`. Run
[33959089005](https://github.com/dancockrell/dr-companion/actions/runs/33959089005),
`gh run watch --exit-status` exited 0.

> **Corrected 5 Sep 2026 by a later review pass.** This line read `d0bbc0a4`,
> which is not an object in this repository — so the green run in the one
> section that certifies the release path could not be traced to any commit.
> The run itself carries the answer, which is why the sha is now derived from
> it rather than restated:
>
> ```
> $ git cat-file -t d0bbc0a4
> fatal: Not a valid object name d0bbc0a4
> $ git cat-file -t c8c3bb77                       # positive control
> commit
> $ gh api repos/dancockrell/dr-companion/actions/runs/33959089005 \
>     --jq '{conclusion,head_branch,head_sha}'
> {"conclusion":"success","head_branch":"v0.0.0-ci-check",
>  "head_sha":"34556d98d9c45b9531a1c2b86ca51092eee641ff"}
> $ git log -1 --oneline 34556d98
> 34556d98 build(release): the viewer's assets are private, so make its absence a state [F1] (#304)
> ```
>
> Run 1's attribution below was already exact (`head_sha` = `c8c3bb77…`,
> `conclusion` = `failure`); only this one was wrong. Where the `gh api` line
> and any sha written here disagree, the API is right.

Draft release created with one asset:

| | |
|---|---|
| Asset | `DR.Companion_0.1.1_x64-setup.exe` |
| Size | 217,267,200 bytes |
| SHA-256 | `9FCF544476A9030E17219B5DC7EA216D33EB8FD8F28D361E255B4E0138DECAE8` |
| Draft | yes |

Release body, verbatim:

> This build does **not** include the Godot world viewer. The client runs
> without it and reports it as not installed. To build one, set the
> `SHARED_ASSETS_TOKEN` secret to a token that can read the shared-assets
> repository.

## E4 — is the installer signed?

`Get-AuthenticodeSignature` on the downloaded artefact:

```
Status     : NotSigned
SignerCert : (none)
```

As expected, and now measured rather than assumed. `docs/RELEASE.md` §2.1
records the decision to ship beta unsigned and why a certificate would not
remove the SmartScreen warning yet.

## What did not work, and what is still unknown

- **The viewer half of the release has still never been exercised in CI.** The
  green run is the no-viewer branch. The token branch is written and untested,
  and it will stay untested until a `SHARED_ASSETS_TOKEN` secret exists. It is
  written to fail loudly rather than silently, which is the best that can be
  done without the credential.
- **The installer has not been installed.** Downloaded and hashed only. E2, E3
  and E10 run it on the clean VM, and that VM does not exist yet (E1).
- The 217 MB size is not yet explained or justified; nothing checks it.

## Cleanup

The tag and its draft release are deleted; `docs/RELEASE.md` §4 has the
commands, because a draft release nobody deletes becomes a draft release
somebody publishes.
