/**
 * The scene editor: what one room looks like, and how to disagree with it.
 *
 * `tools/build-world-content.mjs` classified all 17,750 rooms from the
 * cartography. It is right about most of them, unsure about 86, and has no way
 * to be told when it is wrong. This panel is that way. It shows the room the
 * character is standing in - or any room found through the same place search
 * the map uses - as the viewer will draw it, and lets a person change each
 * field.
 *
 * Everything it offers comes from `sceneOptions()`, which is compiled from
 * `godot/scripts/shared_asset_content.gd` by `tools/build-scene-registry.mjs`.
 * There is no list of kinds in this file, and there must never be one: a
 * dropdown entry the viewer has no factory for renders as
 * `content_registry.gd`'s deliberately-wrong placeholder box, which a player
 * reads as the editor being broken rather than as their choice having no art.
 *
 * Every field says where its value came from - the batch, or you - and offers
 * "reset" only when there is something to reset. Reset deletes the override
 * rather than writing the batch's answer into it, so a later pipeline run that
 * improves that room can still reach it.
 *
 * Two things below the fields make the 86 a job rather than a statistic.
 * `Coverage` lists this zone's unclassified rooms and opens each one here, so
 * the residue is a list somebody can work through. `Transfer` exports the whole
 * set as the JSON `tools/build-world-content.mjs` reads back as its first rule,
 * so working through it is not thrown away by the next `npm run world:build`.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '../../store/useAppStore.ts'
import { PlaceSearch } from './PlaceSearch.tsx'
import { ScenePrimitivePicker } from './ScenePrimitivePicker.tsx'
import { loadWorldContent, type RoomContent } from '../../lib/worldContent.ts'
import {
  exportSceneOverrides,
  importSceneOverrides,
  loadSceneOverrides,
  resolveScene,
  saveSceneOverrides,
  sceneOptions,
  setSceneField,
  resetSceneField,
  subscribeSceneOverrides,
  type PlacedPrimitive,
  type SceneField,
  type SceneImportResult,
  type ResolvedScene,
} from '../../lib/sceneOverrides.ts'

const OPTIONS = sceneOptions()

/** Where the panel is pointed. The character's room unless a search moved it. */
interface Target {
  zone: string
  room: number
  title: string
}

export function ScenePanel() {
  const mapZone = useAppStore((s) => s.mapZone)
  const mapHere = useAppStore((s) => s.mapHere)
  const [picked, setPicked] = useState<Target | null>(null)
  const [content, setContent] = useState<Map<number, RoomContent> | null>(null)
  const [contentZone, setContentZone] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)

  const followed: Target | null =
    mapZone?.zone && mapHere?.id != null
      ? {
          zone: mapZone.zone,
          room: mapHere.id,
          title: mapZone.rooms?.find((r) => r.id === mapHere.id)?.title ?? '',
        }
      : null

  // The search wins until it is cleared, so walking around does not yank the
  // panel off the room somebody is in the middle of editing.
  const target = picked ?? followed
  const targetZone = target?.zone ?? null
  const targetRoom = target?.room ?? null

  useEffect(() => {
    let live = true
    if (!targetZone) return
    void loadWorldContent(targetZone).then((loaded) => {
      if (!live) return
      setContent(loaded)
      setContentZone(targetZone)
    })
    return () => {
      live = false
    }
  }, [targetZone])

  // The store itself, not a revision counter: `loadSceneOverrides` holds the
  // parsed object between edits, so this is a stable identity that changes
  // exactly when somebody edits something - here or in a popped-out copy of
  // this panel, which reaches us through the `storage` event.
  const overrides = useSyncExternalStore(subscribeSceneOverrides, loadSceneOverrides, loadSceneOverrides)

  const roomId = targetZone && targetRoom != null ? `${targetZone}-${targetRoom}` : null
  const scene: ResolvedScene | null = useMemo(() => {
    if (!roomId || targetRoom == null) return null
    // The batch's answer only when the loaded zone is this room's zone. Reading
    // another zone's content by room number would be a confident wrong answer:
    // room ids are not unique across zones.
    const guess = contentZone === targetZone ? content?.get(targetRoom) ?? null : null
    return resolveScene(roomId, guess, overrides)
  }, [roomId, content, contentZone, targetRoom, targetZone, overrides])

  const set = (field: SceneField, value: unknown) => {
    if (!roomId) return
    const result = setSceneField(roomId, field, value)
    setRefused(result.ok ? null : result.reason)
  }

  const reset = (field: SceneField) => {
    if (!roomId) return
    resetSceneField(roomId, field)
    setRefused(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-sm text-ink" data-testid="scene-panel">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <PlaceSearch
            here={target?.zone}
            onPick={(hit) => setPicked({ zone: hit.zone, room: hit.room, title: hit.label })}
          />
        </div>
        {picked && (
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="rounded border border-border px-2 py-1 text-xs text-ink-muted hover:border-accent/60 hover:text-accent"
          >
            Follow me
          </button>
        )}
      </div>

      {!target && (
        <p className="text-xs text-ink-faint">
          No room yet. Connect, or search for a place above.
        </p>
      )}

      {target && scene && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto pr-1">
          <div>
            <p className="text-xs text-ink-faint" data-testid="scene-room">
              {target.zone}-{target.room}
              {target.title ? ` — ${target.title}` : ''}
            </p>
            {contentZone === target.zone && !content?.get(target.room) && (
              <p className="mt-1 text-xs text-ink-faint">
                The batch did not classify this room. Everything below is yours to set.
              </p>
            )}
          </div>

          <Choice
            label="Ground"
            testId="scene-ground"
            value={scene.ground}
            source={scene.sources.ground}
            options={OPTIONS.ground}
            onSet={(v) => set('ground', v)}
            onReset={() => reset('ground')}
            note="What the cell is made of. Changing it moves the block kind with it unless you set that too."
          />

          <Choice
            label="Block"
            testId="scene-block"
            value={scene.block}
            source={scene.sources.block}
            options={OPTIONS.block}
            onSet={(v) => set('block', v)}
            onReset={() => reset('block')}
            note={
              scene.classification.spatialMode === 'interior-cutaway'
                ? 'Drawn as a 3 m cutaway with a floor plane.'
                : 'Drawn as a 1 m block with terrain on top.'
            }
          />

          <Choice
            label="Landmark"
            testId="scene-landmark"
            value={scene.landmark ?? ''}
            source={scene.sources.landmark}
            options={OPTIONS.landmark}
            allowNone="No landmark"
            onSet={(v) => set('landmark', v === '' ? null : v)}
            onReset={() => reset('landmark')}
            note={
              OPTIONS.landmarksDrawn
                ? undefined
                : 'The viewer draws no landmarks yet: no content pack has registered one. This is carried on the snapshot and shown on the 2D map.'
            }
          />

          <ArtChoice
            value={scene.art}
            source={scene.sources.art}
            onSet={(v) => set('art', v)}
            onReset={() => reset('art')}
          />

          <ScenePrimitivePicker
            placeable={OPTIONS.placeable}
            placed={scene.primitives}
            source={scene.sources.primitives}
            onChange={(next: PlacedPrimitive[]) =>
              next.length === 0 ? reset('primitives') : set('primitives', next)
            }
            onReset={() => reset('primitives')}
          />

          {refused && (
            <p className="rounded border border-danger/50 bg-surface-overlay p-2 text-xs text-danger" role="alert">
              {refused}
            </p>
          )}

          <Coverage
            content={contentZone === target.zone ? content : null}
            zone={target.zone}
            current={target.room}
            onPick={(room) =>
              setPicked({
                zone: target.zone,
                room: room.id,
                // The map's title for it when this zone's cartography is
                // loaded, and nothing when it is not. An invented label on a
                // room nobody has classified is exactly the wrong place to
                // guess.
                title: mapZone?.rooms?.find((r) => r.id === room.id)?.title ?? '',
              })
            }
          />

          <Transfer />
        </div>
      )}
    </div>
  )
}

/**
 * The rooms in this zone the batch could not classify, as a work list.
 *
 * Derived from the zone's own content file rather than read from
 * `tools/world-content-residue.csv`. The CSV is the same fact written a second
 * time - the builder emits both from one pass - and a panel reading the CSV
 * would be a copy that goes stale the day somebody rebuilds the world without
 * committing it. `tools/scene-editor-test.mjs` holds the two to each other:
 * the rooms this rule selects, across every zone, must equal the CSV exactly.
 *
 * `rule` rather than `ground === 'unknown'`, and they are the same set today by
 * construction. `rule` is the one that stays right if a later pass ever gives
 * an unclassified room a fallback ground: the room would still be one nobody
 * decided, which is what this list is for.
 */
function Coverage({
  content,
  zone,
  current,
  onPick,
}: {
  content: Map<number, RoomContent> | null
  zone: string
  current: number
  onPick: (room: { id: number }) => void
}) {
  const rooms = useMemo(
    () => (content ? [...content.values()].filter((room) => room.rule === 'unknown').sort((a, b) => a.id - b.id) : []),
    [content]
  )

  if (!content) return null

  return (
    <details className="text-xs text-ink-faint" data-testid="scene-coverage">
      <summary className="cursor-pointer">
        Unclassified in this zone: <span data-testid="scene-coverage-count">{rooms.length}</span>
        {rooms.length === 0 ? ' — the batch has an answer for every room here.' : ''}
      </summary>
      {rooms.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {rooms.map((room) => (
            <li key={room.id}>
              <button
                type="button"
                data-scene-residue={room.id}
                onClick={() => onPick({ id: room.id })}
                className={`w-full truncate text-left underline hover:text-accent ${
                  room.id === current ? 'text-accent' : 'text-ink-muted'
                }`}
              >
                {zone}-{room.id}
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

/**
 * Export and import, as text rather than as a file dialog.
 *
 * A textarea is testable, works identically in the app and in a browser, and -
 * the reason that matters - lets a person *see* what they are about to send
 * somebody before they send it. The export is the shape
 * `tools/build-world-content.mjs` reads back as its first rule, so this is also
 * how a correction made here reaches the pipeline: paste it into
 * `data/scene-overrides.json` and the next `npm run world:build` keeps it.
 *
 * An import never overwrites a local choice. Somebody else's file arriving at a
 * machine whose owner has already decided is a conflict, and it is reported by
 * count rather than resolved silently in either direction.
 */
function Transfer() {
  const overrides = useSyncExternalStore(subscribeSceneOverrides, loadSceneOverrides, loadSceneOverrides)
  const [incoming, setIncoming] = useState('')
  const [result, setResult] = useState<SceneImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const text = useMemo(() => JSON.stringify(exportSceneOverrides(overrides), null, 2), [overrides])
  const rooms = Object.keys(overrides).length

  const doImport = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(incoming)
    } catch (e) {
      setResult(null)
      setError(`That is not JSON: ${(e as Error).message}`)
      return
    }
    const { result: outcome, merged } = importSceneOverrides(parsed, overrides)
    saveSceneOverrides(merged)
    setError(null)
    setResult(outcome)
  }

  return (
    <details className="text-xs text-ink-faint" data-testid="scene-transfer">
      <summary className="cursor-pointer">
        Export and import — <span data-testid="scene-export-count">{rooms}</span>{' '}
        {rooms === 1 ? 'room' : 'rooms'} decided here
      </summary>
      <textarea
        readOnly
        value={text}
        data-testid="scene-export"
        rows={5}
        className="mt-1 w-full rounded border border-border bg-surface-overlay p-1 font-mono text-xs text-ink"
      />
      <textarea
        value={incoming}
        onChange={(e) => setIncoming(e.target.value)}
        data-testid="scene-import-text"
        rows={3}
        placeholder="Paste somebody else's export here"
        className="mt-1 w-full rounded border border-border bg-surface-overlay p-1 font-mono text-xs text-ink"
      />
      <button
        type="button"
        onClick={doImport}
        data-testid="scene-import"
        className="mt-1 rounded border border-border px-2 py-1 text-ink-muted hover:border-accent/60 hover:text-accent"
      >
        Import
      </button>
      {error && (
        <p className="mt-1 text-danger" role="alert" data-testid="scene-import-error">
          {error}
        </p>
      )}
      {result && (
        <p className="mt-1" data-testid="scene-import-result">
          Took {result.added}, already had {result.unchanged}, kept mine over {result.conflicts.length}
          {result.undrawable > 0 ? `, refused ${result.undrawable} this build cannot draw` : ''}.
        </p>
      )}
    </details>
  )
}

function SourceTag({ source }: { source: 'guess' | 'override' | 'none' }) {
  if (source === 'override') return <span className="text-accent">yours</span>
  if (source === 'guess') return <span className="text-ink-faint">from the batch</span>
  return <span className="text-ink-faint">not set</span>
}

function Choice({
  label,
  testId,
  value,
  source,
  options,
  allowNone,
  note,
  onSet,
  onReset,
}: {
  label: string
  testId: string
  value: string
  source: 'guess' | 'override' | 'none'
  options: string[]
  allowNone?: string
  note?: string
  onSet: (value: string) => void
  onReset: () => void
}) {
  return (
    <label className="block text-xs text-ink-faint">
      <span className="flex items-center justify-between gap-2">
        <span>
          {label} · <SourceTag source={source} />
        </span>
        {source === 'override' && (
          <button
            type="button"
            onClick={onReset}
            data-testid={`${testId}-reset`}
            className="text-ink-muted underline hover:text-accent"
          >
            reset to guess
          </button>
        )}
      </span>
      <select
        value={value}
        data-testid={testId}
        onChange={(e) => onSet(e.target.value)}
        className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-sm text-ink"
      >
        {allowNone !== undefined && <option value="">{allowNone}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {note && <span className="mt-1 block text-ink-faint">{note}</span>}
    </label>
  )
}

/**
 * The 2D backdrop, which is a different kind of choice from the three above:
 * the value is an image, so a dropdown of file names would be unreviewable. A
 * grid of the actual pictures is the only honest form of this control.
 *
 * `docs/SCENE_ART.md` calls this tier 1, "curated landmark / published
 * override", and until now nothing wrote to that tier - the pipeline could only
 * be edited by regenerating it. This is its writer.
 */
function ArtChoice({
  value,
  source,
  onSet,
  onReset,
}: {
  value: string | null
  source: 'guess' | 'override' | 'none'
  onSet: (value: string) => void
  onReset: () => void
}) {
  return (
    <div className="text-xs text-ink-faint">
      <span className="flex items-center justify-between gap-2">
        <span>
          Backdrop · <SourceTag source={source} />
        </span>
        {source === 'override' && (
          <button
            type="button"
            onClick={onReset}
            data-testid="scene-art-reset"
            className="text-ink-muted underline hover:text-accent"
          >
            reset to guess
          </button>
        )}
      </span>
      <div className="mt-1 grid grid-cols-3 gap-1" data-testid="scene-art">
        {OPTIONS.art.map((url) => (
          <button
            key={url}
            type="button"
            title={url}
            onClick={() => onSet(url)}
            data-scene-art={url}
            className={`overflow-hidden rounded border ${url === value ? 'border-accent' : 'border-border'}`}
          >
            <img src={url} alt="" loading="lazy" className="h-12 w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}
