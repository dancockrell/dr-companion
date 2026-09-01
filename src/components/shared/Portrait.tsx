import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import { catalogue, choose, loadPortraitManifest, portraitFor, portraitUrl } from '../../lib/portraits'

/**
 * The character's face.
 *
 * Filled in this order: what the player chose, then what their LOOK suggests,
 * then race and sex alone. The generated set is one face per race per sex,
 * which is a starting point rather than a likeness — nobody's character is the
 * default Elf — so changing it is one click and uploading your own stays the
 * better answer.
 *
 * Until the pack exists it draws the race initial rather than a grey
 * rectangle, because an empty box reads as broken and a letter reads as
 * waiting.
 */
export function Portrait({
  character,
  look,
  race,
  sex,
  size = 72,
  shape = 'card',
  focus = 'center',
}: {
  character: string
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

  useEffect(() => {
    void loadPortraitManifest().then(() => setReady(true))
  }, [])

  const key = chosen ?? (ready ? portraitFor({ character, look, race, sex }) : null)
  const options = ready ? catalogue() : []

  const height = size
  const width = Math.round(size * 0.75)

  if (!key || failed) {
    return (
      <div
        style={{ width, height }}
        className={`flex shrink-0 items-center justify-center border border-border bg-surface-overlay text-sm text-ink-faint ${shape === 'oval' ? 'rounded-full' : 'rounded-sm'}`}
        title={ready ? 'No portrait for this race yet' : 'Looking for portraits'}
      >
        {(race ?? character).charAt(0).toUpperCase()}
      </div>
    )
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setPicking((v) => !v)}
        title={`${key.replace(/-/g, ' ')} — click to change`}
        className={`block overflow-hidden border border-border ${shape === 'oval' ? 'rounded-full ring-1 ring-info/30' : 'rounded-sm'}`}
        style={{ width, height }}
      >
        <img
          src={portraitUrl(key)}
          alt={`${character}, ${key.replace(/-/g, ' ')}`}
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover ${focus === 'face' ? 'object-[center_18%]' : ''}`}
        />
      </button>

      {picking && options.length > 0 && (
        <div className="absolute left-0 top-full z-40 mt-1 grid max-h-56 w-56 grid-cols-4 gap-1 overflow-auto rounded border border-border bg-surface-overlay p-1 shadow-lg">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                choose(character, o.key)
                setChosen(o.key)
                setPicking(false)
              }}
              title={`${o.race} ${o.sex}`}
              className={cn(
                'overflow-hidden rounded-sm border',
                o.key === key ? 'border-accent' : 'border-transparent hover:border-ink-faint'
              )}
            >
              <img
                src={portraitUrl(o.key)}
                alt={`${o.race} ${o.sex}`}
                className="h-12 w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
