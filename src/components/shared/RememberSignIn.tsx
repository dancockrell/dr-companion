/**
 * The two controls that govern what this app remembers about a sign-in: the
 * box beside the password field, and the Forget control in Settings.
 *
 * # What changed on 9 September 2026
 *
 * This was `RememberPassword.tsx`, and both controls were about a password
 * only: an opt-in box that was off every time the form opened, and a Settings
 * control that removed the Credential Manager entry and nothing else. Dan's
 * instruction that day was to remember everything about anything signed in and
 * to default the box to checked, on the grounds that this is his own desktop.
 *
 * So there is one box for one decision, not a box per field - a future sign-in
 * inherits the decision rather than inventing a default - and one Forget
 * control that clears the credential entry *and* the remembered preferences
 * together. Two controls that each forgot half of a thing would leave somebody
 * who used one of them believing they had used both.
 *
 * The wording and the default live in `src/lib/rememberSignIn.ts`, imported
 * rather than written here: a second copy of either would drift, and the
 * default in particular has to be one greppable fact.
 */
import { useState } from 'react'
import {
  REMEMBER_SIGN_IN_CONSEQUENCE,
  REMEMBER_SIGN_IN_DEFAULT,
  REMEMBER_SIGN_IN_LABEL,
  REMEMBER_SIGN_IN_NOTICE,
  forgetEverything,
  hasStoredPassword,
  rememberedPrefs,
  tauriCredentials,
  type CredentialBackend,
} from '../../lib/rememberSignIn.ts'

/**
 * "Remember my sign-in on this computer", ticked unless the player says
 * otherwise.
 *
 * Controlled, so the form that owns the password owns this too and there is
 * one place that decides whether to store. `onChange` is expected to *act* on
 * an untick immediately rather than at the next sign-in - see `SignIn.tsx` -
 * because a box that says it has stopped remembering while the password is
 * still in Credential Manager is a lie the player cannot see through.
 */
export function RememberSignInCheckbox({
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
        <span>{REMEMBER_SIGN_IN_LABEL}</span>
      </label>
      {/* Both lines are said whether or not the box is ticked, and that matters
          more now than it did when the box was opt-in: nobody had to do
          anything to reach this state, so the consequence has to be on screen
          rather than behind the act of ticking. */}
      <p className="pl-6 text-xs leading-snug text-ink-faint">{REMEMBER_SIGN_IN_CONSEQUENCE}</p>
      <p className="pl-6 text-xs leading-snug text-ink-faint">{REMEMBER_SIGN_IN_NOTICE}</p>
    </div>
  )
}

/** The default a form should start this box at. On. */
export { REMEMBER_SIGN_IN_DEFAULT }

/**
 * Forget everything remembered for one account, from Settings.
 *
 * One action, one place. It seeds itself from the remembered account name
 * rather than making the player type it, which is possible now that the
 * account name is remembered by default - and it stays editable, because
 * somebody clearing up after a different account is exactly the person who
 * needs this and their name is not the one in preferences.
 */
export function ForgetEverything({ backend = tauriCredentials }: { backend?: CredentialBackend }) {
  const [account, setAccount] = useState(() => rememberedPrefs().account)
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
        const removed = await forgetEverything(backend, account)
        setStatus(
          removed
            ? `Forgotten. The password, the account name, the game and the character are all gone for ${account.trim()}.`
            : `There was no saved password for ${account.trim()}. The remembered account name, game and character have been cleared.`
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
        This app remembers your Play.net account name, game and character in its
        settings, and your password in Windows Credential Manager. Remove all of
        it here.
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
          Forget everything for this account
        </button>
      </div>
      {status && <p className="text-xs leading-snug text-ink-faint">{status}</p>}
    </div>
  )
}
