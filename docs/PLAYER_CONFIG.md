# Player config — the client's own macros, aliases, highlights, substitutes, gags, variables and presets

Design note for **Lane Q** of `docs/PLAN_TO_1_0.md`. Nothing described here is
built yet; this is the interface implementation lanes build against, published
so Q2, Q3 and Q4 can run at the same time without either of them inventing a
second copy of the same list.

## 1. Why this exists

PR #456 (N6) deleted the in-app editors for macros, presets, substitutes, gags
and variables, and the ones for highlights and aliases with them. That was
correct: they edited *Genie's* `Config\*.cfg` files, and the app no longer
routes through Genie. Its own PR body says what it costs, rather than leaving
it to be found:

> there is no in-app editing of macros, presets, substitutes, gags or
> variables at all now, and none of highlights or aliases. Re-implementing any
> of it *against Lich* is a new increment nobody has written.

This is that increment's design. A MUD client whose player cannot bind a key,
name a shortcut, colour a line or hide one is not a MUD client, and today the
only way to change a highlight in this app is to open a program the app spent
a whole increment removing.

## 2. What exists today, and what does not

Verified by reading the files on `origin/main` at `2327a971`, not inferred.

| Piece | File | State |
|---|---|---|
| Highlight parse + paint | `src/lib/highlights.ts` (320 lines) | Alive. `parseHighlights` (Genie text), `paint()`, `segments()`, the catastrophic-backtracking probe. |
| Highlight rendering | `GameLineRow.tsx:45`, `HighlightedText.tsx:34`, `GameSignals.tsx:130` | Alive, three call sites, all through `paint()`. |
| Highlight source | `src/lib/useHighlights.ts` | Reads `read_genie_config('highlights.cfg')`. **A player with no Genie install has no highlights and no way to make one.** |
| Muted classes | `src/lib/offClasses.ts` | Alive, localStorage `drc.off-highlight-classes.v1`, per-listener. |
| Alias parse + expand | `src/lib/aliases.ts` (206 lines) | Alive. `parseAliases`, `expandAlias` with `$0`/`$1`… and cycle detection. |
| Alias use | `GameCommandBar.tsx:95` | Alive, one call site. |
| Alias source | `src/lib/useAliases.ts` | Reads `read_genie_config('aliases.cfg')`. Same gap as highlights. |
| Key bindings | `src/lib/keybindings.ts` | Alive, but **hardcoded**: `MOVEMENT`, `F_KEYS`, `QUICK_SWITCH_KEYS`. `codeToGenieKey()` already maps `KeyboardEvent.code` to Genie's `System.Windows.Forms.Keys` vocabulary and is unused by any editor since N6. |
| Action macros | `macroFlight.ts`, `canSendMacro.ts`, `useMacroRunner.ts` | Alive. A *different* macro: a command list run from a button through the `run_macro` intent, with a 900 ms in-flight gate. |
| Outbound lane | `src/lib/commandLane.ts`, `src-tauri/src/command_gate.rs` | Alive. `sendGame(command, source)`; `'macro'` is one of six sources; `QuickQueuePanel.tsx:41` is the only current caller that uses it. |
| Substitutes | — | **Gone.** No parser, no resolver, no call site. Nothing in the render path rewrites a line. |
| Gags | — | **Gone.** Nothing suppresses a line anywhere. |
| Presets | — | **Gone.** |
| Variables | — | **Gone.** |
| Key-chord macros | — | **Gone.** |
| Genie importer | `src-tauri/src/config_import.rs::read_genie_config` | Alive, read-only, validated leaf, searches `setup::genie_roots()`. |
| Genie writer | `write_genie_config` + `src/lib/genieConfigWrite.ts` | Alive, exactly one caller (`pinsFile.ts`), asserted by `tools/doc-claims-test.mjs:703`. Deleted by Q5 — see §8. |

The deleted parsers are **recoverable, not lost**, and Q1 restores them rather
than writing new ones:

```
git show 2327a971^:src/lib/substitutes.ts
git show 2327a971^:src/lib/gags.ts
git show 2327a971^:src/lib/presets.ts
git show 2327a971^:src/lib/variables.ts
git show 2327a971^:src/lib/macros.ts
```

## 3. The shape of the design

One store, one resolver per domain, and the resolvers are the ones the runtime
**already calls**. Nothing gets a second implementation:

```
editors  ──write──►  playerConfig store  ──read──►  resolvers  ──►  runtime
                     (localStorage,                 paint()         GameLineRow
                      one key per domain)           expandAlias()   GameCommandBar
                                                    resolveKeybinding()
                                                    applyLineRules()
```

Three consequences worth stating because they are the whole design:

1. **`useHighlights` and `useAliases` change their source, not their
   signature.** They stop calling `read_genie_config` and start reading the
   store. Every consumer (`GameLineRow`, `HighlightedText`, `GameSignals`,
   `BattleColumn`, `GameChatColumn`, `GameCommandBar`) is untouched.
2. **Genie's file is read exactly once, by a migration.** After Q1 nothing in
   the running app reads `highlights.cfg` or `aliases.cfg` again. The importer
   stays because a player moving across still has files; it becomes an import
   button, not a live source.
3. **Substitutes and gags apply in `useGameLines()`**, the single sanctioned
   reader of the buffer (`tools/gamelines-test.mjs` fails the build if a
   component reads `gameLines()` directly). The raw buffer is never rewritten,
   so a gag is a display preference and not data loss: the bug bundle, the
   transcript and `aiWorkerHost.ts`'s ingest (`gameLink.ts`'s raw accessor,
   deliberately outside the hook) all still see every line. Changing a rule
   re-applies to everything on screen, because the rewrite happens on read.

## 4. Schema

`src/lib/playerConfig.ts` owns these types and is the only module that writes
them.

```ts
export const PLAYER_CONFIG_VERSION = 1

export type Domain =
  | 'presets' | 'highlights' | 'aliases' | 'macros'
  | 'substitutes' | 'gags' | 'variables'

/** Where an entry came from. Never used to decide behaviour - only to show a
 *  player which of their rules arrived from a Genie import, and to let the
 *  import report say what it added. */
export type RuleSource = 'player' | 'genie-import'

interface RuleBase {
  /** Stable id, generated on create. Replaces `Highlight.sourceLine` and
   *  `Alias.sourceLine`, which were offsets into a file that no longer
   *  exists: an editor patches by id now, not by line. */
  id: string
  enabled: boolean
  source: RuleSource
  /** Free-text group, Genie's `#class`. `offClasses.ts` already mutes by
   *  this name and keeps doing so, unchanged. */
  cls?: string
}

export interface PresetRule extends RuleBase {
  name: string          // 'health', 'roomname', or anything the player types
  fg: string            // '#RRGGBB' or a CSS colour name
  bg?: string
  bold: boolean
}

export interface HighlightRule extends RuleBase {
  type: 'line' | 'string' | 'beginswith' | 'regexp'
  pattern: string
  /** Exactly one of these two. A rule naming a preset that no longer exists
   *  resolves to the default text colour and is reported, never dropped. */
  presetId?: string
  colour?: string
  sound?: string
}

export interface AliasRule extends RuleBase {
  name: string
  expansion: string     // `$0`, `$1`… positional; `$name` variables; `;` chains
}

export interface MacroRule extends RuleBase {
  /** Genie's `System.Windows.Forms.Keys` name - 'F2', 'NumPad8', 'D3', 'A'.
   *  `keybindings.ts`'s `codeToGenieKey()` is the one translation from
   *  `KeyboardEvent.code`, and both the live resolver and the editor's
   *  "press a key" capture call it, so they cannot name a combo differently. */
  key: string
  /** Normalised to this order on write, so two bindings on one physical
   *  chord compare equal however they were typed. */
  modifiers: Array<'Shift' | 'Control' | 'Alt'>
  /** One command per entry. Sent through the lane one at a time. */
  commands: string[]
}

export interface SubstituteRule extends RuleBase {
  find: string          // literal substring, not a regexp
  replace: string
}

export interface GagRule extends RuleBase {
  pattern: string       // literal substring; matching hides the whole line
}

export interface VariableRule extends RuleBase {
  name: string          // referenced as `$name`
  value: string
}

export interface PlayerConfig {
  version: number
  presets: PresetRule[]
  highlights: HighlightRule[]
  aliases: AliasRule[]
  macros: MacroRule[]
  substitutes: SubstituteRule[]
  gags: GagRule[]
  variables: VariableRule[]
}
```

### 4.1 Storage

One localStorage key per domain, through `src/lib/storage.ts`'s `readJSON` /
`writeJSON` — the same primitives `persistence.ts` uses:

```
drc.player-config.presets.v1        { "version": 1, "entries": [ … ] }
drc.player-config.highlights.v1
drc.player-config.aliases.v1
drc.player-config.macros.v1
drc.player-config.substitutes.v1
drc.player-config.gags.v1
drc.player-config.variables.v1
```

**A decision, stated as one rather than left to look like the obvious
arrangement.** The brief said "in the app's own prefs (`persistence.ts`)".
These are *beside* `PersistedPrefs`, not inside it, and they use the same
storage module. A player's 356 aliases in the same key as `alertsVolume` means
every volume change rewrites the whole config, and one `QuotaExceededError`
loses both. `persistence.ts` stays the one store for *preferences*;
`playerConfig.ts` is the one store for *rules*. There is one owner for each,
which is what the no-fork rule is protecting; two keys is not two sources of
truth.

### 4.2 A JSON example

The whole store, as `Export everything` writes it and `Import` reads it back:

```json
{
  "version": 1,
  "presets": [
    { "id": "p-01", "enabled": true, "source": "genie-import",
      "name": "roomname", "fg": "#F5DEB3", "bold": true }
  ],
  "highlights": [
    { "id": "h-01", "enabled": true, "source": "genie-import",
      "type": "line", "pattern": "just arrived", "presetId": "p-01",
      "cls": "people", "sound": "arrive.wav" },
    { "id": "h-02", "enabled": true, "source": "player",
      "type": "string", "pattern": "kobold", "colour": "#FF5555" }
  ],
  "aliases": [
    { "id": "a-01", "enabled": true, "source": "genie-import",
      "name": "appc", "expansion": "appraise $0 careful" }
  ],
  "macros": [
    { "id": "m-01", "enabled": true, "source": "genie-import",
      "key": "NumPad8", "modifiers": [], "commands": ["n"] },
    { "id": "m-02", "enabled": true, "source": "player",
      "key": "F3", "modifiers": ["Control"],
      "commands": ["stow left", "get my $weapon"] }
  ],
  "substitutes": [
    { "id": "s-01", "enabled": true, "source": "player",
      "find": "a Gor'Tog", "replace": "Tog" }
  ],
  "gags": [
    { "id": "g-01", "enabled": true, "source": "player",
      "pattern": "You feel fully rested" }
  ],
  "variables": [
    { "id": "v-01", "enabled": true, "source": "player",
      "name": "weapon", "value": "longsword" }
  ]
}
```

### 4.3 Variables are `$name`, not `%name%`

The brief specified `%name%`. This uses `$name`, deliberately, and the reason
decides it: every alias in a real Genie config that references a variable
writes `$shop`, `$preposition`, `$patient` — `aliases.ts`'s own header names
those three from Dan's file. Importing 356 aliases and then not resolving the
tokens they contain would produce a config that looks imported and does not
work. `expandAlias` already leaves `$name` untouched today for want of a
variable table; this gives it one.

`$0`…`$9` stay positional alias arguments and are never looked up as
variables — the same split `variables.ts` made before it was deleted.

## 5. Resolvers

Exactly one per domain. Two are existing functions gaining a parameter; two
are new; none replaces anything.

```ts
// src/lib/highlights.ts  — EXTENDED, paint() unchanged
/** Store rules → the runtime `Highlight[]` paint() already takes: preset ids
 *  resolved to colours, disabled rules dropped, regexps compiled and probed
 *  by the existing PATTERN_BUDGET_MS guard. Returns the refusals so the
 *  editor can show them beside the rule instead of dropping it in silence. */
export function resolveHighlights(
  cfg: Pick<PlayerConfig, 'highlights' | 'presets'>
): { entries: Highlight[]; refused: Array<{ id: string; why: string }> }

export function paint(line: string, entries: Highlight[], off?: ReadonlySet<string>): Painted

// src/lib/aliases.ts  — EXTENDED, third parameter is new
export function expandAlias(
  line: string,
  entries: readonly Alias[],
  opts?: { maxDepth?: number; variables?: ReadonlyMap<string, string> }
): ExpandResult

// src/lib/keybindings.ts  — EXTENDED, KeyResolution gains one case
export type KeyResolution =
  | { kind: 'game'; command: string }
  | { kind: 'macro'; id: string; commands: string[] }   // new
  | { kind: 'stop' }
  | { kind: 'quickswitch'; slot: number }
  | null

export function resolveKeybinding(
  e: { key: string; code: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  blocked: boolean,
  macros?: readonly MacroRule[]     // player bindings win over the built-ins
): KeyResolution

// src/lib/lineRules.ts  — NEW, the only new resolver in the display path
/** Substitutes then gags, in that order, against one line. Pure. */
export function applyLineRules(
  text: string,
  rules: { substitutes: readonly SubstituteRule[]; gags: readonly GagRule[] }
): { text: string; gagged: boolean; matched: string[] }
```

Wiring, one call site each:

| Resolver | Called from | Notes |
|---|---|---|
| `resolveHighlights` | `useHighlights.ts` | Replaces the `read_genie_config` body. `note` still reports a denominator. |
| `paint` | `GameLineRow`, `HighlightedText`, `GameSignals` | Unchanged. |
| `expandAlias` | `GameCommandBar.tsx:95`, and the macro path below | One resolver for both, so a macro and a typed line expand identically. |
| `resolveKeybinding` | `installKeybindings` | A `macro` resolution sends each command with `sendGame(cmd, 'macro')` through `requestMacro`'s existing in-flight gate — the lane source is already `'macro'` and `command_gate.rs` already paces it. |
| `applyLineRules` | `useGameLines()` | The one place. A gagged line is filtered out of the returned array; a substituted line is returned rewritten. |

**Player macros beat built-ins.** `MOVEMENT`, `F_KEYS` and `QUICK_SWITCH_KEYS`
stay as the shipped defaults for a player who has configured nothing; a store
binding on the same chord wins. Otherwise a player who binds NumPad8 gets the
hardcoded `n` and no error, which is the failure mode this whole lane exists to
remove.

## 6. Genie import — the mapping

One-time migration, `src/lib/playerConfigImport.ts`, reading through the
existing `read_genie_config` and the parsers restored from `2327a971^`.

```ts
export type GenieLeaf =
  | 'highlights.cfg' | 'aliases.cfg' | 'macros.cfg'
  | 'presets.cfg' | 'substitutes.cfg' | 'gags.cfg' | 'variables.cfg'

export interface ImportReport {
  perFile: Array<{
    leaf: GenieLeaf
    found: boolean
    /** Non-blank lines in the file. The denominator, so a parser that
     *  dropped half the file cannot report the same thing as one that
     *  worked. */
    lines: number
    parsed: number
    imported: number
    /** One string per refusal, with the line and the reason. */
    skipped: string[]
  }>
  /** Genie features this app has no home for. Listed, never dropped in
   *  silence - see the table below. */
  unsupported: string[]
}

export function importGenieConfig(
  files: Partial<Record<GenieLeaf, string>>
): { config: PlayerConfig; report: ImportReport }
```

Pure: it takes the text and returns the store. The file reads and the write
are the caller's, so the whole mapping is testable with no Genie install and
no Tauri.

### 6.1 Mapping table

| Genie feature | Genie syntax | App feature | Status |
|---|---|---|---|
| Highlights | `#highlight {type} {colour} {pattern} {class} {sound}` | `HighlightRule` | **Full.** Format verified against Dan's real file; `parseHighlights` already ships. |
| Highlight classes | `#class {name} off` | `cls` + `offClasses.ts` | **Full**, already built. The *off* set stays a per-listener preference and is not imported. |
| Aliases | `#alias {name} {expansion}` | `AliasRule` | **Full.** Verified against a real 356-entry file. |
| Alias arguments | `$0`, `$1`… | `expandAlias` | **Full**, already built. |
| Key macros | `#macro {Key, Mod, Mod} {command}` | `MacroRule` | **Full for the key half** — 95 real entries, all of whose key names `codeToGenieKey` covers. See "Genie script" below for the command half. |
| Presets | `#preset {name} {colours} {bold}` | `PresetRule` | **Full.** Verified against a real 31-entry file. Genie's fixed preset *names* (`health`, `roomname`, `automapper.line`) import as ordinary named presets; the ones this app has no equivalent surface for are listed in `unsupported` rather than pretended into. |
| Substitutes | `#substitute {find} {replace}` | `SubstituteRule` | **Full, format inferred.** `substitutes.cfg` was empty on this machine, so the two-group shape comes from the uniform directive convention, not from a populated file. Re-check on the first real file. |
| Gags | `#gag {pattern}` | `GagRule` | **Full, format inferred.** Same caveat: `gags.cfg` was empty here. |
| Variables | `#var {name} {value}` | `VariableRule` | **Partial, on purpose.** A real `variables.cfg` is mostly Genie's own bookkeeping — `roomid`, `downid`, the whole `Time.*` block — written by Genie while it plays. Those are **not** imported; they are counted and named in `unsupported`. Anything else imports. |
| Genie script in a macro or alias | `#class`, `#queue`, `#setvar`, `\x` escapes | none | **Not imported.** The entry is imported with its command text intact and marked `enabled: false`, so the player sees exactly what Genie had and nothing fires a directive this app cannot execute. Counted in `unsupported`. |
| Sounds on a highlight | fifth `#highlight` group | `sound` | **Carried.** Playback is `alertSound.ts`'s, unchanged by this lane. |
| Window layout, palettes, `#script`, plugins | various | none | **Not imported.** Listed in `unsupported`. |

### 6.2 After the import

Genie's files are never read again by the running app. The importer stays
reachable from the panel (`Import from Genie…`) so a player can run it a
second time on purpose, and a second run is a *merge preview* with the same
add/update/skip shape `pinsFile.ts` already uses for pins — never a silent
overwrite of rules the player has since edited.

## 7. The editor

One panel, `id: 'config'`, reachable as `?view=panel&id=config` like every
other dockable panel (`src/lib/windowView.ts`, `src/lib/layout.ts`'s
`PanelId`). One tab per domain. Plain forms: a list, add, edit, delete,
enable/disable, and the class name.

Two things it must do that a form alone does not:

- **Test a rule against real text.** Highlights, substitutes and gags each get
  a preview pane that runs the *resolver itself* over the last N lines of the
  live buffer (`useGameLines()`), showing what would change. Not a second
  matcher written for the preview: the preview calls `paint()` and
  `applyLineRules()`, so a preview that disagrees with the game pane is
  impossible by construction.
- **Dry-run a macro.** Pressing `Test` shows the exact command list that would
  reach `sendGame(cmd, 'macro')` — after alias expansion and variable
  substitution, in order — and **sends nothing**. The dry run calls
  `expandAlias` with the same arguments the live path uses, and the check for
  it counts calls against a fake `sendGame` that must record **zero**, with a
  positive control in the same run where a real fire records the right number.
  Without the control, an unwired harness passes the check that matters most.

Export and import of the whole store as one JSON document (§4.2), through the
app's own data directory (§8).

## 8. Pins, `saveGenieConfig`, and question N-c — decided

**N-c is answered: pins are app data.**

`pinsFile.ts` writes `dr-companion-pins.yaml` into a Genie install's `Config`
directory. That was right on 30 Aug 2026, when a player certainly had such a
directory. After N6 they may not, and `write_genie_config`'s
`writable_target()` then finds nothing and the export fails with "No Genie
Config folder found" — an export button that cannot work on a clean install.

So:

- pins export writes to `app_data_dir()/config/dr-companion-pins.yaml`;
- the whole-store JSON export writes beside it;
- both are opened in Explorer with the existing `reveal_file` command, so
  "where did it go" has an answer that is not a path in a paragraph;
- **`saveGenieConfig` loses its last caller and `src/lib/genieConfigWrite.ts`
  is deleted**, together with `write_genie_config`, `MAX_WRITE_BYTES` and
  `writable_target` on the Rust side. That is move 3 of the no-fork rule:
  delete it, do not leave it as a second way to write a config;
- the app then **never writes into a Genie install**, which is the property
  `config_import.rs`'s header had before 29 Aug 2026 and lost. It is restored
  and asserted, not merely stated.

The Rust side gains one small module, `src-tauri/src/player_files.rs`, with
`read_player_file(leaf)` and `write_player_file(leaf, text, expectedPrevious?)`
rooted at `app_data_dir()/config`. It is **not a new implementation**: the
`sibling`, `backup_once`, `save_atomically` and `matches_on_disk` helpers move
out of `config_import.rs` with their tests, and the leaf validation stays
`sounds::valid_plain_filename`. `expectedPrevious` finally gets a caller — the
store import reads before it writes — which is the guarantee `config_import.rs`
recorded as a downgrade when N6 left it callerless.

`tools/doc-claims-test.mjs`'s "exactly one caller of `saveGenieConfig`" check
becomes "no module names `saveGenieConfig`, and `genieConfigWrite.ts` does not
exist", with the same control-and-sabotage discipline; the existing sabotage
case in `doc-claims-break-check.mjs:169` is turned the other way up.

Migration for a player who already has a pins file in a Genie folder: on first
run after Q5, if `read_genie_config('dr-companion-pins.yaml')` finds one and
the app-data copy does not exist, copy it across and say so. The Genie copy is
left where it is — deleting somebody's file to tidy up is not a migration.

## 9. Read, inferred, and not checked

The discipline `docs/control.md` uses, because a page that mixes the three
without saying which is how an inference gets published as a fact.

**Read directly, on `origin/main` at `2327a971`:** every row of §2's table;
the `#highlight`, `#alias`, `#macro`, `#preset` and `#var` formats and the
sentence in each deleted module's header saying which real file it was read
from; `command_gate.rs`'s six sources and that `'macro'` is one; that
`tools/gamelines-test.mjs` enforces `useGameLines` as the only component
reader; that `write_genie_config` has exactly one caller and
`expected_previous` has none.

**Inferred, and marked as inference wherever it is acted on:** the
`#substitute` and `#gag` formats, which their own authors recorded as inferred
from the uniform directive convention because both files were empty on this
machine. Q4's `verify:` line therefore asks for the check against a populated
file rather than asserting the format.

**Not checked, and named rather than folded into either of the above:**

- Whether Lich has a settings surface of its own that a player would expect
  these rules to reach — this design puts them in the app and does not touch
  Lich. Nobody has measured what Lich would do with them.
- Whether any real player's `substitutes.cfg` or `gags.cfg` anywhere is
  non-empty. Two empty files on one machine is not a population.
- How many rules a player might accumulate before localStorage's quota
  matters. `storage.ts` reports a quota failure rather than swallowing it, so
  the failure is visible; the number is not known.

## 10. What Q1 actually landed, where it differs from the design above

Written by the increment rather than left for a reader to discover, because
§9's rule cuts both ways: a design page that still describes what was planned
is a claim, and the code is the check.

- **The five recovered parsers live inside `playerConfigImport.ts`**, not in
  five restored modules. They are verbatim from `2327a971^` minus each
  module's `load*Config()`, which called `read_genie_config` directly and is
  the live read this lane removes. One consumer, one copy.
- **`resolveHighlights` and `resolveAliases` shipped in Q1, not Q2/Q3.**
  Q1's own `verify:` requires that nothing reads a Genie config leaf any more,
  which means `useHighlights` and `useAliases` had to change source in this
  increment; a hook reading the store needs the resolver, and leaving Q2 to
  write a second one later is the fork the whole lane is avoiding. Q2 and Q3
  extend these (preset editing, refusal display, `variables` on
  `expandAlias`); they do not replace them. `paint()` and `expandAlias` are
  untouched, and every consumer of both hooks is untouched.
- **`migratePlayerConfig` returns four states, not three**: `absent`,
  `current`, `migrated`, `refused`. The design asked for three so that
  "nothing to migrate" and "could not read this" differ; separating `current`
  from `migrated` is the same argument applied once more, and the panel prints
  whichever it got.
- **A newer version is refused and the key is left untouched.** Overwriting a
  config written by a build the player has since downgraded from is the data
  loss the refusal exists to prevent.
- **A failed write is not kept in memory.** `setDomain` returns the storage
  result and does not update its cache when the write failed, so what the
  panel shows is what is actually durable.
- **`pinsFile.ts` is the one remaining `read_genie_config` caller** and it
  reads the pins file, not a config leaf. Q5 moves it to the app's own data
  directory; `tools/player-config-test.mjs` names it in an allowlist of two so
  the list cannot quietly grow.
- **Known parser edge, asserted rather than left to be found:** a `#macro`
  whose command itself contains braces (`#class {combat} on`) parses its
  second group short, because the recovered parser matches `{...}`
  non-greedily. No line in the 95-entry real file does this - Genie writes
  `#class combat on` - and `tools/player-config-import-test.mjs` records the
  behaviour so the next person meets it as a known edge.
- **Measured against the real config on the machine this was written on**
  (`C:/Genie4/Config`, never committed): 31 presets, 58 highlights, 356
  aliases, 95 macros, 34 of 46 variables. `substitutes.cfg` and `gags.cfg` are
  still empty there, so their formats are still inferred, exactly as §6.1
  says. 87 of 356 aliases and 25 of 95 macros carry Genie script and import
  switched off with their text intact.
- **`tools/doc-claims-test.mjs`'s "the Genie config editor stays deleted" was
  turned the right way up.** It asserted that `src/components/config` did not
  exist, which is the mechanism rather than the property; it now asserts that
  nothing in that directory writes into a Genie install. The one-caller check
  on `saveGenieConfig` is unchanged and still passes its sabotage.

Where this document and a check disagree, **the check is right and this page
is stale.** The checks are the `verify:` lines of Q1–Q6 in
`docs/PLAN_TO_1_0.md`.
