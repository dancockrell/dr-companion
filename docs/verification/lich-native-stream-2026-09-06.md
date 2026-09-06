# Frontend identity and streams on the `.sal` route — 6 September 2026

Lane N, increment **N4**. This answers `docs/LICH_NATIVE_LOGIN.md` §7's
**inferred item 1**, which was the one open question that decided whether the
channel tabs can ever fill:

> Which of `resolve_headless_frontend`'s `'profanity'` and the `GAME=`-derived
> `'stormfront'` decides `Frontend.supports_streams?` at runtime.

**Answer, measured: neither, quite.** `supports_streams?` reads the global
`$frontend`; on this launch the only thing that ever writes `$frontend` is
`resolve_headless_frontend`, which returns **`'profanity'`**; and
`supports_streams?` is **`true`**. The `GAME=`-derived branch never runs. It
would also have said `true`, which is why this went unnoticed as an open
question for so long — the streams answer is the same either way and the
identity is not.

Lich 5.20.1 (`lib/version.rb:3`), Ruby 4.0.6.

---

## How this was measured, and why not by reading

Reading `front-end.rb` is what produced the open question in the first place:
two plausible writers, a predicate in a third file, and a trace nobody had
followed all the way. So the measurement executes **Lich's own code** —
`resolve_headless_frontend` and `Frontend.has_capability?` against Lich's own
registry — with the exact ARGV our launch produces. Nothing is reimplemented.

The ARGV is what `arg_normalization.rb:52-53` turns

```
lich.rbw <sal> --headless=11024 --start-scripts=companion_bridge
```

into before any option parsing:

```ruby
['<sal>', '--without-frontend', '--detachable-client=11024',
 '--start-scripts=companion_bridge']
```

Result:

```
resolve_headless_frontend -> "profanity"
$frontend:             "profanity"
Frontend.client:       "profanity"
supports_streams?:     true
supports_xml?:         true
supports_mono?:        false
supports_room_window?: false
supports_gsl?:         false
STREAM_FRONTENDS:      ["stormfront", "profanity", "saga", "wrayth"]
```

**The chooser, run where the wrong answers were available.** A resolver with
one reachable outcome would return `'profanity'` for anything, and the result
above would mean nothing. It discriminates:

```
["--saga",       "--detachable-client=11024"] -> "saga"       streams=true  mono=true
["--genie",      "--detachable-client=11024"] -> "genie"      streams=false mono=true
["--stormfront", "--detachable-client=11024"] -> "profanity"  streams=true  mono=false
[]                       [no detach port]     -> "unknown"    streams=false mono=false
```

Three things fall out of that table, all of them things this app depends on:

1. **`--genie` is the one flag that would still break the channel tabs.**
   `genie` → `streams=false`. `messaging.rb:21-48` gates every
   `<pushStream id=…>` / `<popStream/>` pair on `supports_streams?`, so the
   labels would simply not arrive and the text would look normal.
   `src-tauri/src/lich.rs` must never pass it.
2. **`--stormfront` is inert.** It resolves to `'profanity'` like everything
   else. It was dropped in N3 rather than kept as a talisman.
3. **Without a detachable port the identity is `'unknown'`**, whose
   capabilities are empty (`front-end.rb:112-121` returns `false` for any name
   not in the registry). So `--headless=<port>` is load-bearing for streams as
   well as for the socket.

## Why the `GAME=STORM` line does not reach it

`main.rb:359`:

```ruby
if ARGV.include?('--without-frontend')
  $_CLIENT_ = nil
elsif @argv_options[:pipe]
  ...
else
  if game =~ /WIZ/i
    Frontend.client = 'wizard'
  elsif game =~ /STORM/i
    Frontend.client = 'stormfront'
```

`--without-frontend` takes the first arm. The `'stormfront'` assignment at
`:375-376` is in the `else` and never executes on this path. The only
`$frontend` write that runs is `main.rb:320`.

`Frontend.client` and `$frontend` are the same thing, incidentally, which is
worth stating because the §7 question was phrased as though they were two:
`front-end.rb:407-415` defines `self.client` as `$frontend` and `self.client=`
as `$frontend = value`, and `supports_streams?(fe = $frontend)` at `:374-376`
reads that global by default and is called with no argument everywhere.

## `--frontend=` is a trap, not an option

`docs/LICH_NATIVE_LOGIN.md` named `'profanity'` and `'stormfront'` as
candidates for a `--frontend=?` flag if the answer had come back `false`. It
did not, so no flag is needed — and it is worth recording that the flag would
not have worked anyway. `argv_options.rb:98-99` parses `--frontend=(.+)` into
`@argv_options[:frontend]`, and **nothing anywhere reads that key**. There is
also a space-separated `--frontend <name>`, scoped to `--add-account` only
(`cli_orchestration.rb:114`).

The flags that do set frontend identity are the boolean ones:
`-s`/`--stormfront`, `-w`/`--wizard`, `--avalon`, `--frostbite`, `--saga`
(`argv_options.rb:385-399`), plus `--genie` and `--saga` on the headless path.
`--wrayth` and `--profanity` do not exist; `src/lib/frontends.ts` claimed both
until this increment.

## What this buys, and what it costs

| Capability | `profanity` (ours) | `genie` (the route we left) | Reaches this app? |
|---|---|---|---|
| `xml` | yes | yes | yes — the whole stream |
| `streams` | **yes** | **no** | yes — the channel tabs |
| `mono` | no | yes | no |
| `room_window` | no | no | no |

`mono` only decides whether Lich wraps its own injected `Room Exits:` /
`Room Number:` lines in `<output class="mono"/>` (`games.rb:64-66`, `:80-82`).
`room_window` only injects a duplicate `<streamWindow>` of the exits
(`games.rb:1364-1367`). The app parses room state from its own bridge commands
and reads neither, so both losses are inert — for two independent reasons, not
one shared one.

**So the Genie warning at `LichLauncher.tsx:283` described a real cost, and
Lane N removes it.** The channel tabs can fill for the first time.

## The state replay on attach — NOT CHECKED, and why

`detachable_client_send_init` (`global_defs.rb:2306-2343`) sends a newly
attached client a synthetic snapshot — progress bars, spell, indicators,
compass — and is suppressed only for `--genie` and `--saga`
(`global_defs.rb:2357-2361`, which keys on **ARGV tokens**, not on `$frontend`
and not on a capability). Our launch passes neither, so it should arrive.

**It was not observed arriving, and this is not a pass.** A real Lich was
started from a `.sal` against a loopback stand-in game server, the app's own
port 11024 was attached to, and the connection was held for 22 seconds:

```
2026-09-06 16:32:22: info: detachable client server listening on 127.0.0.1:11024
2026-09-06 16:32:23: info: detachable client connected (1 attached)
2026-09-06 16:32:45: info: detachable client cleaned up (0 attached)
```

Zero bytes reached the client in that window — no init burst, and no reply to
commands sent up the socket. Lich logged no error from
`detachable_client_send_init`, so it is not failing; the likeliest reading is
that a detachable socket's write path does not drain before the session has a
real game stream (`synchronizedsocket.rb:173` gives a `:detachable` socket a
stream stack seeded with an attachment sentinel), and there is no real game
here to produce one. **That is a hypothesis and it is written as one.**

What would settle it is N7 — Dan signing in with a real account — and the
replay is on N7's checklist. Until then:

- the **fixture** covers the shape: `tools/fake-lich.mjs` mirrors the init
  burst tag for tag from `global_defs.rb:2306`, and `tools/stream-state-test.mjs`
  asserts against it;
- the **suppression rule** is read, not measured: it keys on ARGV and our ARGV
  has neither token.

Recording this as unknown rather than folding it into either a pass or a
failure is the point. A run that skipped something must not be able to say it
passed.

## What changed in the app because of this

- `src/lib/frontends.ts` gains `APP_LAUNCH_IDENTITY = 'profanity'` and
  `APP_LAUNCH_PREFIX = ';'`, with the measurement cited, and loses two
  `lichFlag` values that named flags Lich does not have.
- `tools/frontend-test.mjs` asserts the identity, asserts the prefix *follows
  from* it rather than beside it, and checks every non-null `lichFlag` against
  the set Lich actually parses — with a positive control proving that set
  rejects `--profanity` and `--wrayth`.
- `tools/fake-lich.mjs` gains `--frontend <profanity|genie|stormfront|saga>`,
  default `profanity`. Under `--frontend genie` it strips the stream wrappers
  exactly as `messaging.rb:31-40` does, so **the empty-channel-tabs state is
  now reachable on purpose**, without a Genie and without an account. It was
  not reachable at all before.
- `tools/detachable-port-test.mjs` is new: one port in one place, checked
  rather than claimed.

## Reproducing the measurement

`ruby identity.rb` where `identity.rb` requires `common/front-end` and
`common/authentication/login_helpers` off `C:\Ruby4Lich5\Lich5\lib`, stubs
`Lich::Util.install_gem_requirements` (that file calls it at load time and it
needs the whole boot sequence; the method under test is untouched), and calls
`LoginHelpers.resolve_headless_frontend(argv, detachable_client: true)`
followed by `Frontend.client = …` and the `supports_*?` predicates. The script
is not in the repo — it reaches outside it into an installed Lich — and the
recipe above is complete.
