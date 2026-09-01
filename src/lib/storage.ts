/**
 * The "parse JSON from a key, fall back on any error" and "stringify and
 * write" shapes, factored out after they
 * showed up hand-rolled in six different files (persistence, profiles,
 * useMacroChoice, portraits, mapDock, layout) with the same reasoning
 * ("private mode or a full quota - losing a preference is not worth an error
 * in front of someone mid-fight") copy-pasted into each one's `catch` block.
 *
 * Callers that need to validate or merge what comes back - defaults, field
 * clamping, migrating an old shape - still do that themselves on top of the
 * raw value this returns. This only owns the storage access, not what a
 * caller trusts once it has one.
 */

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export type StorageFailureKind = 'quota' | 'security' | 'serialization' | 'unavailable' | 'unknown'
export type StorageWriteResult = { ok: true } | { ok: false; kind: StorageFailureKind; message: string }

interface PendingWrite { key: string; value: string; retryable: boolean; failure: Exclude<StorageWriteResult, { ok: true }> }
const pending = new Map<string, PendingWrite>()
const listeners = new Set<() => void>()
let revision = 0

function publish() {
  revision++
  for (const listener of listeners) listener()
}

function failureKind(error: unknown): StorageFailureKind {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'quota'
  if (error instanceof DOMException && error.name === 'SecurityError') return 'security'
  if (typeof localStorage === 'undefined') return 'unavailable'
  return 'unknown'
}

function recordFailure(key: string, value: string, kind: StorageFailureKind, error: unknown, retryable = true): StorageWriteResult {
  const failure = { ok: false as const, kind, message: error instanceof Error ? error.message : String(error) }
  pending.set(key, { key, value, retryable, failure })
  publish()
  return failure
}

export function writeText(key: string, value: string): StorageWriteResult {
  try {
    if (typeof localStorage === 'undefined') throw new Error('Persistent storage is unavailable')
    localStorage.setItem(key, value)
    if (pending.delete(key)) publish()
    return { ok: true }
  } catch (error) {
    return recordFailure(key, value, failureKind(error), error)
  }
}

export function writeJSON(key: string, value: unknown): StorageWriteResult {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    return recordFailure(key, '', 'serialization', error, false)
  }
  return writeText(key, serialized)
}

export interface StorageHealth { revision: number; failedWrites: number; failures: StorageFailureKind[] }
export function storageHealth(): StorageHealth {
  return { revision, failedWrites: pending.size, failures: [...new Set([...pending.values()].map((item) => item.failure.kind))] }
}
export function subscribeStorageHealth(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function retryStorageWrites(): StorageHealth {
  for (const item of [...pending.values()]) if (item.retryable) writeText(item.key, item.value)
  return storageHealth()
}
