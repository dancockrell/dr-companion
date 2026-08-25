# What this app will and will not do to your machine

DR Companion needs Ruby and Lich to talk to the game. Getting those installed is
the main thing that stops people trying Lich at all, so the app helps. Helping
with installs is also how software earns a bad reputation, so here is exactly
what it does, in enough detail to check.

All of this is in [`src-tauri/src/setup.rs`](../src-tauri/src/setup.rs).

## The rules

**1. Your Ruby is yours.**
If you have a Ruby that Lich can use, the app uses it and installs nothing. If
yours is too old, it says so and stops. It will not upgrade it, replace it,
reinstall over it, or put anything earlier on your PATH. Other things on your
machine may depend on that Ruby and this app has no business guessing which.

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

Genie 4 also ships `Lamp.exe`, its own updater, which does the same job. The
app says so on the maps card rather than pretending it is the only route.

## The frontend

The frontend is the window you read the game in. **This app is a panel for
Lich, and Lich works with whichever frontend you already use**, so nothing here
is required if you have one. Genie, Wrayth, Frostbite, Saga, Avalon and
Profanity all work.

If none is found, the app offers to fetch Genie, since it is the most common
and its Lich setup is the best documented:

| Option | Notes |
|---|---|
| **Genie 4** (suggested) | Stable, free, open source, and what the Lich connection guides are written for. Release 4.0.2.9 from December 2023. **The project publishes no checksum for this file**, so the app says so plainly rather than implying a check it cannot make. |
| Genie 5 portable | Their README says "Beta ... expect rough edges". A .NET 10 / Avalonia rewrite that runs on Windows, macOS and Linux and runs Genie 4 `.cmd` scripts. Checksummed, unpacks into the app folder, deletes cleanly. |
| Genie 5 installer | Same build, installed normally |

Genie 4 is suggested rather than Genie 5 because of what happens to newcomers:
in the help channel, a returning player on Genie 5 could not run
`#lichsettings` at all, which is the first command the connection guide
depends on. Genie 5 is offered beside it, described in its own words.

**Genie starts Lich scripts with a comma; every other frontend uses a
semicolon.** The app asks which one you use and spells its instructions
accordingly, because `;companion_bridge` fails silently on Genie: it goes to
the game as a command, the game does not understand it, and nothing starts.

Ruby4Lich5 is published by elanthia-online as a release asset alongside Lich
itself. Pointing at their installer is better than inventing our own Ruby
layout, because it is the thing their community supports and troubleshoots. We
download it, verify it, and hand it to you. It asks its own questions.

## What the app never does

- Install or modify Ruby system-wide
- Change your PATH or any environment variable
- Request administrator rights
- Run an installer you did not separately approve
- Fetch from anywhere other than the Lich and Genie projects' own GitHub
  releases and repositories
- Send anything anywhere. There is no telemetry, no analytics, no account.

Outside its own folder it writes in exactly three places, all of them things
you asked for: the bridge script into Lich's `scripts\`, plugins into Genie's
`Plugins\`, and maps into Genie's `Maps\`. Every one of those paths is shown on
the card before you agree, and nothing outside them is ever touched.

## If you would rather do it yourself

Nothing here is required. Install Ruby and Lich however you like, drop
`lich-scripts/companion_bridge.lic` into Lich's `scripts` folder, run
the bridge script in game (`,companion_bridge` on Genie, `;companion_bridge`
elsewhere), and switch the app to Live Lich in Settings. The
setup screen will detect all of it and get out of the way.

The demo dashboard needs none of this and is always reachable.
