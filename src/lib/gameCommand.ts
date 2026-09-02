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
 * Commands assembled from game-derived display names are not raw player
 * input. Lich/Genie use semicolons as command separators, so generated actions
 * must not accept one even though the command line deliberately does.
 */
export function validateGameActionCommand(command: string): string {
  validateGameCommand(command)
  if (!command.trim()) {
    throw new Error('The generated game action is empty.')
  }
  if (command.length > 160) {
    throw new Error('A generated game action is too long.')
  }
  if (command.includes(';')) {
    throw new Error('A generated game action cannot contain a command separator.')
  }
  return command
}
