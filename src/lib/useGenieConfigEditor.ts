/**
 * Shared load/edit/save state for a Genie config editor - highlights and
 * aliases both need the same shape (raw text, parsed entries, a way to apply
 * a text-level patch and persist it, a way to undo everything), just with
 * different parsers, so this is generic over the entry type rather than
 * duplicated per file.
 *
 * Deliberately independent of `useHighlights`/`useAliases`'s own module-level
 * cache: those hold the *parsed* array for the game pane to paint/expand
 * against, with no raw text or file path retained, and consumers there don't
 * need either. An editor needs both - text to patch, path to show where a
 * save went - so it keeps its own copy here and calls the shared reload
 * hooks (`reloadHighlights`/`reloadAliases`) after a save so the game pane
 * picks up the change too.
 */
import { useCallback, useEffect, useState } from 'react'
import { invokeTauri, isTauri } from './tauri'
import { saveGenieConfig, restoreGenieConfigBackup } from './genieConfigWrite'

export interface ConfigEditorState<T> {
  /** Where the file actually is on disk, once known. Empty until loaded. */
  path: string
  /** The full raw text, patched in place by edits before a save. */
  text: string
  entries: T[]
  skipped: string[]
  /** True until the first load (success or failure) completes. */
  loading: boolean
  /** Set when a load, save, or restore failed - shown, not thrown, since a
   * player mid-edit should not lose their draft over a save that failed. */
  error: string
  /** Whether a `.bak` of the pre-edit file exists - so "restore original"
   * can be disabled honestly rather than offered and then refused. */
  backedUp: boolean
}

export interface ConfigEditor<T> extends ConfigEditorState<T> {
  /** Apply a new full text (from one of genieConfigEdit.ts's patch
   * functions), save it, and reload - both this editor's own state and the
   * shared cache the game pane reads. */
  applyAndSave: (newText: string, reloadShared: () => void) => Promise<void>
  /** Undo every change made through this editor, then reload both caches. */
  restoreOriginal: (reloadShared: () => void) => Promise<void>
}

/**
 * `leaf` is the Genie config filename (`highlights.cfg`/`aliases.cfg`).
 * `parse` is that file's own parser, returning entries with a `sourceLine`
 * on each - the contract `genieConfigEdit.ts`'s patch functions need.
 */
export function useGenieConfigEditor<T>(
  leaf: string,
  parse: (text: string) => { entries: T[]; skipped: string[] }
): ConfigEditor<T> {
  const [state, setState] = useState<ConfigEditorState<T>>({
    path: '',
    text: '',
    entries: [],
    skipped: [],
    loading: true,
    error: '',
    backedUp: false,
  })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    if (!isTauri()) {
      setState((s) => ({
        ...s,
        loading: false,
        error: 'No Genie config to edit outside the desktop app.',
      }))
      return
    }
    try {
      const cfg = (await invokeTauri('read_genie_config', { leaf })) as {
        found: boolean
        text: string
        path: string
        note: string
      }
      const text = cfg.found ? cfg.text : ''
      const { entries, skipped } = parse(text)
      setState({
        path: cfg.path,
        text,
        entries,
        skipped,
        loading: false,
        error: cfg.found ? '' : cfg.note,
        backedUp: false,
      })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: String(e) }))
    }
  }, [leaf, parse])

  useEffect(() => {
    void load()
  }, [load])

  const applyAndSave = useCallback(
    async (newText: string, reloadShared: () => void) => {
      try {
        const result = await saveGenieConfig(leaf, newText)
        const { entries, skipped } = parse(newText)
        setState((s) => ({
          ...s,
          path: result.path,
          text: newText,
          entries,
          skipped,
          error: '',
          backedUp: result.backedUp,
        }))
        reloadShared()
      } catch (e) {
        setState((s) => ({ ...s, error: String(e) }))
        throw e
      }
    },
    [leaf, parse]
  )

  const restoreOriginal = useCallback(
    async (reloadShared: () => void) => {
      try {
        await restoreGenieConfigBackup(leaf)
        reloadShared()
        await load()
      } catch (e) {
        setState((s) => ({ ...s, error: String(e) }))
        throw e
      }
    },
    [leaf, load]
  )

  return { ...state, applyAndSave, restoreOriginal }
}
