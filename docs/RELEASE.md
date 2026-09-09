# Releasing DR Companion

How a build becomes something a player can install, and the decisions that
shape it. `docs/PLAN_TO_1_0.md` owns the order of work; this owns the release
mechanics and the standing answers.

---

## 1. What a release run does

A release is built **on this machine**. There is no workflow: Actions was
disabled for this repository on 6 September 2026 (GitHub Actions minutes were
at 1,903 of 2,000 for the month and this repository had spent $127.80 of it),
`.github/workflows/` is empty, and nothing off this machine builds, tests or
publishes anything.

```bash
gh api repos/dancockrell/dr-companion/actions/permissions   # enabled: false
git ls-tree origin/main .github/workflows                   # empty
git ls-tree origin/main .github/                            # the control: still there
```

**Where this document and those commands disagree, the commands are right and
this text is stale.**

### The suites run before the build, and that is now a person's job

This used to be enforced by a job-dependency edge that GitHub's scheduler would
not let a build start without. Nothing enforces it now. That is the real cost
of removing CI and it is worth stating plainly rather than discovering: a tag
is just a tag, and an installer built from an unverified commit looks exactly
like one built from a verified commit.

So the gate is one command, and it is the same suites the `checks` and `tauri`
jobs used to run, in the same order:

```bash
npm run gate     # tsc, lint, every suite, cargo fmt, clippy, cargo test, Godot
```

It prints its own denominator (`7 of 7 stages ran`) and refuses to report a
pass for a stage it could not run — a missing `cargo` is NOT RUN and a non-zero
exit, never a skip. Run it, read the last line, and only then cut a tag.

`npm run test:godot` became the seventh stage on 6 September 2026. It had been
named as a gap here, on the belief that this fleet's machine rule forbids a
Godot install; the rule is *headless only, one process at a time, bounded, and
kind to the other lanes*, and `tools/godot-tests.mjs` already worked that way,
so the scripts in `godot/tests` were running nowhere for no reason. The gate
counts running Godot processes before it starts and reports NOT RUN naming that
count rather than piling a sweep on top of another lane's editor. A missing
engine is a *different* NOT RUN, naming the paths searched and the `GODOT4`
override, because the two call for opposite things from whoever is standing
there: install one, versus wait.

### Building the installer

```bash
npm run version:set -- 1.0.0-beta.1     # five files: package.json, tauri.conf.json,
                                        # Cargo.toml, Cargo.lock, src/lib/versions.ts
node tools/set-version.mjs --check      # refuses a half-bumped tree
npm run gate                            # the gate; read the last line
npm run release:config                  # add --require-viewer for a viewer build

# Sign. Without these two the build succeeds and produces an installer no
# updater can verify, which is indistinguishable from a signed one until a
# player's download fails at 100%. See §2.4 for where the key lives.
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$LOCALAPPDATA/DR Companion/updater-private.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='...'

npm run tauri:build                     # ~217 MB NSIS installer, several minutes
npm run release:manifest                # latest.json, from the installer that was built
npm run release:verify -- --expect-update-manifest   # add --expect-viewer for a viewer build
```

`release:manifest` writes `latest.json` next to the installer and reads it back
against the build before reporting success. It refuses when there is no `.sig`
file beside the installer, when the bundle directory holds more than one
`-setup.exe` (it is not cleaned between builds, so a tree that has built twice
holds two), or when the installer's filename does not carry the version
`package.json` declares.

**The version is now five files, not three.** `src/lib/versions.ts` joined the
check on 9 September 2026 because it was found reading `0.1.0` against four
files at `0.1.1` — and it is the one a *player* sees: the About line, every bug
report, and the version handshake with the bridge. `set-version.mjs` was
checking four files and agreeing with itself.
`npm run test:version-drift-break` bumps each of the five in a temp replica and
asserts the check names the odd one out, and separately makes one unreadable —
because four files that agree and a fifth nothing can parse look identical to
five files in agreement.

The installer lands in `src-tauri/target/release/bundle/nsis/*-setup.exe`.
Record its size and digest by hand, because nothing else does any more — CI
used to print the sha256 to the run summary, which is what let a tester prove
the file they installed was the file that was built:

```bash
sha256sum src-tauri/target/release/bundle/nsis/*-setup.exe
ls -l     src-tauri/target/release/bundle/nsis/*-setup.exe
```

Put both in the verification document for that build
(`docs/verification/first-run-*.md`) before installing it anywhere, so the
chain of custody still has two ends: what was built here, and what was
installed there.

Then create the release by hand and attach the file:

```bash
git tag v1.0.0-beta.1 && git push origin v1.0.0-beta.1
gh release create v1.0.0-beta.1 --draft --title "..." --notes-file <file> \
  src-tauri/target/release/bundle/nsis/*-setup.exe \
  src-tauri/target/release/bundle/nsis/latest.json
```

**Both assets, every time.** The updater fetches
`https://github.com/dancockrell/dr-companion/releases/latest/download/latest.json`
— the `latest` alias, which GitHub points at the newest **non-draft, non-prerelease**
release. Three consequences worth knowing before they surprise somebody:

- A release with the installer and no `latest.json` updates nobody. The endpoint
  404s and every running copy reports a failed check, while the release page
  looks entirely normal.
- A release marked **pre-release** is not `latest`, so publishing `v1.0.0-beta.1`
  as a pre-release leaves the updater pointing at whatever came before it. For a
  beta that people are meant to receive updates for, publish it as a normal
  release and say "beta" in the title and notes.
- The manifest's download URL names the tag it was generated for
  (`.../download/v1.0.0-beta.1/...`), so a manifest attached to the wrong
  release points at a file that is not there.

`--draft` is not optional. Nothing is published to players until somebody
un-drafts it, and §3 below is the list that has to be worked first.

### The world viewer is optional, and the build says which one it made

**History, and why the flags below exist.** The viewer's runtime assets used to
come from a `godot/shared-assets` submodule pointing at a **private**
repository. A workflow's built-in token reaches only its own repository, so a
run had no way to clone it, and the first real release run died there before
building anything. That submodule is gone: 3D is cancelled
([NO-3D.md](NO-3D.md)) and Lane V's V3 removed it after establishing that
nothing live consumed it, so a release build no longer needs a credential for
anything outside this repository.

The three states below are unchanged by that, because what makes them three is
that an installer without the viewer is a supported build (beta.1 ships with the
viewer disabled). Only the reasons a viewer can be absent have narrowed: no
Godot binary, or a plain choice not to export one.

| Condition | What happens |
|---|---|
| A viewer was exported | `release:config --require-viewer` and `release:verify --expect-viewer` both insist on it |
| No viewer was exported | The installer carries no viewer and the release body says so |
| A viewer was asked for and is not there | The build **fails**. Shipping the smaller installer quietly is the one unacceptable outcome |

Row 3 is why both scripts take a flag rather than inferring from what happens
to be on disk, and why a misspelled flag has to be fatal. Until 5 September
2026 both read their flags with `process.argv.includes(...)`, which cannot tell
a flag that was not passed from one that was mistyped: `--requre-viewer` would
have read as *no viewer required* — the smaller installer, shipped green, on
the one build that was supposed to carry a viewer. Both now go through
`tools/cli-flags.mjs` and refuse an argument they do not recognise:

```bash
node tools/build-release-config.mjs --requre-viewer   # exit 1, names the token
npm run test:release-flags                            # the suite that holds it
```

That suite pairs every refusal with a control — the correctly spelled flag, run
the same way, reaching its own branch — because a script that rejected *every*
argument would otherwise score the same as one that rejects only the wrong
ones. It runs inside `npm run gate`.

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

### 2.2 Update checking — **Decided: a real updater, still never automatic**

**Superseded 9 September 2026 by Dan**, who asked for an updater in as many
words: *"yes, so you will need to get updated to 14...and while we are at it,
we need to build an updater, right?"* The recommendation below it — a link and
nothing else — was the standing decision until that point and is kept so the
change is legible rather than silent.

The app now uses `tauri-plugin-updater` (2.11.0) and
`@tauri-apps/plugin-updater` (2.11.0). It checks a manifest, downloads,
verifies a minisign signature, and installs on restart.

**What did not change is the reasoning in the superseded paragraph, and it is
now enforced in code rather than by not having the feature.** This app holds a
live connection to a game character; an update that arrives on its own schedule
can interrupt a fight. So `src/lib/updater.ts` holds four rules, and
`tools/updater-test.mjs` asserts each of them on the *calls that did not
happen* — the only observable form of "it did not install":

1. **Nothing installs without an explicit press.** Checking never downloads;
   downloading never installs. `downloadAndInstall`, which the plugin also
   offers, is called nowhere.
2. **"Later" actually waits.** Deferring records the version and the launch
   check will not raise it again. Nothing schedules a second offer; there is no
   timer in the module.
3. **A live game session is a confirmation gate.** With the bridge connected
   and a character in the game, installing refuses until the player has been
   shown, in words, that this closes the app and drops them out of DragonRealms
   — and has pressed again.
4. **A failure says what to do,** naming the releases page, because the honest
   fallback for a broken updater is a person downloading an installer.

The player-facing surface is a Settings section (all states, a manual "Check
for updates", release notes, progress, and both buttons) plus a one-line banner
that appears **only** when an update is available and carries its own "Later".

`npm run test:updater-break` damages each of those rules in a temp copy and
asserts, by name, which checks go red.

### 2.4 The updater signing key — **Dan's to generate; the config is ready**

The updater will not install anything it cannot verify. The verification is a
minisign signature over the installer's bytes, checked against a public key
compiled into the binary.

**This has not been generated, and it was left for Dan deliberately.** Three
reasons, in order of weight:

1. Whoever holds that private key can publish an installer that every copy of
   DR Companion downloads and runs without asking anybody anything. That is the
   publisher's identity, and it should be created by the publisher.
2. `npx tauri signer generate` prompts for a passphrase interactively. A
   non-interactive session cannot type one, so anything generated from an agent
   session would be an unpassworded key — the weakest possible form of the most
   sensitive credential in the project.
3. There is no hurry: `src-tauri/tauri.conf.json` carries `"pubkey": ""`, which
   is a state the app is honest about rather than a broken one. `updater_configured`
   (`src-tauri/src/updater.rs`) reads that field out of the running binary's own
   config, and a build with an empty key reports *"this build has no update
   channel"* and refuses to check, rather than offering an update it could
   never verify.

To generate it, once, ever:

```bash
npx tauri signer generate -w "$LOCALAPPDATA/DR Companion/updater-private.key"
```

It prompts for a passphrase; use one and keep it somewhere that survives this
machine. It writes two files: the private key at that path, and
`updater-private.key.pub` beside it.

- **The `.pub` contents go into `src-tauri/tauri.conf.json` as `pubkey`**, and
  are committed. Changing it later orphans every existing install's update
  channel, so it changes once.
- **The private key never enters this repository.** Not in a file, not in an
  `.env`, not in a commit message. `npm run test:no-private-key` greps the tree
  for every private-key header and for filenames that name one, and it plants a
  key of its own first to prove the search can see one — a scan that has quietly
  stopped matching reports a clean tree forever.

A build signs when the key is in the environment, and produces an unsigned
installer with no complaint when it is not, which is why
`tools/build-update-manifest.mjs` refuses outright rather than writing a
manifest with a null signature:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$LOCALAPPDATA/DR Companion/updater-private.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='...'
npm run tauri:build
```

Losing the key is recoverable but expensive: generate a new pair, ship a new
`pubkey`, and every install running an older build has to be updated by hand
once, because it will not trust anything signed with the new key.

### 2.3 What ships in beta.1 — **Decided: viewer and local AI both off**

Gates 0 → 1 → 2 → 6 of the plan, with the Godot world viewer and the local
model absent.
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
5. Confirm the update manifest describes this exact installer
   (`npm run release:manifest-check`), and that both assets are attached
   (`gh release view <tag> --json assets --jq '.assets[].name'` lists the
   `-setup.exe` **and** `latest.json`).
6. Un-draft, with release notes linking `docs/PRIVACY.md`, `THIRD_PARTY.md`,
   and the unsigned-installer note from §2.1.

### The updater has one step nothing here can prove

Every check above runs against a manifest and an installer sitting in a
directory on this machine. What none of them establishes is that a *player's
running copy* reaches GitHub's `latest` alias, downloads, verifies, and
installs over itself.

That needs two builds, an hour apart, and the clean VM: install the older one
from the `clean` snapshot, publish the newer one, and press the button. Until
that has been done and recorded in `docs/verification/`, the honest statement
is that the updater's local half is verified and its published half is not.
`docs/PLAN_TO_1_0.md` F17 owns that run.

Note also §2.1: the installer is unsigned for Authenticode, and the updater's
minisign signature is a different thing entirely. The updater proves the file
came from whoever holds the key in §2.4; it does nothing about SmartScreen,
and an update that runs the NSIS installer will show the same warning a first
install does.

---

## 4. Cleaning up a dry run

A local dry run needs no tag at all: build the installer, look at it, delete
it. Nothing is published by building.

```bash
rm -rf src-tauri/target/release/bundle/nsis    # ~217 MB per build
```

If a tag or a draft release was made anyway, both should go. A draft release
nobody deletes becomes a draft release somebody publishes.

```bash
gh release delete v0.0.0-dry-run --yes
git push origin --delete v0.0.0-dry-run
git tag -d v0.0.0-dry-run
```
