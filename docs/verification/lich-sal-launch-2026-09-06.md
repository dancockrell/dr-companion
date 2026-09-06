# `.sal` launch, measured against a real Lich — 6 September 2026

Lane N, increment **N3**. This answers `docs/LICH_NATIVE_LOGIN.md` §7's
**inferred item 2** — *"whether `--headless` normalisation runs on the `.sal`
path"* — by starting a real Lich from a hand-written launch file and looking at
the port, rather than by reading `arg_normalization.rb` and reasoning about it.

Lich 5.20.1 (`C:\Ruby4Lich5\Lich5\lib\version.rb:3`), Ruby 4.0.6
(`C:\Ruby4Lich5\4.0.6\bin\ruby.exe`).

**Nothing here touched Simutronics.** `GAMEHOST` pointed at a loopback
stand-in on `127.0.0.1:11124` that accepts a connection and answers nothing, so
the only server Lich reached was one this measurement started. Both processes
were killed by the PIDs the probe script captured, never by image name
(`CLAUDE.md` §4).

---

## Run 1 — the launch file works, and 11024 listens

Launch file written (`KEY` deliberately invalid; it is never used before the
port opens):

```
GAME=STORM
GAMECODE=DR
GAMEFILE=STORMFRONT.EXE
GAMEHOST=127.0.0.1
GAMEPORT=11124
KEY=deliberately-invalid-not-a-real-key
FULLGAMENAME=DragonRealms
UPPORT=5535
```

Command:

```
C:\Ruby4Lich5\4.0.6\bin\ruby.exe C:\Ruby4Lich5\Lich5\lich.rbw <sal> --headless=11024
```

Observed:

```
lich pid 27288
--- LISTENING after 8s ---

LocalAddress LocalPort OwningProcess
------------ --------- -------------
127.0.0.1        11024         27288

--- lich exited: False ---
--- listening on 11024: True ---
```

and, at the stand-in game server:

```
[standin] listening on 127.0.0.1:11124
[standin] connection from 127.0.0.1:60695
[standin] <- 35 bytes: deliberately…
[standin] <- 48 bytes: /FE:WRAYTH /…
[standin] <- 3 bytes: <c>…
```

**Measured, four things, all of them previously inferred:**

1. **`--headless=11024` is normalised on the `.sal` path.** The listener exists
   and it is Lich's own process holding it. §7 item 2 is answered: `yes`.
2. **No `--dragonrealms`, no `--stormfront`, no `--login` and no saved entry
   were needed.** The command line above is the whole launch. `GAMECODE=DR`
   in the file did the work `--dragonrealms` used to
   (`main.rb:225`).
3. **Lich sends the game key itself under `--without-frontend`.** The 35 bytes
   the stand-in received are exactly the invalid key, followed by
   `Frontend::CLIENT_STRING` (`/FE:WRAYTH /VERSION:1.0.1.28 /P:WIN_UNKNOWN /XML`,
   `front-end.rb:350-352`) — `main.rb:642-664` read as behaviour rather than as
   source.
4. **The game connection happens before the detachable listener opens.** The
   stand-in logged its connection first; 11024 appeared 8 seconds after start.
   This is why the probe needs a stand-in at all: with nothing listening on
   `GAMEPORT`, Lich would not have reached `main.rb:842-857`.

Point 4 is worth carrying forward, because it also bounds the timeout on the
app side: the app's attach cannot succeed until Lich has a game connection, so
`LAUNCH_FILE_TIMEOUT` in `lich.rs` covers a real sign-in and not just a process
start.

## Run 2 — the sabotage, which is what makes run 1 mean anything

The same file with the `GAMECODE=` line removed and nothing else changed. A
green launch on its own does not establish that Lich read *our* file rather
than some other source of launch data; this does.

```
--- lich exited: True ---
--- listening on 11024: False ---
--- stdout ---
error: launch_data contains no GAMECODE info
```

That is `main.rb:232`'s string, verbatim, and the port never opened. The file
reaches Lich's reader, and the four `Array#find` regexes `src-tauri/src/sal.rs`
transcribes are the ones actually being run.

## What is still not measured

- **A real sign-in.** No Play.net credential was used and no valid `KEY`
  existed, so nothing here says the `L` reply's fields are the right ones —
  that is N7, and it needs Dan.
- **The app's own attach shredding the launch file.** `game_link.rs` calls
  `lich::shred_pending_launch_files()` on a successful connect, and that is
  covered by unit tests (`sal::tests::shred_removes_the_file_and_is_happy_to_run_twice`,
  `lich::tests::a_dry_run_reports_the_argv_writes_the_file_and_spawns_nothing`)
  rather than by this probe, because the probe starts Lich directly rather than
  through the app.

## Reproducing this

The probe script is not in the repo — it starts processes and writes files
outside it, and a tool that launches a real Lich is not something to leave
lying in `tools/` where a test runner might find it. The recipe is above and is
complete: a listener on `GAMEPORT`, the eight-line file, that one command, and
`Get-NetTCPConnection -State Listen -LocalPort 11024`. Kill what you start by
its PID.
