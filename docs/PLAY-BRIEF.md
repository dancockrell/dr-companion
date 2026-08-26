# How to play DragonRealms from a Claude session

Everything here is verified working as of 27 Aug 2026. Read it and start
playing; do not rebuild any of it.

## The connection

Genie 4.0.2.9 is running with a plugin I wrote: `genie-plugin/CompanionBridge.cs`,
already compiled and loaded. It publishes newline-delimited JSON on
**127.0.0.1:7416** and takes commands back on the same socket. No clicking, no
screenshots, no focus problems.

Check it is alive:

    node tools/genie.mjs send "#echo alive" 5

Expect `connected to DR Companion Bridge v0.2.0`.

## Commands

    node tools/genie.mjs watch 60           stream the game for 60s
    node tools/genie.mjs send "look" 4      send one command, show 4s of reply
    node tools/genie.mjs run script.txt 3   one command per line, 3s apart
    node tools/genie.mjs vars charactername health

**Comments in a script file are `//`, not `#`.** Every Genie client command
starts with `#`, so a `#` comment filter silently strips the whole file, sends
nothing, and exits 0. That bug cost an evening.

## The state of the character

Character is **Phemius** on Prime. At last check the Genie title bar said
`[Not connected]` - Genie's idle timer had issued `:quit`. If it is still
disconnected, ask Dan to press Connect; the permission gate reads the
Simutronics login modal as desktop shell and blocks a click from me. One click
from him and everything downstream works.

Genie's idle timer will quit the game on you. The warning line is
`GENIE HAS FLAGGED YOU AS IDLE, PLEASE RESPOND!` and you have about a minute.
Sending anything at all resets it, so do not go quiet for long stretches.

## What Dan asked for while playing

1. **Play aggressively.** Learn the game, do not narrate a plan for it.
2. **Do not write scripts for other players while he is at the keyboard.**
   His words: he does not want to be seen developing for them and get busted.
   Scripting for our own character is what he asked for.
3. **Build highlights and sounds from what you actually see**, into
   `C:\Users\Admin\dev\dr-genie-settings` (public repo,
   github.com/dancockrell/dr-genie-settings). `node validate.mjs` before every
   commit; it fails the build if the config gets noisy or a named sound is
   missing. Commit periodically, do not save it all for the end.
   Quote the real line in a comment above each highlight. Everything in that
   file was observed, not imagined, and it should stay that way.
4. **Feed what you learn back into dr-companion.** File issues on
   github.com/dancockrell/dr-companion rather than editing the app from the
   play session; I am working in that tree.

## Sound policy, which the validator enforces

Sound is for things you need to know when you are *not looking at the window*.
Colour is for finding things once you are. Twelve of forty-six entries have a
sound and that ratio is deliberate: a client that pings constantly is a client
people mute, and a muted client has no alerts at all.

`You feel fully attuned to the mana streams again` fires several times a
minute. It is coloured and silent, and the validator fails if that changes.

## Things already learned, so you do not relearn them

- Arrivals are **not** noise. Knowing who is in the room is most of what a MUD
  is, and the person who walked in might be a GM. Highlight and a quiet sound;
  never gag them.
- Departure verbs are per-player flavour: `runs east`, `swaggers east`,
  `goes west`. Match on direction, not on `leaves`.
- `You are relaxed and your mind has entered a light state of rest` means the
  character is learning nothing. Stated once, never repeated. AWAKEN fixes it.
- Do not open a second Genie window. There is one, it is Dan's, and launching
  another disconnects him.
