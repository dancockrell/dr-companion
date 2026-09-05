/**
 * The only way a model reaches anything this app knows.
 *
 * `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 16: "The model reaches the
 * world through typed tools and through nothing else." An allowlist of names
 * is the smaller half of that. The rules below are the half that does the
 * work, and each exists because of a specific way a tool layer leaks:
 *
 * - **Validate before executing.** A tool that trusts its arguments is a tool
 *   the model can point anywhere.
 * - **Refuse, never throw.** A disallowed or unknown name returns
 *   `{ok:false, reason}`. A thrown error crossing back into the worker's turn
 *   is the failure `aiModelProvider.ts` already refuses to make: absence and
 *   refusal are values here too.
 * - **Cap the result, and say when the cap bit.** `truncated:true` travels
 *   with the shortened result. Section 16 wants an over-size result to fail
 *   rather than be silently shortened, "because a silently shortened corpus is
 *   a wrong answer that looks complete" - the flag is how that stops being
 *   silent, and it reaches both the caller and the trace.
 * - **Label untrusted text.** Room titles, tags and wiki prose are data. They
 *   come back wrapped as `{untrusted:true, text}` so a prompt builder can mark
 *   them "data, not instructions" rather than having to remember which fields
 *   came from where.
 * - **Trace every call, without payloads.** A job whose tool calls are not in
 *   its trace cannot be audited, and a trace carrying a credential is a leak
 *   with a long tail. So the trace records the tool, a short argument summary,
 *   a byte count and a time - never the result and never the arguments
 *   verbatim.
 *
 * # No canonical data is imported here
 *
 * `room_by_id` reads a `MapZone` the caller supplies - the same shape
 * `compileWorldSnapshot` reads - rather than importing `mapData.ts`. Two
 * reasons, and they point the same way: `mapData.ts` resolves its zones
 * through `import.meta.glob`, which only Vite can do, so importing it would
 * make this module untestable outside the app; and a tool layer that reaches
 * into a canonical store on its own is a tool layer whose scope is whatever it
 * can see rather than whatever it was given.
 */
import type { MapZone, MapZoneRoom } from '../bridge/types'
import { isApproximate, loreFor } from './bestiary.ts'

/**
 * Text that came from outside this app.
 *
 * A wrapper rather than a sibling field, for the reason `Sourced<T>` in
 * `src/types/stream.ts` gives: a sibling gets dropped by the first `{...spread}`
 * somebody writes, and a wrapper cannot be dropped without the value going
 * with it.
 */
export interface UntrustedText {
  untrusted: true
  text: string
}

export function untrusted(text: string): UntrustedText {
  return { untrusted: true, text }
}

export type ToolResult =
  | { ok: true; value: unknown; bytes: number; truncated: boolean }
  | { ok: false; reason: string }

/** One entry in a job's audit trail. No payloads, no arguments verbatim. */
export interface ToolTraceEntry {
  tool: string
  argsSummary: string
  bytes: number
  at: number
  ok: boolean
}

export interface ToolContext {
  /** The zone the caller has already loaded. Null when none is available,
   * which is a refusal rather than an empty answer. */
  zone?: MapZone | null
  /** Journal reader for `recent_events`. Structural, so a test needs no
   * journal and this module needs no import from one. */
  journal?: {
    readFrom(cursor: number, limit?: number): {
      events: Array<{ seq: number; at: number; kind: string; payload: unknown }>
    }
    acknowledged(): number
  } | null
  /** Stream ids whose private communications the player has opted into.
   * Empty by default; a tool result is not a back door around the same
   * rule a prompt follows. */
  privacyOptIn?: readonly string[]
  /** Wall clock, injected so a trace is deterministic under test. */
  now?: number
}

interface ReadOnlyTool {
  id: string
  /** Null when the arguments are acceptable, otherwise why they are not.
   * Validation happens before execution and its refusal names the field. */
  validate(args: Record<string, unknown>): string | null
  maxResultBytes: number
  execute(args: Record<string, unknown>, context: ToolContext): unknown
}

/** How much of an argument object reaches the trace. Enough to tell two calls
 * apart, far too little to carry anything sensitive. */
function summarize(args: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(args)) {
    const shown =
      typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : typeof value === 'string'
          ? `str(${value.length})`
          : Array.isArray(value)
            ? `arr(${value.length})`
            : typeof value
    parts.push(`${key}=${shown}`)
  }
  return parts.join(' ')
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length
}

/**
 * Shorten a result to fit its ceiling, and say that it happened.
 *
 * Only arrays are shortened, because an array is the only shape where a prefix
 * is still a true (if partial) answer. Anything else that will not fit is
 * refused: half an object is not a smaller object, it is a wrong one - section
 * 16's "fails rather than truncating" applies to exactly that shape.
 *
 * Exported because the shortening branch is otherwise unreachable through any
 * tool that returns an object, and a branch nobody can execute on purpose is
 * a branch nobody can prove they fixed.
 */
export function capResult(value: unknown, maxResultBytes: number): ToolResult {
  const bytes = byteLength(value)
  if (bytes <= maxResultBytes) return { ok: true, value, bytes, truncated: false }

  if (!Array.isArray(value)) {
    return {
      ok: false,
      reason: `result of ${bytes} bytes exceeds the ${maxResultBytes}-byte ceiling and cannot be shortened honestly`,
    }
  }

  const kept: unknown[] = []
  for (const item of value) {
    const next = [...kept, item]
    if (byteLength(next) > maxResultBytes) break
    kept.push(item)
  }
  return { ok: true, value: kept, bytes: byteLength(kept), truncated: true }
}

/** Exits as `{move, to}` pairs, paired by index because that is how the zone
 * builder writes them (`toZoneRoom` in `mapData.ts`). A move with no matching
 * destination is carried with `to: null` rather than dropped or guessed. */
function exitsOf(room: MapZoneRoom): Array<{ move: string | null; to: number | null }> {
  const moves = room.moves ?? []
  const to = room.to ?? []
  const count = Math.max(moves.length, to.length)
  const out: Array<{ move: string | null; to: number | null }> = []
  for (let i = 0; i < count; i++) out.push({ move: moves[i] ?? null, to: to[i] ?? null })
  return out
}

const TOOLS: Record<string, ReadOnlyTool> = {
  room_by_id: {
    id: 'room_by_id',
    maxResultBytes: 4096,
    validate(args) {
      if (typeof args.zone !== 'string' || args.zone.length === 0) return 'zone must be a non-empty string'
      if (!Number.isInteger(args.id)) return 'id must be an integer room id'
      return null
    },
    execute(args, context) {
      const zone = context.zone
      if (!zone || zone.ok !== true) return null
      if (zone.zone !== args.zone) return null
      const room = (zone.rooms ?? []).find((r) => r.id === args.id)
      if (!room) return null
      return {
        id: room.id,
        // The cartographer wrote these, not this app: labelled so a prompt
        // builder never has to remember which strings came from outside.
        title: room.title === null || room.title === undefined ? null : untrusted(room.title),
        exits: exitsOf(room),
        tags: (room.tags ?? []).map(untrusted),
      }
    },
  },


  /**
   * What the bestiary already knows about a creature.
   *
   * `approximate` is the whole reason this is a tool rather than a lookup the
   * prompt builder does inline: 773 creatures share 408 nouns, so a match on
   * the noun alone is weaker evidence and a card that hid that difference
   * would let a model state a level it cannot support.
   */
  lore_for: {
    id: 'lore_for',
    maxResultBytes: 4096,
    validate(args) {
      if (typeof args.name !== 'string' || args.name.length === 0) return 'name must be a non-empty string'
      if (typeof args.noun !== 'string' || args.noun.length === 0) return 'noun must be a non-empty string'
      return null
    },
    execute(args) {
      const name = args.name as string
      const noun = args.noun as string
      const lore = loreFor(name, noun)
      if (!lore) return null
      return { lore, approximate: isApproximate(name, noun) }
    },
  },

  /**
   * The tail of the journal, as kinds and sequence numbers.
   *
   * Never `text`. A journalled line's payload holds whatever the game sent,
   * including player speech, and this tool exists to let a model ask "what has
   * been happening" without that being a route by which a whisper reaches a
   * prompt. The privacy class travels so a caller can filter further; the
   * words never do.
   */
  recent_events: {
    id: 'recent_events',
    maxResultBytes: 8192,
    validate(args) {
      if (!Number.isInteger(args.n) || (args.n as number) < 1) return 'n must be a positive integer'
      if ((args.n as number) > 200) return 'n may not exceed 200'
      return null
    },
    execute(args, context) {
      const journal = context.journal
      if (!journal) return null
      const n = args.n as number
      const ack = journal.acknowledged()
      const from = Math.max(0, ack - n)
      const read = journal.readFrom(from, n)
      const optIn = context.privacyOptIn ?? []
      return read.events
        .filter((event) => privacyOf(event.payload) !== 'private-comms' || optedIn(event.payload, optIn))
        .map((event) => ({
          seq: event.seq,
          kind: event.kind,
          at: event.at,
          privacy: privacyOf(event.payload),
        }))
    },
  },
}

/**
 * The privacy class an event already carries, or null when it has none.
 *
 * Read off the payload rather than re-derived: G12 classifies at ingest from
 * the stream id the bridge already labelled, and a second opinion computed
 * here would be a second parser of game text, which section 2 forbids.
 */
/** Whether the player has opted this event's own source into sharing. Read
 * off the payload's stream id, which the bridge labelled and the ingest step
 * carried through - not re-derived here. */
function optedIn(payload: unknown, optIn: readonly string[]): boolean {
  if (payload && typeof payload === 'object' && 'stream' in payload) {
    const stream = (payload as { stream: unknown }).stream
    return typeof stream === 'string' && optIn.includes(stream)
  }
  return false
}

function privacyOf(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'privacy' in payload) {
    const value = (payload as { privacy: unknown }).privacy
    return typeof value === 'string' ? value : null
  }
  return null
}

/** Every tool that exists. Exported so a test can assert the registry rather
 * than keeping its own copy of the list, which would drift. */
export const TOOL_IDS: readonly string[] = Object.keys(TOOLS)

/**
 * Call a tool, or refuse and say why.
 *
 * Four refusals, deliberately distinct: unknown, disallowed, invalid
 * arguments, and a result that cannot be shortened honestly. Collapsing any
 * two of them would send a reader looking in the wrong place - "unknown" and
 * "not allowed for this job" are different bugs with different fixes.
 *
 * The trace is appended for refusals as well as successes. A job that tried to
 * call something it was not allowed to call is exactly the thing an audit
 * wants to see, and a trace that only recorded successes would hide it.
 */
export function callTool(
  name: string,
  args: Record<string, unknown>,
  allowedTools: readonly string[],
  trace: ToolTraceEntry[],
  context: ToolContext = {}
): ToolResult {
  const at = context.now ?? Date.now()
  const record = (result: ToolResult): ToolResult => {
    trace.push({
      tool: name,
      argsSummary: summarize(args),
      bytes: result.ok ? result.bytes : 0,
      at,
      ok: result.ok,
    })
    return result
  }

  if (!allowedTools.includes(name)) {
    return record({ ok: false, reason: `Tool "${name}" is not in this job's allowedTools.` })
  }
  const tool = TOOLS[name]
  if (!tool) return record({ ok: false, reason: `Tool "${name}" does not exist.` })

  const invalid = tool.validate(args)
  if (invalid !== null) {
    return record({ ok: false, reason: `Tool "${name}" refused its arguments: ${invalid}` })
  }

  let value: unknown
  try {
    value = tool.execute(args, context)
  } catch (error) {
    // A tool that throws is a bug in the tool, and it still must not become an
    // exception in the worker's turn - the failure is reported as a refusal
    // naming the tool so it is findable rather than swallowed.
    return record({
      ok: false,
      reason: `Tool "${name}" failed: ${error instanceof Error ? error.message : String(error)}`,
    })
  }

  return record(capResult(value, tool.maxResultBytes))
}
