const CONTROL_CHARACTERS = /\p{Cc}/u

/**
 * Native `game_send` writes exactly one CRLF-terminated command to Lich.
 * Embedded controls would turn one request into extra protocol lines or
 * otherwise corrupt that boundary, so they are rejected rather than stripped.
 */
export function validateGameCommand(command: string): string {
  if (CONTROL_CHARACTERS.test(command)) {
    throw new Error('A game command must be one line and contain no control characters.')
  }
  return command
}

/**
 * Printable ASCII plus the space, and nothing else.
 *
 * The suggestion card's whole promise is that the string a person reads is
 * the string that gets sent. That is a claim about *rendering*, not bytes, so
 * refusing one class at a time loses: `\p{Cc}` was refused and `\p{Cf}` was
 * not, and `look my ring <U+202E>rob the bank` rendered on the card as
 * `look my ring knab eht bor` with `textContent` still equal to the command.
 * (Written as `<U+202E>` on purpose. A literal one here would reverse this
 * very comment in whatever editor the next reader opens it in.)
 * Widening the deny-list to Cf, then to bidi controls, then to zero-width
 * joiners, variation selectors, private use, `\p{Cn}`, `\p{Cs}`, `\p{Zl}` and
 * `\p{Zp}` is a list that has to be kept correct against every future Unicode
 * revision. An allow-list of printable ASCII refuses all of them by
 * construction and cannot fall behind.
 *
 * Admissible because DragonRealms commands are ASCII, and so is every string
 * this app builds one from. Measured over the repo's game-derived data:
 * 1,395,537 characters of room/exit strings across 86 map files, 0 non-ASCII;
 * `src/data/places.json` 108,700 characters, 0; `data/elanthipedia/items.json`
 * 41,928 characters, 0; `src/data/bestiary.json` 159,863 characters, 0.
 * `data/elanthipedia/bestiary.json` holds three U+2019, all inside wiki prose
 * (`Sorrow's Reach`, an `Xala'shar archer` description) and none in a name a
 * command could target.
 *
 * This is the generated path only. Raw player input keeps `validateGameCommand`:
 * what a human chooses to type is not this function's business.
 *
 * Lich/Genie also use semicolons as command separators, so generated actions
 * must not accept one even though the command line deliberately does.
 */
const NON_PRINTABLE_ASCII = /[^\x20-\x7E]/u

export function validateGameActionCommand(command: string): string {
  validateGameCommand(command)
  if (!command.trim()) {
    throw new Error('The generated game action is empty.')
  }
  if (NON_PRINTABLE_ASCII.test(command)) {
    const points = Array.from(command)
    const at = points.findIndex((point) => NON_PRINTABLE_ASCII.test(point))
    const code = points[at]?.codePointAt(0) ?? 0
    const label = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
    throw new Error(
      'A generated game action contains characters a game command cannot carry ' +
        `(${label} at position ${at + 1}). What is shown must be what is sent.`,
    )
  }
  if (command.length > 160) {
    throw new Error('A generated game action is too long.')
  }
  if (command.includes(';')) {
    throw new Error('A generated game action cannot contain a command separator.')
  }
  return command
}
