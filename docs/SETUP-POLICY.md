# What this app will and will not do to your machine

DR Companion needs Ruby and Lich to talk to the game. Getting those installed is
the main thing that stops people trying Lich at all, so the app helps. Helping
with installs is also how software earns a bad reputation, so here is exactly
what it does, in enough detail to check.

All of this is in [`src-tauri/src/setup.rs`](../src-tauri/src/setup.rs).

## The rules

**1. Current versions, and nothing else disturbed.**
Nobody installs this app because they want Ruby. Lich is written in it, so Ruby
comes along, and the job is to get a working one in place and get out of the
way.

If you already have a Ruby that Lich can use, the app uses it and installs
nothing. If it is too old, the app offers the current release, in its own
folder rather than over the top of anything. Your old Ruby is not deleted or
overwritten, which is ordinary good manners rather than a feature: this app has
no business deciding what else on your machine needs Ruby, and no business
keeping a deprecated runtime alive either.

One caveat, because it is someone else's installer and it does what it likes:
Ruby4Lich5 adds its own `bin` to the front of your user PATH. So `ruby` at a
prompt will mean the new one afterwards. If that matters to you, install Ruby 4
yourself instead and the app will use it.

Detection looks on PATH first and then on disk, because a Ruby installed while
the app was running will not be on PATH yet. Being told to install Ruby you
just installed is worse than being told nothing.

**2. Nothing downloads until you ask.**
Startup checks what is present. That is a read of your filesystem plus one
request to GitHub's release API for version numbers. It fetches no files.

Every download is a button you pressed, after seeing:

- what it is and which version
- the exact URL
- the size
- the SHA-256
- the full path it will be written to
- what happens to it afterwards

**2b. The music library is the same deal, and it is large.**
The app can play a curated library of 182 tracks. None of it is in the
installer: measured by fetching every file and weighing what landed, it is
4.36 GB, against an installer of roughly 211 MB. So it works like every other
download here - a button in the sound transport that states the size before you
press it, nothing fetched until you do, every file checked against a SHA-256
that shipped inside the app rather than one fetched alongside the files.

It installs into `%LOCALAPPDATA%\DR Companion Data\audio`, which the
uninstaller can remove, and it can be cancelled while it runs. Until it is
installed the transport says `Music not installed` and offers the install; it
does not pretend to be playing something.

The sources are `upload.wikimedia.org` and `opengameart.org`, the only two
hosts `data/audio/manifest.json` names. Every track's licence is in
[`THIRD_PARTY.md`](../THIRD_PARTY.md) and per-track credits in
[`data/audio/ATTRIBUTIONS.md`](../data/audio/ATTRIBUTIONS.md). None of it is
DragonRealms audio.

**3. Downloads are verified, and a bad one is deleted.**
Checksums come from GitHub's release API, the same authenticated source as the
download link. The file is hashed as it streams. On a mismatch it is deleted
and nothing is installed. This path is tested, not assumed: see
`src-tauri/examples/fetch.rs`, which deliberately fails a checksum and confirms
no partial file survives.

Where a project publishes no checksum for an asset, the app says so on the
option itself and in the detail panel, rather than quietly omitting the line.
Genie 4 is the current case. You get told what can and cannot be checked.

Downloads are refused outright from any host other than
`github.com/elanthia-online/`, `github.com/GenieClient/` and
`objects.githubusercontent.com`.

**4. Downloading and running are two different decisions.**
Fetching an installer does not run it. A verified installer sits in the app's
download folder until you ask again, and "Show me the file" sits next to "Run
the installer" so you can inspect or scan it first. `run_installer` refuses
anything outside the app's own download folder and anything that is not an
`.exe` we just wrote there.

**5. Everything lands in one place.**

```
%LOCALAPPDATA%\DR Companion Data\
    downloads\     verified files, kept so you can re-check them
    lich\          Lich, if the app installed it
    genie\         Genie, if you chose the portable build
```

Nothing is written to Program Files, no service is installed, no registry keys
are set, no PATH is modified, and nothing needs administrator rights. Deleting
that folder removes everything the app put on your machine. There is a button
on the setup screen that opens it.

Note the `Data` on the end. The program installs to
`%LOCALAPPDATA%\DR Companion\`, and until 0.1.1 that was also where downloads
and Lich went. Installing this app therefore put a full Lich tree, including
the `scripts\` folder holding your own scripts, next to `uninstall.exe`, where
uninstalling would have deleted the lot. The two are now separate directories,
and the app refuses at runtime to return a data path that contains its own
executable, so a rename cannot walk that back.

If you ran a build before 0.1.1, the setup screen says so and names what is
still sitting in the program folder. Move it across before you uninstall.

**6. One thing is installed for you: our own script.**
`companion_bridge.lic` is a single Ruby file copied into Lich's scripts folder.
It ships inside the app, so nothing is downloaded, and its source path is
resolved in Rust rather than passed from the web view, so the UI cannot ask the
native side to copy an arbitrary file somewhere.

## Which route the app picks

| Your machine | What it offers | Why |
|---|---|---|
| Ruby 4.x and Lich present | Nothing | It is already working |
| Ruby 4.x, no Lich | `lich-5.zip`, about 1.8 MB | Adds Lich only, uses your Ruby as-is |
| No Ruby, or Ruby too old | `Ruby4Lich5.exe`, about 65 MB | The Lich project's own Windows bundle |

Both Lich routes are always offered; the table says which one is suggested.

## Plugins and maps

A fresh Genie has an empty Maps folder and none of the plugins the community
scripts assume. The travel script every DragonRealms player uses opens with
"REQUIRES EXPTRACKER PLUGIN! MANDATORY!", and without maps the automapper has
nothing to route over. The app offers both.

These ship as files committed to a repo, not as release assets, so there is no
release checksum. GitHub's contents API does publish the **git blob hash** for
every file, and that is verifiable: `sha1("blob " + length + NUL + content)`.
Same authenticated source as the download URL, and it pins exact content.

Every file is hashed before anything is written. One mismatch aborts the whole
install, and nothing partial is left behind. You can list every file and its
hash in the UI before agreeing.

| Bundle | Goes to | Size |
|---|---|---|
| Genie plugins: EXPTracker, SpellTimer, CircleCalc and the rest | Genie's `Plugins\` folder | about 0.4 MB |
| The community map set, 90 files | Genie's `Maps\` folder | about 12 MB |

Those two rows are counted from someone else's repository, so they go out of
date without anybody here touching a file. The app itself asks GitHub at run
time and shows you what it gets; if you want the same answer before you press
anything:

```bash
gh api repos/GenieClient/Maps/contents/ \
  --jq '[.[] | select(.name | endswith(".xml"))]
        | "count=\(length) bytes=\([.[].size] | add)"'
```

`GenieClient/Plugins` with `.dll`/`.xml` gives the plugin row the same way.
Where the command and this table disagree, the command is right.

Genie 4 also ships `Lamp.exe`, its own updater, which does the same job. The
app says so on the maps card rather than pretending it is the only route.

## The frontend

The frontend is the window you read the game in. **You do not need one.** This
app signs you in to DragonRealms itself and starts Lich with the result
(`docs/LICH_NATIVE_LOGIN.md`), so there is no second window to install,
configure or point at a port.

If you already have one and want to keep it, keep it: this app is a panel for
Lich, and Lich works with whichever frontend you use. Genie, Wrayth, Frostbite,
Saga, Avalon and Profanity all work alongside it.

If none is found, the app still offers to fetch Genie, since it is the most
common and the config importer reads its files. This is optional and always
was — since 6 September 2026 it is optional for a second reason, which is that
nothing about signing in depends on it:

| Option | Notes |
|---|---|
| **Genie 4** (suggested) | Stable, free, open source, and what the Lich connection guides are written for. Release 4.0.2.9 from December 2023. **The project publishes no checksum for this file**, so the app says so plainly rather than implying a check it cannot make. |
| Genie 5 portable | Their README says "Beta ... expect rough edges". A .NET 10 / Avalonia rewrite that runs on Windows, macOS and Linux and runs Genie 4 `.cmd` scripts. Checksummed, unpacks into the app folder, deletes cleanly. |
| Genie 5 installer | Same build, installed normally |

Genie 4 is suggested rather than Genie 5 because of what happens to newcomers:
in the help channel, a returning player on Genie 5 found its own config
commands missing, and the community's connection walkthroughs are all written
for 4. Genie 5 is offered beside it, described in its own words.

**The bridge script is `;companion_bridge`.** Lich decides that character from
its frontend, and on this app's route there is no frontend — Lich runs headless
— so it is a semicolon (`main.rb:58`). The app prints the command rather than
making you remember it. If you start Lich yourself under some other frontend,
check that frontend's own documentation.

Ruby4Lich5 is published by elanthia-online as a release asset alongside Lich
itself. Pointing at their installer is better than inventing our own Ruby
layout, because it is the thing their community supports and troubleshoots. We
download it, verify it, and hand it to you. It asks its own questions.

One of them needs an answer from us, because that page answers it wrong for
this game. Its **"Select Additional Tasks - Lich5 Folder Location"** step offers
`C:\Ruby4Lich5\Lich5`, labelled preferred for DragonRealms, and the Desktop,
labelled preferred for Gemstone IV and **selected by default**. Both of these
work with this app. On a clean VM the default was taken deliberately: Lich
landed on the Desktop, detection found it, and the bridge installed there
(`docs/verification/first-run-2026-09-05.md`, Defect 2). The Ruby4Lich5 option
keeps Lich beside the Ruby that runs it, so that is the one the Ruby row
suggests; anyone who has already clicked past it should leave it alone. Nothing
in this app is written against either path, and the row now says so before you
open the installer.

## What the app never does

- Install or modify Ruby system-wide
- Change your PATH or any environment variable
- Request administrator rights
- Run an installer you did not separately approve

That list covers **this app**, and the distinction matters on one point.
Ruby4Lich5 is not us: it is the Lich project's own installer, we hand it to you
after checking it, and it then does what it does. Observed on a real install,
it puts `C:\Ruby4Lich5\<version>\bin` at the front of your user PATH. That is
reasonable of it, it is not something we do or can prevent, and the app used to
tell you it would not happen. It now says who is doing what.
- Fetch from anywhere other than the Lich and Genie projects' own GitHub
  releases and repositories
- Send anything anywhere. There is no telemetry, no analytics, no account.

Outside its own folder it writes in exactly three places, all of them things
you asked for: the bridge script into Lich's `scripts\`, plugins into Genie's
`Plugins\`, and maps into Genie's `Maps\`. Every one of those paths is shown on
the card before you agree, and nothing outside them is ever touched.

**It no longer writes into a Genie install at all.** It used to: the config
editors edited Genie's own `Config\*.cfg` files. Your highlights, aliases,
macros, variables, substitutes, gags and presets are the app's own now, and
they live in the app's data folder:

```
%LOCALAPPDATA%\DR Companion Data\config\
    player-config.json        all seven kinds of rule, one file
    dr-companion-pins.yaml    your map pins
```

Both are written only when you press Export or Save, never on their own, and
overwriting either keeps a `.bak` of the previous version beside it. Your
Genie config is read once if you ask for an import and is never written to.
`docs/PLAYER_CONFIG.md` is the file format and what an import reports.

## If you would rather do it yourself

Nothing here is required. Install Ruby and Lich however you like, drop
`lich-scripts/companion_bridge.lic` into Lich's `scripts` folder, run
the bridge script in game (`;companion_bridge`, or whatever command character
your own frontend uses), and switch the app to Live Lich in Settings. The
setup screen will detect all of it and get out of the way.

The demo dashboard needs none of this and is always reachable.
