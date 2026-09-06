# The window while a link is down — issues #501 and #506

7 Sep 2026, against `fix/501-506-reconnect-honesty`.

Run it yourself, and the command is the claim rather than this page being it:

```
npx vite --port 5310 --strictPort          # the DEV server, see below
node tools/reconnect-honesty-shots.mjs http://127.0.0.1:5310/
```

It needs `vite` and not `vite preview`: the bridge drop is driven through
`window.__store`, which is behind `import.meta.env.DEV` and is dead-code
eliminated from a production build. That is the right place for it to be.

Result on the day: **all passed: 32/32**, and the two screenshots beside this
file were taken by that run.

## `reconnect-2026-09-07-reconnecting.png` — issue #501

The main window, with the game link reconnecting on attempt 3 of 6.

- the connection bar reads **Reconnecting 3/6**
- the safety footer reads **Reconnecting 3/6**
- the command box placeholder reads **Reconnecting 3/6, type and wait** — it
  read *Not attached* before this change, under both of those badges
- `go east` was typed and Enter pressed. It is still in the box, focused, and
  the line above the box reads *Not sent — Reconnecting, attempt 3 of 6.
  Nothing can be sent until it is back. Your command is still here - press
  Enter again once you can see the room.*
- nothing reached `game_send`. The harness records every call rather than
  trusting the message, because a held command that was quietly sent would
  look exactly like a held command that was not.

Then, with the link given up, a press **does** reach `game_send` and the lane's
own sentence comes back to the box: *Not sent — The connection is closed. Your
command is still here.* Those words are written in `closed_reason()`
(`src-tauri/src/game_link.rs`), and before this change the frontend's own
pre-check threw first, so they could never be read from the command bar.

## `reconnect-2026-09-07-stale.png` — issue #506

The Battle panel's own window (`?view=panel&id=room`), because the main
window's default layout renders no vitals cluster at either 1180x820 or
1600x1000 — asserting "the vitals are dimmed" against a document with no vitals
in it would pass for the wrong reason, so the run counts the rows first.

The bridge was dropped through `simulateBridgeStatus('reconnecting')`, which
calls the same `applyLiveStatus` the live subscription calls. The panel then
shows **last known, 3s ago** above the pools, and the pools themselves at
`opacity: 0.5` — read off the computed style, not off a class name, because a
class that stopped being generated and a class that generates nothing look the
same in the markup.

Measured in the same run:

- the character and script list are **kept**, not cleared. The deliberate
  disconnect path still clears them.
- `bridgeStaleSince` survives `simulateBridgeStatus('connected')`. The socket
  coming back is not the moment the numbers become current: Lich's replay is up
  to ten seconds late in DragonRealms (`src/lib/linkReplay.ts` has the source
  citation), so clearing on `connected` would put full contrast back over
  pre-drop readings for that whole window.
- a payload landing clears it, the note leaves the screen, and the pools go
  back to `opacity: 1`.

## What this run does not cover

Chrome is not the app. `isTauri()` is made true by a `__TAURI_INTERNALS__` stub
that records the listener `listenTauri` installs and hands it a `LinkState` on
demand; there is no Rust behind it, so anything gated on a real command's
*answer* is not exercised here. The Rust half of the reconnect — the backoff,
the bound, the lane's refusal and the wording of `closed_reason()` — is
asserted in `src-tauri/src/game_link.rs`'s own tests, where the schedule can be
read rather than timed.

The cheap checks that run on every build are
`tools/link-reconnect-test.mjs` (properties of the functions, including a
source census that no consumer of the link state tests `connected` inline) and
`tools/link-reconnect-break-check.mjs`, which damages the real files and
requires the named checks to go red.
