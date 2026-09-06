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
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '../../store/useAppStore.ts'
import { PlaceSearch } from './PlaceSearch.tsx'
import { loadWorldContent, type RoomContent } from '../../lib/worldContent.ts'
import {
  loadSceneOverrides,
  resolveScene,
  sceneOptions,
  setSceneField,
  resetSceneField,
  subscribeSceneOverrides,
  type SceneField,
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

          {refused && (
            <p className="rounded border border-danger/50 bg-surface-overlay p-2 text-xs text-danger" role="alert">
              {refused}
            </p>
          )}
        </div>
      )}
    </div>
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
