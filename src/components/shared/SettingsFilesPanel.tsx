import { useState } from 'react'
import { FileWarning, FileCheck2, RefreshCw, ChevronRight } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'

/**
 * Which dr-scripts settings files are being read, in what order, and which one
 * will not parse.
 *
 * Everything on this panel was already crossing the socket. The bridge walks
 * the profile directories, works out the load order dr-scripts uses, sizes each
 * file, parses it, counts the top-level settings, lists their names, and on a
 * syntax error reports the line and column. It broadcasts all of that as a
 * `settings` message. The store's switch had no case for that message, so the
 * whole payload arrived and fell off the end, and the intent that produces it
 * was never wired to a control in the first place. A finished feature, missing
 * only somebody to press it.
 *
 * Three things are worth a person's attention here and they are not the same
 * thing:
 *
 *   - **Load order.** Later files override earlier ones. Nearly every "I
 *     changed the setting and nothing happened" is a value being overwritten
 *     two files down, and reading the order is how you find it.
 *   - **A file that will not parse.** dr-scripts does not stop for this. It
 *     carries on with defaults, so the symptom is a script quietly behaving
 *     like somebody else's, which is a hard thing to guess at.
 *   - **The line number.** A YAML error names its line and column. That is the
 *     one fact that turns this from a hunt into an edit, and it is the reason
 *     people paste these files into online parsers.
 *
 * Nothing here is written back. This reads files and says what is in them.
 */

/** Bytes, at the sizes settings files actually come in. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function SettingsFilesPanel() {
  const files = useAppStore((s) => s.settingsFiles)
  const character = useAppStore((s) => s.settingsCharacter)
  const readSettings = useAppStore((s) => s.readSettings)
  const connected = useAppStore((s) => s.bridgeConnected)

  const [open, setOpen] = useState<string | null>(null)

  const broken = files?.filter((f) => !f.ok) ?? []

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-ink-muted hover:bg-surface-overlay hover:text-ink disabled:opacity-50"
          onClick={readSettings}
          disabled={!connected}
          title={
            connected
              ? 'Ask Lich which dr-scripts settings files apply to this character'
              : 'Needs a bridge connection'
          }
        >
          <RefreshCw className="h-3 w-3" />
          {files ? 'Check again' : 'Check settings files'}
        </button>

        {character && <span className="text-xs text-ink-faint">for {character}</span>}
      </div>

      {/* No answer yet is not the same as no files, and must not look like it. */}
      {!files && (
        <p className="text-xs text-ink-faint">
          Not checked yet. This reads your dr-scripts YAML profiles and reports the
          load order and any that will not parse. Nothing is written.
        </p>
      )}

      {files && files.length === 0 && (
        <p className="text-xs text-ink-faint">
          No dr-scripts profiles found. That is fine if you do not use them; this app
          does not require them.
        </p>
      )}

      {broken.length > 0 && (
        <p className="text-xs text-danger">
          {broken.length} file{broken.length > 1 ? 's' : ''} will not parse. dr-scripts
          carries on with defaults rather than stopping, so the setting you changed is
          not being read.
        </p>
      )}

      {files && files.length > 0 && (
        <ol className="flex flex-col gap-1">
          {files.map((f, i) => {
            const expanded = open === f.path
            return (
              <li key={f.path} className="rounded border border-border bg-surface">
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 px-2 py-1 text-left"
                  onClick={() => setOpen(expanded ? null : f.path)}
                >
                  {/* Load order is the point of the number, so it is a number
                      and not a bullet. Later wins. */}
                  <span className="shrink-0 text-xs tabular-nums text-ink-faint">{i + 1}</span>

                  {f.ok ? (
                    <FileCheck2 className="h-3.5 w-3.5 shrink-0 self-center text-good" />
                  ) : (
                    <FileWarning className="h-3.5 w-3.5 shrink-0 self-center text-danger" />
                  )}

                  <span
                    className={`min-w-0 flex-1 truncate text-xs ${f.ok ? 'text-ink' : 'text-danger'}`}
                  >
                    {f.name}
                  </span>

                  <span className="shrink-0 text-xs text-ink-faint">
                    {f.kind === 'defaults' ? 'defaults' : 'yours'}
                  </span>

                  <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                    {f.ok ? `${f.count ?? 0} settings` : 'broken'}
                  </span>

                  <ChevronRight
                    className={`h-3 w-3 shrink-0 self-center text-ink-faint transition-transform ${
                      expanded ? 'rotate-90' : ''
                    }`}
                  />
                </button>

                {!f.ok && (
                  <p className="px-2 pb-1.5 text-xs text-danger">
                    {f.line !== undefined && (
                      <span className="font-medium">
                        line {f.line}
                        {f.column !== undefined ? `, column ${f.column}` : ''}:{' '}
                      </span>
                    )}
                    {f.error ?? 'will not parse'}
                  </p>
                )}

                {expanded && (
                  <div className="border-t border-border px-2 py-1.5">
                    <p className="mb-1 break-all text-xs text-ink-faint">{f.path}</p>
                    <p className="mb-1 text-xs text-ink-faint">{size(f.bytes)}</p>
                    {/* The key names were in the payload and were being thrown
                        away with the rest of it. They are how you answer "is
                        my setting even in this file", which is the question
                        that sends people to a text editor. */}
                    {f.keys && f.keys.length > 0 && (
                      <p className="text-xs leading-relaxed text-ink-muted">
                        {f.keys.join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {files && files.length > 1 && (
        <p className="text-xs text-ink-faint">
          Read top to bottom. A setting in a later file replaces the same setting in an
          earlier one.
        </p>
      )}
    </div>
  )
}
