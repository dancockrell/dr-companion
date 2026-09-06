# The first screen, after the honest-default change

6 September 2026. Evidence for issue #382, which is defect 3 of
`first-run-2026-09-05.md`: on a clean VM the app opened on "In combat, 84 of
100 health", a character called Dan the Bold, room 308 in the Empaths' Guild
and eighteen people present, none of it real.

## How these were produced

```
npm run dev -- --port 5182
node tools/first-screen-shots.mjs http://127.0.0.1:5182/
```

`tools/first-screen-shots.mjs` drives a real browser through
`tools/browser.mjs` (the repo's own DevTools client), sets a profile that has
been through setup and stored nothing else - which is exactly the state the
first-run walkthrough was in - and then reaches each state by clicking the
control a person would click, not by a query parameter. It writes the two PNGs
beside this file and asserts fifteen things about what it saw. It printed
`all render checks passed`.

## a. Default, no flags: `first-screen-2026-09-06-empty.png`

Stored preferences: `{"setupComplete":true}` and nothing else.

The window shows the empty state and nothing else. In words on screen:

> **Nothing is connected yet.**
> Attach to Lich to see your own character, or start the demo to look around
> an invented one.

Below it, the Genie configuration lines that were already there, then two
buttons: **Start the demo** and **Connection help**. The bottom bar reads
`Bridge down`, `Idle`. No character name, no vitals, no room, no stat block,
no skills. The strings `Dan the Bold` and `84 of 100` do not occur anywhere in
the document.

## b. Demo on: `first-screen-2026-09-06-demo.png`

Reached by clicking **Start the demo**.

A band runs the full width of the window, immediately under the vitals row and
above everything else:

> `DEMO`  Demo: this is invented data. Attach to Lich to see your character.
> [ Leave the demo ]

The mock world is behind it - Dan the Bold, room 308, 18 others here, the stat
block, the skills. The existing small `MOCK` badge and the `Mock` corner
indicator are still there; they were not removed, because they answer "is this
live" at a glance for somebody who already knows the app, which is a different
question from the one a first-time user is asking.

## c. Demo off

Reached by clicking **Leave the demo**. The banner is gone, `Dan the Bold` is
gone from the document, and the screen in (a) is back. Not screenshotted
separately because it is pixel-for-pixel the (a) case; the assertions for it
are in the tool's output.

## What this does not show, and cannot

Chrome is not the app. `isTauri()` is false in a browser, so `LichLauncher` -
the attach control the setup flow uses - renders nothing here, which is why
(a) offers a route to attaching in prose rather than a Start button. **The
attach control's real behaviour is not exercised by any of this**: only its
presence in the empty state, and that only as a source check
(`tools/first-screen-test.mjs`, section 6). `tools/app-eyes.mjs` is the tool
that attaches to the real WebView2 and would be the way to check the rest.

The three states above are all real renders of the real components, and the
default in (a) is the shipped default with no flag, environment variable or
stored preference involved.
