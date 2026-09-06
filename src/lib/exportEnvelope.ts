/**
 * The header every document this app writes for a player carries, and the one
 * reader that admits or refuses it.
 *
 * # Why this is one module rather than two identical blocks
 *
 * The scene editor's export (#468) and Q6's whole-store player config export
 * are the same document in two domains: `{ version, provenance, ...payload }`,
 * written as text a person can read, mailed to another machine, pasted back
 * in. `parseSceneOverrides` grew the four refusals below first, because #461
 * found that `version: 99` imported as if it were version 1 - a field sitting
 * in the type doing no work at all. Writing them a second time for the player
 * config would have been a second opinion about what a valid document header
 * is, and two of them would eventually disagree about the day a version 2
 * arrives. So the checks moved here and both readers call this; the scene
 * refusals keep their exact wording, which is what
 * `tools/scene-editor-test.mjs` still asserts on.
 *
 * # What it does not do
 *
 * It reads the header and nothing else. The payload is each domain's own
 * business - `parseSceneOverrideSet` for rooms, `parsePlayerConfigFile` for
 * the seven rule domains - because a shared reader that also understood
 * payloads would be a schema library, and the reasons a payload is refused
 * are the product in both places.
 */

/** The header. Both exports write exactly these two fields ahead of their
 *  payload, in this order. */
export interface ExportEnvelope {
  version: number
  /** What the file is: `player` for something a person made by hand, a tool's
   *  own name for something generated. A reader who finds one on disk knows
   *  which without opening the payload. */
  provenance: string
}

/** A value quoted back into a refusal, bounded so a refusal about a megabyte
 *  is not a megabyte. Moved here from `sceneOverrides.ts`, which now imports
 *  it, for the same reason as the checks themselves. */
export function shortenValue(value: unknown, limit = 48): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value))
  return text.length <= limit ? text : `${text.slice(0, limit)}… (${text.length} characters)`
}

export interface EnvelopeSpec {
  /** How a refusal names the document, with its article: `a scene export`,
   *  `a player config export`. Used mid-sentence and, capitalised, at the
   *  start of one. */
  kind: string
  /** The version this build writes. */
  version: number
  /**
   * Older versions this build can read and migrate.
   *
   * Empty is the honest answer where there is no migration - scene exports
   * have only ever had version 1 - and it is a list rather than a `minimum`
   * so that dropping support for one old version does not silently re-admit
   * an older one below it.
   */
  migratable?: readonly number[]
  /** How long a provenance string may be. */
  provenanceChars?: number
}

export type EnvelopeRead =
  | { ok: true; version: number; provenance: string; migrated: boolean }
  | { ok: false; reason: string }

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/**
 * Admit or refuse a document header.
 *
 * Four refusals, each naming what it saw. A version this build does not know
 * is refused rather than read as the current one: old data under a new meaning
 * is the quietest bug there is, and a file written by a build the player has
 * since downgraded from is exactly that. A version in `migratable` is admitted
 * and flagged, so the caller migrates deliberately rather than by the payload
 * happening to still parse.
 */
export function readEnvelope(file: unknown, spec: EnvelopeSpec): EnvelopeRead {
  const chars = spec.provenanceChars ?? 256
  if (file == null || typeof file !== 'object' || Array.isArray(file)) {
    return { ok: false, reason: `That is not ${spec.kind}: it is ${shortenValue(file)}.` }
  }
  const envelope = file as Partial<ExportEnvelope>
  if (!('version' in envelope)) {
    return {
      ok: false,
      reason: `That file has no version. ${capitalise(spec.kind)} says version ${spec.version}.`,
    }
  }
  const version = envelope.version
  const migratable = spec.migratable ?? []
  if (typeof version !== 'number' || (version !== spec.version && !migratable.includes(version))) {
    const also = migratable.length ? ` (and migrates ${migratable.join(', ')})` : ''
    return {
      ok: false,
      reason:
        `That file says version ${shortenValue(version)}. This build reads version ` +
        `${spec.version}${also} and has no way to migrate from ${shortenValue(version)}.`,
    }
  }
  if (
    typeof envelope.provenance !== 'string' ||
    envelope.provenance.length === 0 ||
    envelope.provenance.length > chars
  ) {
    return {
      ok: false,
      reason:
        `That file has no provenance saying where it came from. ` +
        `${capitalise(spec.kind)} says provenance "player".`,
    }
  }
  return { ok: true, version, provenance: envelope.provenance, migrated: version !== spec.version }
}
