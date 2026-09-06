/**
 * Frontends, and the prefix each one uses to start a Lich script.
 *
 * This exists because of one line in the Lich help channel:
 *
 *     "genie uses commas to start lich scripts, every other FE uses semicolon"
 *
 * Every instruction this app gave said `;companion_bridge`. For a Genie user
 * that is simply wrong, and the failure is silent: Genie treats it as a game
 * command, the game says it does not understand, and the bridge never starts.
 * A first-run instruction that does not work for the most common frontend is
 * about as bad as a first-run instruction gets.
 *
 * The wider point, and the reason this file is a list rather than a boolean:
 * **DR Companion is a GUI for Lich, and Lich is frontend-agnostic.** Genie is
 * the most common one, not the only one, and the community is actively using
 * several others. Treating Genie as required would narrow the audience for no
 * reason.
 */

export interface Frontend {
  id: string
  label: string
  /** What you type before a Lich script name. */
  prefix: ';' | ','
  /**
   * The flag Lich is launched with for this frontend, where one exists.
   *
   * `null` means Lich has **no** flag for it, which is a different claim from
   * "nobody filled this in". Two entries here named a flag that does not exist
   * until 6 Sep 2026 - `--wrayth` and `--profanity` - and neither appears
   * anywhere in Lich's argument parser. `determine_frontend`
   * (`argv_options.rb:385-399`) accepts exactly `-s`/`--stormfront`,
   * `-w`/`--wizard`, `--avalon`, `--frostbite` and `--saga`; everything else
   * falls through to `'unknown'`. `--genie` is honoured too, but only on the
   * headless path (`login_helpers.rb:578-584`) - it is not in
   * `determine_frontend` at all.
   *
   * There is also a `--frontend=<name>`, and it is a trap rather than an
   * option: `argv_options.rb:98-99` parses it into `@argv_options[:frontend]`
   * and **nothing anywhere reads that key**. Setting it does nothing.
   */
  lichFlag: string | null
  /** Executables to look for when detecting it. */
  executables: string[]
  /** Folder names it is commonly installed under. */
  folders: string[]
  note?: string
}

export const FRONTENDS: Frontend[] = [
  {
    id: 'genie',
    label: 'Genie',
    // The one that is different, and the most widely used.
    prefix: ',',
    lichFlag: '--genie',
    executables: ['Genie.exe', 'Genie4.exe', 'Genie5.exe', 'GenieClient.exe'],
    folders: ['Genie', 'Genie4', 'Genie5', 'GenieClient', 'Genie Client'],
    note: 'Genie starts Lich scripts with a comma, not a semicolon.',
  },
  {
    id: 'wrayth',
    label: 'Wrayth',
    prefix: ';',
    // Lich has no `--wrayth`. `-s`/`--stormfront` is the flag for this
    // client, under its former name (argv_options.rb:386-387).
    lichFlag: '--stormfront',
    executables: ['Wrayth.exe', 'StormFront.exe'],
    folders: ['Wrayth', 'StormFront'],
    note: 'Formerly StormFront. Simutronics’ long-running Windows client.',
  },
  {
    id: 'frostbite',
    label: 'Frostbite',
    prefix: ';',
    lichFlag: '--frostbite',
    executables: ['Frostbite.exe'],
    folders: ['Frostbite'],
    note: 'Community client. Uses Genie’s map files for its built-in mapper.',
  },
  {
    id: 'saga',
    label: 'Saga',
    prefix: ';',
    lichFlag: null,
    executables: ['Saga.exe'],
    folders: ['Saga'],
    note: 'Simutronics’ newer client. Reducing typeahead helps script-driven movement.',
  },
  {
    id: 'avalon',
    label: 'Avalon',
    prefix: ';',
    lichFlag: '--avalon',
    executables: ['Avalon.exe'],
    folders: ['Avalon'],
  },
  {
    id: 'profanity',
    label: 'ProfanityFE',
    prefix: ';',
    // Lich has no `--profanity` flag. The identity is reached by being a
    // headless detachable client, which is what this app's own launch does
    // (login_helpers.rb:578-584), not by asking for it.
    lichFlag: null,
    executables: ['profanity'],
    folders: ['ProfanityFE', 'profanity'],
    note: 'Terminal client from elanthia-online.',
  },
  {
    id: 'other',
    label: 'Something else',
    prefix: ';',
    lichFlag: null,
    executables: [],
    folders: [],
    note: 'Every frontend except Genie uses a semicolon.',
  },
]

export const DEFAULT_FRONTEND = 'genie'

/**
 * The identity **Lich gives itself** when DR Companion starts it, which is a
 * different question from every entry above.
 *
 * The list above answers "which client is the player using, so what do we tell
 * them to type". This answers "what does Lich think it is talking to", and
 * since Lane N the answer is: this app. `--headless=<port>` is normalised into
 * `--without-frontend --detachable-client=<port>`
 * (`arg_normalization.rb:52-53`), which routes `Frontend.client` through
 * `resolve_headless_frontend` (`login_helpers.rb:578-584`) — and that returns
 * `'profanity'` for every launch except `--saga` and `--genie`.
 *
 * **Measured, not inferred**, on 6 Sep 2026 by executing Lich 5.20.1's own
 * `resolve_headless_frontend` and `Frontend.has_capability?` against its own
 * registry with our exact argv:
 * `docs/verification/lich-native-stream-2026-09-06.md`. That closes
 * `docs/LICH_NATIVE_LOGIN.md` §7's inferred item 1.
 *
 * Two consequences the app depends on:
 *
 *   - **`supports_streams?` is `true`**, so `<pushStream id=…>` labels arrive
 *     and the channel tabs can fill. Under Genie they never could:
 *     `genie`'s capabilities are `[xml, mono]` with no `streams` at all
 *     (`front-end.rb:251-252`), and `messaging.rb:21-48` gates every stream
 *     tag on that predicate.
 *   - **`supports_mono?` and `supports_room_window?` are `false`**, unlike an
 *     interactive Wrayth session. Neither reaches this app: `mono` only wraps
 *     Lich's own injected room text in `<output class="mono"/>`, and
 *     `room_window` only injects a duplicate `<streamWindow>` of the exits.
 *     The app parses room state from its own bridge commands instead.
 *
 * The `GAME=STORM` line in the launch file does **not** decide this. The
 * branch that would set `'stormfront'` from it (`main.rb:375-376`) is inside
 * the `else` of `if ARGV.include?('--without-frontend')` at `main.rb:359`, so
 * it never runs on this path. It happens to have `streams` too, which is why
 * this went unnoticed as an open question for so long — the answer is the same
 * either way, and the identity is not.
 */
export const APP_LAUNCH_IDENTITY = 'profanity'

/**
 * The prefix that applies when the app started Lich itself.
 *
 * `$clean_lich_char = Frontend.client.eql?('genie') ? ',' : ';'`
 * (`main.rb:58`). Our identity is never `genie`, so it is always `;` — and
 * `main.rb:58` in fact runs before `Frontend.client` is assigned at all, with
 * `$frontend` still `nil`, which reaches the same answer by a second route.
 */
export const APP_LAUNCH_PREFIX = ';'

export function frontendById(id: string): Frontend {
  return FRONTENDS.find((f) => f.id === id) ?? FRONTENDS[0]!
}

/** The prefix for a frontend, defaulting to the safe majority case. */
export function prefixFor(id: string | null | undefined): string {
  if (!id) return ';'
  return frontendById(id).prefix
}

/**
 * How to start the bridge, spelled for the frontend in use.
 *
 * Everywhere the app tells someone to run a Lich script should go through
 * here rather than hardcoding a punctuation mark.
 */
export function bridgeCommand(frontendId: string | null | undefined, arg?: string): string {
  const p = prefixFor(frontendId)
  return arg ? `${p}companion_bridge ${arg}` : `${p}companion_bridge`
}

/** Guess the frontend from a detected executable path. */
export function frontendFromPath(path: string | null | undefined): string | null {
  if (!path) return null
  const lower = path.toLowerCase()
  for (const f of FRONTENDS) {
    if (f.executables.some((e) => lower.endsWith(e.toLowerCase()))) return f.id
  }
  return null
}
