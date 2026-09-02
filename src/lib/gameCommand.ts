function hasUnsafeCommandCharacter(command: string): boolean {
  return [...command].some((character) => character === ';' || character.charCodeAt(0) <= 31)
}

/**
 * Generated UI actions must remain exactly one ordinary DragonRealms command.
 * Raw text typed into the command line bypasses this guard and keeps its
 * existing player-controlled semantics.
 */
export function validateGameActionCommand(command: string): string {
  if (!command.trim()) throw new Error('The game action did not contain a command.')
  if (command.length > 160) throw new Error('The game action command is too long.')
  if (hasUnsafeCommandCharacter(command)) {
    throw new Error('The game action contained an unsafe command separator or control character.')
  }
  return command
}
