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
| Genie writer | — | **Gone**, deleted by Q5 on 6 Sep 2026 with its Rust command and its wrapper module. `tools/doc-claims-test.mjs` asserts that nothing under `src/` so much as names it, with a sabotage in `doc-claims-break-check.mjs` that reddens when a module reaches for it again. |
| Player files | `src-tauri/src/player_files.rs` + `src/lib/playerFiles.ts` | Alive. `read_player_file` / `write_player_file` / `adopt_genie_file`, rooted at `app_data_dir()/config`. The backup, atomic write and compare-and-swap moved here from `config_import.rs` with their tests. See §8. |

The deleted parsers are **recoverable, not lost**, and Q1 restores them rather
than writing new ones:

```
git show 2327a971^:src/lib/substitutes.ts
git show 2327a971^:src/lib/gags.ts
git show 2327a971^:src/lib/presets.ts
git show 2327a971^:src/lib/variables.ts
git show 2327a971^:src/lib/macros.ts
```

### 2.4 What the pattern guard refuses, and what it measured

A `regexp` highlight, substitute or gag goes through `compilePattern` in
`src/lib/highlights.ts` before anything runs it, because `paint()` runs once
per rendered line and the game pane keeps 400: a pattern that backtracks
exponentially is not a slow client, it is a window with no route back except
killing the app, and the rule is stored, so it hangs again on the next
launch. There is no way to interrupt a running regexp in JavaScript.

The gate asks two questions, in this order, and gives three answers to the
first.

**First the structure** (`patternRefusal`). What is refused is an **ambiguous
repetition**: a group repeated without limit whose body can consume the same
characters in more than one way. That is narrower than "a quantifier inside a
quantified group", which is what this rule was in its first version and which
is wrong — it refuses `([A-Za-z]+ )+\.`, which measures 0.0ms at 60 characters,
because a mandatory space leaves exactly one way to cut the text into
iterations. The danger is the ambiguity, not the nesting.

| Refused | Example | Why |
|---|---|---|
| A group repeating something that already repeats without limit | `(a+)+`, `(.*)*`, `((\w|\s)+)+`, `(\d+)+` | Repeating a repetition is ambiguous by construction: the same characters divide between the two in 2^n ways, and a failing tail makes the engine try all of them. |
| A repeated group **ending in an optional part**, with something unbounded inside | `(\w+\s?)+`, `(\s*\w+\s*)+`, `(.*\s?)+`, `(\w+\s*)+` | The body can stop early, so the next repetition picks up mid-token and the same arithmetic applies. This is #482's own pattern. |
| A repeated group whose alternatives can start with the same character | `(a\|a)*`, `(herb\|herbs)+` | Same arithmetic again, reached through the alternation rather than through a second quantifier. |
| Syntax the parser cannot model **and cannot widen into something it can** | `^(\w+) \9$` (there is no group 9), `^(\w+)\1$` (anchored, with nothing to build a probe from), `\p{Lu}` under the `u` flag | #500. Abstaining used to fall through to acceptance: `compilePattern` read only `patternRefusal`'s sentence and discarded its `parsed` flag, and `probePrefix` bailed on the same parse, so `prefixProbes` returned `[]` and an anchored pattern was timed against sixteen unanchored bodies it rejects at its first character. Measured through the real `resolveHighlights` + `paint`, `^You see (\w+)\s(\w+\s?)+\1$` was accepted in 0.1ms and then took 6ms on a 31-character line, 396ms on 37, and was still running at both 41 and 45 when a 5-second ceiling killed it; #500 measured the uncapped 45-character line at **103 seconds** in one paint. The refusal names the construct: *contains `\1`, which this app cannot check for safety; write it without the backreference*. |

| Not refused | Example | Why |
|---|---|---|
| A quantified group with no inner quantifier and disjoint branches | `(say\|whisper)+`, `(\w\|\s)+` | Deterministic: at each character exactly one branch can apply. |
| A repeated group whose body ends in a mandatory part | `([A-Za-z]+ )+\.`, `(\w+\s+)+arrives$` | Unambiguous, and measured at 0.0ms over 60 characters. |
| Syntax the parser does not model, once it has been read another way | `\p{Lu}`, `\u0041`, `(\w+) \1`, `^You see (\w+) \1$` | Reported as **not modelled** rather than as clean, and then read again with the construct widened into one the parser does handle: a backreference becomes the group it refers to, a property escape becomes what the engine matches without the `u` flag. If the widened form is clean and probes can be derived from it, the pattern loads. |

A lookaround is **not** an exemption, though an earlier draft of this table said
it was. `(?=(\w+)+)ok` is refused: zero width does not mean zero work, and a
lookahead that fails backtracks exactly as hard as anything else. The scan
descends into it, and skips it only when judging whether the *enclosing* group's
body is ambiguous, where a zero-width part cannot make it so.

**Refusing beats admitting on the abstain path, and the asymmetry is not
close.** A highlight is a convenience: refusing one costs a player some colour
on a line, plus a message naming the construct to remove, and nothing else in
the client changes. Admitting one costs the app - a 103-second paint is not a
slow highlight, it is the window hung with the game still arriving behind it,
and the rule is stored, so it hangs again on the next launch. There is nothing
symmetrical to weigh.

The corpus below holds **0 not modelled of 467**, so no real rule on this
machine reaches that path, and none is taken away by it - which is also why the
corpus cannot cover it. `tools/pattern-analyser-test.mjs` section 3b is its
fixture population instead: six unmodelled-but-safe patterns that must be
accepted *and* show probes derived from their own opening, and five that must
be refused by name. The one safe fixture whose derived count is zero is
unanchored, where the sixteen fixed bodies do reach the pattern; every anchored
one must have derived its own, which is the count that goes to zero when this
regresses.

One pattern moved from `tools/highlight-test.mjs`'s list of rules that must be
allowed to load into its list of rules that must be refused:
`(\w+\s+)+of the (\w+\s*)+$`. Measured with a plain `RegExp` on a line that
reaches `of the` and then fails, it took 1.6ms over 40 trailing characters and
16.4ms over 50, climbing about tenfold per ten characters after that; a room
description is two hundred. The old 22-character probes sat on the flat part of
that curve, so the suite had been asserting since it was written that a pattern
which freezes the game pane must load.

**The false-positive rate is measured, not asserted.** Over every rule on this
machine that a player actually has:

| Corpus | Rules | Refused |
|---|---|---|
| `dr-genie-settings/Config/highlights.cfg` | 58 | 0 |
| `Genie Client 4/Config/highlights.cfg` | 53 | 0 |
| `Genie Client 4/Config/aliases.cfg` | 356 | 0 |
| **Total** | **467** | **0** |

`gags.cfg`, `substitutes.cfg` and `triggers.cfg` are present and hold no
entries, which the check reports as its own state rather than as a pass.

Where this table and the check disagree, **the check is right and this table
is stale**:

```
node tools/pattern-analyser-test.mjs
DRC_PATTERN_CORPUS=/path/to/one.cfg;/path/to/two.cfg node tools/pattern-analyser-test.mjs
```

It refuses to conclude anything from a corpus that is not there: an absent
config is a named skip carried into the summary, and a config that is present
but reads as zero rules fails, because a false-positive rate of zero over zero
rules establishes nothing.

**Then the timing** (`slowestProbeMs`). Sixteen fixed 22-character probes, as
before, plus probes built from the candidate's own opening at 40, 50, 60, 70
and 80 characters. The second set is #482: every fixed probe is an unanchored
body, so `^You rummage (\w+\s?)+kronars$` — an ordinary loot highlight —
failed at its first token on all sixteen in O(1), measured ~0ms, was admitted,
and then took **21.7 seconds** on a 60-character prefix of the line it was
written for. `probePrefix` synthesises `You rummage ` from the pattern itself,
so the probe reaches the quantifier instead of being turned away at the anchor.

**Structure runs first, and that ordering is load-bearing rather than
tidiness.** Sabotaging `patternRefusal` to return "clean" and re-running the
guard measured `^You see (.*\s?)+X$` at **76.3 seconds inside a single probe**
— the guard paying the exact cost it exists to prevent — and left `(.*)*$` and
`(herb|herbs)+` accepted outright. So the probes are a real net (they refuse
#482's pattern in 43ms with the analyser gone) and they are not a substitute
for reading the structure, in both directions. That is a command, not a
paragraph:

```
node tools/pattern-analyser-break-check.mjs
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
**`writeJSONVerified`** — the verified writer, not the plain `writeJSON`
`persistence.ts` uses. `{ok:true}` from `setItem` is not a claim the value
persisted: #461 measured a store that accepted a write, threw nothing and kept
nothing, and #483 measured all seven of these keys going through the
unverified writer anyway, so `setDomain` reported success, updated its cache,
and showed the player a rule the next reload would not have. The verified
writer reads the key back and reports a mismatch as its own failure kind,
`lost`, which is neither a quota error nor a success:

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
| `paint` | `GameLineRow`, `HighlightedText`, `GameSignals` | Note what each one paints. The row components paint the *displayed* text; `GameSignals`, the one that plays a sound, paints the **raw** text off `useRawGameLines()`. See §14. |
| `expandAlias` | `GameCommandBar.tsx:95`, and the macro path below | One resolver for both, so a macro and a typed line expand identically. |
| `resolveKeybinding` | `installKeybindings` | A `macro` resolution sends each command with `sendGame(cmd, 'macro')` through `requestMacro`'s existing in-flight gate — the lane source is already `'macro'` and `command_gate.rs` already paces it. |
| `applyLineRules` | `useGameLines()` | The one place. A gagged line is filtered out of the returned array; a substituted line is returned rewritten. Which is exactly why anything that makes a noise must not read this hook — §14. |

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
`sounds::valid_plain_filename`. `expectedPrevious` finally gets a caller —
the pin export reads the file and writes it in the same breath, passing what
it just read — which is the guarantee `config_import.rs` recorded as a
downgrade when N6 left it callerless.

`tools/doc-claims-test.mjs`'s "exactly one caller of `saveGenieConfig`" check
becomes "no module names `saveGenieConfig`, and `genieConfigWrite.ts` does not
exist", with the same control-and-sabotage discipline; the existing sabotage
case in `doc-claims-break-check.mjs:169` is turned the other way up.

Migration for a player who already has a pins file in a Genie folder: on first
run after Q5, if `read_genie_config('dr-companion-pins.yaml')` finds one and
the app-data copy does not exist, copy it across and say so. The Genie copy is
left where it is — deleting somebody's file to tidy up is not a migration.

### 8.1 As built, 6 Sep 2026 (Q5)

Where this section and the tree disagree, the tree is right and this page is
stale. Three things landed differently from the design above, and Q5's `done:`
line in `docs/PLAN_TO_1_0.md` carries the evidence for each.

- **The webview surface is a module, not a bare `invoke`.**
  `src/lib/playerFiles.ts` is `genieConfigWrite.ts` moved and renamed, and it
  exports `readPlayerFile` / `writePlayerFile` / `adoptGenieFile`. **Q6 writes
  through it**; a second writer is the thing this whole section exists to
  prevent.
- **The migration is its own command**, `adopt_genie_file`, rather than a
  `read_genie_config` call from `pinsFile.ts`. The property asserted here is
  that exactly one *module* invokes `read_genie_config` and that module is the
  config importer, so a second TypeScript caller would have contradicted the
  check. The Rust side calls the reader directly, writes through the same
  `save_atomically`, and refuses when an app-data copy already exists.
- **`MAX_WRITE_BYTES` is renamed, not deleted** — `MAX_PLAYER_FILE_BYTES`,
  8 MiB, with its test. The cap guards a string that arrives from the webview,
  which changing the destination directory does not make safe.
  `writable_target` **is** deleted: the root is ours now, so there is no Genie
  install to avoid fabricating.

And the check named above landed as three checks rather than one, because
"exactly one caller of `saveGenieConfig`" left standing after the caller was
deleted would have passed forever — including on the day somebody reintroduced
the writer with one caller. `tools/doc-claims-test.mjs` now asserts that
nothing under `src/` **names** a Genie writer (reporting `file:line`), that
`src/lib/genieConfigWrite.ts` does not exist, and that exactly one module
invokes `read_genie_config`; each has a control that shows the same scan
finding something that is genuinely there.

## 9. Read, inferred, and not checked

The discipline `docs/control.md` uses, because a page that mixes the three
without saying which is how an inference gets published as a fact.

**Read directly, on `origin/main` at `2327a971`:** every row of §2's table;
the `#highlight`, `#alias`, `#macro`, `#preset` and `#var` formats and the
sentence in each deleted module's header saying which real file it was read
from; `command_gate.rs`'s six sources and that `'macro'` is one; that
`tools/gamelines-test.mjs` enforces `useGameLines` as the only component
reader; that `write_genie_config` had exactly one caller and
`expected_previous` had none **before Q5**, which deleted the first and gave
the second its caller (`pinsFile.ts`'s export). Both halves of that sentence
are now history rather than a description of the tree — see §8's implementation
note.

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
  on `saveGenieConfig` survived Q1 unchanged and was **replaced by Q5**, which
  deleted the caller and the writer both — see §8.1.

## 11. What Q2 actually landed, where it differs from the design above

- **One compile gate, extracted rather than added.** `parseHighlights` and
  `resolveHighlights` each held their own compile-and-probe, and the editor
  needed the same question answered before a save. `compilePattern(type,
  pattern)` in `highlights.ts` is now the single answer and all three call it.
  Three implementations of "is this pattern safe to run once per rendered
  line" is how a rule refused at load gets accepted at save and freezes the
  game pane anyway.
- **The editor refuses an invalid pattern before it is stored, and the
  resolver still refuses it if one gets in.** The gate is the editor; the
  backstop is `resolveHighlights`. Both are asserted, because the property is
  not "the form validates" but "the runtime never sees an invalid rule" - a
  hand-edited localStorage key produces exactly that state.
- **A preset in use is not deleted, and the refusal names the rules.**
  `refuseDeletingPreset(preset, highlights)` is pure and lives in
  `highlights.ts`, not inside the tab: the message is the product, and a
  message assembled inside a component is a message no check can read. "3
  highlights use it" is a fact the player cannot act on.
- **The preview is the game pane.** `HighlightsTab.tsx` calls `paint()` and
  renders through `HighlightedText` over `useGameLines()`, and
  `tools/highlight-test.mjs` greps it for the two matching primitives a
  hand-rolled matcher would need, with a positive control on `highlights.ts`
  so a zero means something. It prints how many lines it searched beside how
  many matched.
- **Only `fg` reaches the game pane.** `paint()` returns one colour per line
  and one per span and `HighlightedText` sets `color` from it; Q2's `do:`
  keeps that signature, so a preset's `bg` and `bold` are stored and edited
  but not painted, and the tab says so on screen. Italic and underline were
  **not** added: two fields the store does not declare and the renderer cannot
  use would be an absence with more steps, freshly built.
- **`useHighlights.ts` is untouched by Q2.** §10 records that Q1 had already
  pointed it at the store; there was nothing left for this increment to
  change, and editing it to satisfy a `touches:` line would have been a change
  with nothing to fix.

## 12. What Q4 landed: substitutes, gags, and the way back

- **`applyLineRules` is in `src/lib/lineRules.ts` with the signature §5
  publishes**, and `useGameLines()` is its only call site. The raw buffer is
  never rewritten; `tools/line-rules-test.mjs` compares `gameLines()` as a
  whole string before and after every case, because a filter that rewrote a
  line in place and left the count alone would pass a count.
- **Order is substitutes then gags**, so a gag matches the text the player is
  actually looking at. The test asserts it both ways: a gag written against
  the substituted text fires, and a gag written against the original does not.
  One direction alone would be a statement about gags rather than about order.
- **Q2's `compilePattern()` gained a `flags` argument rather than gaining a
  twin.** Q4 and Q2 ran at the same time and both extracted the
  compile-and-probe guard out of `highlights.ts`; Q2's landed first, so Q4's
  was deleted on rebase and `lineRules.ts` is its fourth caller. A substitute
  replaces every occurrence and so needs the same pattern with `g`, which is
  the whole of the difference. Two answers to "is this pattern safe to run
  once per rendered line" is how a rule refused at load gets accepted at save
  and freezes the game pane anyway - §11's own reason, one increment later.
- **`SubstituteRule` and `GagRule` gained an optional `regex`**, absent by
  default. §4's "literal substring, not a regexp" is still what an imported
  rule means, which is the point: reinterpreting stored text under a new
  meaning is the quiet bug that default avoids. A pattern that will not
  compile, or that fails the backtracking probe, is refused at save by
  `ruleRefusal()` and refused again at read - a rule can also arrive from an
  import or from a key another build wrote, and a `catch` in the render path
  is the wrong place to find that out.
- **A gag is reversible on screen.** `drc.show-gagged-lines.v1` is a
  per-listener display preference, the same shape as `offClasses.ts` and for
  the same reason. The switch is in the game pane's tab row, appears only when
  a gag is enabled, and a shown-gagged line is drawn dimmed so the switch
  visibly does something rather than appearing to do nothing.
- **`useRawGameLines()`** is a second hook in `useGameLines.ts`: the preview
  needs the before, and the sanctioned hook now returns the after. It lives
  there rather than in the panel because `tools/gamelines-test.mjs` says the
  raw accessors are that file's business, and that rule is what stopped the
  same subscription defect three times.
- **The preview calls `applyLineRules`, not a matcher of its own.**
  `tools/line-rules-test.mjs` strips comments from the two tabs, the preview
  and the panel and refuses any of `new RegExp`, `indexOf`, `.split(` or
  `.replace(` in what is left, with a positive control proving the scan can
  see a matcher when there is one.
- **The formats are still inferred.** `substitutes.cfg` and `gags.cfg` were
  empty on this machine and nothing in Q4 changed that. Both tabs say so on
  screen under their rule list, rather than leaving the caveat in this
  document where the person meeting a mis-parsed import is not looking.

## 13. What Q6 landed: the whole store as one document

The last increment of Lane Q. Export writes every domain to one file; import
reads it back, merges by identity, and reports what it did with every entry it
was given.

### 13.1 The file

`app_data_dir()/config/player-config.json`, beside `dr-companion-pins.yaml`,
written through `writePlayerFile` and read through `readPlayerFile` — the
surface Q5 built and §8.1 says Q6 writes through. There is no second writer,
and `tools/player-config-transfer-test.mjs` reads the shipping module to say so
rather than inferring it from a fake.

The shape is §4.2's, with one field ahead of it:

```json
{
  "version": 1,
  "provenance": "player",
  "presets": [ … ], "highlights": [ … ], "aliases": [ … ],
  "macros": [ … ], "substitutes": [ … ], "gags": [ … ], "variables": [ … ]
}
```

`provenance` says what the file is — `player` for one a person exported — so a
reader who finds one on disk knows without opening the payload. It is the same
field, read by the same function, as the scene editor's export (#468): both
headers are `src/lib/exportEnvelope.ts`'s `readEnvelope`, which is where
`parseSceneOverrides`' four refusals moved to, wording unchanged. Writing them
a second time for this document would have been a second opinion about what a
valid header is, and the day a version 2 arrives the two would have disagreed
about it.

The bytes are deterministic: two-space JSON, a trailing newline, fields in the
order above, and every entry rebuilt through the store's own reader on the way
out so an editor's key order cannot show up as a diff. Export, import into an
empty store, export again, and the strings are equal — asserted as strings,
because comparing parsed objects would pass against an exporter whose key order
wandered.

### 13.2 The report

Per domain, and exhaustive against the file:

| Column | What it counts |
|---|---|
| In file | Entries the document carried for that domain. The denominator. |
| Added | No rule of that identity was here. |
| Updated | One was, and the document's body differs. The local id survives. |
| Same | One was, and it says the same thing. |
| Refused | This build will not store it. Named, with the reason. |
| Removed | Was here, the document does not carry it. Only `Replace all`. |

**`added + updated + unchanged + refused` equals `in file`, for every domain.**
That is the property, not a nicety: a report whose numbers do not add up is how
a rule goes missing while the screen says the import worked, and the check
asserts the sum rather than trusting it.

Identity is `identityOf` — an alias's name, a highlight's type and pattern, a
macro's key and modifiers — the same function the Genie import already merged
by. One merge with three modes rather than two merges: `keep-mine` for a second
Genie import (the player has edited these since, and Genie's file is the older
opinion), `update` for a config document, `replace-all` for a deliberate
overwrite, which the panel confirms before running. Two implementations of "is
this the same rule" would eventually disagree.

A fourth outcome is reported beside the four counts and is not folded into
them: a rule **kept and switched off**. An alias whose expansion is Genie
script, or a macro one of whose commands is, is stored with its text intact and
`enabled: false` — exactly what the editors do with the same rule — and the
player is told, because otherwise it reads as the import half-working. A
document this app wrote never contains one switched on, so a round trip does
not trip over it; a hand-edited one can, and has its own case.

A fifth thing is reported and is not a count either: **highlights this import
would leave naming a preset it removes**. `wouldRemove` reports identities per
domain and nothing crosses between them, so a `replace-all` could delete a
preset while the highlights pointing at it survived, and nothing said so
(#490). The case that bites is a partial document — one carrying somebody's
highlights and not their presets, or presets under different ids — and it is
not data loss: `resolveHighlights` resolves a dangling `presetId` to the
default colour and reports it, so seven lines quietly change colour while
every number in the report adds up.

The warning is `refuseDeletingPreset`'s own sentence, unedited — the same
function the Presets editor already refuses a by-hand delete with, listing the
rules rather than counting them. Two wordings of one situation would disagree
the first time either was improved, so `orphanedByImport` quotes it and the
suite compares the two strings. It is shown at the confirmation step, before
the only action here that can delete a preset, and again in the report.

### 13.3 One validator, not a second one

Every entry goes through `migratePlayerConfig`, the store's own reader, and
then through the predicate the matching editor calls before it saves:

| Domain | Asked | From |
|---|---|---|
| highlights | `compilePattern` | Q2, `highlights.ts` |
| substitutes, gags | `ruleRefusal` | Q4, `lineRules.ts` |
| aliases, macros | `isGenieScript` | Q3, `playerConfig.ts` |
| variables | `isBookkeepingVariable` | Q3, `playerConfig.ts` |

A rule this app would refuse to let a player type is a rule it refuses to
import, and it says so naming the domain and the id. The check reads the
transfer module and asserts it names each of those functions and constructs no
`RegExp` of its own, with a positive control on the same scan.

A refusal costs one entry, never the document: a broken pattern in one domain
is refused by name while the other six import in full. A parser that gave up on
the whole file would satisfy "the bad rule did not get in" perfectly and lose
the player everything else.

### 13.4 Two windows

The export reads the file and writes it in the same breath, passing what it
just read as `expectedPrevious`. A second window of this app exporting from a
view taken before the first one wrote is refused **by name**, the first
window's file is still on disk, and the refusal is recoverable: the same window
succeeds once it has re-read. That is Q5's compare-and-swap with its second
caller.

### 13.5 Not done here

Named rather than folded into the above.

- The report is shown after the import runs, not before it. The panel computes
  the merge once and writes the config that computation produced, so the counts
  on screen are the counts of the run that happened — but there is no
  "show me and let me decide" step. `Replace all`, the only mode that can
  delete anything, takes a second click instead.
- `reveal_file` is registered and would open the folder from the panel. The
  transfer section reports the path in its note and does not offer the button;
  that is a UI increment nobody has claimed, and it is the same gap the map
  panel's export still has.
- Nothing here was verified against a running desktop app. Every claim is
  `node tools/player-config-transfer-test.mjs`, the browser harness against the
  dev server, or a read of the tree. The app-data path itself is exercised
  through a fake of `player_files.rs`; the real one is `cargo test player_files`.

Where this document and a check disagree, **the check is right and this page
is stale.** The checks are the `verify:` lines of Q1–Q6 in
`docs/PLAN_TO_1_0.md`.

## 14. What review pass 8 fixed: the ear, and the text that actually gets sent

Two shipped defects, both of the same shape — a decision made about text that
is not the text the next stage sees.

### 14.1 A gag no longer silences an alert (#484)

`GameSignals` is the component that plays a highlight's sound. It read
`useGameLines()`, the *display* view, and `currentGameLines()` drops a gagged
line from the array outright. So:

- a gag on a noisy combat line — the natural thing to gag, and the natural
  line to have bound an alert to — also silenced that line's chime;
- a substitute that rewrote the words a highlight matched silenced it with no
  gag involved at all, because the effect painted the substituted text;
- nothing on screen connected the two, and "show gagged lines" did not fix it
  either: `soundedUpTo` had already advanced past the line, so the sound did
  not arrive late.

Measured, before the fix, driving the real buffer through the real handler:
a `danger` highlight with `sound: Growl.wav` on `A kobold swings a broadsword
at you!`, with a gag on `kobold`, gave `paint()` sounds `[]` off the display
reading and `["Growl.wav"]` off the raw one; the substitute case gave
`[]`/`["Growl.wav"]` with no gag present. The control — `paint()` on the
unmodified line — returned `["Growl.wav"]`, so the empty array was the rules
and not a broken probe.

**The rule, decided and written down: a gag hides text from the eye, never
from the ear or the alert broker.** It follows from `lineRules.ts`'s own
argument that a gag is a display preference and not a delete, which is why
this was the defensible half of the two options the issue put.

So `GameSignals` takes `useRawGameLines()`, `lineRules.ts`'s list of
raw-reading consumers names it, and `tools/line-rules-test.mjs` checks both
halves:

- the behaviour — a gagged danger line, and a substituted one, still paint
  their sound off the raw reading, each with a control asserting the rig can
  produce a sound at all;
- the source — the play-a-sound entry points are **derived from
  `alertSound.ts`'s own exports** rather than listed, every component
  importing one of them is classified, and every one that reads the buffer
  must read it raw. It prints `N of N` and asserts a floor at each step, so a
  scan that found nothing reports itself instead of reporting a clean tree.

Sabotaged both ways: flipping `GameSignals` back to `useGameLines` on disk
turns that check red (`0 of 1 … READS THE DISPLAY LIST`), and the suite
carries the same mutation as an in-run sabotage with a control proving the
classifier sees the real file correctly. The file was restored and its md5
compared.

### 14.2 The dry run shows what the lane would accept, and a variable cannot smuggle script (#485)

`runMacroCommands` is one function for the dry run and the real fire, on
purpose. That was true of the code path and not of the answer, because the
real fire had one step the dry run did not: `requestGameAction` →
`validateGameActionCommand`, which refuses `;` and control characters, and
variables are expanded *before* it.

Measured, before the fix, with `$shop = "bank;withdraw 5000 coins"` and
`$nl = "go bank\nsell all"`: the dry run listed both commands as though they
would go, and the lane refused both — "cannot contain a command separator"
and "must be one line and contain no control characters".

And the enable guards judged the stored text. `macroEnableRefusal({ key: 'F6',
commands: ['go $s'] })` returned `null`; `$s = "#queue clear"` was substituted
afterwards at fire time; `go #queue clear` was accepted by the lane and went
to DragonRealms as literal text — the exact outcome `aliasEnableRefusal`'s own
comment says the guard exists to prevent. 87 of the 356 aliases and 25 of the
95 macros in the real config import switched off for that reason, and a
one-line variable put any of them back.

The fix is one predicate at every place the question is asked:

- **`scriptRefusalWhy`** (in `aliases.ts`) asks two things of the text that
  will be sent: is the *planned* text a directive, and did a variable carry a
  directive into it. The second is checked against the variable's **value**
  rather than by widening `isGenieScript`, so nothing changes for a config
  with no variables in it, and the refusal can name the row to edit —
  `$s is "#queue clear"`.
- **`macroEnableRefusal` and `aliasEnableRefusal`** take the variable table
  and judge the expanded text. Their callers (`MacrosTab`, `AliasesTab`,
  `resolveAliases`) pass it.
- **`plannedCommandRefusal`** adds the lane's own
  `validateGameActionCommand` — the same function `requestGameAction` calls,
  not a copy of its rules — and `runMacroCommands` asks it of every planned
  command. On a dry run the answers come back as `planRefusals`, index for
  index with `plan`, and the Macros tab shows each one beside the command it
  belongs to and reports "would send 1 of 2" rather than "would send 2".
- On a real fire the same answers refuse the macro, **before** the in-flight
  slot is claimed and with nothing partial sent: a variable edited after the
  macro was switched on cannot smuggle script through, because nothing re-runs
  the enable guard in between.

`tools/macro-dry-run-test.mjs` covers both halves with the wrong answer
available: a clean macro plans two commands with no refusals and really sends
them (the positive control for every zero), the same macro with a scripted
variable sends nothing and names the script, and two sabotages — removing the
fire-time check, and pointing the enable guard back at the stored text —
each redden their own checks and leave the other's alone.

### 14.3 Still true, and not changed here

- `isGenieScript` is unchanged: a leading `#` in a `;`-separated part, or a
  `\x` escape. `go #queue clear` typed literally, with no variable involved,
  is still not called script — it is a `go` command with an odd argument, and
  refusing it would be a different decision about a different case.
- A macro refused at fire time sends nothing and says so in its result, which
  `App.tsx` does not yet surface anywhere on screen. The dry run and the
  enable-time refusal are where a player meets it today. That gap is real and
  is not this pass's.
