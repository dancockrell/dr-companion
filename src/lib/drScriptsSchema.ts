/**
 * dr-scripts settings, derived as a schema — never invented, never committed.
 *
 * `DOMAIN.md:1150-1153`: "the settings are structured, typed data. A herb
 * entry is a record with `name`, `size`, `stackable`, `room`, `price`,
 * `quantity`. A form produces that correctly every time; a person counting
 * spaces does not." This module is the "produces that correctly" half: given
 * the text of a player's own settings file (or files, in dr-scripts' own
 * load order), it derives a typed schema by walking the parsed YAML — it
 * never hand-encodes a copy of `base.yaml`'s keys. A committed schema is a
 * fork of a file its authors keep changing, and it would drift silently
 * (CLAUDE.md §0). Read `base.yaml` at runtime instead.
 *
 * Three things make this the hard part rather than a one-line `YAML.load`:
 *
 *   - **Anchors and aliases are in scope.** dr-scripts' town/crafting/hunting
 *     data files lean on them heavily (`base-town.yaml` alone defines 20+
 *     anchors) and nothing rules out a player's own profile doing the same.
 *     `js-yaml`'s `load()` resolves these for us within one document; this
 *     module does not reimplement YAML, it walks the object `load()`
 *     already produced.
 *   - **Merge keys (`<<: *name`) need the YAML 1.1 schema, not the default
 *     one.** `companion_bridge.lic`'s `Yaml.check` parses with Ruby's
 *     `YAML.unsafe_load_file` (Psych), which follows YAML 1.1 and resolves
 *     `<<` automatically. `js-yaml`'s *default* schema does not: measured
 *     against the installed js-yaml (5.4.1), `load('herbs:\n  - <<: *d\n
 *     name: kelp')` with no schema option returns a literal `'<<'` key
 *     holding the aliased map, not a merged record — every herb built from
 *     `<<: *common_herb_fields` would report only the fields it wrote
 *     itself. `yaml.YAML11_SCHEMA` (exported by this js-yaml version
 *     specifically for YAML 1.1 documents) resolves it correctly and, as a
 *     side effect, matches Psych's own looser YAML-1.1 scalar rules —
 *     `y`/`n`/`yes`/`no`/`on`/`off` as booleans, for instance — which is a
 *     feature here: this derivation should see what Ruby sees, not what the
 *     stricter YAML 1.2 core schema sees.
 *   - **`base.yaml` itself uses a Ruby-specific tag.** The installed file
 *     (verified 2026-09-10 against `C:\Ruby4Lich5\Lich5\scripts\profiles\
 *     base.yaml`) has three `!ruby/regexp` scalars under
 *     `pattern_hues_no_use_rooms`. `js-yaml`'s YAML11_SCHEMA does not know
 *     that tag and throws `unknown scalar tag !<!ruby/regexp>` — which is
 *     correct default behaviour for an unrecognised tag, and would be a
 *     dropped branch here: the whole file would fail to parse over one
 *     setting nobody asked this module to execute as a regexp. `RUBY_TAG`
 *     below matches any `!ruby/...` scalar by prefix and keeps its literal
 *     source as an opaque value, so the setting still appears in the schema
 *     (typed `string`, carrying the tag) instead of taking the file down.
 *   - **Anchors do not cross files.** dr-scripts loads `base.yaml`, then
 *     `<Character>-setup.yaml`, then `<Character>-<Arg>.yaml`, later files
 *     winning key-by-key (`companion_bridge.lic`'s `Yaml.files_for`
 *     comment). Each of those is a separate YAML document with its own
 *     anchor table — an anchor defined in `base.yaml` is not visible to an
 *     alias in a character's own file, and two different files are free to
 *     reuse the same anchor *name* for unrelated things. `deriveSchema`
 *     parses every file independently for exactly this reason: concatenating
 *     the text first would either collide anchor names across files or, worse,
 *     let one file's alias silently resolve against another file's anchor —
 *     a bug that would only ever surface as a setting quietly taking the
 *     wrong value.
 *
 * A derivation that finds nothing has failed, not produced an empty form —
 * `MIN_SETTINGS` is the floor. A file that will not parse is reported with
 * its line and column, never silently skipped into a schema missing a
 * branch: `companion_bridge.lic`'s `Yaml.check` already reports line/column
 * for exactly this reason, and this module keeps that contract.
 *
 * Scope note (2026-09-10): this increment (Z0) is scoped to this file only.
 * `lich-scripts/companion_bridge.lic` is held by lane R0
 * (`lane-r0/activity-intent-contract`) at the time of writing, and
 * `docs/PLAN_TO_1_0.md` §3.1 allows only one increment touching that file to
 * be in progress at once across lanes R/W/X/Y/Z. The bridge-side change that
 * would send a settings file's raw text to the client over the socket (so
 * this module can run against the *installed* file inside the Tauri app,
 * not just in a Node test) is deferred to whichever of Z0/Z1 picks the
 * bridge queue up next. This module is fully usable today from anything
 * that can hand it file text — a Node test against the real file on disk
 * (see `tools/drscripts-schema-test.mjs`), a Tauri `fs` read, or the bridge
 * once it is free.
 */
import { load as parseYaml, Schema, YAML11_SCHEMA, defineScalarTag } from 'js-yaml'

/**
 * Any `!ruby/...` scalar tag (`!ruby/regexp`, `!ruby/symbol`, etc). Matched
 * by prefix so a dr-scripts file using a Ruby tag this module has never seen
 * still parses — the setting appears with its literal source text rather
 * than vanishing the whole file over one unrecognised tag. `resolve`'s
 * three-argument shape (`source, isExplicit, tagName`) is `js-yaml` 5's
 * scalar-tag contract, verified against the installed version by reading
 * `boolYaml11Tag`'s own definition rather than guessed from the docs.
 */
const RUBY_TAG = defineScalarTag('!ruby/', {
  matchByTagPrefix: true,
  resolve: (source: unknown, _isExplicit: boolean, tagName: string) => ({
    rubyTag: tagName,
    source: String(source),
  }),
  // Required by js-yaml's types for the dump direction; this module only
  // loads, but the schema is shared, so an identify function still has to
  // exist. Structural, matching `isRubyTagValue` below.
  identify: (data: unknown) =>
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { rubyTag?: unknown }).rubyTag === 'string',
})

/** YAML 1.1 (for merge-key and loose-scalar support, see the module
 *  comment) plus the Ruby-tag fallback above. Built once at module load. */
const SCHEMA = new Schema([...YAML11_SCHEMA.tags, RUBY_TAG])

/** A derivation that parses cleanly but finds fewer settings than this is
 *  treated as a failure, not an empty form — see the module comment. */
const MIN_SETTINGS = 1

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'list'
  | 'record'
  | 'list-of-records'

export interface FieldSchema {
  key: string
  type: FieldType
  /** For `record` and `list-of-records`: the field names/types found. For
   *  `list-of-records` this is the *union* of keys across every entry in the
   *  sample, because dr-scripts entries do not all carry every optional
   *  field (a herb missing `stackable` is still a herb). */
  fields?: FieldSchema[]
  /** For `list` and `list-of-records`: how many entries were sampled. */
  sampleSize?: number
  /** The value as read from the file, for display — never re-encoded. */
  default: unknown
}

/** One settings file's identity and text. `name` is a display name
 *  (`base.yaml`, `Kenstrom-setup.yaml`) — not a filesystem path, so this
 *  module never touches a disk itself and stays usable from a browser
 *  bundle, a Node test, or a Tauri command result alike. */
export interface SourceFile {
  name: string
  text: string
}

export interface SchemaOk {
  ok: true
  settings: FieldSchema[]
  count: number
  /** Which file each top-level key's *effective* value came from, honouring
   *  dr-scripts' later-file-wins load order. */
  sources: Record<string, string>
}

export interface SchemaError {
  ok: false
  file: string
  error: string
  /** 1-based, matching what a text editor shows — `js-yaml` marks are
   *  0-based and are converted here. Present only when the parser could
   *  locate the failure. */
  line?: number
  column?: number
}

export type SchemaResult = SchemaOk | SchemaError

interface RubyTagValue {
  rubyTag: string
  source: string
}

/** True for the wrapper `RUBY_TAG.resolve` produces for a `!ruby/...`
 *  scalar. Checked structurally (not `instanceof`) because the value has
 *  crossed a `JSON`-shaped boundary by the time anything here sees it. */
function isRubyTagValue(value: unknown): value is RubyTagValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return typeof v.rubyTag === 'string' && typeof v.source === 'string' && Object.keys(v).length === 2
}

function classify(value: unknown): FieldType {
  if (value === null || value === undefined) return 'null'
  if (isRubyTagValue(value)) return 'string'
  if (Array.isArray(value)) {
    const allRecords =
      value.length > 0 &&
      value.every((v) => typeof v === 'object' && v !== null && !Array.isArray(v) && !isRubyTagValue(v))
    return allRecords ? 'list-of-records' : 'list'
  }
  if (typeof value === 'object') return 'record'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

/** Union the keys of every sampled record, typing each from the first
 *  record that actually carries it. */
function recordFields(records: Record<string, unknown>[]): FieldSchema[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }
  return keys
    .slice()
    .sort()
    .map((key) => {
      const owner = records.find((r) => key in r)
      return fieldSchema(key, owner ? owner[key] : undefined)
    })
}

/** Recursively swap every `!ruby/...` wrapper for its readable form, so a
 *  `default` never leaks the internal `{ rubyTag, source }` shape whether
 *  the tag sits at the top of a field or nested in a list/record. */
function normalizeDisplay(value: unknown): unknown {
  if (isRubyTagValue(value)) return `${value.rubyTag} ${value.source}`
  if (Array.isArray(value)) return value.map(normalizeDisplay)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeDisplay(v)]))
  }
  return value
}

function fieldSchema(key: string, value: unknown): FieldSchema {
  const type = classify(value)
  const schema: FieldSchema = { key, type, default: normalizeDisplay(value) }
  if (type === 'list-of-records') {
    const records = value as Record<string, unknown>[]
    schema.fields = recordFields(records)
    schema.sampleSize = records.length
  } else if (type === 'list') {
    schema.sampleSize = (value as unknown[]).length
  } else if (type === 'record') {
    schema.fields = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => fieldSchema(k, v))
  }
  return schema
}

interface FileMark {
  message?: string
  mark?: { line?: number; column?: number }
}

/** Parse exactly one file's text into a plain object. Anchors, aliases and
 *  merge keys are resolved by `js-yaml` within this single call only — a
 *  fresh call has a fresh anchor table, which is the mechanism behind
 *  "anchors do not cross files" (see the module comment). */
export function parseOneFile(file: SourceFile): { ok: true; data: Record<string, unknown> } | SchemaError {
  let parsed: unknown
  try {
    parsed = parseYaml(file.text, { filename: file.name, schema: SCHEMA })
  } catch (err) {
    const e = err as FileMark
    const line = typeof e.mark?.line === 'number' ? e.mark.line + 1 : undefined
    const column = typeof e.mark?.column === 'number' ? e.mark.column + 1 : undefined
    return {
      ok: false,
      file: file.name,
      error: e.message ?? String(err),
      line,
      column,
    }
  }
  if (parsed === null || parsed === undefined) return { ok: true, data: {} }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    const kind = Array.isArray(parsed) ? 'a list' : typeof parsed
    return {
      ok: false,
      file: file.name,
      error: `${file.name} must be a mapping of settings, not ${kind}.`,
    }
  }
  return { ok: true, data: parsed as Record<string, unknown> }
}

/**
 * Derive a settings schema from one or more files, layered in dr-scripts'
 * own load order (earliest first — `base.yaml`, then `<Character>-setup.yaml`,
 * then `<Character>-<Arg>.yaml`). Later files win key-by-key, matching
 * `companion_bridge.lic`'s `Yaml.files_for` comment. Each file is parsed on
 * its own, so an anchor in one is never visible to an alias in another.
 *
 * A file that will not parse fails the whole derivation loudly, naming the
 * file and, where the parser could locate it, the line and column — never
 * silently produces a schema missing that file's branch. A derivation that
 * parses every file cleanly but finds fewer than `MIN_SETTINGS` top-level
 * keys also fails: an empty result is indistinguishable from a broken
 * derivation unless it is treated as one.
 */
export function deriveSchema(files: SourceFile[]): SchemaResult {
  if (files.length === 0) {
    return { ok: false, file: '(none)', error: 'No settings files were given to derive a schema from.' }
  }

  const merged: Record<string, unknown> = {}
  const sources: Record<string, string> = {}
  for (const file of files) {
    const parsed = parseOneFile(file)
    if (!parsed.ok) return parsed
    for (const [key, value] of Object.entries(parsed.data)) {
      merged[key] = value
      sources[key] = file.name
    }
  }

  const settings = Object.entries(merged)
    .map(([key, value]) => fieldSchema(key, value))
    .sort((a, b) => a.key.localeCompare(b.key))

  if (settings.length < MIN_SETTINGS) {
    const last = files[files.length - 1]!.name
    return {
      ok: false,
      file: last,
      error:
        `Parsed cleanly but found ${settings.length} top-level setting(s) across ` +
        `${files.length} file(s) — that is not a real dr-scripts profile, so this ` +
        'is reported as a failure rather than an empty form.',
    }
  }

  return { ok: true, settings, count: settings.length, sources }
}

/** Convenience for the common single-file case: derive a schema directly
 *  from one file's text (the increment's own `verify:` line — "derive
 *  against the installed `base.yaml`"). */
export function deriveSchemaFromYaml(text: string, name = 'base.yaml'): SchemaResult {
  return deriveSchema([{ name, text }])
}
