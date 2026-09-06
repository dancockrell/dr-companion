# The pop-out windows, measured in the real app

6 September 2026. Two things were left open by the packaged-build runs behind
PRs #409, #429 and #431, and both were open for the same reason: nobody had
driven **two real WebView2 windows of one process** at once.

- **#409** put the demo banner in every window and said plainly that the
  pop-out half was never seen, because at the time of that run the pop-out
  rendered blank white.
- **#429** made the demo mode one fact across every window, and said plainly
  that its **Tauri transport had never been executed** — Chrome is not the app,
  `isTauri()` is false there, so only the localStorage transport had ever run.
- **#431** fixed the blank window, and recorded in the #419 entry of
  `docs/verification/first-run-2026-09-06.md` that the pop-out then came up
  showing the map panel's "No bridge" state rather than the demo — an ordinary
  unchecked item rather than a blank one.

This is that measurement. Everything below was observed on a release build of
this branch; where something was not, it says so.

| | |
|---|---|
| Binary | `src-tauri/target/release/dr-companion.exe`, built by `npm run tauri:build` from this branch |
| Driven by | CDP, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9341` |
| Profile | `WEBVIEW2_USER_DATA_FOLDER` pointed at a throwaway directory under the system temp folder, so nothing here read or wrote an installed app's data |
| Started from | `bridgeMode: 'live'`, `setupComplete: true`, and then the app's own **Start the demo** button — not a seeded `mock` |
| Screens | `popout-mode-2026-09-06.png` (the map pop-out, in the demo), `panel-controls-2026-09-06.png` (the main window with the map header on screen). The `panel-controls-browser-*` shots beside them are the browser check in section 5, named apart on purpose: a browser shot and a WebView2 shot under one filename would be two different claims wearing the same name. |

---

## 1. Does a pop-out come up in the demo when the main window is in it?

**Yes, and it always did.** The mode a pop-out opens in comes from the
persisted preference — `initialBridgeMode(prefs.bridgeMode)` ->
`selectBridgeMode(stored, search)` — and both windows are
`http://tauri.localhost`, so both read the same `dr-companion-prefs-v1` key.
`setBridgeMode` writes that key before the window is opened, so by the time the
pop-out's store evaluates, the answer is already on disk.

Measured, main window in the demo, then `open_panel_window('map')`:

```
MAIN in the demo   storedMode=mock  banner=true  character="MOCK Dan the Bold Room 308 · Empaths' Guild…"
POPOUT at open     storedMode=mock  banner=true  leaveDemo=true  who="Dan the Bold"
```

The compact banner from #409 is present in the pop-out, with its **Leave the
demo** button, and the invented character is there. So #409's "unverified" note
is now verified in the real app rather than in a browser.

The same reading over **all twelve panels in the registry**, each opened as its
own real window and read at 1180x820 and 720x480: every one carried
`Demo: this is invented data. Attach to Lich to see your character.` and its
**Leave the demo** button. Not one came up outside the demo.

### Why #431's run saw "No bridge", and this one does not

Not established, and it is worth saying so rather than inventing a reason. What
is established is that on this build, from a `live` profile taken into the demo
by the app's own button, twelve out of twelve pop-outs came up in the demo. The
route by which #431's single run saw otherwise is not reproducible here, so this
supersedes it by measurement rather than by argument.

## 2. #429's Tauri transport, run for the first time

`src/lib/bridgeModeSync.ts` has two transports. Only the browser one had ever
been executed; the Tauri one was, in #429's own words, "a four-line emit/listen
pair … but it has not been executed."

It has now, in both directions, between two real webviews:

```
main leaves the demo   -> POPOUT banner=false  storedMode=live
main starts it again   -> POPOUT banner=true   storedMode=mock
pop-out leaves the demo-> MAIN   banner=false  storedMode=live
```

**It works.** No echo storm, no window left behind, and the persisted
preference agrees with both running windows at every step. That is a negative
result — nothing to fix — and it is recorded here because it is the one nobody
re-derives.

## 3. The map's own pop-out window was rendering the wrong thing

Found by looking at the artefact rather than by looking for it. Before the
change on this branch, `?view=panel&id=map` came up reading:

```
Demo: this is invented data. Attach to Lich to see your character. / Leave the demo
MAP / · / Dan the Bold / Bring it back
Open in its own window, where it is big enough to watch.
```

That is the placeholder whose entire job is to tell you the map is in a window
somewhere else — rendered **inside that very window**, with no map in it. So
`open_panel_window('map')`, the control this lane is about, has never produced a
usable window: before #431 it was blank, and after #431 it was this.

The cause is one boolean answering two different questions.
`usePanelWindows()` reports which panels have windows of their own, and it
reports that honestly to *every* webview of the process, the popped-out one
included. `MapPanel` read it as "the map is somewhere else". The window that
**is** somewhere else cannot tell from that registry alone; only the document
knows which window it is.

Fixed at that seam: `src/lib/windowView.ts` now owns the query parsing that
`App.tsx` used to keep to itself, and adds `isOwnPanelWindow(id)`. `MapPanel`
asks both — the registry for whether such a window exists, the document for
whether it is this one. `App.tsx` imports the parser rather than keeping a
second copy; `MAP_WINDOW_ENABLED` stays where it is, because it gates a branch
rather than the parsing.

After the change, the same window renders the map.

## 4. The pop-out control at `left: 2685` — not reproduced

Issue #435 records `MapPanel`'s "Open the map in its own window" button
measuring `left: 2685` on the packaged app at the default window size. **It does
not reproduce on this build, at any size measured**, and the reason is worth
having because it is not "the report was wrong":

```
MAIN 1180x820    mapBtn absent      (the app default)
MAIN 720x480     mapBtn absent      (the declared minimum)
MAIN 1180x1000   left=793  right=815   in a  652px header, window 1180
MAIN 1600x1200   left=1124 right=1146  in a  902px header, window 1600
MAIN 2560x1440   left=1881 right=1903  in a 1473px header, window 2560
```

Wherever the control renders it is comfortably inside the window. At the app's
**default and minimum sizes it does not render at all**, and that is deliberate
and documented: `App.tsx` hides the map column when the board slot is shorter
than `MIN_MAP_H + MIN_BATTLE_H + SPLIT_W` (548 px) and says so in words —
`Map hidden while the window is this short. Enlarge it to restore your saved
map height.` Measured board heights: 370 px at 1180x820, 450 px at 1180x900,
550 px at 1180x1000, which is where the map appears.

So at the app's own default size there is currently no route to the map's own
window from the main window. That is a real gap and it belongs to whoever owns
the board-slot arithmetic, not to this lane; it is recorded here rather than
quietly folded into "the control is fine".

**The instrument, so the negative result can be re-derived**: the numbers above
came from `getBoundingClientRect()` on the element whose `aria-label` is
`Open the map in its own window`, read over CDP from the release binary, with
`Emulation.setDeviceMetricsOverride` for each size. A control that is *absent*
and a control that is *outside the window* are different answers and the probe
distinguishes them — `absent` above is the probe saying it found nothing, not a
zero it inferred.

## 5. The check that now guards the class

`tools/panel-controls-shots.mjs`, with its probe and size list in
`tools/panel-controls-probe.mjs`. It needs a dev server, the same way
`tools/first-screen-shots.mjs` does:

```bash
npx vite --port 5182 --strictPort
node tools/panel-controls-shots.mjs http://127.0.0.1:5182/
```

At 1180x820 and 720x480 — the app's `REQUESTED` and `MIN` from
`src-tauri/src/window_size.rs` — it opens the main window and every panel route
in the registry and asserts no control inside a `<header>` has a rect ending
past `innerWidth`. It reports the header's own width beside each escape, which
turns "this button is at 2685" into "this header is 3000 px wide inside a
1180 px window".

Three denominators have to be met before it will conclude anything: every panel
in `PANEL_TITLES` was reached at every size (the list is parsed from the source
and the parse throws rather than returning a short one), every document actually
rendered the app (the demo banner is the marker), and the Tauri stand-in took,
so that the `isTauri()`-gated pop-out controls existed to be measured at all.

### Sabotage

| sabotage | result |
|---|---|
| `w-[3000px]` on `MapPanel`'s `Shell` header | **3 failed**, exit 1, naming the window and the size: `"Open the map in its own window" at 2908..2930 in a 3000px header, window 1180px`, and again at `window 720px` |
| the `addInit(TAURI_STUB)` call removed | **1 failed**, exit 1: `the Tauri stand-in took … 0 isTauri()-gated control(s) measured across the run` — and only that one, so the checks are not entangled |
| `DRC_PANELS_SRC=package.json` | aborts: `PANEL_TITLES was not found in panels.tsx - this probe cannot say anything` |
| `DRC_PANELS_SRC=` a registry with two panels | aborts: `only 2 panels parsed out of PANEL_TITLES; the registry has more than that, so this parse is broken` |

`DRC_PANELS_SRC` exists so those last two branches can be run on purpose rather
than reasoned about. Restored from the pre-sabotage `md5sum` each time and the
unmodified run re-run green afterwards — `no failures`, exit 0 — because a fix
that passes only under sabotage is not a fix.

## What was not tested

- **A real Lich connection.** Everything here is the demo bridge.
- **The VM.** This is the release binary on the development machine, not a
  clean-install run; `docs/verification/first-run-2026-09-06.md` owns that.
- **Whether the map column should be hidden at 1180x820 at all.** Measured and
  reported in section 4, not changed.
- **`?view=map`.** `MAP_WINDOW_ENABLED` is false and nothing in `src/` opens it.
