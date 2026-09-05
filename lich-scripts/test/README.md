# Bridge tests

Two things can be checked without a DragonRealms account, and both are worth
checking because both have already caught real bugs.

## `cmd_test.rb`

The command layer, against a fake game that refuses the way the real one does.

```bash
ruby lich-scripts/test/cmd_test.rb lich-scripts/companion_bridge.lic
```

DragonRealms refuses commands in three distinguishable ways, and every
community script handles all three:

```
...wait               you are in roundtime
still stunned         you are stunned
Sorry, you may only   a command-specific refusal
```

A refusal is not a result. Treating "...wait" as the answer is how you get a
button that appears to do nothing, which is the default failure mode in this
game. The test covers a clean reply, retrying past each of the three refusals,
giving up with nil rather than returning a refusal string, waiting out
roundtime before sending, and surviving an exception from the game layer.

## `protocol_harness.rb`

Stubs the Lich runtime so the bridge can serve real WebSocket clients outside
the game.

```bash
npm run test:protocol-harness
```

That starts the harness, drives it with the independent client in
`tools/ws-client.mjs`, asserts nine properties of the exchange, and stops the
process it started. It prints NOT CHECKED rather than passing if Ruby cannot
be found, and `DRC_HARNESS_PORT` moves it off 7419 when that port is busy.

It is deliberately outside `tools/test-suites.json` because it needs Ruby and
a free port; `npm run test:needs-env` lists it with that reason.

The two-shell form still works and is what you want while poking at the
protocol by hand:

```bash
ruby lich-scripts/test/protocol_harness.rb lich-scripts/companion_bridge.lic 7419
# then, from another shell:
node tools/ws-client.mjs
```

This is how the framing was verified in the first place: against an
independent WebSocket implementation rather than against itself. `ws` is a
devDependency now, so the old `npm install ws --no-save` step is gone.

## What these cannot check

Anything that talks to the actual game. The command layer is tested against a
fake, so the retry logic is proven but the specific text each intent matches on
is not. Those patterns come from reading community scripts and need a live
account to confirm.
