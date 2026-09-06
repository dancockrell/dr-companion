/**
 * "Remember my password on this computer" — the opt-in half of Lane N's
 * credential handling (N8), and the only thing in the frontend that can make a
 * password outlive one sign-in.
 *
 * The logic lives here rather than in the checkbox for two reasons. The
 * component that renders the box is JSX and cannot be imported by a Node test,
 * and the fact worth testing is not that a box draws — it is that
 * {@link REMEMBER_PASSWORD_DEFAULT} is `false` and that nothing calls
 * `credential_store` unless the player asked. Both are checked in
 * `tools/credential-store-test.mjs` against a fake backend.
 *
 * # What is *not* here
 *
 * There is no read. `credential_store`, `credential_has` and
 * `credential_forget` are the whole command surface, and none of them returns
 * a password: the stored one is read on the Rust side, into a type that cannot
 * be serialised, and used once. So there is no route by which a remembered
 * password can arrive in this file, and that is deliberate rather than an
 * omission — see `src-tauri/src/credential_store.rs`.
 *
 * # The sentence
 *
 * {@link REMEMBER_PASSWORD_NOTICE} is shown beside the box, and it says what is
 * true rather than what is reassuring: Windows Credential Manager protects a
 * secret from other *users* of the machine, not from anything running as this
 * user. A player deciding whether to tick a box is owed that. The same sentence
 * is in `docs/PRIVACY.md`, and `tools/doc-claims-test.mjs` section K checks
 * that the two still agree.
 */
import { invokeTauri } from './tauri.ts'

/**
 * Off. Not a preference, not persisted, not remembered between sessions — a
 * constant, so that "the default is off" is one greppable fact rather than a
 * property of whatever was in storage.
 *
 * Sabotaging this to `true` is one of N8's two sabotages and reddens
 * `tools/credential-store-test.mjs`.
 */
export const REMEMBER_PASSWORD_DEFAULT = false

/** What the player is told, beside the box, before they tick it. */
export const REMEMBER_PASSWORD_NOTICE =
  'Stored in Windows Credential Manager. Anyone signed in to this Windows account can use it.'

/** The label on the box itself. */
export const REMEMBER_PASSWORD_LABEL = 'Remember password on this computer'

/**
 * The three commands, behind an interface so a test can supply its own and
 * assert what was called with what.
 */
export interface CredentialBackend {
  store(account: string, password: string): Promise<void>
  has(account: string): Promise<boolean>
  forget(account: string): Promise<boolean>
}

/** The real one. Every call is a Tauri command; none returns a password. */
export const tauriCredentials: CredentialBackend = {
  async store(account, password) {
    await invokeTauri('credential_store', { account, password })
  },
  async has(account) {
    return (await invokeTauri('credential_has', { account })) === true
  },
  async forget(account) {
    return (await invokeTauri('credential_forget', { account })) === true
  },
}

/** What {@link rememberIfAsked} did, for a caller that wants to say so. */
export type RememberOutcome = 'stored' | 'not asked' | 'nothing to store'

/**
 * Store the password the player just signed in with — **only** if they ticked
 * the box.
 *
 * Called after a successful sign-in rather than before it, so a mistyped
 * password is never the one remembered. The `remember` argument is the
 * checkbox's state and there is no default value for it: a caller that forgets
 * to pass it does not compile, which is the failure worth having on the one
 * function in this app that persists a secret.
 */
export async function rememberIfAsked(
  backend: CredentialBackend,
  account: string,
  password: string,
  remember: boolean
): Promise<RememberOutcome> {
  if (!remember) return 'not asked'
  if (!account.trim() || !password) return 'nothing to store'
  await backend.store(account, password)
  return 'stored'
}

/**
 * Forget a remembered password. Returns whether there was one.
 *
 * The Settings control calls this. It is separate from `rememberIfAsked` and
 * takes no `remember` flag on purpose: forgetting is never conditional on the
 * checkbox, because the box's state and what is actually in the store can
 * disagree — a player who ticked it on another day is exactly the person
 * pressing Forget.
 */
export async function forgetStoredPassword(
  backend: CredentialBackend,
  account: string
): Promise<boolean> {
  if (!account.trim()) return false
  return await backend.forget(account)
}

/** Whether a password is remembered for this account. Never what it is. */
export async function hasStoredPassword(
  backend: CredentialBackend,
  account: string
): Promise<boolean> {
  if (!account.trim()) return false
  return await backend.has(account)
}
