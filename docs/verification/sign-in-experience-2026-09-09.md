# The sign-in experience, looked at rather than read

9 September 2026. `node tools/sign-in-shots.mjs http://127.0.0.1:5191/`, against a
dev server on a port nothing else on this machine held, driving the dry-run
stand-in (`?lichDryRun=1`) in headless Edge at 1024x768.

**77 checked, 0 failed.**

## What this cannot tell you, said plainly

Chrome is not the app. `isTauri()` is false here, so this drove
`src/lib/lichLoginFake.ts`, not `eaccess.rs`, not Windows Credential Manager and
not a real Lich. It proves the screens, the state machine, the sentences and the
one-press flow. It proves nothing about the protocol, the real credential store,
or the real launch. The credential store's own round trip is proved by
`cargo test credential_store`, which reads `cmdkey /list` rather than the code
under test.

## The screens

| File | What it shows |
|---|---|
| `sign-in-experience-2026-09-09-form.png` | A profile that has been through setup and remembers nothing. The remember box is on screen, ticked, with both the consequence and the warning beside it. |
| `sign-in-experience-2026-09-09-picker.png` | The character list that came back, as a list of buttons. |
| `sign-in-experience-2026-09-09-launched.png` | Attached, and what happens next. |
| `sign-in-experience-2026-09-09-one-press.png` | **The point of the change.** A returning player: account filled, no password field, the last character named on the button, focus already on it, `data-actions-to-play="1"`. |
| `sign-in-experience-2026-09-09-one-press-done.png` | The same profile, one press later, in the game. The character list was never shown. |
| `sign-in-experience-2026-09-09-error.png` | A failure as a sentence, not a stack trace. |
| `sign-in-experience-2026-09-09-locked.png` | A locked account: what happened, what to do, and the technical line behind a *Details for a bug report* disclosure rather than on the panel. |
| `sign-in-experience-2026-09-09-badpw.png` | A refusal that says which two things to check, with the password field cleared. |
| `sign-in-experience-2026-09-09-no-characters.png` | An account with no characters in the chosen game, and a way back. |
| `sign-in-experience-2026-09-09-stored.png` | A saved password in use: no password box, Sign in pressable, and a way to type a different one. |
| `...-attach-ours.png`, `-attach-foreign.png`, `-attach-no-port.png`, `-attach-no-lich.png`, `-attach-unknown.png` | The five answers `lich_attach_offer` can give, each with its own sentence, and each reachable only because the stand-in has a fixture per answer. |

## The numbers this run measured

- **Actions to sign in, for a returning player: 4 before, 1 after.** Counted by
  the rule in `actionsToPlay` - a field to fill costs two (reach it, type it), a
  submit costs one, a pick costs one. Before: the account name was remembered,
  the password was not because the box was off by default, and the remembered
  character was written down and never read, so the picker always appeared. The
  screen carries the number it is offering in `data-actions-to-play`, and this
  run read `1` off the page rather than off a test.
- **The box is ticked when the screen opens.** Read off the checkbox element,
  with a control asserting there is exactly one checkbox to read.
- **Every control is inside a 1024x768 window**, over 22 controls examined - the
  denominator matters, because an error page has no controls outside the window
  for the same reason a suite that never ran has no failures.
- **The technical line is not on the panel and is one press away.** Both
  directions, because deleting it would satisfy the first on its own.

## What changed in this harness, and why there is still only one

There was already a browser harness for this screen. A second one would have
been two harnesses answering one question, which drift, so the new states are
cases in this one and the screenshots carry the new date. Three checks were
turned over rather than deleted, and each is commented where it stands:

- the password sentence, which changed with the default it describes;
- the remember box in the saved-password case, which used to be asserted
  *absent* - correct while it governed a password only, wrong now that it
  governs the account, game and character too;
- the attach offers with nothing to attach to, which used to be asserted as
  having **no** buttons at all. That was right about the attach and wrong about
  the screen: a sentence saying why nothing can be pressed, with nothing to
  press, is where a player was stranded (#523). There is no attach, and there is
  a way back.

## One defect this harness found in itself

The first run died on `nothing matched button with /^Sign in$/`, and the app was
right. With remembering on by default, the first case's successful sign-in left
the account, game and character remembered, so the second case opened on a
returning player's screen whose button read "Sign in as Phemius". Every cold case
now starts from `freshProfile()`. Worth recording because the failure looked like
a broken app and was a harness that had stopped controlling its own starting
state.
