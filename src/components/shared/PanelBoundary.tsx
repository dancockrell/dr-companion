import { Component, type ReactNode } from 'react'

/**
 * One panel's crash must not take the window with it.
 *
 * Nothing in this tree caught render errors before this existed: a single
 * throw in one box — `<GamePane>` reading `link.connected` before the state
 * it reads was ever guarded — white-screened the entire app, Stop bar
 * included, with the only trace left in the devtools console. A player
 * watching that has no idea whether the app died or the game did.
 *
 * So every major region gets one of these. The failure is reported in the
 * box that failed, in words, rather than the box silently disappearing —
 * an empty panel and a crashed panel must not look the same. See section 1
 * of the working agreements: a check that cannot fail is not a check, and a
 * panel that vanishes on error is reporting nothing rather than reporting
 * broken.
 */
export class PanelBoundary extends Component<
  { label: string; children: ReactNode; onRetry?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error(`[${this.props.label}] crashed:`, error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-0 flex-col gap-1 rounded border border-danger/40 bg-danger/10 p-2 text-xs">
          <span className="font-medium text-danger">
            {this.props.label} broke: {this.state.error.message}
          </span>
          <button
            type="button"
            onClick={() => {
              if (this.props.onRetry) this.props.onRetry()
              else this.setState({ error: null })
            }}
            className="self-start rounded border border-danger/40 px-2 py-0.5 text-danger hover:bg-danger/15"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
