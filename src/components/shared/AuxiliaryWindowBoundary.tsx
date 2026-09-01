import { Component, type ReactNode } from 'react'

interface Props {
  label: string
  children: ReactNode
  onError?: (error: Error, componentStack: string) => void
}

/** Keeps a detached webview recoverable even when its only content crashes. */
export class AuxiliaryWindowBoundary extends Component<Props, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Retain a developer-visible trace even if the application log callback fails.
    // eslint-disable-next-line no-console
    console.error(`[${this.props.label}] auxiliary window crashed:`, error, info.componentStack)
    this.props.onError?.(error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex h-full min-h-0 w-full flex-col items-start justify-center gap-3 bg-surface p-4 text-sm text-ink" role="alert">
          <div>
            <h1 className="font-semibold text-danger">{this.props.label} crashed</h1>
            <p className="mt-1 break-words text-xs text-ink-muted">{this.state.error.message}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border border-danger/50 px-3 py-1 text-danger hover:bg-danger/10" onClick={() => this.setState(({ attempt }) => ({ error: null, attempt: attempt + 1 }))}>
              Retry
            </button>
            <button type="button" className="rounded border border-border px-3 py-1 text-ink-muted hover:text-ink" onClick={() => window.location.reload()}>
              Reload window
            </button>
            <button type="button" className="rounded border border-border px-3 py-1 text-ink-muted hover:text-ink" onClick={() => window.close()}>
              Close pop-out
            </button>
          </div>
        </main>
      )
    }
    return <div key={this.state.attempt} className="h-full min-h-0 w-full">{this.props.children}</div>
  }
}
