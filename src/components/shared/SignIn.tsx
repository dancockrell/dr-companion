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
 * put in a URL, and never comes back from Rust in any result or error. There is
 * no "remember my password" control because there is nowhere safe to remember it
 * yet: that is increment N8, which needs a new Rust dependency and Dan's yes, and
 * a disabled checkbox now would read as a feature that merely does nothing.
 *
 * # Three states, laid out in order
 *
 * `form` → `picker` → `launched`, one at a time, in a column that scrolls. The
 * app's smallest supported window is 720x480 and issue #418 was a call to action
 * rendered below the bottom edge of a 1024x768 one, so nothing here is allowed
 * to depend on the window being tall.
 */
import { useState } from 'react'
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
import { attachGame } from '../../lib/gameLink.ts'
import { isTauri } from '../../lib/tauri.ts'

type Stage = 'form' | 'picker' | 'launched'

export function SignIn() {
  const remembered = rememberedSignIn()

  const [account, setAccount] = useState(remembered.account)
  // Never read anywhere but the two calls below, never written anywhere else.
  const [password, setPassword] = useState('')
  const [gameCode, setGameCode] = useState(remembered.gameCode || DEFAULT_GAME_CODE)

  const [stage, setStage] = useState<Stage>('form')
  const [characters, setCharacters] = useState<CharacterEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [launched, setLaunched] = useState('')

  // Outside the desktop app there is no backend at all, so the form would
  // submit into nothing. The dry-run stand-in is the one exception, and it has
  // to be asked for by URL.
  const workable = isTauri() || usingFakeBackend()

  const signIn = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await listCharacters({ account: account.trim(), password, gameCode })
      rememberSignIn({ account: account.trim(), gameCode })
      setCharacters(result.characters)
      setStage('picker')
    } catch (e) {
      // Cleared on the failure path immediately: a wrong password left sitting
      // in the field is both a retry that repeats the same mistake and a secret
      // kept for no reason.
      setPassword('')
      setError(classifyLoginError(e).sentence)
    } finally {
      setBusy(false)
    }
  }

  const pick = async (character: CharacterEntry) => {
    setBusy(true)
    setError('')
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
      setStage('launched')
      // The existing attach flow takes over from here, with the port the
      // command returned rather than a number retyped in this file.
      await attachGame(result.port)
    } catch (e) {
      setError(classifyLoginError(e).sentence)
      setStage('picker')
    } finally {
      setPassword('')
      setBusy(false)
    }
  }

  const back = () => {
    setStage('form')
    setCharacters([])
    setError('')
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

          <button
            type="button"
            disabled={busy || !workable || !account.trim() || !password}
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
            * "unless you later ask for it" describes N8, which is not built:
            * there is no control anywhere in this app that stores a password
            * today. Flagged rather than reworded here, because this sentence
            * has one owner and it is the privacy document. */}
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

      {error && <p className="mt-2 text-xs leading-snug text-danger">{error}</p>}
    </div>
  )
}
