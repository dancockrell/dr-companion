import { Suspense, type ReactNode } from 'react'
import { PanelBoundary } from './PanelBoundary'

export function LazySurface({ label, children }: { label: string; children: ReactNode }) {
  return (
    <PanelBoundary label={label} onRetry={() => window.location.reload()}>
      <Suspense
        fallback={
          <div className="flex min-h-16 items-center justify-center p-3 text-sm text-ink-muted" role="status">
            Loading {label.toLowerCase()}…
          </div>
        }
      >
        {children}
      </Suspense>
    </PanelBoundary>
  )
}
