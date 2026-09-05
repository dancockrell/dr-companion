/**
 * Candidate claims: what the worker believes, kept where it cannot become
 * what the app knows.
 *
 * The record is `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 7, adopted whole
 * from the 5 September implementation handoff. Every field there is required,
 * and the four the first draft left out - `privacy`, `licence`, `reviewer`,
 * `reviewedAt` - are the ones that decide whether a claim may leave the
 * machine.
 *
 * # This module cannot touch canonical data, structurally
 *
 * It imports nothing from `mapData.ts`, `mapPins.ts`, `bestiary.ts` or any
 * other canonical store, and `tools/ai-claim-store-test.mjs` reads this file's
 * own source to enforce that. A claim is a candidate; a candidate that could
 * write to the map would not be one. G9 adds the single, explicit, reversible
 * promotion path, and it is a separate function with a separate test for
 * exactly that reason.
 *
 * # Evidence is a precondition, not a decoration
 *
 * A claim with no `evidenceRefs`, or with refs that no longer resolve, is
 * refused outright. Section 16: "a reference that dangles after journal
 * eviction is a claim whose provenance cannot be re-derived." `aiEvidenceStore.ts`
 * is what makes them resolvable an hour later, and this store is the caller
 * that makes citing them mandatory.
 *
 * # Retracted and superseded are different facts
 *
 * A retraction says the claim should never have been made. A supersession says
 * a better one exists. Collapsing them loses the reason the older record is
 * still on file, so both exist and supersession *appends* - the old claim is
 * marked `superseded` and stays addressable, never edited into the new one.
 */
import type { ResolveResult } from './aiEvidenceStore.ts'

export type ClaimStatus =
  | 'candidate'
  | 'corroborated'
  | 'accepted-local'
  | 'published'
  | 'rejected'
  | 'retracted'
  | 'superseded'

export type ClaimPrivacy = 'private' | 'group' | 'public-candidate'

export interface ClaimProducer {
  kind: 'human' | 'parser' | 'model' | 'import'
  /** Which worker, parser, importer or person. `kind` alone cannot tell two
   * models or two people apart, and a promotion with no identity cannot be
   * audited against anything. */
  identity: string
  model?: string
  adapter?: string
  softwareVersion?: string
}

export interface Claim {
  schemaVersion: 1
  claimId: string
  subject: string
  predicate: string
  value: unknown
  status: ClaimStatus
  /** Non-empty and resolvable. Enforced at creation and again at every
   * transition that moves a claim toward being believed. */
  evidenceRefs: string[]
  producer: ClaimProducer
  /** Advisory, never proof. Null is a real value - a deterministic parser
   * claim has no probability to report and should not invent one. */
  confidence: number | null
  createdAt: string
  /** Null until reviewed. "Never reviewed" and "reviewed and found current"
   * must stay different facts. */
  reviewedAt: string | null
  reviewer: string | null
  /** The claimId this one replaces, or null. Supersession appends; it never
   * edits the record it replaces. */
  supersedes: string | null
  privacy: ClaimPrivacy
  /** Null only when the claim rests on nothing third-party. */
  licence: string | null
}

/**
 * Legal transitions. Anything absent is refused.
 *
 * The four terminal states have no outgoing transitions, for the reason
 * `aiJobStore.ts` gives about its own table: a terminal status that could be
 * moved again would make itself meaningless. `superseded` is terminal and is
 * reached only through `supersede`, never through `transition` - the point of
 * a supersession is that a *new* record exists, and a bare status change would
 * lose it.
 */
const ALLOWED: Record<ClaimStatus, readonly ClaimStatus[]> = {
  candidate: ['corroborated', 'accepted-local', 'rejected', 'retracted'],
  corroborated: ['accepted-local', 'rejected', 'retracted'],
  'accepted-local': ['published', 'retracted'],
  published: [],
  rejected: [],
  retracted: [],
  superseded: [],
}

export const TERMINAL_CLAIM_STATUSES: readonly ClaimStatus[] = [
  'published',
  'rejected',
  'retracted',
  'superseded',
]

export function isTerminalClaim(status: ClaimStatus): boolean {
  return TERMINAL_CLAIM_STATUSES.includes(status)
}

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return ALLOWED[from].includes(to)
}

export const CLAIM_KEY = 'drc.ai-claims.v1'

/**
 * What this store needs from the evidence store.
 *
 * Structural, so nothing canonical is imported to satisfy it and a test can
 * supply a resolver of two lines. The type import above is a type only and
 * disappears at compile time.
 */
export interface EvidenceResolver {
  resolve(refs: readonly string[]): ResolveResult
}

export interface ClaimResult {
  ok: boolean
  claim?: Claim
  /** Why it was refused, for a caller that must report rather than guess. */
  reason?: string
}

/**
 * Publication is refused for now, and it is a deliberate refusal rather than a
 * missing feature.
 *
 * `accepted-local -> published` is a legal transition in the table because it
 * is a legal transition in the contract, and the conditions on it - a privacy
 * class that is not `private`, and a licence - are checked. Then it is refused
 * anyway, because nothing that could publish a claim exists: the sharing path
 * is G11-era work behind Dan's approval. A silently-succeeding `published`
 * status on a machine with nowhere to publish to would be a record claiming
 * something that never happened.
 */
const PUBLICATION_UNAVAILABLE =
  'publication is not built: no sharing path exists yet, so a claim cannot honestly be marked published'

interface StoredShape {
  schemaVersion: 1
  claims: Claim[]
}

export interface CreateClaimParams {
  subject: string
  predicate: string
  value: unknown
  evidenceRefs: string[]
  producer: ClaimProducer
  confidence?: number | null
  privacy?: ClaimPrivacy
  licence?: string | null
  supersedes?: string | null
  now: string
}

export class ClaimStore {
  private claims = new Map<string, Claim>()
  private nextId = 1
  private readonly evidence: EvidenceResolver | null
  private readonly storage: {
    read<T>(key: string, fallback: T): T
    write(key: string, value: unknown): unknown
  }

  /**
   * The storage functions are injected rather than imported for one reason and
   * it is not testability: `storage.ts` is the app's only persistence path and
   * this store uses it, but a claim store that reached for a module by name
   * could reach for any module by name, and the source check in the test would
   * then be checking a convention instead of a fact. Passing them in keeps the
   * import list of this file short enough to be worth asserting.
   */
  constructor(options: {
    evidence?: EvidenceResolver
    storage: { read<T>(key: string, fallback: T): T; write(key: string, value: unknown): unknown }
  }) {
    this.evidence = options.evidence ?? null
    this.storage = options.storage
  }

  load(): void {
    const stored = this.storage.read<StoredShape | null>(CLAIM_KEY, null)
    if (!stored || !Array.isArray(stored.claims)) return
    this.claims = new Map(stored.claims.map((c) => [c.claimId, c]))
    const highest = stored.claims
      .map((c) => Number.parseInt(c.claimId.replace(/^claim:/, ''), 10))
      .filter((n) => Number.isFinite(n))
    this.nextId = highest.length > 0 ? Math.max(...highest) + 1 : 1
  }

  private persist(): void {
    const shape: StoredShape = { schemaVersion: 1, claims: [...this.claims.values()] }
    this.storage.write(CLAIM_KEY, shape)
  }

  /**
   * Whether this claim's evidence is admissible.
   *
   * Two separate refusals, because they send a reader somewhere different: no
   * refs at all is a producer bug, and refs that will not resolve is evidence
   * that was never pinned or has been evicted. With no resolver attached the
   * store refuses everything rather than accepting on trust - "I could not
   * check" is not "it is fine", and the third state has to be visible.
   */
  private evidenceProblem(refs: readonly string[]): string | null {
    if (refs.length === 0) return 'a claim must cite at least one piece of evidence'
    if (!this.evidence) {
      return 'no evidence store is attached, so these refs cannot be checked and must not be trusted'
    }
    const { missing } = this.evidence.resolve(refs)
    if (missing.length > 0) {
      return `evidence does not resolve: ${missing.join(', ')}`
    }
    return null
  }

  create(params: CreateClaimParams): ClaimResult {
    const problem = this.evidenceProblem(params.evidenceRefs)
    if (problem) return { ok: false, reason: problem }

    if (params.supersedes) {
      const target = this.claims.get(params.supersedes)
      if (!target) return { ok: false, reason: `No such claim to supersede: ${params.supersedes}` }
    }

    const claim: Claim = {
      schemaVersion: 1,
      claimId: `claim:${this.nextId++}`,
      subject: params.subject,
      predicate: params.predicate,
      value: params.value,
      status: 'candidate',
      evidenceRefs: [...params.evidenceRefs],
      producer: params.producer,
      // `??` rather than `||`: a confidence of 0 is a real value - a producer
      // saying "I have no faith in this at all" - and must not be replaced.
      confidence: params.confidence ?? null,
      createdAt: params.now,
      reviewedAt: null,
      reviewer: null,
      supersedes: params.supersedes ?? null,
      privacy: params.privacy ?? 'private',
      licence: params.licence ?? null,
    }
    this.claims.set(claim.claimId, claim)
    this.persist()
    return { ok: true, claim }
  }

  get(claimId: string): Claim | undefined {
    return this.claims.get(claimId)
  }

  all(): Claim[] {
    return [...this.claims.values()]
  }

  byStatus(status: ClaimStatus): Claim[] {
    return this.all().filter((c) => c.status === status)
  }

  /**
   * Move a claim to a new status.
   *
   * A review is a person's act, so `accepted-local` and `rejected` record who
   * and when. Without that a promotion cannot be audited or reversed against
   * anybody, which is what section 7 says `reviewer` is for.
   */
  transition(
    claimId: string,
    to: ClaimStatus,
    params: { now: string; reviewer?: string } = { now: new Date().toISOString() }
  ): ClaimResult {
    const claim = this.claims.get(claimId)
    if (!claim) return { ok: false, reason: `No such claim: ${claimId}` }

    if (to === 'superseded') {
      return {
        ok: false,
        claim,
        reason: 'superseded is reached by appending the replacement claim, never by a status change',
      }
    }

    if (!canTransitionClaim(claim.status, to)) {
      return {
        ok: false,
        claim,
        reason: `Refused ${claim.status} -> ${to} for ${claimId}${
          isTerminalClaim(claim.status) ? ' (already terminal)' : ''
        }`,
      }
    }

    if (to === 'published') {
      if (claim.privacy === 'private') {
        return { ok: false, claim, reason: `Refused: ${claimId} is private and may not be published` }
      }
      if (!claim.licence) {
        return { ok: false, claim, reason: `Refused: ${claimId} has no licence and may not be published` }
      }
      return { ok: false, claim, reason: `Refused: ${PUBLICATION_UNAVAILABLE}` }
    }

    // Evidence is re-checked on the way up, never on the way out. A claim
    // being rejected or retracted because its evidence vanished must still be
    // rejectable; a claim being believed harder must still be provable.
    if (to === 'corroborated' || to === 'accepted-local') {
      const problem = this.evidenceProblem(claim.evidenceRefs)
      if (problem) return { ok: false, claim, reason: `Refused ${claim.status} -> ${to}: ${problem}` }
    }

    claim.status = to
    if (to === 'accepted-local' || to === 'rejected') {
      claim.reviewedAt = params.now
      claim.reviewer = params.reviewer ?? null
    }
    this.persist()
    return { ok: true, claim }
  }

  /**
   * A second, independent observation of something already claimed.
   *
   * Corroboration is not "the same fact seen twice". It is the same fact
   * supported by evidence the claim did not already rest on, and the
   * difference is the whole of it: a producer that runs every second would
   * otherwise corroborate its own claim off one observation until it looked
   * like a hundred, and confidence built that way is a number counting how
   * often a loop ran.
   *
   * So a call citing only refs the claim already holds is refused, by name,
   * and the claim does not move. Only a genuinely new ref promotes
   * `candidate` to `corroborated`.
   *
   * The match is on the triple - subject, predicate and value - because two
   * claims that differ in value are two different assertions, however alike
   * they look. Terminal claims are not matched: corroborating something a
   * person has already rejected would quietly undo the rejection.
   */
  corroborate(params: {
    subject: string
    predicate: string
    value: unknown
    evidenceRefs: readonly string[]
    now: string
  }): ClaimResult {
    const fingerprint = JSON.stringify(params.value)
    const match = this.all().find(
      (c) =>
        c.subject === params.subject &&
        c.predicate === params.predicate &&
        JSON.stringify(c.value) === fingerprint &&
        (c.status === 'candidate' || c.status === 'corroborated')
    )
    if (!match) return { ok: false, reason: 'no open claim makes that assertion' }

    const fresh = params.evidenceRefs.filter((ref) => !match.evidenceRefs.includes(ref))
    if (fresh.length === 0) {
      return {
        ok: false,
        claim: match,
        reason: `Refused: ${match.claimId} already rests on that evidence, so it corroborates nothing`,
      }
    }

    const problem = this.evidenceProblem(fresh)
    if (problem) return { ok: false, claim: match, reason: `Refused corroboration: ${problem}` }

    match.evidenceRefs = [...match.evidenceRefs, ...fresh]
    if (match.status === 'candidate') match.status = 'corroborated'
    this.persist()
    return { ok: true, claim: match }
  }

  /**
   * Append a claim that replaces an existing one.
   *
   * The old record is marked `superseded` and keeps everything else it had, so
   * it stays addressable and the evidence trail is not erased. A cycle - A
   * superseding B which already supersedes A - is refused, because a chain
   * that loops has no current claim at the end of it and every reader walking
   * it would either loop forever or stop somewhere arbitrary.
   */
  supersede(oldClaimId: string, params: Omit<CreateClaimParams, 'supersedes'>): ClaimResult {
    const old = this.claims.get(oldClaimId)
    if (!old) return { ok: false, reason: `No such claim to supersede: ${oldClaimId}` }
    if (isTerminalClaim(old.status)) {
      return { ok: false, claim: old, reason: `Refused: ${oldClaimId} is ${old.status} and cannot be superseded` }
    }

    const created = this.create({ ...params, supersedes: oldClaimId })
    if (!created.ok || !created.claim) return created

    const cycle = this.supersessionCycle(created.claim)
    if (cycle) {
      // Undo rather than leave a record that cannot be walked. The id is not
      // reused: a gap in claim ids is cheaper than an id that meant two things.
      this.claims.delete(created.claim.claimId)
      this.persist()
      return { ok: false, reason: `Refused: that supersession would make a cycle (${cycle.join(' -> ')})` }
    }

    old.status = 'superseded'
    this.persist()
    return created
  }

  /** The supersession chain from a claim back through what it replaced, or
   * null when it terminates honestly. Returns the loop itself so a refusal can
   * name it rather than only assert one exists. */
  private supersessionCycle(from: Claim): string[] | null {
    const seen: string[] = [from.claimId]
    let current = from.supersedes
    while (current) {
      if (seen.includes(current)) return [...seen, current]
      seen.push(current)
      current = this.claims.get(current)?.supersedes ?? null
    }
    return null
  }

  /** Test and reset hook. Clears memory and storage together so the two cannot
   * disagree. */
  reset(): void {
    this.claims.clear()
    this.nextId = 1
    this.storage.write(CLAIM_KEY, { schemaVersion: 1, claims: [] })
  }
}
