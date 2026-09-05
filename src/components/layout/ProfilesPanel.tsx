/**
 * Characters this app has seen, and their settings.
 *
 * The thing this replaces is sixty-one hand-copied if-blocks in a 930 KB text
 * file. So the two operations that file cannot do are the ones worth putting
 * on screen: switching happens by itself when the game says who you are, and
 * copying settings between characters is one click.
 *
 * See docs/DOMAIN.md section 18.
 */
import { Users, CopyPlus, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore.ts'
import { profilesByRecency, profileKey } from '../../lib/profiles.ts'
import { cityLabel, type HealCityId } from '../../data/healers.ts'

function when(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function ProfilesPanel() {
  const profiles = useAppStore((s) => s.profiles)
  const activeKey = useAppStore((s) => s.activeProfileKey)
  const copySettingsFrom = useAppStore((s) => s.copySettingsFrom)
  const deleteProfileByKey = useAppStore((s) => s.deleteProfileByKey)

  const list = profilesByRecency(profiles)

  if (list.length === 0) {
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
          Characters
        </h3>
        <p className="text-xs text-ink-faint leading-snug">
          No characters yet. One appears here the first time the bridge reports
          who you are, and its settings follow it from then on. You never have
          to declare a character before playing it.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
          Characters
        </h3>
        <span className="text-xs text-ink-faint flex items-center gap-1">
          <Users className="w-3 h-3" />
          {list.length}
        </span>
      </div>

      <div className="rounded-xl border border-border divide-y divide-border">
        {list.map((p) => {
          const key = profileKey(p.name, p.instance)
          const active = key === activeKey
          return (
            <div
              key={key}
              className={`px-3 py-2 space-y-1 ${active ? 'bg-accent/5' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-ink truncate flex items-center gap-1.5">
                  {active && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  )}
                  {p.name}
                </span>
                <span className="text-xs text-ink-faint shrink-0">
                  {p.instance} · {when(p.lastSeen)}
                </span>
              </div>

              <div className="text-xs text-ink-faint leading-snug">
                {p.guild ?? 'guild unknown'} · {p.accountTier}
                {p.preferredHealCity
                  ? ` · heals in ${cityLabel(p.preferredHealCity as HealCityId)}`
                  : ' · no heal city'}
                {p.trainFocus.length > 0 && ` · ${p.trainFocus.length} focus`}
                {p.huntFavorites.length > 0 &&
                  ` · ${p.huntFavorites.length} favourite grounds`}
              </div>

              {!active && (
                <div className="flex gap-1.5 pt-0.5">
                  <button
                    type="button"
                    className="text-xs flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-ink-muted hover:text-ink"
                    onClick={() => copySettingsFrom(key)}
                    title="Copy this character's settings onto the one you are playing"
                  >
                    <CopyPlus className="w-3 h-3" aria-hidden />
                    Copy settings to current
                  </button>
                  <button
                    type="button"
                    className="text-xs flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-ink-faint hover:text-danger"
                    onClick={() => {
                      if (confirm(`Delete ${p.name}? This drops their saved settings — heal city, train focus, hunt favourites — for good.`)) {
                        deleteProfileByKey(key)
                      }
                    }}
                    title="Delete this character" aria-label="Delete this character"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-ink-faint leading-snug">
        Settings on this screen belong to the character you are playing and
        switch with them. Interface mode and the bridge apply to the app.
      </p>
    </section>
  )
}
