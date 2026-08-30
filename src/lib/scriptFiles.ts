/**
 * The player's own scripts: list, read, save, delete.
 *
 * Three languages, and the difference is not cosmetic. A Python or TypeScript
 * script is one of this app's tasks — it runs as its own process against the
 * script API, under the rate cap and the pause gate. A Ruby script is a
 * *Lich* script: it lives in Lich's `scripts` folder, runs inside Lich, and
 * is started through the bridge exactly as any other Lich script is.
 *
 * So "which language" is really "which engine runs this", and the destination
 * follows from it rather than being a choice anybody should have to make. The
 * UI says which is which instead of hiding it, because each has genuinely
 * different capabilities and a player will want more than one for different
 * jobs.
 *
 * Saving a Python or TypeScript script installs it: `python/runner.py` and
 * `typescript/runner.ts` each discover their own `tasks/user/*` every time
 * they are asked, so a file saved here appears in the task list on the next
 * refresh with no restart and no registration step.
 */
import { invokeTauri, isTauri } from './tauri'

export type ScriptLang = 'python' | 'typescript' | 'ruby'

export type ScriptFile = {
  name: string
  lang: ScriptLang
  path: string
  bytes: number
  /**
   * The first line of the script's own header comment or docstring, when it
   * has one. Empty when it does not — the browser then shows nothing rather
   * than quoting a line of code as though it were a description.
   */
  summary: string
}

export type ScriptDirs = {
  pythonDir: string | null
  typescriptDir: string | null
  rubyDir: string | null
  /**
   * Why a language is unavailable, when one is. Ruby needs Lich, and "Lich was
   * not found" is a different problem from "you have written no Ruby scripts"
   * even though both produce an empty list.
   */
  note: string
}

export async function scriptDirs(): Promise<ScriptDirs> {
  const raw = await invokeTauri('script_dirs')
  if (!raw || typeof raw !== 'object') {
    return {
      pythonDir: null,
      typescriptDir: null,
      rubyDir: null,
      note: isTauri()
        ? 'The script backend did not answer.'
        : 'Scripts are edited in the app, not in a browser preview.',
    }
  }
  return raw as ScriptDirs
}

export async function listScripts(): Promise<ScriptFile[]> {
  const raw = await invokeTauri('list_scripts')
  return Array.isArray(raw) ? (raw as ScriptFile[]) : []
}

export async function readScript(lang: ScriptLang, name: string): Promise<string> {
  const raw = await invokeTauri('read_script', { lang, name })
  return typeof raw === 'string' ? raw : ''
}

/** Save, and answer with the path it went to rather than a bare success. */
export async function writeScript(
  lang: ScriptLang,
  name: string,
  body: string
): Promise<string> {
  const raw = await invokeTauri('write_script', { lang, name, body })
  return typeof raw === 'string' ? raw : ''
}

export async function deleteScript(lang: ScriptLang, name: string): Promise<void> {
  await invokeTauri('delete_script', { lang, name })
}

/** A starting point, so a new script is never a blank page. */
export async function scriptTemplate(lang: ScriptLang, name: string): Promise<string> {
  const raw = await invokeTauri('script_template', { lang, name })
  return typeof raw === 'string' ? raw : ''
}

/**
 * The task id a saved Python script gets.
 *
 * Derived in one place so the editor and the task list cannot disagree about
 * what a script is called once it is saved.
 */
export function taskIdFor(name: string): string {
  return `user.${name}`
}
