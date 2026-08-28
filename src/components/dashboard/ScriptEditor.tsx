/**
 * Writing a script, in the app, in either language.
 *
 * This replaces the step-list form that used to live in `TaskFlowPanel`. That
 * form could express a list of commands and one condition per step, because
 * behind it was a hand-written condition grammar (`flowConditions.ts`) that
 * had to grow a feature for every idea anybody had. A text editor over a real
 * language has no such ceiling, and every player who has written a Lich script
 * has met one before.
 *
 * # Why a plain textarea and not a syntax-highlighting editor
 *
 * A highlighter is a dependency, a bundle, and a grammar per language, in a
 * panel that shares a window with a live game. The thing that actually makes
 * this usable is not colour: it is that Tab indents instead of leaving the
 * field, that the file saves where you expect, and that Save and Run is one
 * press. Those are done. Colour can come later and costs nothing to add on
 * top; getting them wrong would make the editor useless with colour.
 *
 * # Two languages, two engines
 *
 * Python is this app's own scripting language — a saved script becomes a task
 * and runs as its own process under the rate cap and the pause gate. Ruby is
 * Lich's, and a saved script goes into Lich's folder to be started through the
 * bridge. The editor names which engine will run the thing before it is run,
 * because they are genuinely different and a player choosing between them
 * should be choosing knowingly.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Play, Save, Trash2, X } from 'lucide-react'
import {
  deleteScript,
  readScript,
  scriptTemplate,
  taskIdFor,
  writeScript,
  type ScriptDirs,
  type ScriptLang,
} from '../../lib/scriptFiles'
import { invokeTauri } from '../../lib/tauri'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'

export type EditorTarget = {
  /** Empty for a script being created. */
  name: string
  lang: ScriptLang
}

/** What each engine can be told about itself, in one line, before you commit. */
const ENGINE: Record<ScriptLang, string> = {
  python:
    'Runs as its own process against this app. Rate-capped and pausable. ' +
    'Saved here it becomes a task you can start from the Tasks list.',
  ruby:
    "Runs inside Lich, with Lich's own API. Saved into Lich's scripts folder " +
    'and started the same way as any other Lich script.',
}

export function ScriptEditor({
  target,
  dirs,
  onClose,
  onSaved,
  onRun,
}: {
  target: EditorTarget
  dirs: ScriptDirs | null
  onClose: () => void
  onSaved: () => void
  onRun: (taskId: string) => void
}) {
  const addLog = useAppStore((s) => s.addLog)
  const startScript = useAppStore((s) => s.startScript)

  const [lang, setLang] = useState<ScriptLang>(target.lang)
  const [name, setName] = useState(target.name)
  const [body, setBody] = useState('')
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const area = useRef<HTMLTextAreaElement>(null)

  // Existing script: load it. New one: a template, so the first thing a player
  // sees is a working example rather than a blank page and a language they may
  // not know the shape of.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const text = target.name
          ? await readScript(target.lang, target.name)
          : await scriptTemplate(target.lang, 'my_script')
        if (!cancelled) {
          setBody(text)
          setDirty(false)
        }
      } catch (e) {
        if (!cancelled) setNote(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [target.name, target.lang])

  // Switching language on a *new* script swaps the template with it. Never on
  // an existing one: that would silently replace what somebody wrote.
  const changeLang = useCallback(
    async (next: ScriptLang) => {
      setLang(next)
      if (!target.name && !dirty) setBody(await scriptTemplate(next, name || 'my_script'))
    },
    [target.name, dirty, name]
  )

  const save = useCallback(async (): Promise<boolean> => {
    if (!name.trim()) {
      setNote('Give it a name first.')
      return false
    }
    try {
      const path = await writeScript(lang, name.trim(), body)
      setDirty(false)
      // The path, not just "saved". A success message with no location is how
      // you end up with a file written somewhere nobody expected.
      setNote(`Saved to ${path}`)
      onSaved()
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setNote(message)
      addLog(`Could not save ${name}: ${message}`, 'error')
      return false
    }
  }, [lang, name, body, onSaved, addLog])

  const saveAndRun = useCallback(async () => {
    if (!(await save())) return
    if (lang === 'python') {
      onRun(taskIdFor(name.trim()))
    } else {
      // Ruby goes to Lich, which starts it by name. Nothing in this app runs
      // it directly, and a second execution path here would bypass Lich's own
      // script handling entirely.
      startScript(name.trim())
      addLog(`Asked Lich to start ${name.trim()}`, 'info')
    }
  }, [save, lang, name, onRun, startScript, addLog])

  const remove = useCallback(async () => {
    try {
      await deleteScript(lang, name)
      onSaved()
      onClose()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }, [lang, name, onSaved, onClose])

  /**
   * Tab indents rather than leaving the field.
   *
   * In a Python editor this is not a nicety: a Tab that moves focus makes the
   * one language where indentation is syntax unusable in the one place this
   * app offers to edit it.
   */
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey) return
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart: start, selectionEnd: end, value } = el
    const next = `${value.slice(0, start)}    ${value.slice(end)}`
    setBody(next)
    setDirty(true)
    // Restored after React writes the new value, or the caret jumps to the end
    // on every single Tab.
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 4
    })
  }, [])

  const folder = lang === 'python' ? dirs?.pythonDir : dirs?.rubyDir
  const unavailable = lang === 'ruby' && !dirs?.rubyDir

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {(['python', 'ruby'] as ScriptLang[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => void changeLang(l)}
            // Disabled for an existing script: a saved script's language is
            // its file extension and its folder, so "switching" it would mean
            // writing a copy somewhere else and leaving the original behind.
            disabled={Boolean(target.name)}
            title={ENGINE[l]}
            className={cn(
              'rounded border px-2 py-0.5 text-xs capitalize',
              lang === l
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-border text-ink-faint hover:text-ink',
              target.name && 'opacity-60'
            )}
          >
            {l}
          </button>
        ))}

        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setDirty(true)
          }}
          disabled={Boolean(target.name)}
          placeholder="script name"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-0.5 font-mono text-xs text-ink placeholder:text-ink-faint"
        />

        <button
          type="button"
          onClick={onClose}
          title="Close the editor"
          className="rounded border border-border px-1.5 py-0.5 text-ink-faint hover:text-ink"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Which engine will run this, said before it is run rather than after. */}
      <p className="text-xs leading-tight text-ink-faint">{ENGINE[lang]}</p>

      {unavailable && (
        <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">
          {dirs?.note || "Lich's scripts folder was not found, so this cannot be saved yet."}
        </p>
      )}

      <textarea
        ref={area}
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          setDirty(true)
        }}
        onKeyDown={onKeyDown}
        spellCheck={false}
        placeholder={loading ? 'Loading…' : ''}
        className="min-h-0 flex-1 resize-none rounded border border-border bg-surface p-2 font-mono text-xs leading-snug text-ink"
      />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void save()}
          disabled={unavailable}
          className={cn(
            'flex items-center gap-1 rounded border px-2 py-0.5 text-xs',
            dirty
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-border text-ink-faint hover:text-ink',
            unavailable && 'opacity-50'
          )}
        >
          <Save className="h-3 w-3" />
          Save{dirty ? ' •' : ''}
        </button>

        <button
          type="button"
          onClick={() => void saveAndRun()}
          disabled={unavailable}
          className={cn(
            'flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-ink hover:border-ink-faint',
            unavailable && 'opacity-50'
          )}
        >
          <Play className="h-3 w-3" />
          Save and run
        </button>

        {folder && (
          <button
            type="button"
            onClick={() => void invokeTauri('reveal_file', { path: folder })}
            title={folder}
            className="rounded border border-border px-1.5 py-0.5 text-ink-faint hover:text-ink"
          >
            <FolderOpen className="h-3 w-3" />
          </button>
        )}

        {/* Only ever offered for the app's own Python folder. Lich's folder
         * holds dr-scripts and whatever else the player installed; this app did
         * not put them there and will not remove them. */}
        {target.name && lang === 'python' && (
          <button
            type="button"
            onClick={() => void remove()}
            title="Delete this script"
            className="ml-auto rounded border border-danger/40 px-1.5 py-0.5 text-danger hover:bg-danger/15"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {note && <p className="truncate text-xs text-ink-faint" title={note}>{note}</p>}
    </div>
  )
}
