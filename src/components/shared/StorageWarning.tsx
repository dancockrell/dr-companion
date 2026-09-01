import { useSyncExternalStore } from 'react'
import { retryStorageWrites, storageHealth, subscribeStorageHealth } from '../../lib/storage'

let snapshot = storageHealth()
function currentSnapshot() {
  const next = storageHealth()
  if (next.revision !== snapshot.revision) snapshot = next
  return snapshot
}

export function StorageWarning() {
  const health = useSyncExternalStore(subscribeStorageHealth, currentSnapshot, currentSnapshot)
  if (health.failedWrites === 0) return null
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-warn/50 bg-warn/10 px-2 py-1 text-xs text-warn" role="alert">
      <span className="min-w-0 flex-1">
        Changes can’t be saved on this device right now. {health.failedWrites} accepted {health.failedWrites === 1 ? 'change is' : 'changes are'} session-only.
      </span>
      <button type="button" onClick={retryStorageWrites} className="shrink-0 rounded border border-warn/60 px-2 py-0.5 hover:bg-warn/15">
        Retry saving
      </button>
    </div>
  )
}
