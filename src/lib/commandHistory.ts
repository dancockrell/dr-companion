/**
 * Command-line history is a view over sent commands, not ownership of the
 * line the player is currently writing. Keep that draft separately so a
 * quick trip through history can always return to it intact.
 */
export interface CommandHistoryCursor {
  /** -1 means the player is editing their current draft. */
  at: number
  /** The exact input that was present when history browsing began. */
  draft: string
}

export interface CommandHistoryView extends CommandHistoryCursor {
  command: string
}

export const freshCommandHistoryCursor = (): CommandHistoryCursor => ({ at: -1, draft: '' })

export function historyPrevious(
  history: readonly string[],
  cursor: CommandHistoryCursor,
  command: string
): CommandHistoryView {
  if (history.length === 0) return { ...cursor, command }
  const entering = cursor.at < 0
  const at = entering ? history.length - 1 : Math.max(0, cursor.at - 1)
  return {
    at,
    draft: entering ? command : cursor.draft,
    command: history[at],
  }
}

export function historyNext(
  history: readonly string[],
  cursor: CommandHistoryCursor,
  command: string
): CommandHistoryView {
  if (cursor.at < 0) return { ...cursor, command }
  const at = cursor.at + 1
  if (at >= history.length) {
    return { at: -1, draft: '', command: cursor.draft }
  }
  return { at, draft: cursor.draft, command: history[at] }
}
