import { RefreshCw } from 'lucide-react'
import type { ZoneLoadError, ZoneLoadStatus } from '../../lib/useZoneBrowsing'

/** Visible without replacing the last good map. */
export function ZoneLoadNotice({
  loading,
  error,
  onRetry,
  hasMap = true,
}: {
  loading: ZoneLoadStatus | null
  error: ZoneLoadError | null
  onRetry: () => void
  hasMap?: boolean
}) {
  if (error) {
    return (
      <div
        className="flex min-w-0 items-center justify-between gap-2 rounded border border-warn/35 bg-warn/5 px-2 py-1 text-xs"
        role="alert"
      >
        <span className="min-w-0 truncate text-warn" title={error.detail}>
          Couldn’t load {error.name}.
          {hasMap ? ' The current map is still here.' : ''}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="flex shrink-0 items-center gap-1 rounded border border-warn/40 px-2 py-0.5 text-warn hover:bg-warn/10"
          aria-label={`Retry loading ${error.name}`}
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <p className="rounded border border-border bg-surface px-2 py-1 text-xs text-ink-faint" role="status">
        Loading {loading.name}…
      </p>
    )
  }

  return null
}
