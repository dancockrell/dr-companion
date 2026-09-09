/**
 * Every state a player can be in on the way into the game, and the screen each
 * one gets.
 *
 * # Why this is a list rather than a set of `if`s in a component
 *
 * The sign-in screen had four rendered stages (`form`, `picker`, `starting`,
 * `launched`) and roughly twenty *situations*, and the difference between those
 * two numbers is where a player gets stranded. A failure code with no screen
 * renders as the generic sentence; an attach offer with no button renders as a
 * dead end; a dropped link renders as the success screen it was a second ago.
 * None of those is visible by reading the component, because a missing branch
 * looks exactly like a branch nobody needed.
 *
 * So the states are enumerated here, **derived from the code that produces
 * them** wherever there is such code:
 *
 *   * the failure codes come from `loginErrorFixtures.ts`, which `cargo test`
 *     generates from the Rust types, so a code Rust starts sending appears here
 *     without anybody editing this file;
 *   * the refusal tokens come from the same generated file;
 *   * the "a Lich is already up" answers come from `ATTACH_OFFER_KINDS`, which
 *     is the union `lich_attach_offer` can return;
 *   * only {@link BASE_STATES} is hand-written, and it is short enough to read.
 *
 * {@link screenFor} is a pure function, so `tools/sign-in-experience-test.mjs`
 * can walk every state without a browser and assert that each has a distinct
 * screen with at least one thing to press. **A state with no screen is a
 * defect**, and a state whose screen has no action is the same defect wearing a
 * sentence.
 *
 * # One place that decides the words
 *
 * `SignIn.tsx` renders what this returns and writes no prose of its own. That
 * is the point: the heading, the sentence and the labels on the buttons live
 * together, so a screen cannot say one thing while the control under it offers
 * another - which is exactly what #504 was.
 */
import {
  LOGIN_ERROR_FIXTURES,
  REFUSAL_SENTENCES,
  type LoginErrorFixture,
} from './loginErrorFixtures.ts'
import { classifyLoginError } from './lichLogin.ts'
import { ATTACH_OFFER_KINDS, attachAdvice, type AttachOffer } from './lichAttachOffer.ts'
import { DEFAULT_ATTACH_PORT } from './gameLink.ts'

/**
 * Every action a screen can offer, as a closed set.
 *
 * Ids rather than labels, because `SignIn.tsx` maps them to handlers and a
 * label is prose that gets reworded. The test asserts every id produced by
 * every state is handled there, so an action that names no handler is caught
 * rather than rendering as a button that does nothing.
 */
export const SIGN_IN_ACTIONS = [
  /** Submit the form. */
  'sign-in',
  /** Ignore the saved password and type one. */
  'type-password',
  /** Back to the sign-in form, from anywhere. */
  'back',
  /** Run the same step again. */
  'retry',
  /** Choose a character from the list. */
  'pick',
  /** Attach to the Lich that is already running. */
  'attach',
  /** Stop waiting and go back. */
  'cancel',
  /** Show the technical line, for a bug report. */
  'details',
  /** Forget everything remembered for this account. */
  'forget',
] as const

export type SignInActionId = (typeof SIGN_IN_ACTIONS)[number]

export interface SignInAction {
  id: SignInActionId
  label: string
}

export interface SignInScreen {
  /** The state this is the screen for. */
  state: string
  /** The largest words on the panel. Distinct across every state. */
  heading: string
  /** What happened, in the second person. */
  sentence: string
  /** At least one. A screen with nothing to press is how a player is stranded. */
  actions: SignInAction[]
  /**
   * The technical line, behind the `details` action rather than on the panel.
   * Empty where there is nothing a bug report would want.
   */
  detail: string
}

/**
 * The states that are not derived from a generated table.
 *
 * Four of them are the shapes of "we remember you", one per combination that
 * can actually occur - an account is what the other two are keyed on, so
 * "password but no account" is not a state, it is a bug. The rest are the
 * steps of signing in, which are the states nobody had screens for: the app
 * showed one spinner for four of them.
 */
export const BASE_STATES = [
  'signed_out',
  'remembered_account',
  'remembered_account_password',
  'remembered_account_character',
  'remembered_all',
  'contacting',
  'choosing',
  'no_characters',
  'starting_lich',
  'attaching',
  'attached',
  'dropped',
  'gave_up',
  'browser_preview',
] as const

/** `failed_<code>`, one per code the Rust side can send. */
export const FAILURE_STATES = LOGIN_ERROR_FIXTURES.map((f) => `failed_${f.code}`)

/** `refused_<token>`, one per `A`-reply refusal token Lich knows. */
export const REFUSAL_STATES = REFUSAL_SENTENCES.map((r) => `refused_${r.token}`)

/** `running_<kind>`, one per answer `lich_attach_offer` can give. */
export const RUNNING_STATES = ATTACH_OFFER_KINDS.map((k) => `running_${k}`)

/**
 * Every state, with its denominator.
 *
 * The four groups are summed rather than listed, so adding a login error code
 * in Rust grows this list and the test's denominator together. A test that
 * counted a literal would stay green over a code with no screen, which is the
 * whole thing this file exists to stop.
 */
export const SIGN_IN_STATES: string[] = [
  ...BASE_STATES,
  ...FAILURE_STATES,
  ...REFUSAL_STATES,
  ...RUNNING_STATES,
]

/** A floor, well under the real count, so an emptied table cannot read as fine. */
export const SIGN_IN_STATE_FLOOR = 30

function fixtureFor(code: string): LoginErrorFixture | undefined {
  return LOGIN_ERROR_FIXTURES.find((f) => f.code === code)
}

/** Back, and nothing else. The last resort every screen can fall back on. */
const BACK: SignInAction = { id: 'back', label: 'Back to sign in' }
const RETRY: SignInAction = { id: 'retry', label: 'Try again' }
const DETAILS: SignInAction = { id: 'details', label: 'Details for a bug report' }

/**
 * The screen for one state.
 *
 * `character` is the remembered character's name where there is one, because
 * two of these screens name it - a button reading "Sign in as Phemius" is the
 * whole of the one-press return, and a button reading "Sign in as your
 * character" would not be.
 */
export function screenFor(state: string, character = ''): SignInScreen {
  const who = character.trim()
  const named = who || 'your character'

  switch (state) {
    case 'signed_out':
      return {
        state,
        heading: 'Sign in to DragonRealms',
        sentence:
          'Your Play.net account, the same one you use to play. This starts Lich for you, so there is nothing else to open.',
        actions: [{ id: 'sign-in', label: 'Sign in' }],
        detail: '',
      }
    case 'remembered_account':
      return {
        state,
        heading: 'Welcome back',
        sentence: 'Your account name is remembered. Type your password to carry on.',
        actions: [
          { id: 'sign-in', label: 'Sign in' },
          { id: 'forget', label: 'Forget everything for this account' },
        ],
        detail: '',
      }
    case 'remembered_account_password':
      return {
        state,
        heading: 'Welcome back',
        sentence:
          'Your account name and password are remembered. Pick a character after signing in.',
        actions: [
          { id: 'sign-in', label: 'Sign in' },
          { id: 'type-password', label: 'Use a different password' },
          { id: 'forget', label: 'Forget everything for this account' },
        ],
        detail: '',
      }
    case 'remembered_account_character':
      return {
        state,
        heading: 'Welcome back',
        sentence: `Your account name is remembered, and ${named} is the character you played last. Type your password.`,
        actions: [
          { id: 'sign-in', label: `Sign in as ${named}` },
          { id: 'forget', label: 'Forget everything for this account' },
        ],
        detail: '',
      }
    case 'remembered_all':
      return {
        state,
        heading: 'Welcome back',
        sentence: `Everything is remembered. One press signs ${named} in and starts Lich.`,
        actions: [
          { id: 'sign-in', label: `Sign in as ${named}` },
          { id: 'type-password', label: 'Use a different password' },
          { id: 'forget', label: 'Forget everything for this account' },
        ],
        detail: '',
      }
    case 'contacting':
      return {
        state,
        heading: 'Signing in to Play.net…',
        sentence: 'Asking Simutronics for the characters on this account.',
        actions: [{ id: 'cancel', label: 'Stop and go back' }],
        detail: '',
      }
    case 'choosing':
      return {
        state,
        heading: 'Pick a character',
        sentence:
          'Choosing one starts Lich for that character and attaches this app to it. The one you played last is first.',
        actions: [
          { id: 'pick', label: 'Play this character' },
          BACK,
        ],
        detail: '',
      }
    case 'no_characters':
      return {
        state,
        heading: 'No characters on this account',
        sentence:
          'This account has no characters in the game you chose. Go back and choose another game, or make a character on the Play.net website.',
        actions: [BACK],
        detail: '',
      }
    case 'starting_lich':
      return {
        state,
        heading: 'Starting Lich…',
        sentence:
          'Lich is booting Ruby and connecting to the game. This takes a few seconds and is the slowest part.',
        actions: [{ id: 'cancel', label: 'Stop and go back' }],
        detail: '',
      }
    case 'attaching':
      return {
        state,
        heading: 'Attaching…',
        sentence:
          'Lich is up and this app is joining it. It waits up to twenty seconds, because the port is not open the instant Lich starts.',
        actions: [{ id: 'cancel', label: 'Stop and go back' }],
        detail: '',
      }
    case 'attached':
      return {
        state,
        heading: `${named} is in the game`,
        sentence: 'The game text appears here in a moment. You can play from this window.',
        actions: [{ id: 'back', label: 'Sign in as somebody else' }],
        detail: '',
      }
    case 'dropped':
      return {
        state,
        heading: 'The link dropped',
        sentence:
          'The connection to Lich went away and this app is trying to get it back. Nothing has been lost; the character is still in the game.',
        actions: [{ id: 'cancel', label: 'Stop trying' }, BACK],
        detail: '',
      }
    case 'gave_up':
      return {
        state,
        heading: 'Not connected any more',
        sentence:
          'The reconnect attempts ran out. Attach again if Lich is still running, or sign in to start a fresh one.',
        actions: [{ id: 'attach', label: 'Attach again' }, BACK],
        detail: '',
      }
    case 'browser_preview':
      return {
        state,
        heading: 'This is the browser preview',
        sentence:
          'Signing in needs the desktop app, which is where Lich and the credential store are. Nothing here can reach them.',
        actions: [BACK],
        detail: '',
      }
  }

  if (state.startsWith('failed_')) {
    const code = state.slice('failed_'.length)
    const fixture = fixtureFor(code)
    // Classified rather than looked up, so this screen and the error panel
    // cannot disagree about what a code means: one function decides both.
    const { kind, sentence, detail } = classifyLoginError(
      fixture ? { code: fixture.code, message: fixture.message } : { code, message: '' }
    )
    const actions: SignInAction[] =
      kind === 'lich_already_running'
        ? [{ id: 'attach', label: 'Attach to it' }, BACK]
        : kind === 'password_needed' || kind === 'stored_password_rejected'
          ? [{ id: 'type-password', label: 'Type your password' }, BACK]
          : kind === 'character_not_found'
            ? [RETRY, BACK]
            : [RETRY, BACK]
    return {
      state,
      heading: HEADINGS[kind] ?? 'Signing in failed',
      sentence,
      actions: detail ? [...actions, DETAILS] : actions,
      detail,
    }
  }

  if (state.startsWith('refused_')) {
    const token = state.slice('refused_'.length)
    const row = REFUSAL_SENTENCES.find((r) => r.token === token)
    return {
      state,
      heading: `Play.net said ${token}`,
      sentence: row?.sentence ?? 'Play.net refused this sign-in.',
      actions: [RETRY, BACK, DETAILS],
      detail: row ? `A-reply refusal token ${row.token} (${row.gloss})` : `refusal token ${token}`,
    }
  }

  if (state.startsWith('running_')) {
    const kind = state.slice('running_'.length) as AttachOffer['kind']
    // The offer objects the advice is written against. Built here rather than
    // in the component so the sentence a test reads is the sentence a player
    // reads, and so `no_port` genuinely has no attach button.
    // The port is `DEFAULT_ATTACH_PORT`, never a literal. `tools/detachable-port-test.mjs`
    // holds the line that 11024 lives in one place - `instances.ts`, through
    // `gameLink.ts` - and it caught this file retyping it. In the running app
    // the sentence comes from the *real* offer's port anyway; this is the
    // sample the enumeration needs, and a sample with a hardcoded number is a
    // second copy of a fact whether or not a player ever sees it.
    const port = Number(DEFAULT_ATTACH_PORT)
    const offer: AttachOffer =
      kind === 'ours'
        ? { kind: 'ours', port }
        : kind === 'foreign'
          ? { kind: 'foreign', port, character: who || null }
          : kind === 'no_port'
            ? { kind: 'no_port', port }
            : kind === 'no_lich'
              ? { kind: 'no_lich' }
              : { kind: 'unknown', why: 'the local listening ports could not be read' }
    const advice = attachAdvice(offer)
    return {
      state,
      heading: RUNNING_HEADINGS[kind],
      sentence: advice.sentence,
      // `back` is always here, including on the three answers that have no
      // attach to offer. That is #523's smallest honest fix: the screens with
      // nothing to press were the ones where a player was stuck, and the way
      // out is the way in.
      actions: advice.action ? [{ id: 'attach', label: advice.action }, BACK] : [BACK],
      detail: '',
    }
  }

  // Not a fallback that renders. An unknown state reaching this function means
  // the caller invented one, and a screen apologising for it would look like a
  // handled case in a screenshot.
  throw new Error(`no screen for sign-in state ${state}`)
}

/** The heading per failure kind. Short, and never the error code. */
const HEADINGS: Record<string, string> = {
  bad_password: 'That did not work',
  account_locked: 'Play.net has locked this account',
  account_refused: 'Play.net refused the sign-in',
  character_not_found: 'That character is gone',
  service_unreachable: 'Play.net did not answer',
  login_service_changed: 'The login service has changed',
  password_unsendable: 'This password cannot be sent',
  lich_did_not_start: 'Lich did not start',
  lich_already_running: 'Lich is already running',
  password_needed: 'A password is needed',
  stored_password_rejected: 'The saved password stopped working',
  unknown: 'Signing in failed',
}

const RUNNING_HEADINGS: Record<AttachOffer['kind'], string> = {
  ours: 'This app already started Lich',
  foreign: 'Somebody else’s Lich is running',
  no_port: 'Lich is running but cannot be joined',
  no_lich: 'Nothing is running now',
  unknown: 'Could not tell what is running',
}
