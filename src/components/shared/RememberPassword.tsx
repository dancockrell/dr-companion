/**
 * The two controls N8 ships: the opt-in box that offers to remember a Play.net
 * password, and the Settings control that forgets one.
 *
 * # Where each of these mounts, and why one of them does not yet
 *
 * {@link ForgetStoredPassword} is mounted today, in `SettingsSheet.tsx`'s
 * "Licences and privacy" section. It is the escape hatch, and an escape hatch
 * that arrives after the thing it undoes is worth less than one that arrives
 * with it.
 *
 * {@link RememberPasswordCheckbox} has no mount point in this commit and that
 * is the increment's own instruction rather than an oversight: it belongs
 * beside a password field, and the only screen with one is the sign-in form
 * N5 builds. N8's `pitfalls:` line says in as many words that "N5 does not
 * render the checkbox until this is `[x]`" — so this component is the
 * interface N5 mounts, published the way `docs/LICH_NATIVE_LOGIN.md` §8
 * publishes the Rust one, and its logic (`src/lib/rememberPassword.ts`) is
 * tested and live regardless of who renders it. If N5 is dropped, this file
 * goes with it rather than sitting here unused.
 */
import { useState } from 'react'
import {
  REMEMBER_PASSWORD_DEFAULT,
  REMEMBER_PASSWORD_LABEL,
  REMEMBER_PASSWORD_NOTICE,
  forgetStoredPassword,
  hasStoredPassword,
  tauriCredentials,
  type CredentialBackend,
} from '../../lib/rememberPassword.ts'

/**
 * "Remember password on this computer", off unless the player says otherwise.
 *
 * Controlled, so the form that owns the password owns this too and there is
 * one place that decides whether to store. The default lives in
 * `rememberPassword.ts` rather than here: a caller writes
 * `useState(REMEMBER_PASSWORD_DEFAULT)`, so flipping the default is one edit
 * and one test rather than a hunt through JSX.
 */
export function RememberPasswordCheckbox({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{REMEMBER_PASSWORD_LABEL}</span>
      </label>
      {/* Said whether or not the box is ticked. A warning that only appears
          after the decision is a warning about a decision already made. */}
      <p className="pl-6 text-xs leading-snug text-ink-faint">{REMEMBER_PASSWORD_NOTICE}</p>
    </div>
  )
}

/** The default a form should start this box at. Off. */
export { REMEMBER_PASSWORD_DEFAULT }

/**
 * Forget a remembered password, from Settings.
 *
 * Takes the account name typed in rather than read from preferences, because
 * nothing persists an account name yet (N2 declined to add `accountName` to
 * `PersistedPrefs` with no writer, and N5 is what writes it). Typing it is
 * also the honest interaction for a destructive control: there is no list of
 * accounts to show, and offering to delete "your credential" without saying
 * which would be worse.
 */
export function ForgetStoredPassword({
  backend = tauriCredentials,
}: {
  backend?: CredentialBackend
}) {
  const [account, setAccount] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (what: 'check' | 'forget') => {
    setBusy(true)
    try {
      if (what === 'check') {
        const stored = await hasStoredPassword(backend, account)
        setStatus(
          stored
            ? `A password is remembered for ${account.trim()}.`
            : `No password is remembered for ${account.trim()}.`
        )
      } else {
        const removed = await forgetStoredPassword(backend, account)
        setStatus(
          removed
            ? `Forgotten. ${account.trim()} will be asked for a password next time.`
            : `There was nothing stored for ${account.trim()}.`
        )
      }
    } catch (e) {
      // Named rather than swallowed: "nothing was stored" and "the store could
      // not be reached" are different answers and only one of them is good news.
      setStatus(`The credential store could not be reached: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const ready = account.trim().length > 0 && !busy

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-xs text-ink-muted">
        If you asked this app to remember a Play.net password, it is in Windows Credential
        Manager. Remove it here.
      </p>
      <input
        type="text"
        value={account}
        onChange={(e) => {
          // The verdict names an account, so it must not outlive the one it
          // was about. Cleared where the change happens rather than in an
          // effect reacting to it.
          setAccount(e.target.value)
          setStatus(null)
        }}
        placeholder="Play.net account name"
        aria-label="Play.net account name"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => void run('check')}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Check
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => void run('forget')}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Forget password
        </button>
      </div>
      {status && <p className="text-xs leading-snug text-ink-faint">{status}</p>}
    </div>
  )
}
