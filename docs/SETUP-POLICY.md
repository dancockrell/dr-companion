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
%LOCALAPPDATA%\DR Companion\
    downloads\     verified files, kept so you can re-check them
    lich\          Lich, if the app installed it
    genie\         Genie, if you chose the portable build
```

Nothing is written to Program Files, no service is installed, no registry keys
are set, no PATH is modified, and nothing needs administrator rights. Deleting
that folder removes everything the app put on your machine. There is a button
on the setup screen that opens it.

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

## The frontend

Genie is the window you read the game in. If none is found, the app offers:

| Option | Notes |
|---|---|
| **Genie 5 portable** (suggested) | Current development line, .NET 8, runs Genie 4 `.cmd` scripts. Beta. Unpacks into the app folder, no installer, deletes cleanly. Checksummed. |
| Genie 5 installer | Same build, installed normally |
| Genie 4 | The stable client most scripts were written against. Release 4.0.2.9 from December 2023. **The project publishes no checksum for this file**, so the app says so plainly rather than implying a check it cannot make. |

The portable build is suggested because it fits the rest of this policy: it
lands in the app folder, changes nothing else, and is verifiable.

Ruby4Lich5 is published by elanthia-online as a release asset alongside Lich
itself. Pointing at their installer is better than inventing our own Ruby
layout, because it is the thing their community supports and troubleshoots. We
download it, verify it, and hand it to you. It asks its own questions.

## What the app never does

- Install or modify Ruby system-wide
- Change your PATH or any environment variable
- Write outside its own folder, except the one bridge script into Lich's
  scripts folder
- Request administrator rights
- Run an installer you did not separately approve
- Download from anywhere other than the Lich and Genie projects' own GitHub releases
- Send anything anywhere. There is no telemetry, no analytics, no account.

## If you would rather do it yourself

Nothing here is required. Install Ruby and Lich however you like, drop
`lich-scripts/companion_bridge.lic` into Lich's `scripts` folder, run
`;companion_bridge` in game, and switch the app to Live Lich in Settings. The
setup screen will detect all of it and get out of the way.

The demo dashboard needs none of this and is always reachable.
