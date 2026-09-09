/**
 * One preference, one owner: **what this app remembers about a sign-in.**
 *
 * # What changed, and why this file is not called `rememberPassword.ts` any more
 *
 * It was. N8 (#452) shipped an opt-in box, off by default, that remembered a
 * password and nothing else, and three files carried the sentence "not stored
 * unless you later ask for it". Dan reversed that on **9 September 2026**, in
 * as many words: *"it's on my computer so definitely store the password. 100%"*
 * and then, generalising, *"remember everything about anything signed in.
 * passwords account names, etc. you can put a check box, but default it to
 * checked, it's on the desktop."*
 *
 * That is a decision about a product that runs on one person's desktop, not a
 * relaxation of a privacy position, and it is dated here so that a later
 * session reading `REMEMBER_SIGN_IN_DEFAULT = true` does not read it as a
 * defect and "fix" it back. `docs/LICH_NATIVE_LOGIN.md` §8 carries the same
 * dated line, and `docs/PRIVACY.md` (generated) is what the player is told.
 *
 * The rename is the other half. A module called `rememberPassword` that also
 * owns the account name, the game and the character would be a name that lies,
 * and the next sign-in this app grows would have no obvious owner to inherit
 * from - which is how a second default gets invented. There is **one**
 * preference ({@link REMEMBER_SIGN_IN_DEFAULT}), **one** resolver
 * ({@link resolveRemembered}), and **one** writer ({@link rememberAfterSignIn}).
 * `tools/sign-in-experience-test.mjs` derives the set of secret-storing call
 * sites from the tree and fails if there is ever a second one.
 *
 * # Where each remembered thing lives
 *
 * {@link REMEMBERED_FIELDS} is the enumeration, and it is the list the tests
 * count against rather than a number written down twice. Secrets go to Windows
 * Credential Manager through `credential_store`; everything else is an ordinary
 * preference in `persistence.ts`, in plain text, like the rest of the app's
 * settings.
 *
 * # What is *not* here
 *
 * There is still no read of a password **in the webview**. `credential_store`,
 * `credential_has` and `credential_forget` are the whole command surface, and
 * none of them returns a password: the stored one is read on the Rust side,
 * into a type that cannot be serialised, and used once. {@link resolveRemembered}
 * gets a `boolean` and never more than that. Making remembering the default
 * does not widen that boundary by one byte, and it must not: see
 * `src-tauri/src/credential_store.rs`.
 */
import { invokeTauri } from './tauri.ts'
import { loadPrefs, savePrefs } from './persistence.ts'

/**
 * **On.** Dan's instruction of 9 September 2026, quoted in the header above.
 *
 * A constant rather than a value read from storage, so that "the default is
 * on" is one greppable fact rather than a property of whatever happened to be
 * persisted. The *preference* is stored (a player who unticks stays unticked);
 * the *default*, for somebody who has never expressed a view, is this.
 *
 * Sabotaging this to `false` reddens `tools/credential-store-test.mjs` and
 * `tools/sign-in-experience-test.mjs`, which is the inverse of the sabotage N8
 * shipped with - that one flipped it to `true`.
 */
export const REMEMBER_SIGN_IN_DEFAULT = true

/**
 * What the player is told, beside the box.
 *
 * It says what is true rather than what is reassuring: Windows Credential
 * Manager protects a secret from other *users* of the machine, not from
 * anything running as this user. That sentence mattered when the box was
 * opt-in and it matters more now that it is on by default, because nobody had
 * to tick anything to reach it.
 *
 * The same sentence is in `docs/PRIVACY.md` and `tools/doc-claims-test.mjs`
 * checks that the two still agree.
 */
export const REMEMBER_SIGN_IN_NOTICE =
  'Stored in Windows Credential Manager. Anyone signed in to this Windows account can use it.'

/**
 * The label on the box itself.
 *
 * It no longer says "password", because the box no longer decides only that.
 * A box labelled for one of the four things it governs is a box whose other
 * three are ungoverned as far as the reader can tell.
 */
export const REMEMBER_SIGN_IN_LABEL = 'Remember my sign-in on this computer'

/** The one-line consequence, under the box. Shown ticked or not. */
export const REMEMBER_SIGN_IN_CONSEQUENCE =
  'Your account name, game, character and password are kept so the next sign-in is one press.'

/**
 * Everything one sign-in produces that identifies the session, and where each
 * one is kept.
 *
 * Enumerated rather than counted, so a fifth thing cannot be added without
 * appearing here, and so the tests have a denominator that goes to zero if the
 * enumeration breaks rather than a number that silently stays right.
 *
 * `secret: true` means it goes to Windows Credential Manager and nowhere else.
 * There is exactly one such row and `tools/sign-in-experience-test.mjs`
 * asserts that the number of secret-storing call sites in the tree equals it.
 */
export interface RememberedField {
  /** The name a player would use for it. */
  name: string
  /** The preference key, or the credential target, this lands in. */
  where: string
  secret: boolean
}

export const REMEMBERED_FIELDS: RememberedField[] = [
  { name: 'account name', where: 'prefs: lichAccount', secret: false },
  { name: 'game', where: 'prefs: lichGameCode', secret: false },
  { name: 'character', where: 'prefs: lichCharacter', secret: false },
  { name: 'password', where: 'Windows Credential Manager', secret: true },
  { name: 'the choice itself', where: 'prefs: lichRemember', secret: false },
]

/**
 * The three commands, behind an interface so a test can supply its own and
 * assert what was called with what.
 */
export interface CredentialBackend {
  store(account: string, password: string): Promise<void>
  has(account: string): Promise<boolean>
  forget(account: string): Promise<boolean>
}

/**
 * The real one, and the only place in the webview that names
 * `credential_store`.
 *
 * That is checked rather than promised: the one-path check in
 * `tools/sign-in-experience-test.mjs` scans `src/` for the command name and
 * fails naming any second site. A new sign-in surface inherits this by having
 * nowhere else to go.
 */
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

/** The non-secret half of a remembered sign-in. */
export interface RememberedPrefs {
  account: string
  gameCode: string
  character: string
  /** Whether the player has said yes or no. `null` = never asked. */
  remember: boolean | null
}

/**
 * Read the preferences half.
 *
 * `remember` is three-state on purpose. `null` is "this player has never
 * expressed a view", which is what {@link REMEMBER_SIGN_IN_DEFAULT} answers;
 * folding it into `false` would make the default unreachable, and folding it
 * into `true` would ignore somebody who unticked the box.
 */
export function rememberedPrefs(): RememberedPrefs {
  const prefs = loadPrefs()
  return {
    account: prefs.lichAccount ?? '',
    gameCode: prefs.lichGameCode ?? '',
    character: prefs.lichCharacter ?? '',
    remember: prefs.lichRemember ?? null,
  }
}

/** Whether remembering is on, for a player who may never have said. */
export function rememberingIsOn(): boolean {
  return rememberedPrefs().remember ?? REMEMBER_SIGN_IN_DEFAULT
}

/**
 * Remember what is safe to keep in plain text, and nothing else.
 *
 * There is deliberately no `password` parameter here, and that has not changed
 * with the default: the password goes to Credential Manager or nowhere, and a
 * function that *could* take one is a function somebody adds a caller to. The
 * shape is the guarantee, and `tools/sign-in-test.mjs` drives a whole sign-in
 * and reads the persisted blob back to prove it.
 */
export function rememberSignIn(fields: {
  account?: string
  gameCode?: string
  character?: string
  remember?: boolean
}): void {
  const next: Parameters<typeof savePrefs>[0] = {}
  if (fields.account !== undefined) next.lichAccount = fields.account
  if (fields.gameCode !== undefined) next.lichGameCode = fields.gameCode
  if (fields.character !== undefined) next.lichCharacter = fields.character
  if (fields.remember !== undefined) next.lichRemember = fields.remember
  savePrefs(next)
}

/** What {@link resolveRemembered} answers. The one question the form asks. */
export interface RememberedSignIn extends RememberedPrefs {
  /** Whether a password is remembered for this account. Never what it is. */
  hasPassword: boolean
  /**
   * `true` when the store could not be asked at all.
   *
   * Kept separate from `hasPassword: false`, because "there is none" and "I
   * could not find out" lead to opposite screens: one hides the password field
   * and one must not, or a player whose store is unreachable is left with no
   * field and no way in.
   */
  passwordUnknown: boolean
  /** How many player actions signing in will take from here. */
  actions: number
}

/**
 * **The one resolver.** What do we remember for this account?
 *
 * Every sign-in surface asks this and nothing else. It is one function rather
 * than four reads so that a future sign-in - any service this app ever
 * authenticates to - inherits the answer instead of assembling its own from
 * parts, which is where a second default would come from.
 *
 * `account` is optional: with none given it answers about the remembered
 * account, which is what the screen needs before anybody has typed anything.
 */
export async function resolveRemembered(
  backend: CredentialBackend,
  account?: string
): Promise<RememberedSignIn> {
  const prefs = rememberedPrefs()
  const who = (account ?? prefs.account).trim()
  let hasPassword = false
  let passwordUnknown = false
  if (who) {
    try {
      hasPassword = await backend.has(who)
    } catch {
      passwordUnknown = true
    }
  }
  return {
    ...prefs,
    account: who,
    hasPassword,
    passwordUnknown,
    actions: actionsToPlay({
      account: Boolean(who),
      password: hasPassword,
      character: Boolean(prefs.character),
    }),
  }
}

/**
 * How many acts a player performs to get from an open window into the game.
 *
 * The counting rule, stated because a number nobody can re-derive is a claim
 * rather than a measurement: **a field that has to be filled costs two** - the
 * click or tab that reaches it and the typing - **submitting costs one, and
 * picking a character off the list costs one.** Nothing is counted for reading.
 *
 * Measured against this app on 9 September 2026: **4** before (the account name
 * was remembered, the password was not because the box was off by default, and
 * the remembered character was written down and never used, so the picker
 * always appeared) and **1** after (everything remembered, the picker skipped
 * when the remembered character is still on the account, one button).
 */
export function actionsToPlay(remembered: {
  account: boolean
  password: boolean
  character: boolean
}): number {
  return (
    (remembered.account ? 0 : 2) +
    (remembered.password ? 0 : 2) +
    1 +
    (remembered.character ? 0 : 1)
  )
}

/** What {@link rememberAfterSignIn} did, for a caller that wants to say so. */
export type RememberOutcome = 'remembered' | 'not asked' | 'nothing to store'

/**
 * Remember the sign-in that just worked - all of it, or none of it.
 *
 * Called after `lich_login_characters` has returned rather than before it, so a
 * mistyped password is never the one remembered. The `remember` argument has no
 * default value: a caller that forgets to pass it does not compile, which is
 * the failure worth having on the one function in this app that persists a
 * secret.
 *
 * The choice itself is written either way, so that unticking the box survives a
 * restart rather than reverting to the default on the next launch.
 */
export async function rememberAfterSignIn(
  backend: CredentialBackend,
  what: { account: string; password: string; gameCode?: string; character?: string },
  remember: boolean
): Promise<RememberOutcome> {
  const account = what.account.trim()
  rememberSignIn({ remember })
  if (!remember) return 'not asked'
  if (!account) return 'nothing to store'
  rememberSignIn({
    account,
    ...(what.gameCode !== undefined ? { gameCode: what.gameCode } : {}),
    ...(what.character !== undefined ? { character: what.character } : {}),
  })
  // A sign-in that used the already-stored password has nothing new to write,
  // and storing an empty string would overwrite a good entry with nothing.
  if (!what.password) return 'remembered'
  await backend.store(account, what.password)
  return 'remembered'
}

/**
 * Forget everything for this account: the credential entry and the remembered
 * preferences, in one act.
 *
 * One action in one place, because two controls that each forget half of a
 * thing leave a player who used one of them believing they used both. Returns
 * whether there had been a password.
 *
 * Takes no `remember` flag on purpose: forgetting is never conditional on the
 * box, because the box's state and what is actually stored can disagree - a
 * player who ticked it on another day is exactly the person pressing this.
 */
export async function forgetEverything(
  backend: CredentialBackend,
  account: string
): Promise<boolean> {
  const who = account.trim()
  rememberSignIn({ account: '', gameCode: '', character: '', remember: false })
  if (!who) return false
  return await backend.forget(who)
}

/** Whether a password is remembered for this account. Never what it is. */
export async function hasStoredPassword(
  backend: CredentialBackend,
  account: string
): Promise<boolean> {
  if (!account.trim()) return false
  return await backend.has(account)
}
