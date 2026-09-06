/**
 * The one Tauri command this app still uses to write into a Genie install.
 *
 * # What N6 removed, and what is left
 *
 * This module used to wrap three: save, restore-from-backup, and a sound-file
 * list for a picker. The last two existed for the Genie config editor, which
 * N6 deleted along with the rest of the route through that client, so they
 * went with it - `restore_genie_config` and `list_sounds` are deregistered on
 * the Rust side too, not merely uncalled.
 *
 * `saveGenieConfig` survives because it has a caller that is not the editor:
 * `pinsFile.ts` writes the portable pin file into the same `Config` directory,
 * which was Dan's ask (30 Aug 2026) so that a player backing up that folder
 * gets their pins with it. That is a storage-location decision this sweep did
 * not make and is not entitled to reverse; `docs/PLAN_TO_1_0.md` question N-a
 * holds it. See `src-tauri/src/config_import.rs`'s own header for the
 * backup/atomic-write guarantees this wraps.
 */
import { invokeTauri, isTauri } from './tauri.ts'

export interface WriteResult {
  path: string
  backedUp: boolean
}

/**
 * Write `text` back to the named file in the Genie `Config` directory, backing
 * up the pre-edit version the first time this leaf is ever saved through this
 * app. Throws with a message meant to be shown directly - the Rust side
 * already writes player-facing text, not an error code.
 *
 * `expectedPrevious`, when given, is the text this save's patch was built
 * from. The Rust side refuses to write if the file no longer matches it. No
 * caller passes it today: the editor that always could is gone, and
 * `pinsFile.ts`'s export dumps the whole store rather than patching text it
 * read, so a hand-edit to that YAML is silently overwritten. Any future
 * read-then-write caller must pass it.
 */
export async function saveGenieConfig(
  leaf: string,
  text: string,
  expectedPrevious?: string
): Promise<WriteResult> {
  if (!isTauri()) {
    throw new Error('No config directory to save to outside the desktop app.')
  }
  return (await invokeTauri('write_genie_config', {
    leaf,
    text,
    expectedPrevious,
  })) as WriteResult
}
