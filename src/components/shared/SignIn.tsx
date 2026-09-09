/**
 * Signing in to DragonRealms, in the app, with no other program involved.
 *
 * # What this replaced, and then what changed again
 *
 * It replaced a block of instructions telling the player to configure Genie.
 * The whole of the sign-in is two commands: `lich_login_characters` returns the
 * account's real character list, and `lich_login_launch` starts Lich for the
 * character that was picked and returns the port, which goes straight to the
 * existing `attachGame`.
 *
 * On **9 September 2026** Dan asked for the whole first-contact experience to
 * be better, and for everything about a sign-in to be remembered by default -
 * *"it's on my computer so definitely store the password. 100%"*, and then
 * *"remember everything about anything signed in. passwords account names, etc.
 * you can put a check box, but default it to checked, it's on the desktop."*
 * Three things followed:
 *
 *   1. **One preference with one owner.** `src/lib/rememberSignIn.ts` decides
 *      what is remembered, for every sign-in this app will ever have. This file
 *      asks it one question (`resolveRemembered`) and does not keep its own
 *      idea of the answer.
 *   2. **One place that decides the words.** `src/lib/signInStates.ts`
 *      enumerates every state a player can be in and returns the heading, the
 *      sentence and the labels for each. This file renders them and writes no
 *      prose of its own, so a screen cannot say one thing while the button
 *      under it offers another - which is what #504 was.
 *   3. **A screen per state.** There were four rendered stages and about twenty
 *      situations. The gap is where somebody gets stranded: a failure with no
 *      screen, an attach offer with no button, a dropped link still showing the
 *      success panel. `tools/sign-in-experience-test.mjs` walks the enumeration
 *      and fails naming any state without a distinct screen and an action.
 *
 * # The password
 *
 * It lives in one `useState` below, for the length of one call, and is cleared
 * the moment the call returns - success or failure. It is never put in a URL
 * and never comes back from Rust in any result or error. If remembering is on,
 * and only after `lich_login_characters` has proved the password works, it goes
 * to Windows Credential Manager through the one path in `rememberSignIn.ts`.
 * A password the account server rejected is not one worth keeping, and storing
 * before the call would remember typing mistakes.
 *
 * Unticking the box forgets immediately rather than at the next sign-in. A box
 * that says it has stopped remembering while the entry is still in Credential
 * Manager is a lie the player cannot see through.
 *
 * # One press
 *
 * With everything remembered the screen opens with the account filled, no
 * password field, the remembered character preselected and focus on a single
 * button reading "Sign in as Phemius". The character list is skipped when the
 * remembered character is still on the account - and *only* then, because a
 * character that has gone has to be chosen again rather than silently
 * substituted. `actionsToPlay` counts what that costs: four acts before this
 * change, one after.
 *
 * The column scrolls and nothing here depends on the window being tall: the
 * smallest supported window is 720x480 and issue #418 was a call to action
 * rendered below the bottom edge of a 1024x768 one.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { LogIn, ArrowLeft, Loader2, ChevronRight } from 'lucide-react'
import {
  GAME_CODES,
  DEFAULT_GAME_CODE,
  classifyLoginError,
  listCharacters,
  launchCharacter,
  usingFakeBackend,
  type CharacterEntry,
} from '../../lib/lichLogin.ts'
import { fakeCredentialHas } from '../../lib/lichLoginFake.ts'
import {
  REMEMBER_SIGN_IN_DEFAULT,
  actionsToPlay,
  forgetEverything,
  rememberAfterSignIn,
  rememberSignIn,
  rememberedPrefs,
  tauriCredentials,
} from '../../lib/rememberSignIn.ts'
import { screenFor, type SignInScreen } from '../../lib/signInStates.ts'
import { RememberSignInCheckbox } from './RememberSignIn.tsx'
import {
  attachGame,
  gameState,
  linkPhase,
  subscribeGame,
  LICH_STARTUP_WAIT_MS,
} from '../../lib/gameLink.ts'
import { lichAttachOffer, attachAdvice, type AttachOffer } from '../../lib/lichAttachOffer.ts'
import { isTauri } from '../../lib/tauri.ts'

/**
 * The rendered stages, which are fewer than the states.
 *
 * A stage is "what shape is on screen"; a state is "what is true". `progress`
 * covers three states - contacting, starting, attaching - because they are one
 * shape with a different step name, and `screenFor` supplies that name. Keeping
 * them as one stage and three states is deliberate: the player sees the step
 * they are on, and the test still counts three screens.
 *
 * The wait between launching and attaching is not cosmetic (issue #458). The
 * launch used to jump straight to attached in the same tick, which provably
 * cannot connect - Lich does not open the detachable port until it has booted
 * Ruby and reached the game.
 */
type Stage = 'form' | 'picker' | 'progress' | 'attached'

/** How long a step runs before the elapsed seconds appear beside it. */
const ELAPSED_AFTER_MS = 3000

export function SignIn() {
  const initial = rememberedPrefs()

  const [account, setAccount] = useState(initial.account)
  // Never read anywhere but the two calls below, never written anywhere else.
  const [password, setPassword] = useState('')
  const [gameCode, setGameCode] = useState(initial.gameCode || DEFAULT_GAME_CODE)
  /**
   * On, unless this player has said otherwise before.
   *
   * `?? REMEMBER_SIGN_IN_DEFAULT` and not `||`: the stored value is a boolean
   * and `false` is the whole point of storing it. With `||` a player who
   * unticked would have their choice overwritten by the default on every
   * launch, which is the trap this repo has hit before.
   */
  const [remember, setRemember] = useState(initial.remember ?? REMEMBER_SIGN_IN_DEFAULT)

  const [stage, setStage] = useState<Stage>('form')
  const [step, setStep] = useState<'contacting' | 'starting_lich' | 'attaching'>('contacting')
  const [characters, setCharacters] = useState<CharacterEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ state: string; screen: SignInScreen } | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [launched, setLaunched] = useState('')
  const [offer, setOffer] = useState<AttachOffer | null>(null)
  const [alreadyRunning, setAlreadyRunning] = useState(false)

  /**
   * Whether a password is saved for this account, in three states.
   *
   * `null` is "could not ask" - the store was unreachable, or the check has not
   * answered yet - and it must not read as "there is none", because that would
   * hide the password field from somebody who has to type one. So the field is
   * shown for `null` exactly as it is for `false`.
   */
  const [storedPassword, setStoredPassword] = useState<boolean | null>(null)
  /** The "Use a different password" escape hatch, per account. */
  const [typePasswordAnyway, setTypePasswordAnyway] = useState(false)

  /** The link, so a dropped or exhausted connection gets its own screen. */
  const link = useSyncExternalStore(subscribeGame, gameState, gameState)
  const phase = linkPhase(link)

  const errorRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)

  const trimmedAccount = account.trim()
  const usingStoredPassword = storedPassword === true && !typePasswordAnyway
  const rememberedCharacter = initial.character

  // Outside the desktop app there is no backend at all, so the form would
  // submit into nothing. The dry-run stand-in is the one exception, and it has
  // to be asked for by URL.
  const workable = isTauri() || usingFakeBackend()

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
          : await tauriCredentials.has(trimmedAccount)
        if (live) setStoredPassword(has)
      } catch {
        // Not `false`: a store this app could not reach is a question it cannot
        // answer, and answering it anyway is how a player ends up with no
        // password field and no way in.
        if (live) setStoredPassword(null)
      }
    })()
    return () => {
      live = false
    }
  }, [trimmedAccount])

  /**
   * Focus the first empty field, or the button when there is nothing to fill.
   *
   * The one-press return depends on this. It runs once the stored-password
   * answer is in, because until then the form does not know whether there is a
   * password field to focus.
   */
  useEffect(() => {
    if (stage !== 'form' || storedPassword === null) return
    if (!trimmedAccount) accountRef.current?.focus?.()
    else if (!usingStoredPassword) passwordRef.current?.focus?.()
    else submitRef.current?.focus?.()
  }, [stage, storedPassword, usingStoredPassword, trimmedAccount])

  /** Elapsed on a step, so a long wait does not read as a hang. */
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (stage !== 'progress') {
      setElapsed(0)
      return
    }
    const started = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - started), 500)
    return () => clearInterval(id)
  }, [stage, step])

  // Bring the failure into view rather than leaving it under the fold.
  useEffect(() => {
    if (!failure) return
    errorRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [failure])

  /**
   * Which of the four "we remember you" states this is, or `signed_out`.
   *
   * Named from the same enumeration the test walks, so the screen a returning
   * player sees is one of the screens that was counted rather than a fifth
   * shape assembled here.
   */
  const rememberedState = useMemo(() => {
    if (!trimmedAccount) return 'signed_out'
    const pw = usingStoredPassword
    const ch = Boolean(rememberedCharacter)
    if (pw && ch) return 'remembered_all'
    if (pw) return 'remembered_account_password'
    if (ch) return 'remembered_account_character'
    return 'remembered_account'
  }, [trimmedAccount, usingStoredPassword, rememberedCharacter])

  /** What this screen is, right now. One value, and everything reads it. */
  const state = !workable
    ? 'browser_preview'
    : stage === 'form'
      ? rememberedState
      : stage === 'picker'
        ? characters.length > 0
          ? 'choosing'
          : 'no_characters'
        : stage === 'progress'
          ? step
          : phase === 'reconnecting'
            ? 'dropped'
            : phase === 'gave-up'
              ? 'gave_up'
              : 'attached'

  const screen = screenFor(state, launched || rememberedCharacter)

  /** How many acts remain from here. Reported, not decoration - see the test. */
  const actionsRemaining = actionsToPlay({
    account: Boolean(trimmedAccount),
    password: usingStoredPassword,
    character: Boolean(rememberedCharacter),
  })

  /** One place that says what went wrong, so the two paths cannot disagree. */
  const report = (e: unknown) => {
    const { kind, detail } = classifyLoginError(e)
    // `failed_<rust code>` where there is one, so the screen a player gets is
    // the screen the enumeration counted. A failure with no code at all lands
    // on the `internal` screen, which prints what actually happened.
    const structured =
      typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string'
        ? (e as { code: string }).code
        : ''
    const stateId = `failed_${structured || 'internal'}`
    let s: SignInScreen
    try {
      s = screenFor(stateId, launched || rememberedCharacter)
    } catch {
      // A code the enumeration does not know. Not silently generic: the raw
      // text is the only information there is, so it is what gets shown.
      s = { ...screenFor('failed_internal'), state: stateId, detail }
    }
    setShowDetail(false)
    setFailure({ state: stateId, screen: { ...s, detail: detail || s.detail } })
    setAlreadyRunning(kind === 'lich_already_running')
    if (kind === 'lich_already_running') {
      setOffer(null)
      void (async () => {
        try {
          setOffer(await lichAttachOffer(trimmedAccount))
        } catch (readFailure) {
          setOffer({
            kind: 'unknown',
            why: readFailure instanceof Error ? readFailure.message : String(readFailure ?? ''),
          })
        }
      })()
    }
    if (kind === 'stored_password_rejected') {
      // Rust has already forgotten the entry, so the form must stop offering to
      // use it - otherwise the next press signs in with nothing and the player
      // is told a password they never typed is wrong.
      setStoredPassword(false)
      setTypePasswordAnyway(true)
    }
    return kind
  }

  /** Launch one character and attach. Shared by the picker and the one press. */
  const launch = async (name: string) => {
    setStep('starting_lich')
    setStage('progress')
    try {
      const result = await launchCharacter({
        account: trimmedAccount,
        password,
        gameCode,
        character: name,
      })
      if (remember) rememberSignIn({ character: name })
      setLaunched(name)
      setStep('attaching')
      try {
        await attachGame(result.port, undefined, LICH_STARTUP_WAIT_MS)
        setStage('attached')
      } catch (attachFailure) {
        // The one place in this app that knows an attach failure *followed a
        // launch*, which is what makes `lich_did_not_start` the honest code.
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

  const signIn = async () => {
    setBusy(true)
    setFailure(null)
    setAlreadyRunning(false)
    setStep('contacting')
    setStage('progress')
    try {
      const result = await listCharacters({ account: trimmedAccount, password, gameCode })
      // Only now, and only if asked: the account server has just accepted this
      // password, so it is one worth keeping. One call writes all of it or none
      // of it, which is what makes the checkbox a single decision.
      try {
        await rememberAfterSignIn(
          tauriCredentials,
          { account: trimmedAccount, password, gameCode },
          remember
        )
      } catch (storeError) {
        // Signing in worked; only remembering failed. Say so rather than
        // failing the sign-in, and rather than saying nothing.
        report({
          code: 'internal',
          message: `Signed in, but the sign-in could not be remembered: ${String(storeError)}`,
        })
      }
      setCharacters(result.characters)
      // The one press. Only when the remembered character is still on the
      // account: one that has gone has to be chosen again rather than silently
      // swapped for somebody else's.
      const straightIn =
        remember && rememberedCharacter
          ? result.characters.find((c) => c.name === rememberedCharacter)
          : undefined
      if (straightIn) {
        await launch(straightIn.name)
        return
      }
      setStage('picker')
    } catch (e) {
      // Cleared on the failure path immediately: a wrong password left sitting
      // in the field is both a retry that repeats the same mistake and a secret
      // kept for no reason.
      setPassword('')
      report(e)
      setStage('form')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Attach to the Lich that is already up, or to one this app lost.
   *
   * The same `attachGame` the launch path uses, and the same port the offer
   * names, so there is one attach and one number. `undefined` for the wait
   * where a Lich is already up: there is nothing to wait for and twenty seconds
   * of spinner would be a worse answer than an immediate one.
   */
  const attachToRunning = async () => {
    const advice = attachAdvice(offer)
    if (advice.port === null) return
    setBusy(true)
    setFailure(null)
    try {
      await attachGame(advice.port)
      setAlreadyRunning(false)
      setOffer(null)
      setStage('attached')
    } catch (attachFailure) {
      report({
        code: 'lich_did_not_start',
        message:
          attachFailure instanceof Error ? attachFailure.message : String(attachFailure ?? ''),
      })
      setAlreadyRunning(true)
      setOffer(null)
      try {
        setOffer(await lichAttachOffer(trimmedAccount))
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
    setFailure(null)
    setAlreadyRunning(false)
    setOffer(null)
    // Going back is also the way out of the flow, so it is the other place the
    // password has to stop existing.
    setPassword('')
  }

  /**
   * Untick, and forget now.
   *
   * Not at the next sign-in: the box is a statement about what is stored, so it
   * has to be true the moment it changes. Ticking it again stores nothing until
   * the next successful sign-in, because there is no password in hand to store.
   */
  const changeRemember = (next: boolean) => {
    setRemember(next)
    if (!next) {
      setStoredPassword(false)
      setTypePasswordAnyway(true)
      void forgetEverything(tauriCredentials, trimmedAccount).catch(() => {})
    } else {
      rememberSignIn({ remember: true })
    }
  }

  /**
   * Every action id the enumeration can produce, mapped to what it does.
   *
   * One record rather than handlers scattered through the JSX, so the test can
   * assert that no screen offers an action nothing here handles - a button that
   * does nothing being the exact defect a screen-per-state is meant to remove.
   * `pick` is the one that is not a single call: it needs the character, so it
   * is bound per row in the list below.
   */
  const handlers: Record<string, () => void> = {
    'sign-in': () => void signIn(),
    'type-password': () => {
      setTypePasswordAnyway(true)
      setPassword('')
    },
    // Written long rather than as the shorthand `back,`. The scan in
    // `tools/sign-in-experience-test.mjs` looks for `<id>:` in this block, and
    // a shorthand property is a handler the scan cannot see - which would make
    // the one action every stranded screen depends on the one action nobody
    // could prove was wired.
    back: back,
    retry: () => {
      setFailure(null)
      void signIn()
    },
    pick: () => {},
    attach: () => void attachToRunning(),
    cancel: back,
    details: () => setShowDetail((v) => !v),
    forget: () => {
      void forgetEverything(tauriCredentials, trimmedAccount).catch(() => {})
      setAccount('')
      setStoredPassword(false)
      setRemember(REMEMBER_SIGN_IN_DEFAULT)
    },
  }

  const field =
    'w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint'
  const primary =
    'flex items-center gap-1.5 rounded border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50'
  const quiet =
    'flex items-center gap-1.5 text-xs text-ink-faint underline decoration-dotted hover:text-ink disabled:opacity-50'

  /**
   * Which screen's actions the secondary row shows.
   *
   * The failure's, except on the form - where the form itself *is* the way
   * onward, and offering "Try again" beside a password field cleared on the
   * failure would be offering to send an empty one. Off the form there is no
   * such route, so the failure's own actions are the only ones there are, and
   * without this they were computed and rendered by nobody: a screen with a
   * `back` in its action list and no button is the same defect as no action.
   */
  const active = failure && stage !== 'form' ? failure.screen : screen

  /** The secondary actions of that screen, minus the ones drawn inline. */
  const secondary = active.actions.filter(
    (a) => a.id !== 'sign-in' && a.id !== 'pick' && a.id !== 'attach' && a.id !== 'details'
  )

  return (
    <div className="mt-3 min-w-0 rounded-lg border border-border bg-surface-raised p-3">
      <div className="flex items-center gap-2">
        <LogIn className="h-4 w-4 shrink-0 text-accent" />
        <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          {screen.heading}
        </h3>
      </div>
      <p className="mt-2 text-xs leading-snug text-ink-muted" data-sign-in-state={state}>
        {screen.sentence}
      </p>

      {stage === 'form' && (
        /* A real form, so Enter submits from any field without a keydown
         * handler pretending to be one, and so the browser and any password
         * manager see a login form rather than three loose inputs. */
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (busy || !workable || !trimmedAccount || (!password && !usingStoredPassword)) return
            void signIn()
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs text-ink-faint">Account name</span>
            <input
              ref={accountRef}
              className={field}
              type="text"
              name="username"
              autoComplete="username"
              spellCheck={false}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="Your Play.net account"
            />
          </label>

          {usingStoredPassword ? (
            /* No password box at all, which is the point of remembering one.
             * The escape hatch is not optional - a saved password can be the
             * wrong one, and a form with no way to type a different one would
             * be a dead end. It is one of this screen's actions, below. */
            <p className="text-xs leading-snug text-ink-muted">
              Using the password remembered on this computer for {trimmedAccount}.
            </p>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs text-ink-faint">Password</span>
              <input
                ref={passwordRef}
                className={field}
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

          <RememberSignInCheckbox
            checked={remember}
            onChange={changeRemember}
            disabled={busy || !workable}
          />

          <button
            ref={submitRef}
            type="submit"
            disabled={busy || !workable || !trimmedAccount || (!password && !usingStoredPassword)}
            className={primary}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
            {busy
              ? 'Signing in…'
              : (screen.actions.find((a) => a.id === 'sign-in')?.label ?? 'Sign in')}
          </button>

          <p className="text-xs leading-snug text-ink-faint" data-actions-to-play={actionsRemaining}>
            Your password is typed into this app, used once to sign in to
            Simutronics, and kept in Windows Credential Manager unless you
            untick the box.
          </p>
        </form>
      )}

      {stage === 'picker' && characters.length > 0 && (
        <div className="mt-2 space-y-2">
          {/* A list, so the count is announced and the rows are one tab stop
            * each. The remembered character is first, because the commonest
            * thing a returning player does is play the same character again.
            * Enter picks, because these are buttons. */}
          <ul className="flex flex-col gap-1">
            {[...characters]
              .sort((a, b) =>
                a.name === rememberedCharacter ? -1 : b.name === rememberedCharacter ? 1 : 0
              )
              .map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      void launch(c.name)
                    }}
                    className="flex w-full items-center justify-between rounded border border-accent/40 bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
                  >
                    <span>
                      {c.name}
                      {c.name === rememberedCharacter && (
                        <span className="ml-2 font-normal text-ink-faint">played last</span>
                      )}
                    </span>
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {stage === 'progress' && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {screen.heading}
          {elapsed >= ELAPSED_AFTER_MS && (
            <span className="text-ink-faint">{Math.round(elapsed / 1000)}s</span>
          )}
        </p>
      )}

      {secondary.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {secondary.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={busy && a.id !== 'cancel'}
              onClick={handlers[a.id]}
              className={quiet}
            >
              {a.id === 'back' || a.id === 'cancel' ? <ArrowLeft className="h-3 w-3" /> : null}
              {a.label}
            </button>
          ))}
        </div>
      )}

      {failure && (
        <div ref={errorRef} className="mt-2 space-y-1.5">
          {/* The heading as well as the sentence. It is what the enumeration
            * names this failure, and until it was rendered here it was a value
            * every test asserted and no player ever saw. */}
          <p className="text-xs font-semibold text-danger">{failure.screen.heading}</p>
          <p className="text-xs leading-snug text-danger">{failure.screen.sentence}</p>
          {/* What the backend actually said, behind a disclosure rather than on
            * the panel. The sentence tells a player what to do; this is what
            * goes in a bug report, and deleting it to keep the panel tidy would
            * throw away the only line that says which of thirteen things
            * happened. */}
          {failure.screen.detail && (
            <>
              <button
                type="button"
                onClick={handlers.details}
                className="text-xs text-ink-faint underline decoration-dotted hover:text-ink"
                aria-expanded={showDetail}
              >
                Details for a bug report
              </button>
              {showDetail && (
                <p className="text-xs leading-snug text-ink-faint">{failure.screen.detail}</p>
              )}
            </>
          )}
          {/* The action, not a diagnostic. Rendered only for the one kind that
            * means a Lich is up (#488 §3), and saying *which* Lich before it
            * offers to join it (#504). */}
          {alreadyRunning && (
            <div className="space-y-1.5" data-testid="attach-offer">
              <p
                className="text-xs leading-snug text-ink-muted"
                data-attach-kind={offer?.kind ?? 'checking'}
              >
                {attachAdvice(offer).sentence}
              </p>
              {attachAdvice(offer).action && (
                <button
                  type="button"
                  onClick={handlers.attach}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2 py-1 text-xs text-accent disabled:opacity-40"
                >
                  {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                  {attachAdvice(offer).action}
                </button>
              )}
              {/* Always, including on the three answers with no attach to
                * offer. Those were the screens a player was stuck on (#523):
                * a sentence explaining why nothing can be pressed, and nothing
                * to press. */}
              <button type="button" onClick={handlers.back} className={quiet}>
                <ArrowLeft className="h-3 w-3" />
                Back to sign in
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
