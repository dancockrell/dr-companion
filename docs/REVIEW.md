# Code review: DR Companion, builds A and B

Reviewed 25 Aug 2026 against the two packaged zips as shipped, before any
cleanup. Commit `build-b` is the tree this describes. Findings are ordered by
what would hurt a real user first.

The premise throughout: the intent is sound and the execution is what is under
review. Nearly every finding below is a case of the right idea written down
correctly in a doc or a type, then implemented as a stub, a hardcoded constant
or an empty return. The fix is almost never to remove the feature. It is to
finish it.

---

## 1. Build B does not build

`src/lib/accountCapabilities.ts` is zero bytes. It is the only source of
`capabilitiesFor`, `capabilitiesForCharacter` and `intentBlockReason`, which are
imported by eight modules: `mockBridge`, `hunting`, `townRun`, `travelPath`,
`PowerDashboard`, `InventoryPanel`, `PresetBar`, `ScriptLauncher`.

`npm run build` fails with ten errors. Verified against the tree, with the file
restored to its zero-byte state:

```
src/bridge/mockBridge.ts(8,10): error TS2305: Module '"../lib/accountCapabilities"'
  has no exported member 'capabilitiesForCharacter'.
src/data/hunting.ts(8,10): error TS2305: ... has no exported member 'capabilitiesFor'.
src/data/townRun.ts(7,10): error TS2305: ... has no exported member 'capabilitiesFor'.
src/data/travelPath.ts(13,10): error TS2305: ... has no exported member 'capabilitiesFor'.
[6 more]
```

`npm run dev` serves a white screen with a missing-export error in the console.
The file survived intact in Build A and was restored from there. With it back,
`tsc -b && vite build` completes clean in 3.6s.

`src/data/hunting.ts.bak` also shipped, an editor backup of the older stub
version of the hunting data.

**Fix:** done, in the commit after `build-b`.

---

## 1b. The lockfile points every dependency at a build-box IP

All 111 `resolved` URLs in the shipped `package-lock.json` read like this:

```json
"resolved": "http://35.245.43.102/npm/%40jridgewell%2Fgen-mapping/-/gen-mapping-0.3.13.tgz"
```

A bare IP address, over plain HTTP, on a host nobody outside whatever machine
built the zip can reach. `npm config get registry` on a normal machine returns
`https://registry.npmjs.org/` and `npm ping` succeeds, but `npm install` still
fails, because the lockfile overrides the registry per package:

```
npm error network request to http://35.245.43.102/npm/zustand/-/zustand-5.0.15.tgz
npm error network failed, reason: connect ETIMEDOUT 35.245.43.102:80
```

Every person who clones this repo hits that, and the error blames their network
rather than the lockfile, so they will spend a while looking in the wrong place.
For a project whose whole pitch is that it is easy to get running, this is the
first thing a new contributor would have met.

Plain HTTP is the second half of the problem. Tarball integrity hashes in the
lockfile do protect against tampering, but shipping a dependency graph that
resolves over unencrypted HTTP to an unnamed IP is not something to publish.

**Fix:** done. Deleted and regenerated against `https://registry.npmjs.org/`.
All 124 entries now resolve there, and the tree installs and builds from a clean
clone. Worth checking any future zip for the same thing, since it comes from the
build environment rather than from anything in the source.

---

## 2. The setup wizard is supposed to install Ruby and Lich. It fakes it.

`SetupWizard.tsx` reports "Genie: Detected (mock)" and then "Ruby: not found",
"Lich: not installed". Pressing **Confirm and Install** runs two `setTimeout`
calls and lands on a green check reading **"Installed successfully"**. Nothing
was downloaded. Nothing was configured. `handleFinish` then enters the dashboard
as though the toolchain is ready.

There is a disclaimer in 11px grey text at the bottom of the screen. It does not
undo a green checkmark that says installed.

The feature is the right one. Getting Ruby and Lich installed is the single
biggest barrier between a curious player and a working setup, and a wizard that
handles it is most of this project's value to a newcomer. Nothing is wrong with
the idea. What shipped is a green checkmark reading "Installed successfully"
over an empty function, and a first-time player will believe they now have Lich.

**Fix:** build the real thing. It divides cleanly:

*Detection* is the easy half and unblocks everything else. Tauri can run a
command and read its output, so:

- Ruby: run `ruby -v`, parse the version, check it meets Lich's minimum
- Lich: look for `lich.rbw` in the usual locations, and check the version
- Genie: look for the installed client and its config directory
- Bridge: check whether `companion_bridge.rb` is in Lich's scripts directory
- Maps: check for the map database Lich uses for pathing

Each detection result feeds the `SetupComponent` status that already exists.
That alone turns the wizard truthful without installing anything.

*Installation* is the half that needs care, because it downloads and executes
code on someone's machine:

- Ruby: hand it to `winget install RubyInstallerTeam.Ruby` rather than
  fetching an installer yourself. Winget handles the signature checking, and
  the user can audit the command.
- Lich: fetch from the official source over HTTPS, show the URL and the
  resolved version in the UI before downloading, and verify a checksum.
- Never install silently, never elevate, and never proceed past a failed
  verification. Show the actual command being run and its actual output. A
  player who can see `winget install RubyInstallerTeam.Ruby` scroll past will
  trust the tool more than one who sees a spinner.
- Every step needs a real failure state. Right now there is a `SetupStatus` of
  `'error'` in the type union that nothing ever sets.

Until the install half exists, detection plus a link and a copyable command is
already a good wizard, and it is honest. The mock timers should go either way:
they are the part that makes a claim the program cannot back.

Note this needs `src-tauri/capabilities/` and the shell or process plugin
properly permissioned, which finding 10 covers.

---

## 3. Stop is gated behind the connection it is meant to interrupt

`useAppStore.requestIntent` refuses every intent, `stop_all` included, unless
`bridgeConnected && character.connected`:

```ts
if (!bridgeConnected || !character?.connected) {
  addLog('Not connected — cannot run intent: ' + intent)
  return
}
```

The bridge contract states Stop is always available, and `SafetyFooter` is built
around that promise. But `character.connected` is a flag the *game* side sets. A
live socket with a stale or false `connected` flag produces a Stop button that
logs a line and does nothing, at exactly the moment a player is mashing it.

**Fix:** exempt `stop_all`, `pause` and `escape` from the gate. Send them
whenever the socket is open, and when it is not, say so on the button rather than
in the log.

---

## 4. Tier gating is documented as mandatory and implemented as `return null`

```ts
export function intentBlockReason(_intent: string, _c: CharacterStatus): string | null {
  return null
}
```

`BRIDGE_CONTRACT.md` carries a table of F2P restrictions (reject travel outside
Zoluren, skip vault, never offer Fang Cove) under the heading "Capability-aware
rule (mandatory)". `mockBridge.handleIntent` calls `intentBlockReason` first, so
the entire gate is one function returning null. Every intent passes.

The scoring modules do enforce tier, separately and correctly, inside
`scoreHealers` and `rankHuntingGrounds`. So the gate is not needed for those
paths, which makes the empty function worse rather than better: it looks like
enforcement and is not.

**Fix:** implement it from the doc's own table, or delete it and move the
statement to where the enforcement actually lives.

---

## 5. Healer selection ignores where the character is

The contract says never pick by room distance alone. The code went past that to
using no distance at all.

`HealerOption.pathDifficulty` is a fixed integer per healer, not a distance from
anywhere. `mobilityScore` is hardcoded to `55` in both `mockBridge` and
`PowerDashboard`. `character.location` is never read by `scoreHealers`. A
character bleeding out in Ratha and one standing in Crossing get the same
ranking, and Crossing Empath Guild wins both.

**Fix:** pass current location into `HealerScoreContext` and make
`pathDifficulty` relative to it. Proximity should be one weighted factor, which
is what the contract was asking for.

---

## 6. `instance: 'Unknown'` produces zero healers and zero hunting grounds

Both scorers reject on exact instance mismatch:

```ts
if (option.instance !== ctx.instance) { rejected = true }
```

`GameInstance` includes `'Test'` and `'Unknown'`, and `'Unknown'` is what a real
bridge will send whenever Lich cannot identify the instance. Every option is
rejected, `pickBestHealer` returns `null`, and the UI shows "No healer route".

The account-tier code treats `'unknown'` conservatively as F2P, which is the
right instinct. The instance code has no equivalent.

**Fix:** treat `'Unknown'` as Prime with a visible caveat, or refuse the intent
with a message that names the real problem.

---

## 7. Prime geography runs against Fallen sessions

`BRIDGE_CONTRACT.md`: "Never run Prime navigation data against a Fallen
session."

`planTravel` does exactly that. Every entry in `TRAVEL_DESTINATIONS` is Prime
geography with no `instance` field. On a Fallen character the planner builds a
Prime route and appends a note:

```ts
reasons.push('Fallen geography may differ from Prime labels')
```

A soft note is not the rule the document states.

**Fix:** give destinations an `instance` field and filter, the way healers and
hunting grounds already do.

---

## 8. Live-mode status listener leaks on every connect

`connectBridge` subscribes and throws away the unsubscribe:

```ts
bridge.onLiveStatus((status, detail) => { ... })   // return value discarded
```

`RealBridge.statusListeners` is a `Set` that is never pruned. `RealBridge`
reconnects every 3s forever with no backoff and no attempt cap, and each
reconnect cycle plus each Mock/Live toggle adds another listener. Log lines
duplicate, then quadruple. `unsubBridge` is handled properly a few lines above,
so the omission looks like an oversight rather than a decision.

**Fix:** store and call it in `disconnectBridge`, alongside `unsubBridge`. Add
exponential backoff to the reconnect while you are in there.

---

## 9. Buttons that do not do what they say

- `SimpleDashboard`: `primaryIntent = inCombat ? 'start_training' : 'start_training'`.
  Both branches are identical. The button reads **Combat Assist** in combat and
  sends `start_training`.
- **Safe** (both dashboards) sends `stop_all`. The `escape` intent exists in
  `IntentName`, is described in the contract as "emergency exit to safety", and
  is never dispatched from anywhere in the UI.
- **Stow all** in `InventoryPanel` sends `stow_all`, which falls through
  `mockBridge`'s switch to `default` and logs "Intent received: stow_all".
- Demo buttons (Low health, In combat, Safe again) are hardcoded into all three
  dashboards and stay visible in Live mode, where `bridge.simulateLowHealth()`
  no-ops silently. Click, nothing, no feedback.

---

## 10. The Tauri build cannot produce the executable Build B is about

Build B exists to ship a double-clickable `.exe`, and the packaging is not there
yet:

- `src-tauri/icons/` contains one file: a 99-byte 32x32 PNG with no alpha
  channel. Tauri's icon pipeline requires RGBA, and the Windows NSIS and MSI
  bundlers require an `.ico`. There is no `.ico`.
- There is no `src-tauri/capabilities/` directory. `tauri-plugin-shell` is a
  dependency and is initialised in `lib.rs`, but with no capability file none of
  its commands are reachable. It is dead weight in the binary, and shell
  execution is not weight you want to carry for nothing.
- `"csp": null` disables the content security policy outright. Low severity for a
  localhost app, but it is an explicit security-off setting in something headed
  for public release.
- The bundle identifier is `online.elanthia.dr-companion`. **elanthia.online is
  someone else's**, the org behind Lich 5 and dr-scripts. Shipping under their
  reverse-DNS namespace, into their community, will read as impersonation
  whether or not it is meant that way. Change it before anything is published.
- `greet` in `lib.rs` is leftover Tauri scaffolding.

---

## 11. TypeScript strict mode is off

`strict` appears in none of `tsconfig.json`, `tsconfig.app.json`,
`tsconfig.node.json`. No `strictNullChecks` in a codebase whose central type is
`character: CharacterStatus | null`, threaded through every component and guarded
by hand each time.

`noUnusedLocals` and `noUnusedParameters` are on, so the intent was there. Turn
`strict` on now while the tree is 5,500 lines and the fixes are cheap.

Related: `guild: (character.guild as any)` in `PowerDashboard` casts a
free-string to `GuildId`. `character.guild` is `string | undefined` and nothing
validates it against the twelve guilds, so a typo silently becomes an unknown
profile.

---

## 12. Duplication that will drift

- The three dashboards are roughly 90% identical markup. Header, vitals, quick
  actions and log are copy-pasted three times. The `primaryIntent` bug in
  finding 9 exists in `SimpleDashboard` and is fixed in `StandardDashboard`,
  which is exactly how this goes.
- `SettingsSheet` reimplements the tier filter inline instead of calling
  `filterTrainFocusForTier`, which is exported from `training.ts` and unused.
- `ScriptLauncher` renders an Activities list underneath a Quick Actions grid
  that triggers the same intents.
- Every component reads the store with bare `useAppStore()` destructuring rather
  than selectors, so each of the 120 log lines re-renders the whole dashboard.

Dead exports: `ENTRY_ROOMS`, `formatRankBand`, `listReachable`,
`describeTrainingPlan`, `filterTrainFocusForTier`, `getBridgeDefaultUrl`.

---

## 13. Smaller things

- `tools/mock-lich-server.mjs` imports `ws`, which is not in `package.json`.
  `npm run mock-lich` fails on a clean clone with a module-not-found error. The
  file comments tell you to `npm install ws --no-save`; the script itself does
  not degrade or explain.
- `bridge.setLiveUrl` and `getBridgeDefaultUrl` are never called. The bridge
  contract says the port is configurable. It is hardcoded.
- `SafetyFooter` computes busy state by matching activity strings against a
  whitelist `['Ready', 'Stopped', 'Paused', 'Healed — Ready']`. Any new activity
  string reads as Active forever, and the last entry is matched by literal em
  dash.
- Fang Cove is `province: 'Ilithi'` in `travelDestinations.ts`,
  `province: 'Zoluren'` in the `premium_prime` preset, and `inZoluren: true` in
  `healers.ts`. Three answers. Checked since: Ilithi is correct, so
  `travelDestinations.ts` is right and the other two are wrong. (An earlier
  version of this line said Fang Cove was its own premium area. That was wrong.
  See `DOMAIN.md` section 5.)
- `capabilitiesFor` gives `hasVault: !f2p`, so Basic accounts get a vault.
  Checked since: broadly correct, but F2P can buy vault expansions up to 250
  items, so the boolean is incomplete rather than wrong. The
  `vaultApproximateCapacity: 500` beside it has no basis.
- `bankDepositCap: 100000` and `bankCapPlatinum: 10` are bare numbers with no
  unit anywhere near them. Checked since: both are correct and they are the
  *same* cap in two units, since 10 platinum is 100,000 copper. Redundant, not
  contradictory.
- `estimatedHops: steps.length` counts narrative steps, not rooms.
- `combatMachine` transitions `retreating -> safe -> escaping -> safe ->
  stopped`. Retreating into escaping reads backwards, and the machine is only
  ever run as a one-shot log dump in `mockBridge`, never driven by real events.
- `guildAdjust` overwrites `note` on each matching branch, so only the last
  reason survives.
- `mockBridge` `escape_heal` sets `scripts = ['uber-heal']` and emits a script
  named `uber`. Given `GAME_KNOWLEDGE.md` explicitly rules out shipping Uber
  Combat, borrowing its name in the mock is worth renaming.
- `noobChecklist.ts` references `NOOB.ARMOR`, a third-party Genie script, in
  user-facing copy.
- Indentation is visibly broken around the `PresetBar` call in both
  `SimpleDashboard` and `StandardDashboard`, and around `ScriptLauncher` in
  `PowerDashboard`. Cosmetic, but it is the tell of hand-patching.

---

## 14. One thing to decide before release, which is not a bug

The house-entry feature automates the in-game burgle system: entry method, room
search loop, guard checks, leave-on-footsteps, guild-specific stealth prep. The
mechanics are public and the implementation here is original.

But a polished burglary tool, released into official community channels under a
friendly name, is the feature that will attract attention regardless of how the
rest of the project is framed. It is worth deciding on purpose whether it ships
in v1, ships behind a flag, or waits. That is a positioning call, not a technical
one, and it is better made now than in a forum thread.

---

## What is genuinely good here

Worth saying, because the list above is long.

The bridge split is the right architecture. Keeping the Companion out of the
game stream, and pushing all game logic behind high-level intents over a
localhost socket, means the UI can be thrown away and rewritten without touching
anything that matters. That decision will still be paying off in a year.

The scoring modules are the real work. `scoreHealers` and `rankHuntingGrounds`
return their reasons alongside their scores, and Power mode renders those
reasons in the UI, rejected candidates included. A tool that shows why it chose
something is a tool players will trust and correct, which is the difference
between a script people run and a script people adopt.

`GAME_KNOWLEDGE.md` draws the line between public mechanics and other people's
script code before any of it was needed. That does not usually get written down
until after someone complains.

And the three density modes are a real insight about the audience rather than a
UI flourish. Simple mode exists because a player who is bleeding does not want a
ranking table.

---

## 15. What the domain research changed

`DOMAIN.md` was written after this review, from Elanthipedia and from reading
community scripts. It supersedes several assumptions here and adds findings this
pass could not have caught by reading the code alone. The load-bearing ones:

- **Training is driven by mindstate**, a 34-point pool per skill that fills and
  drains. `trainFocus` as static checkboxes plus a single `skillRanks` number is
  the wrong shape for the central feature. This is a larger correction than
  anything in findings 1 through 14.
- **F2P travel is passport-gated per transport leg**, not tier-locked to
  Zoluren, and an expired passport can strand a character. `canTravelOutsideZoluren`
  cannot answer the question with the inputs it has.
- **Athletics ranks against published per-obstacle thresholds** is the real
  mobility mechanic, modified by burden, armor, buffs, rope and group state.
  That replaces both `pathDifficulty: 0-3` and the hardcoded `mobilityScore: 55`
  from finding 5.
- **`BRIDGE_CONTRACT.md` names the wrong Lich API.** It says to push status from
  "Char / Room / XMLData / Infomon". Infomon is GemStone. DragonRealms uses
  `DRStats`, `DRSkill`, `DRRoom` and the `DRC*` commons modules. Fix before
  anyone writes the Ruby.
- **`elanthia-online/dr-scripts` is GPL-2.0** and this repo is MIT, so its Ruby
  cannot be copied in. Its *data* files are already on any Lich user's disk and
  are better read than duplicated.
- Three guilds (Empath, Trader, Necromancer) are closed to F2P, which
  `GUILD_PROFILES` does not gate.
- Platinum cross-world portals require six months of tenure, which
  `travelPath.ts` offers unconditionally.

## Suggested order

1. ~~Restore the truncated file.~~ done
2. ~~Real detection in the setup wizard.~~ done. Real installs are still hand-off-the-command rather than automated, deliberately.
3. ~~Ungate Stop.~~ done
4. ~~Fix the listener leak and add reconnect backoff.~~ done, plus game-clock liveness detection
5. ~~Turn on `strict`.~~ done, zero errors
6. ~~Change the bundle identifier off the elanthia.online namespace.~~ done
7. ~~Instance-scoped travel data.~~ done, along with passport gating
8. ~~Real icons, then a build that produces an installer.~~ done, NSIS + MSI + exe
9. ~~Write the Ruby bridge.~~ done for reading state and stopping scripts
10. Implement `intentBlockReason`, or remove it and correct the doc
11. Healer scoring with a preferred-heal-city override, then location awareness
12. Wire the athletics thresholds into route planning
13. Per-character profiles as a first-class object
14. Intents that actually drive the game: travel, hunt, town run
15. Collapse the three dashboards onto shared components

Nothing above item 12 needs the game running. All of it can be done against the
mock.
