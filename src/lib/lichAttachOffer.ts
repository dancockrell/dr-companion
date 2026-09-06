/**
 * Which Lich is running, before this app offers to join it.
 *
 * # What the offer used to be
 *
 * Issue #504. A refused launch (`lich_already_running`) put a button on the
 * sign-in screen reading "Attach to the Lich that is running", and pressing it
 * dialled the constant 11024. The refusal behind it came from one `tasklist`
 * call matched on the image name `rubyw.exe`, so what the screen actually knew
 * was *a Ruby process exists*. It did not know whose it was, which account or
 * character it was playing, or whether it had opened a port at all.
 *
 * Two things followed, and both are what this module exists to stop:
 *
 *   * the player typed account A's credentials, picked character X, and could
 *     be joined to character Y from another account with nothing on screen
 *     saying the character had changed;
 *   * the retry advice - "a Lich that is up but not yet listening is the
 *     commonest reason this fails, so press it again" - is an inference, and
 *     for a Lich started without `--detachable-client` it can never come true.
 *     That player was invited to keep pressing forever while the sentence sent
 *     them to a diagnostic for a Lich running perfectly.
 *
 * # What it is now
 *
 * `lich_attach_offer` (`src-tauri/src/lich.rs`) answers with one of five
 * things, and the screen has a different sentence for each. The identification
 * is Lich's own: `Frontend.create_session_file`
 * (`lib/common/front-end.rb:435-443`) writes
 * `<tmp>/simutronics/sessions/<Name>.session` holding
 * `{"name":..,"host":..,"port":..}`, and the detachable listener calls it with
 * the character it was started for and the port it just bound
 * (`lib/main/main.rb:856-866`). So the name on the offer is read off a file
 * Lich wrote, never guessed from the credentials this app happens to be
 * holding.
 *
 * The listener is read out of the OS connection table rather than by
 * connecting: an actual connect would register a detachable client on
 * somebody's live session (`global_defs.rb:2357`), which is a side effect on
 * the thing being probed.
 *
 * # Three states, not two
 *
 * `unknown` is a real answer and is never folded into either of the others.
 * "Nothing is listening" and "the table could not be read" lead to opposite
 * sentences, and a check that cannot say it does not know reports a fact it
 * did not establish.
 */
import { invokeTauri } from './tauri.ts'
import { usingFakeBackend } from './lichLogin.ts'
import { fakeAttachOffer } from './lichLoginFake.ts'

export type AttachOffer =
  /** This app started it and still holds the handle. Nothing to ask. */
  | { kind: 'ours'; port: number }
  /**
   * Somebody else's Lich is listening. `character` is what Lich itself wrote
   * about that port; `null` where it wrote nothing, which is "we cannot tell
   * whose" and not "it must be yours".
   */
  | { kind: 'foreign'; port: number; character: string | null }
  /**
   * A Lich is running and nothing is listening on the port this app can join.
   * Pressing again can never work - it was not started with
   * `--detachable-client`.
   */
  | { kind: 'no_port'; port: number }
  /** Nothing running and nothing listening: the refusal that led here is stale. */
  | { kind: 'no_lich' }
  /** The question was not answered, and the sentence says which half was missing. */
  | { kind: 'unknown'; why: string }

/**
 * Ask which Lich is running.
 *
 * Read fresh at every point the screen needs it - after the refusal, and again
 * after a failed attach - rather than remembered. The old code's failure was
 * that it reasoned about why the attach had not worked; this asks.
 */
export async function lichAttachOffer(account: string): Promise<AttachOffer> {
  if (usingFakeBackend()) return await fakeAttachOffer(account)
  return (await invokeTauri('lich_attach_offer')) as AttachOffer
}

/**
 * The sentence a player reads for each answer, and whether an attach is on
 * offer at all.
 *
 * A pure function of the offer, so `tools/sign-in-test.mjs` can assert every
 * arm without a browser, and so the button and the sentence cannot disagree:
 * one value decides both. Short and plain, per the app's own UI rules.
 */
export interface AttachAdvice {
  /** What to say above the button. Empty while the offer is still being read. */
  sentence: string
  /** The button's words, or null when there is nothing to press. */
  action: string | null
  /** The port an attach would dial, or null when there is nothing to dial. */
  port: number | null
}

export function attachAdvice(offer: AttachOffer | null): AttachAdvice {
  if (!offer) {
    return { sentence: 'Checking which Lich is running.', action: null, port: null }
  }
  switch (offer.kind) {
    case 'ours':
      return {
        sentence: 'This app started that Lich and it is still running.',
        action: 'Attach to it',
        port: offer.port,
      }
    case 'foreign':
      return {
        // The name is the whole point: a player about to be joined to another
        // character has to be told the name before they press, not after the
        // stream arrives.
        sentence: offer.character
          ? `A Lich is running for ${offer.character} on port ${offer.port}. Attaching joins that session, whoever you just signed in as.`
          : `A Lich is running on port ${offer.port} and does not say which character. Attaching joins that session, whoever you just signed in as.`,
        action: offer.character ? `Attach to ${offer.character}` : 'Attach anyway',
        port: offer.port,
      }
    case 'no_port':
      return {
        // No button. This app never ends a Lich it did not start - see
        // `LichProcess::stop` - so the way out is the player's to take.
        sentence:
          'A Lich is running but has no attachable port, so it was not started with --detachable-client. Close it and sign in again to start a fresh one.',
        action: null,
        port: null,
      }
    case 'no_lich':
      return {
        sentence:
          'No Lich is running now. Try signing in again - the one that refused the launch has gone.',
        action: null,
        port: null,
      }
    case 'unknown':
      return {
        sentence: `Could not tell which Lich is running: ${offer.why}`,
        action: null,
        port: null,
      }
  }
}
