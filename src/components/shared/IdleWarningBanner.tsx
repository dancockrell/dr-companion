import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { sendGameAction } from '../../lib/gameActions.ts'
import { playAlert } from '../../lib/alertSound.ts'
import {
  advanceIdleWarning,
  dismissIdleWarning,
  freshIdleWarningState,
  idleWarningSecondsLeft,
  IDLE_WARNING_TEXT,
  type IdleWarning,
  type IdleWarningLine,
} from '../../lib/idleWarning.ts'

/** Mounted by GameSignals above the workspace, independently of the AI
 * worker and of whether the player has any text panel open. */
export function IdleWarningBanner({ lines, connected }: {
  lines: readonly IdleWarningLine[]
  connected: boolean
}) {
  const [snapshot, setSnapshot] = useState(() => ({
    lines,
    connected,
    state: advanceIdleWarning(freshIdleWarningState(), lines, connected, Date.now()),
  }))
  // Adjust state while receiving changed props, before children commit. An
  // effect would briefly leave an old warning's button active on a new line.
  if (snapshot.lines !== lines || snapshot.connected !== connected) {
    // Sample only on a new external snapshot to distinguish old backlog from
    // a current warning. Re-renders without new input never extend its life.
    // eslint-disable-next-line react/purity
    setSnapshot({ lines, connected, state: advanceIdleWarning(snapshot.state, lines, connected, Date.now()) })
  }

  const warning = connected ? snapshot.state.warning : null
  // Changing the warning replaces its response state, so an old in-flight
  // command can never dismiss or mark a newer warning as answered.
  return warning ? <IdleWarningNotice key={warning.seq} warning={warning}
    onDismiss={() => setSnapshot((current) => ({ ...current, state: dismissIdleWarning(current.state, warning.seq) }))} /> : null
}

function IdleWarningNotice({ warning, onDismiss }: {
  warning: IdleWarning
  onDismiss: () => void
}) {
  const [now, setNow] = useState(Date.now)
  const [response, setResponse] = useState<'ready' | 'sending' | 'sent'>('ready')
  const [error, setError] = useState('')
  const sending = useRef(false)
  const mounted = useRef(false)
  const sounded = useRef(false)
  useEffect(() => {
    mounted.current = true
    // The ordinary System volume/mute and sound throttle still apply.
    if (!sounded.current) {
      sounded.current = true
      playAlert('Thunder.wav', 'alert')
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { mounted.current = false; window.clearInterval(timer) }
  }, [])

  const respond = async () => {
    if (sending.current || response === 'sent') return
    sending.current = true
    setResponse('sending')
    setError('')
    try {
      // Only this explicit click sends anything. Keep the warning after the
      // transport accepts it: acceptance by Lich is not a game response.
      await sendGameAction('look', "I'm here", 'ui-action')
      if (mounted.current) setResponse('sent')
    } catch (cause) {
      if (mounted.current) {
        setResponse('ready')
        setError(`Not sent: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    } finally {
      sending.current = false
    }
  }

  const seconds = idleWarningSecondsLeft(warning, now)
  return (
    <section aria-label="Game idle warning" className="mx-2 my-1 flex shrink-0 flex-wrap items-center gap-3 rounded-lg border-2 border-danger bg-danger/15 px-3 py-2 text-sm text-ink">
      <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1 basis-64">
        <div role="alert" className="font-semibold">Game idle warning: respond now</div>
        <p className="text-xs">{IDLE_WARNING_TEXT}</p>
        {response === 'sent' ? (
          <p role="status" className="mt-1 text-xs">“look” sent to Lich. Check the game replied, then dismiss this warning.</p>
        ) : (
          <p role="timer" aria-live="off" className="mt-1 text-xs">
            {seconds === null ? 'Disconnect may be imminent.' : seconds > 0
              ? `About ${seconds}s until possible disconnect.`
              : 'The estimated response time has elapsed. The game may disconnect at any moment.'}
            {' '}Send a command yourself, or press “I'm here” to send “look”.
          </p>
        )}
        {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" disabled={response !== 'ready'} onClick={() => void respond()}
          className="rounded border border-danger bg-surface px-3 py-2 font-semibold hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60">
          {response === 'sending' ? 'Sending look…' : response === 'sent' ? 'look sent' : "I'm here (send look)"}
        </button>
        <button type="button" onClick={onDismiss} title="Hide this warning without sending a game command"
          className="rounded border border-border px-2 py-2 text-xs hover:bg-surface-raised">Dismiss</button>
      </div>
    </section>
  )
}
