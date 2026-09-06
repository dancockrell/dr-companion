/**
 * The app's own data directory, from the webview side.
 *
 * This module is `genieConfigWrite.ts` moved and renamed, not a second way to
 * write a file. That module wrapped the Rust command that wrote into a
 * *Genie* install's `Config` folder; Q5 deleted both (`docs/PLAYER_CONFIG.md`
 * §8, question N-c: the player's own files are app data). Everything this app
 * writes on the player's behalf now lands in `app_data_dir()/config`, and the
 * app writes nothing into a Genie install - `tools/doc-claims-test.mjs`
 * asserts that no module under `src/` so much as names the deleted writer,
 * which is why this paragraph does not either.
 *
 * This is the whole surface. Q6's whole-store export writes through
 * `writePlayerFile` rather than adding a second writer, which is why the
 * compare-and-swap and the backup live in `src-tauri/src/player_files.rs`
 * behind one command rather than in each caller.
 */
import { invokeTauri, isTauri } from './tauri.ts'

export interface PlayerFile {
  path: string
  text: string
  found: boolean
  note: string
}

export interface WriteResult {
  path: string
  backedUp: boolean
}

export interface AdoptResult {
  adopted: boolean
  from: string
  path: string
  note: string
}

/** Outside the desktop app there is no data directory at all, and pretending
 *  otherwise is how a browser check passes for a feature that cannot run. */
export function canUsePlayerFiles(): boolean {
  return isTauri()
}

/**
 * Read one of the player's own files. `found: false` with a note is the
 * ordinary answer for a player who has never exported - not an error.
 */
export async function readPlayerFile(leaf: string): Promise<PlayerFile> {
  if (!isTauri()) {
    return { path: '', text: '', found: false, note: 'No data folder to read outside the desktop app.' }
  }
  return (await invokeTauri('read_player_file', { leaf })) as PlayerFile
}

/**
 * Write one of the player's own files, atomically, keeping a one-time backup
 * of whatever was there first.
 *
 * `expectedPrevious` is the text this write was built from - what a
 * `readPlayerFile` just returned, or `''` when it found nothing. Pass it. The
 * Rust side refuses the write if the file no longer matches, which is what
 * stops a second window of this app silently overwriting the first one's
 * export. `config_import.rs` recorded having no caller for this as a
 * downgrade; the pin export is the caller.
 *
 * Throws with a message meant to be shown directly - the Rust side already
 * writes player-facing text, not an error code.
 */
export async function writePlayerFile(
  leaf: string,
  text: string,
  expectedPrevious?: string
): Promise<WriteResult> {
  if (!isTauri()) {
    throw new Error('No data folder to save to outside the desktop app.')
  }
  return (await invokeTauri('write_player_file', { leaf, text, expectedPrevious })) as WriteResult
}

/**
 * One-time migration for a player who has a file of this name in a Genie
 * `Config` folder from before Q5. Copies it into app data only when no
 * app-data copy exists, and leaves the Genie copy where it is - deleting
 * somebody's file to tidy up is not a migration.
 *
 * Idempotent, so callers run it before their first read rather than tracking
 * a "have I migrated yet" flag of their own.
 */
export async function adoptGenieFile(leaf: string): Promise<AdoptResult> {
  if (!isTauri()) {
    return { adopted: false, from: '', path: '', note: '' }
  }
  return (await invokeTauri('adopt_genie_file', { leaf })) as AdoptResult
}
