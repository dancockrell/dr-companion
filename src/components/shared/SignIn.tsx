/**
 * Signing in to DragonRealms, in the app, with no other program involved.
 *
 * # What this replaced
 *
 * A block of instructions telling the player to go and configure Genie, and a
 * warning panel explaining that Lich's own login window cannot complete on a
 * machine whose only frontend is Genie. Both were true and both were the app
 * giving up: the account login is a documented protocol, this app can perform
 * it, and Dan's instruction on 6 September 2026 was to stop routing through
 * Genie entirely.
 *
 * The whole of it is two commands. `lich_login_characters` returns the account's
 * real character list, so nobody types a character name and nobody has to
 * remember the spelling. `lich_login_launch` starts Lich for the character that
 * was picked and returns the port it opened, which is handed straight to the
 * existing `attachGame` - the same attach the app has always done, unchanged.
 *
 * # The password
 *
 * It lives in one `useState` below, for the length of one call, and is cleared
 * the moment the call returns - success or failure. It is never persisted, never
 * put in a URL, and never comes back from Rust in any result or error.
 *
 * There is now one exception, and it is opt-in: N8 landed the day after this
 * screen did, so there *is* somewhere safe to remember a password - Windows
 * Credential Manager, through `credential_store`. The box is off every time
 * this form opens, it is never seeded from anything stored, and the password
 * is handed to the store only after `lich_login_characters` has proved it
 * works. A password that failed to sign in is not one worth remembering, and
 * storing before the call would remember typing mistakes.
 *
 * The box itself is `RememberPasswordCheckbox`, imported rather than written
 * here: the sentence beside it and the default it starts at have one owner,
 * `src/lib/rememberPassword.ts`, and a second copy of either would drift.
 *
 * # Three states, laid out in order
 *
 * `form` → `picker` → `launched`, one at a time, in a column that scrolls. The
 * app's smallest supported window is 720x480 and issue #418 was a call to action
 * rendered below the bottom edge of a 1024x768 one, so nothing here is allowed
 * to depend on the window being tall.
 */
import { useEffect, useRef, useState } from 'react'
import { LogIn, ArrowLeft, Loader2 } from 'lucide-react'
import {
  GAME_CODES,
  DEFAULT_GAME_CODE,
  classifyLoginError,
  listCharacters,
  launchCharacter,
  rememberSignIn,
  rememberedSignIn,
  usingFakeBackend,
  type CharacterEntry,
} from '../../lib/lichLogin.ts'
import { fakeCredentialHas } from '../../lib/lichLoginFake.ts'
import {
  REMEMBER_PASSWORD_DEFAULT,
  hasStoredPassword,
  rememberIfAsked,
  tauriCredentials,
} from '../../lib/rememberPassword.ts'
import { RememberPasswordCheckbox } from './RememberPassword.tsx'
import { attachGame, LICH_STARTUP_WAIT_MS } from '../../lib/gameLink.ts'
import {
  lichAttachOffer,
  attachAdvice,
  type AttachOffer,
} from '../../lib/lichAttachOffer.ts'
import { isTauri } from '../../lib/tauri.ts'

/**
 * `starting` is not cosmetic (issue #458).
 *
 * The launch used to jump straight to `launched` and attach in the same tick,
 * which provably cannot connect: Lich does not open the detachable port until
 * it has booted Ruby, loaded itself and reached the game. The attach failed in
 * about two milliseconds and the player was told the sign-in had failed while
 * their character was in fact logging in. This is the honest state for the
 * seconds in between, and `launched` now means "attached", which is a thing
 * that was actually observed.
 */
type Stage = 'form' | 'picker' | 'starting' | 'launched'

export function SignIn() {
  const remembered = rememberedSignIn()

  const [account, setAccount] = useState(remembered.account)
  // Never read anywhere but the two calls below, never written anywhere else.
  const [password, setPassword] = useState('')
  const [gameCode, setGameCode] = useState(remembered.gameCode || DEFAULT_GAME_CODE)
  // Off, every time, from a constant rather than from anything persisted. A
  // ticked box restored from storage would tell a player their password is
  // being kept without their having said so this session.
  const [remember, setRemember] = useState(REMEMBER_PASSWORD_DEFAULT)

  const [stage, setStage] = useState<Stage>('form')
  const [characters, setCharacters] = useState<CharacterEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [launched, setLaunched] = useState('')
  /**
   * Whether the last failure was "a Lich is already up" (#488 §3).
   *
   * Its own state rather than a string match on `error`: the sentence is prose
   * and prose gets reworded, which is the same silent breakage `classifyLoginError`
   * exists to avoid. Set from the classified `kind` and nothing else.
   */
  const [alreadyRunning, setAlreadyRunning] = useState(false)

  /**
   * Which Lich is running, read rather than assumed (#504).
   *
   * `null` while the answer is still coming back, and it renders as
   * "Checking which Lich is running." with no button - because an
   * attach offered before anything has been identified is exactly the
   * offer this replaced. Re-read after a failed attach as well, so the
   * sentence that follows a failure is a fresh reading rather than the
   * old inference about why it probably failed.
   */
  const [offer, setOffer] = useState<AttachOffer | null>(null)

  /**
   * The error block, so it can be scrolled to when it appears.
   *
   * Not decoration. This panel lives in a column that scrolls, and the error
   * is the last thing in it: adding the detail line under the sentence pushed
   * the detail below the fold at 1024x768, which was visible in the screenshot
   * and invisible in the source - the same defect as issue #418, in the screen
   * that replaced the one #418 was found in.
   */
  const errorRef = useRef<HTMLDivElement>(null)


  /**
   * Whether a password is saved for this account, in three states.
   *
   * `null` is "could not ask" - the store was unreachable, or the check has
   * not answered yet - and it must not read as "there is none", because that
   * would hide the password field from somebody who has to type one. So the
   * field is shown for `null` exactly as it is for `false`.
   *
   * This is the read half of N8 arriving in the UI (issue #459): the box that
   * stores a password has been there since the day after this screen shipped,
   * and nothing has ever asked whether one was stored, so a player typed it
   * again every time.
   */
  const [storedPassword, setStoredPassword] = useState<boolean | null>(null)
  /** The "Use a different password" escape hatch, per account. */
  const [typePasswordAnyway, setTypePasswordAnyway] = useState(false)

  const trimmedAccount = account.trim()
  const usingStoredPassword = storedPassword === true && !typePasswordAnyway

  useEffect(() => {
    let live = true
    if (!trimmedAccount) {
      setStoredPassword(false)
      return
    }
    void (async () => {
      try {
        const has = usingFakeBackend()
          ? fakeCredentialHas(trimmedAccount)
          : await hasStoredPassword(tauriCredentials, trimmedAccount)
        if (live) setStoredPassword(has)
      } catch {
        // Not `false`: a store this app could not reach is a question it
        // cannot answer, and answering it anyway is how a player ends up with
        // no password field and no way in.
        if (live) setStoredPassword(null)
      }
    })()
    return () => {
      live = false
    }
  }, [trimmedAccount])

  // Bring the failure into view rather than leaving it under the fold. `block:
  // 'nearest'` so a message already on screen does not make the panel jump,
  // and guarded because jsdom-free environments and older webviews may not
  // have it.
  useEffect(() => {
    if (!error) return
    errorRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error, errorDetail])

  // Outside the desktop app there is no backend at all, so the form would
  // submit into nothing. The dry-run stand-in is the one exception, and it has
  // to be asked for by URL.
  const workable = isTauri() || usingFakeBackend()

  /** One place that says what went wrong, so the two paths cannot disagree. */
  const report = (e: unknown) => {
    const { kind, sentence, detail } = classifyLoginError(e)
    setError(sentence)
    // The offer is keyed on the classified kind, and cleared on every other
    // failure: an Attach button left over from a previous error would be
    // offering to attach to a Lich this failure says nothing about.
    setAlreadyRunning(kind === 'lich_already_running')
    // Ask the backend which Lich that is. Nothing is offered until it
    // answers: the old screen went straight from an image-name match to a
    // button that dialled a constant.
    if (kind === 'lich_already_running') {
      setOffer(null)
      void (async () => {
        try {
          setOffer(await lichAttachOffer(account.trim()))
        } catch (e) {
          // A failed read is not a clean no. It says so, and offers
          // nothing - the three-state rule the rest of this flow keeps.
          setOffer({
            kind: 'unknown',
            why: e instanceof Error ? e.message : String(e ?? ''),
          })
        }
      })()
    }
    // The detail is shown under the sentence rather than instead of it, and
    // not at all when the sentence already carries it (the `unknown` arm
    // appends it). Deleting information is never the answer to a busy screen.
    setErrorDetail(sentence.includes(detail) ? '' : detail)
    if (kind === 'stored_password_rejected') {
      // Rust has already forgotten the entry, so the form must stop offering
      // to use it - otherwise the next press signs in with nothing and the
      // player is told a password they never typed is wrong.
      setStoredPassword(false)
      setTypePasswordAnyway(true)
    }
    return kind
  }

  const signIn = async () => {
    setBusy(true)
    setError('')
    setErrorDetail('')
    setAlreadyRunning(false)
    try {
      const result = await listCharacters({ account: account.trim(), password, gameCode })
      rememberSignIn({ account: account.trim(), gameCode })
      // Only now, and only if asked: the account server has just accepted this
      // password, so it is one worth keeping. `rememberIfAsked` does nothing at
      // all when the box is unticked - not a no-op write, no call.
      if (remember) {
        try {
          await rememberIfAsked(tauriCredentials, account.trim(), password, remember)
        } catch (storeError) {
          // Signing in worked; only remembering failed. Say so rather than
          // failing the sign-in, and rather than saying nothing - a player who
          // ticked the box would otherwise be typing it again next time with
          // no idea why.
          setError(`Signed in, but the password could not be remembered: ${String(storeError)}`)
        }
      }
      setCharacters(result.characters)
      setStage('picker')
    } catch (e) {
      // Cleared on the failure path immediately: a wrong password left sitting
      // in the field is both a retry that repeats the same mistake and a secret
      // kept for no reason.
      setPassword('')
      report(e)
    } finally {
      setBusy(false)
    }
  }

  const pick = async (character: CharacterEntry) => {
    setBusy(true)
    setError('')
    setErrorDetail('')
    setAlreadyRunning(false)
    try {
      // Frame 2 of the protocol runs again for the launch, so the password is
      // needed a second time. It is held in this component's state between the
      // two calls rather than asked for twice - a second password box on the
      // picker is a worse thing to put in front of a player than ten seconds of
      // one string in one component, and it is never persisted either way.
      const result = await launchCharacter({
        account: account.trim(),
        password,
        gameCode,
        character: character.name,
      })
      rememberSignIn({ character: character.name })
      setLaunched(character.name)
      // Not `launched` yet: the sign-in has worked and Lich is booting, which
      // takes seconds. See the `Stage` note above.
      setStage('starting')
      // The existing attach flow takes over from here, with the port the
      // command returned rather than a number retyped in this file - and with
      // a wait, because the port provably is not open in this tick (#458).
      try {
        await attachGame(result.port, undefined, LICH_STARTUP_WAIT_MS)
        setStage('launched')
      } catch (attachFailure) {
        // The one place in this app that knows an attach failure *followed a
        // launch*, which is what makes `lich_did_not_start` the honest code:
        // the account login demonstrably worked, and what did not happen is
        // Lich opening its port. `game_attach` returns a string because the
        // Attach button is its other caller, so the code is attached here
        // rather than invented in Rust for one of two callers.
        report({
          code: 'lich_did_not_start',
          message:
            attachFailure instanceof Error ? attachFailure.message : String(attachFailure ?? ''),
        })
        setStage('picker')
      }
    } catch (e) {
      report(e)
      setStage('picker')
    } finally {
      setPassword('')
      setBusy(false)
    }
  }

  /**
   * Attach to the Lich that is already up.
   *
   * The whole of #488 §3's second half. This used to arrive as
   * `lich_did_not_start`, whose sentence sends the player to a diagnostic -
   * and there is nothing to diagnose: the sign-in worked, a Lich is running,
   * and the thing to do is join it. That is the ordinary state after closing
   * the app with "Leave it running".
   *
   * The same `attachGame` the launch path uses, and the same port constant the
   * connection bar defaults to, so there is one attach and one number.
   * `undefined` for the wait, deliberately: this Lich is up already, so there
   * is nothing to wait for and twenty seconds of spinner would be a worse
   * answer than an immediate one.
   */
  const attachToRunning = async () => {
    const advice = attachAdvice(offer)
    // Unreachable through the button, which is not rendered without a port,
    // and asserted anyway: this is the line that used to be
    // `Number(DEFAULT_ATTACH_PORT)` regardless of what was known.
    if (advice.port === null) return
    setBusy(true)
    setError('')
    setErrorDetail('')
    try {
      await attachGame(advice.port)
      setAlreadyRunning(false)
      setOffer(null)
      setStage('launched')
    } catch (attachFailure) {
      // The old code guessed here - "a Lich that is up but not yet
      // listening is the commonest reason this fails, so press again" -
      // and for a Lich started without --detachable-client a second press
      // could never work. `report` re-reads the offer, so what appears
      // under the sentence is a fresh answer about the Lich that is
      // actually there, and the button only comes back if that answer
      // still has a port in it.
      report({
        code: 'lich_did_not_start',
        message:
          attachFailure instanceof Error ? attachFailure.message : String(attachFailure ?? ''),
      })
      setAlreadyRunning(true)
      setOffer(null)
      try {
        setOffer(await lichAttachOffer(account.trim()))
      } catch (e) {
        setOffer({ kind: 'unknown', why: e instanceof Error ? e.message : String(e ?? '') })
      }
    } finally {
      setBusy(false)
    }
  }

  const back = () => {
    setStage('form')
    setCharacters([])
    setError('')
    setErrorDetail('')
    setAlreadyRunning(false)
    setOffer(null)
    // Going back is also the way out of the flow, so it is the other place the
    // password has to stop existing.
    setPassword('')
  }

  const field =
    'w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint'

  return (
    <div className="mt-3 min-w-0 rounded-lg border border-border bg-surface-raised p-3">
      <div className="flex items-center gap-2">
        <LogIn className="h-4 w-4 shrink-0 text-accent" />
        <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          Sign in to DragonRealms
        </h3>
      </div>

      {stage === 'form' && (
        <div className="mt-2 space-y-2">
          <p className="text-xs leading-snug text-ink-muted">
            Your Play.net account, the same one you use to play. This starts Lich
            for you, so there is nothing else to open.
          </p>

          <label className="block space-y-1">
            <span className="text-xs text-ink-faint">Account name</span>
            <input
              className={field}
              type="text"
              autoComplete="username"
              spellCheck={false}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="Your Play.net account"
            />
          </label>

          {usingStoredPassword ? (
            /* No password box at all, which is the point of N8's checkbox and
             * what #459 was: the password was stored and the player typed it
             * again every time anyway. The escape hatch is not optional - a
             * saved password can be the wrong one, and a form with no way to
             * type a different one would be a dead end. */
            <div className="space-y-1">
              <p className="text-xs leading-snug text-ink-muted">
                Using the password saved on this computer for {trimmedAccount}.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setTypePasswordAnyway(true)
                  setPassword('')
                }}
                className="text-xs text-ink-faint underline decoration-dotted hover:text-ink disabled:opacity-50"
              >
                Use a different password
              </button>
            </div>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs text-ink-faint">Password</span>
              <input
                className={field}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && account.trim() && password && !busy) void signIn()
                }}
                placeholder="Your Play.net password"
              />
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-xs text-ink-faint">Game</span>
            <select
              className={field}
              value={gameCode}
              onChange={(e) => setGameCode(e.target.value)}
            >
              {GAME_CODES.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>

          {/* Hidden while a saved password is being used, because there is
            * nothing to remember: no password is being typed, and the one in
            * the store is already there. */}
          {!usingStoredPassword && (
            <RememberPasswordCheckbox
              checked={remember}
              onChange={setRemember}
              disabled={busy || !workable}
            />
          )}

          <button
            type="button"
            disabled={busy || !workable || !trimmedAccount || (!password && !usingStoredPassword)}
            onClick={() => void signIn()}
            className="flex items-center gap-1.5 rounded border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          {/* The truth, replacing the retired claim that stood here. The app
            * does hold the password, for one call, and saying otherwise while
            * sending it would be the exact defect tools/doc-claims-test.mjs
            * section K exists to catch - which is also why the retired wording
            * is not quoted in this comment: that scan reads comments too, and
            * it is right to.
            *
            * Word for word what docs/PRIVACY.md states and what LichLauncher
            * and SettingsSheet say, rather than a fourth phrasing of the same
            * fact. That test pins this string in three files at once, which is
            * what stops the four of them drifting apart.
            *
            * "unless you later ask for it" now describes something real: N8
            * built the box above, and the sentence is true in both directions
            * rather than being a promise about a feature nothing could ask
            * for. It is still not reworded here - it has one owner and that is
            * the privacy document. */}
          <p className="text-xs leading-snug text-ink-faint">
            Your password is typed into this app, used once to sign in to
            Simutronics, held only in memory, and not stored unless you later
            ask for it.
          </p>

          {!workable && (
            <p className="text-xs text-ink-faint">
              Signing in needs the desktop app. This is the browser preview.
            </p>
          )}
        </div>
      )}

      {stage === 'picker' && (
        <div className="mt-2 space-y-2">
          {characters.length > 0 ? (
            <>
              <p className="text-xs text-ink-muted">Pick a character to play.</p>
              <div className="flex flex-wrap gap-1.5">
                {characters.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    disabled={busy}
                    onClick={() => void pick(c)}
                    className="rounded border border-accent/40 bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            /* An empty list is not an error and must not render as one, but it
             * is also not a list - showing an empty row of buttons would leave
             * somebody pressing nothing. */
            <p className="text-xs leading-snug text-warn">
              This account has no {GAME_CODES.find((g) => g.code === gameCode)?.label ?? 'DragonRealms'}{' '}
              characters. If you play on another one, go back and choose it.
            </p>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={back}
            className="flex items-center gap-1.5 text-xs text-ink-faint underline decoration-dotted hover:text-ink disabled:opacity-50"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to sign in
          </button>
        </div>
      )}

      {stage === 'starting' && (
        <div className="mt-2 space-y-2">
          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            Signed {launched} in. Starting Lich, which takes a few seconds…
          </p>
        </div>
      )}

      {stage === 'launched' && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-good">
            Started {launched}. The game text appears here in a few seconds.
          </p>
          <button
            type="button"
            onClick={back}
            className="flex items-center gap-1.5 text-xs text-ink-faint underline decoration-dotted hover:text-ink"
          >
            <ArrowLeft className="h-3 w-3" />
            Sign in as somebody else
          </button>
        </div>
      )}

      {error && (
        <div ref={errorRef}>
          <p className="mt-2 text-xs leading-snug text-danger">{error}</p>
          {/* What the backend actually said, under the sentence rather than
            * instead of it. The sentence tells a player what to do; this is
            * what goes in a bug report, and dropping it to keep the panel tidy
            * would be throwing away the only line that says which of seven
            * things happened. */}
          {errorDetail && (
            <p className="mt-1 text-xs leading-snug text-ink-faint">{errorDetail}</p>
          )}
          {/* The action, not a diagnostic. Rendered only for the one kind that
            * means a Lich is up (#488 section 3), and now saying *which* Lich
            * before it offers to join it (#504).
            *
            * The sentence and the button come from one function, so they
            * cannot disagree: a `no_port` answer has no button because
            * pressing one could never work, and a `foreign` answer names
            * the character on the button itself, because the player is
            * about to join somebody else's session and the name is the
            * only thing on screen that would tell them. */}
          {alreadyRunning && (
            <div className="mt-2 space-y-1.5" data-testid="attach-offer">
              <p
                className="text-xs leading-snug text-ink-muted"
                data-attach-kind={offer?.kind ?? 'checking'}
              >
                {attachAdvice(offer).sentence}
              </p>
              {attachAdvice(offer).action && (
                <button
                  type="button"
                  onClick={() => void attachToRunning()}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2 py-1 text-xs text-accent disabled:opacity-40"
                >
                  {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                  {attachAdvice(offer).action}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
