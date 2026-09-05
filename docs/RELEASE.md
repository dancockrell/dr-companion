# Releasing DR Companion

How a build becomes something a player can install, and the decisions that
shape it. `docs/PLAN_TO_1_0.md` owns the order of work; this owns the release
mechanics and the standing answers.

---

## 1. What a release run does

`.github/workflows/release.yml` fires on any `v*` tag, and on manual dispatch
with a tag name. It builds the Windows NSIS installer and opens a **draft**
release with the artefact attached. Nothing is published to players until
somebody un-drafts it.

```bash
npm run version:set -- 1.0.0-beta.1     # package.json, tauri.conf.json, Cargo.toml
git commit -m "chore(release): 1.0.0-beta.1" -- package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git tag v1.0.0-beta.1 && git push origin v1.0.0-beta.1
gh run watch "$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

`node tools/set-version.mjs --check` refuses a tree where those files disagree,
so a release cannot be cut from a half-bumped version.

### The world viewer is optional, and the build says which one it made

The viewer's admitted runtime assets live in the `godot/shared-assets`
submodule, which points at a **private** repository. A workflow's built-in
token reaches only its own repository, so a release run has no way to clone it
unless it is given one. The first real run of this workflow died there, before
building anything.

An installer without the viewer is a supported build — the plan ships beta.1
with the viewer disabled — so the workflow treats this as three states rather
than a crash:

| Condition | What happens |
|---|---|
| `SHARED_ASSETS_TOKEN` set and the submodule fetches | Godot is installed, the viewer is exported, `release:config --require-viewer` and `release:verify --expect-viewer` both insist on it |
| No `SHARED_ASSETS_TOKEN` | Godot is never installed, the installer carries no viewer, and the release body says so |
| Token set but the fetch fails | The run **fails**. A viewer was asked for; shipping the smaller installer quietly would be the one unacceptable outcome |

To build a viewer-carrying release, add a repository secret
`SHARED_ASSETS_TOKEN` holding a token that can read the shared-assets
repository. Nothing else changes. Do not paste a token anywhere else in the
workflow, and never into a file: it is a credential for a private repository.

---

## 2. Decisions

Each of these was Dan's to make and was delegated on 5 September 2026 ("i don't
actually have any opinions on the decisions so use your best judgement"), so
the recommendation is recorded as the decision. Reopen one by editing this
file and saying why.

### 2.1 Code signing — **Decided: unsigned for beta, revisit at 1.0**

The installer is unsigned. `Get-AuthenticodeSignature` on the artefact reports
`NotSigned`, and Windows SmartScreen will warn the first people who run it.

The alternative is an OV code-signing certificate: an annual cost, an identity
verification process, and — this is the part that decides it — **SmartScreen
still warns until the signed binary builds reputation**, which takes downloads
the beta will not have. Paying for a certificate now buys a warning that looks
slightly different.

What we do instead: the download page and the release notes say plainly that
the installer is unsigned, what the warning looks like, and how to proceed past
it. A person told in advance that a warning is coming is not alarmed by it; a
person surprised by one is right to be.

Revisit at 1.0, when there is a stable download URL and enough volume for
reputation to accumulate.

### 2.2 Update checking — **Decided: a link, never an auto-install**

The app already fetches Ruby4Lich5 from GitHub releases and verifies it against
a manifest (`tools/vendor-fetch.mjs`, `src-tauri/src/setup.rs`), so the
mechanism exists.

It will be reused to check `dancockrell/dr-companion` releases and, when a
newer version exists, **show a link**. It will not download, will not install,
and will not restart anything.

This is not caution for its own sake. This app holds a live connection to a
game character; an update that arrives on its own schedule can interrupt a
fight, and an installer that replaces a running binary is an outage the player
did not ask for. A link costs one click and never surprises anybody.

### 2.3 What ships in beta.1 — **Decided: viewer and local AI both off**

Gates 0 → 1 → 2 → 6 of the plan, with the 3D viewer and the local model absent.
Both are optional by construction and the client is complete without them, so
shipping them dark trades nothing a player would notice for a much smaller
surface to get wrong.

---

## 3. Before publishing a build

Draft releases exist so this list can be worked without a deadline.

1. Install the artefact on the clean VM from the `clean` snapshot, and record
   every prompt including SmartScreen (`docs/verification/first-run-*.md`).
2. Run it. Reach a playing session.
3. Uninstall through Settings → Apps, and record what remains under `%APPDATA%`
   and `%LOCALAPPDATA%` — user data should survive, program files should not.
4. Confirm `THIRD_PARTY.md` regenerates clean (`node tools/build-third-party.mjs --check`).
5. Un-draft, with release notes linking `docs/PRIVACY.md`, `THIRD_PARTY.md`,
   and the unsigned-installer note from §2.1.

---

## 4. Cleaning up a dry run

A throwaway tag leaves a tag and a draft release behind. Both should go:

```bash
gh release delete v0.0.0-ci-check --yes
git push origin --delete v0.0.0-ci-check
git tag -d v0.0.0-ci-check
```

A draft release nobody deletes becomes a draft release somebody publishes.
