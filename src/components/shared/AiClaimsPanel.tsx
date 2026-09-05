import { useSyncExternalStore } from 'react'
import {
  aiClaimRevision,
  getAiClaimStore,
  publishAiClaimsChanged,
  subscribeAiClaims,
} from '../../lib/aiWorkerHost.ts'
import type { Claim } from '../../lib/aiClaimStore.ts'
import { addPin, loadPins, removePin } from '../../lib/mapPins.ts'
import { useAppStore } from '../../store/useAppStore.ts'

/**
 * Where a candidate claim meets a person.
 *
 * Everything the background worker produces is a candidate, and a candidate
 * that nobody can see is the same as one that was never made: the worker would
 * be writing records into storage that only another program could read. This
 * is the read side, and the only place a claim's status changes by anybody's
 * decision.
 *
 * # Accept changes a status and nothing else
 *
 * Accept moves `candidate` or `corroborated` to `accepted-local`. It does not
 * write a pin, a room, a tether or anything else the app treats as its own
 * knowledge. That separation is the point of the whole lane, so it is worth
 * saying plainly here as well as in the store: the map's `localStorage` keys
 * are byte-identical either side of an Accept.
 *
 * Promotion - the one path from an accepted claim into a canonical store - is
 * separate, explicit and reversible, and it is this panel that supplies the
 * pin functions: `aiClaimStore.ts` imports nothing canonical, so the code
 * that actually writes a pin has to live where the person doing the
 * promoting is. Remove puts the map back exactly as it was, by the pin id
 * recorded at promotion rather than by anything that could name a different
 * pin later.
 *
 * # Confidence is shown as what it is
 *
 * A number the producer supplied, not a probability anybody measured. A claim
 * with no confidence shows a dash rather than 0%, because "this producer does
 * not report confidence" and "this producer is certain it is wrong" are
 * different facts and a zero would merge them.
 */
export function AiClaimsPanel() {
  // A revision counter rather than the store, because the store's identity
  // never changes and `useSyncExternalStore` compares snapshots by identity -
  // the same trap `useGameLines` documents about the line buffer.
  useSyncExternalStore(subscribeAiClaims, aiClaimRevision, aiClaimRevision)
  const store = getAiClaimStore()

  if (!store) {
    // "The host has not mounted" and "there are no claims" are different
    // facts, and a panel that showed the empty list for both would say the
    // worker had found nothing when it had never run.
    return <p className="text-xs text-ink-faint">The worker has not started yet.</p>
  }

  const open = store
    .all()
    .filter((c) => c.status === 'candidate' || c.status === 'corroborated')
  const accepted = store.byStatus('accepted-local')

  const act = (run: () => void) => {
    run()
    publishAiClaimsChanged()
  }

  const now = () => new Date().toISOString()
  const character = useAppStore.getState().character

  const promote = (claim: Claim) =>
    act(() =>
      store.promote(claim.claimId, {
        now: now(),
        createPin: (c) => {
          // No character means no per-character pin store to write into. A
          // refusal, not a pin dropped somewhere arbitrary.
          if (!character) return null
          const roomId = Number.parseInt(String(c.subject).replace(/^room:/, ''), 10)
          if (!Number.isFinite(roomId)) return null
          const pins = addPin(character.name, character.instance, {
            roomId,
            zone: useAppStore.getState().mapZone?.zone ?? '',
            label: `${c.predicate} (AI candidate)`,
            color: 'purple',
            note: `Promoted from ${c.claimId}. Evidence: ${c.evidenceRefs.join(', ')}`,
            provenance: 'ai-candidate',
          })
          return pins[pins.length - 1]?.id ?? null
        },
      })
    )

  const revert = (claim: Claim) =>
    act(() =>
      store.revertPromotion(claim.claimId, {
        now: now(),
        deletePin: (pinId) => {
          if (!character) return false
          const before = loadPins(character.name, character.instance).length
          const after = removePin(character.name, character.instance, pinId).length
          // The count is the evidence that something was actually removed.
          // Reporting a revert that deleted nothing would leave the record
          // saying the map had been put back when it had not.
          return after === before - 1
        },
      })
    )

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-faint">
        What the background worker believes, and nothing it has been allowed to act on.
        Accepting a claim changes its status; it does not touch the map, your pins, or
        anything else this client treats as known.
      </p>

      {open.length === 0 && accepted.length === 0 && (
        <p className="text-xs text-ink-faint">No candidates yet.</p>
      )}

      {open.map((claim) => (
        <ClaimRow key={claim.claimId} claim={claim}>
          <button
            type="button"
            className="rounded-lg border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink"
            onClick={() =>
              act(() => store.transition(claim.claimId, 'accepted-local', { now: now(), reviewer: 'you' }))
            }
          >
            Accept
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink"
            onClick={() =>
              act(() => store.transition(claim.claimId, 'rejected', { now: now(), reviewer: 'you' }))
            }
          >
            Reject
          </button>
        </ClaimRow>
      ))}

      {accepted.map((claim) => (
        <ClaimRow key={claim.claimId} claim={claim}>
          {claim.promotedPinId ? (
            <button
              type="button"
              className="rounded-lg border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink"
              onClick={() => revert(claim)}
            >
              Remove that pin
            </button>
          ) : (
            <button
              type="button"
              className="rounded-lg border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink"
              onClick={() => promote(claim)}
            >
              Promote to a pin
            </button>
          )}
        </ClaimRow>
      ))}

    </div>
  )
}

function ClaimRow({ claim, children }: { claim: Claim; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border px-2 py-1.5 space-y-1">
      <div className="text-xs text-ink">
        <span className="font-medium">{claim.subject}</span>{' '}
        <span className="text-ink-muted">{claim.predicate}</span>
      </div>
      <div className="text-xs text-ink-faint flex flex-wrap gap-x-3">
        {/* The refs themselves in the tooltip: a count alone cannot be checked,
            and the whole point of pinning evidence was that somebody could go
            and look at it. */}
        <span title={claim.evidenceRefs.join(', ')}>
          {claim.evidenceRefs.length} piece{claim.evidenceRefs.length === 1 ? '' : 's'} of evidence
        </span>
        <span>
          {claim.producer.kind}: {claim.producer.identity}
        </span>
        <span>
          confidence {claim.confidence === null ? '—' : claim.confidence.toFixed(2)}
        </span>
        <span>{claim.status}</span>
        {claim.promotedPinId ? <span>pinned as {claim.promotedPinId}</span> : null}
      </div>
      {children ? <div className="flex gap-1.5">{children}</div> : null}
    </div>
  )
}
