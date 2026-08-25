# Testing this against a live game

Nothing in this app has ever talked to DragonRealms. Everything below the
WebSocket has been tested against fakes, which proves the plumbing and proves
nothing about the game.

This document says what is likely to be wrong, how to find out, and what to
send back. It is deliberately specific about where the weak points are, because
a tester who knows where to push finds things faster than one who wanders.

## Setting up

1. Get Lich running with your usual frontend.
2. Copy `lich-scripts/companion_bridge.lic` into Lich's `scripts` folder. The
   app will do this for you from the setup screen if it can find Lich.
3. In game: `;companion_bridge`
4. In the app: Settings → Bridge → **Live Lich**
5. Open the **Console** at the bottom and turn **trace** on.

If the bridge will not start, `;companion_bridge stop` then start it again. It
refuses to run twice on the same port on purpose.

## Turn trace on before you do anything

The console is the whole point. With trace on, every command the bridge sends,
every reply, and every failed match is recorded. Without it, a failure looks
like a button that did nothing, which tells nobody anything.

The **problems** filter shows only the rows that mean something went wrong:

| Row | Means |
|---|---|
| `no_match` | We sent a command and nothing we expected came back. **The most useful failure.** The row includes the pattern that failed and how long we waited. |
| `refused` | The game said `...wait`, `still stunned` or `Sorry, you may only`. Retried automatically; only a problem if it repeats. |
| `gave_up` | Refused three times running. |
| `error` | An exception. Should not happen; if it does, that is a bug in the bridge. |

**Copy** puts the whole console on the clipboard, oldest first, ready to paste
into an issue.

## What is most likely broken

In rough order of confidence that something is wrong:

### 1. Every game-text pattern

All of them are in `Companion::Patterns` at the top of the bridge script. They
came from reading community Genie scripts, not from a live account.

A `no_match` row means a pattern is wrong. The fix is usually one line, and the
thing that makes it possible is the raw game text, which is why the trace keeps
it. If you can also paste what the game printed in your own client, that
settles it.

### 2. Status flags

`State#situation` reads `XMLData.indicator` and guesses at names like
`IconDEAD`, `IconSTUNNED`, `IconBLEEDING`. Those names are from the shared
Simutronics XML protocol and are **not confirmed for DragonRealms**.

Worth checking: get stunned, get bleeding, die. Does the panel notice? If the
situation chips never appear, the indicator names are wrong.

### 3. The instance mapping

`State#instance` maps `XMLData.game` through `DR`/`DRX`/`DRF`/`DRT` to
Prime/Platinum/Fallen/Test. If your instance reads Unknown in the header, that
map is wrong for your game, and travel will refuse everything as a result.

### 4. Vital maxima

Vitals are reported as percentages with `healthMax: 100` hardcoded. If DR
reports something other than a percentage, the bars will be nonsense.

### 5. Room and location

`Room.current` needs Lich's map database. Without maps, `roomId` and `zone` are
nil and the location line falls back to the room title. That is expected, not a
bug, but it is worth confirming it degrades quietly rather than throwing.

## What is worth trying, in order

**Read-only first.** None of this sends anything to the game.

- Does the character name, guild, circle and favor count look right?
- Open **Training**. Do your skills appear with plausible ranks, and does the
  mindstate label match what `EXP` shows in game? This is the single most
  valuable check in the app, because mindstate is the thing everything else is
  built on.
- Wound yourself and watch the Situation banner.
- Walk between rooms. Does the location update?

**Then the safety controls.** These are the ones that must not fail.

- Start any Lich script, then press **Stop all**. Everything except the bridge
  should die. Try it while in roundtime, while stunned, and while dead.
- **Pause** and **Resume**.
- Break the connection deliberately: `;companion_bridge stop` while the panel
  is connected. The panel should notice, back off, and reconnect when you start
  it again. It should not spin.
- Let the game sit idle long enough to be disconnected. The panel should
  eventually say the game clock has stopped rather than claiming to be
  connected.

**Then the two intents that touch the game.**

- `check_health` — read-only. Reports wounds and bleeders.
- `stow_all` — puts what is in your hands away.

Everything else refuses with `ok:false` and a reason. That is on purpose, not
an error: an intent that is not implemented says so rather than silently doing
nothing.

## What is not implemented, so do not report it

- Travel, hunting, town runs, buffs, looting, house entry. The bridge reads
  state and stops scripts. It does not drive the game yet.
- Vault, bank and container capacities. Inventory reports containers but not
  how full they are.
- Wound severity per body part. `check_health` reports counts, not a chart.

## Reporting

Useful:

- The **Copy** output from the console, with trace on
- What you did and what you expected
- Your guild, instance and account type, since most of the logic branches on
  those
- Lich version and frontend

Especially useful: a `no_match` row plus the line your own client printed. That
pair is enough to fix a pattern without guessing.

## Running the offline tests

Neither needs a game or an account.

```bash
ruby lich-scripts/test/cmd_test.rb lich-scripts/companion_bridge.lic
```

Ten assertions on the command layer: retrying past each of the three refusals,
giving up cleanly, waiting out roundtime, surviving an exception.

```bash
ruby lich-scripts/test/protocol_harness.rb lich-scripts/companion_bridge.lic 7419
npm install ws --no-save && node tools/ws-client.mjs
```

Serves the real protocol to a real WebSocket client with the Lich runtime
stubbed. This is how the framing was verified in the first place.
