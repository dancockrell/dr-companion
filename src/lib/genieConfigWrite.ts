/**
 * The three Tauri commands `genieConfigEdit.ts`'s patched text actually gets
 * sent to: save, restore-from-backup, and the sound-file list a picker needs
 * so a player never has to type a filename they can only get right by
 * already knowing it. See `src-tauri/src/config_import.rs`'s own header for
 * the backup/atomic-write guarantees these wrap.
 */
import { invokeTauri, isTauri } from './tauri.ts'

export interface WriteResult {
  path: string
  backedUp: boolean
}

/**
 * Write `text` back to the named Genie config file (`highlights.cfg` or
 * `aliases.cfg`), backing up the pre-edit version the first time this leaf is
 * ever saved through this app. Throws with a message meant to be shown
 * directly - the Rust side already writes player-facing text, not an error
 * code.
 *
 * `expectedPrevious`, when given, is the text this save's patch was built
 * from - what this caller last read or wrote. The Rust side refuses to write
 * if the file no longer matches it, which is the only thing standing between
 * "Genie's own editor touched this file while the sheet was open" and that
 * edit vanishing with no trace. Pass it whenever there is a real "previous
 * text" this save is a patch of - `useGenieConfigEditor` always can. Omit it
 * only for a deliberate one-shot snapshot write with no such concept (e.g.
 * `pinsFile.ts`'s export, which dumps localStorage in full rather than
 * patching a previously-read file) - and know that means a hand-edit to that
 * file gets silently overwritten the same way every save here used to risk.
 */
export async function saveGenieConfig(
  leaf: string,
  text: string,
  expectedPrevious?: string
): Promise<WriteResult> {
  if (!isTauri()) {
    throw new Error('No Genie install to save to outside the desktop app.')
  }
  return (await invokeTauri('write_genie_config', {
    leaf,
    text,
    expectedPrevious,
  })) as WriteResult
}

/** Undo every change this app has made to a leaf by restoring its backup. */
export async function restoreGenieConfigBackup(leaf: string): Promise<WriteResult> {
  if (!isTauri()) {
    throw new Error('No Genie install to restore outside the desktop app.')
  }
  return (await invokeTauri('restore_genie_config', { leaf })) as WriteResult
}

/**
 * Every sound file `read_sound` could actually find, across every directory
 * it searches - for a picker, sorted case-insensitively. Empty (not an
 * error) outside Tauri or when no Sounds folder exists yet.
 */
export async function listSounds(): Promise<string[]> {
  if (!isTauri()) return []
  return (await invokeTauri('list_sounds')) as string[]
}
