import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { catalogue, choose, genericPortraitFor, loadPortraitManifest, portraitFor, portraitUrl, resetChoice } from '../../lib/portraits'
import { readCustomPortrait, removeCustomPortrait } from '../../lib/customPortraits'
import { CustomPortraitEditor } from './CustomPortraitEditor'
import { useModalDialog } from '../../lib/useModalDialog'
import { scrollableRegionProps } from '../../lib/scrollableRegion'

/**
 * The character's face.
 *
 * Filled in this order: what the player chose, then what their LOOK suggests,
 * then race and sex alone. The generated set is one face per race per sex,
 * which is a starting point rather than a likeness — nobody's character is the
 * default Elf — so changing it is one click and uploading your own stays the
 * better answer.
 *
 * The core pack ships with the app, so loading and incomplete metadata use a
 * stable photographic default. A character portrait never collapses to a
 * letter, which reads like missing art rather than a person.
 */
export function Portrait({
  character,
  instance = 'Prime',
  look,
  race,
  sex,
  size = 72,
  shape = 'card',
  focus = 'center',
}: {
  character: string
  instance?: string
  /** The character's LOOK text, if the bridge has read it. */
  look?: string
  race?: string
  sex?: 'male' | 'female'
  size?: number
  /** Radar uses an oval face crop inside its oval dashboard; other portrait
   * pickers retain the full rectangular character card. */
  shape?: 'card' | 'oval'
  /** Generated portraits include shoulders and clothing. The radar needs the
   * face to remain visible as its frame scales down. */
  focus?: 'center' | 'face'
}) {
  const [ready, setReady] = useState(false)
  const [picking, setPicking] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [customUrl, setCustomUrl] = useState<string | null>(null)
  const [editingCustom, setEditingCustom] = useState(false)
  const [customError, setCustomError] = useState('')
  const dialogRef = useModalDialog(() => setPicking(false), picking)

  useEffect(() => {
    void loadPortraitManifest().then(() => setReady(true))
  }, [])
  useEffect(() => {
    let current = true
    void readCustomPortrait(character, instance).then((url) => { if (current) setCustomUrl(url) }).catch((error) => { if (current) setCustomError(String(error)) })
    return () => { current = false }
  }, [character, instance])

  const suggested = ready ? portraitFor({ character, instance, look, race, sex }) : genericPortraitFor(character)
  const key = chosen ?? suggested ?? genericPortraitFor(character)
  const emergencyKey = key === 'human-male' ? 'human-female' : 'human-male'
  const displayKey = failed ? emergencyKey : key
  const displayDescription = customUrl && !failed
    ? `${character}, local custom portrait`
    : `${character}, ${sex ? displayKey.replace(/-/g, ' ') : `${race ?? 'generic'} portrait, gender unknown`}`
  // catalogue() has a shipped-core baseline. The chooser must work on the
  // first frame rather than becoming a dead button until an optional manifest
  // request finishes; `ready` only improves automatic matching above.
  const options = catalogue()

  const height = size
  const width = Math.round(size * 0.75)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setPicking((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={picking}
        title={`${customUrl && !failed ? 'Local custom portrait' : sex ? displayKey.replace(/-/g, ' ') : `${race ?? 'Generic'} default · gender not yet known`} — click to change`}
        className={`block overflow-hidden border border-border ${shape === 'oval' ? 'rounded-full ring-1 ring-info/30' : 'rounded-sm'}`}
        style={{ width, height }}
      >
        <img
          src={customUrl && !failed ? customUrl : portraitUrl(displayKey)}
          alt={displayDescription}
          onError={() => {
            if (!failed) setFailed(true)
          }}
          // `object-position` alone cannot make a full-body race default read
          // as a face inside the radar's small oval. Zoom the source around
          // its upper centre for that one use; card portraits and the chooser
          // still show the complete authored image.
          className={`h-full w-full object-cover ${focus === 'face' && !customUrl ? 'object-[center_18%] origin-[50%_18%] scale-[1.72]' : ''}`}
        />
      </button>

      {picking && options.length > 0 && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="presentation" data-gameplay-shortcuts="suspend">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setPicking(false)}
            aria-label="Close portrait chooser"
          />
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="portrait-chooser-title"
            tabIndex={-1}
            className="relative z-10 flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-info/45 bg-surface-overlay shadow-2xl"
          >
            <header className="flex items-center gap-2 border-b border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <h2 id="portrait-chooser-title" className="text-sm font-semibold text-ink">Choose {character}'s portrait</h2>
                <p className="text-xs text-ink-muted">Your choice is saved for this character and overrides the automatic default.</p>
              </div>
              <button type="button" onClick={() => setPicking(false)} className="rounded border border-border px-2 py-1 text-xs text-ink-muted hover:border-accent hover:text-ink">Close</button>
            </header>
            {editingCustom ? <CustomPortraitEditor character={character} instance={instance} initialUrl={customUrl} onCancel={() => setEditingCustom(false)} onSaved={(url) => { setCustomUrl(url); setFailed(false); setEditingCustom(false); setPicking(false) }} /> : <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <button type="button" onClick={() => setEditingCustom(true)} className="rounded border border-info/50 px-2 py-1 text-xs text-info hover:bg-info/10">{customUrl ? 'Replace or re-crop your image' : 'Choose your own image'}</button>
              {customUrl && <button type="button" onClick={() => void removeCustomPortrait(character, instance).then(() => { setCustomUrl(null); setFailed(false) }).catch((error) => setCustomError(String(error)))} className="rounded border border-danger/40 px-2 py-1 text-xs text-danger">Remove local image</button>}
              <button type="button" onClick={() => void removeCustomPortrait(character, instance).then(() => { resetChoice(character, instance); setCustomUrl(null); setChosen(null); setFailed(false) }).catch((error) => setCustomError(String(error)))} className="rounded border border-border px-2 py-1 text-xs text-ink-muted">Reset to automatic default</button>
            </div>
            {customError && <p role="alert" className="mx-3 mt-2 text-xs text-danger">{customError}</p>}
            <p className="px-3 pt-2 text-xs text-ink-muted">Local images stay private on this machine. Public community portraits still require a separate reviewed GitHub submission.</p>
            <div {...scrollableRegionProps('Available portraits')} className="grid min-h-0 flex-1 grid-cols-4 gap-2 overflow-y-auto p-3 sm:grid-cols-6">
              {options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => {
                    choose(character, instance, o.key)
                    setChosen(o.key)
                    setFailed(false)
                    setPicking(false)
                  }}
                  title={`Use ${o.race} ${o.sex}`}
                  aria-pressed={o.key === displayKey}
                  className={cn(
                    'overflow-hidden rounded-lg border bg-surface-raised p-1 text-left',
                    o.key === displayKey ? 'border-accent ring-1 ring-accent/50' : 'border-border hover:border-info'
                  )}
                >
                  <img
                    src={portraitUrl(o.key)}
                    alt={`${o.race} ${o.sex}`}
                    className="aspect-[3/4] w-full rounded object-cover object-top"
                  />
                  <span className="mt-1 block truncate text-xs capitalize text-ink-muted">{o.race}</span>
                  <span className="block text-xs capitalize text-ink-faint">{o.sex}</span>
                </button>
              ))}
            </div>
            </>}
          </section>
        </div>,
        document.body,
      )}
    </div>
  )
}
