import { useSyncExternalStore } from 'react'
import { writeText, type StorageWriteResult } from './storage.ts'

export type SkinId = 'elanthian-bronze' | 'moonlit-iron' | 'ember-court'

export interface Skin {
  id: SkinId
  name: string
  description: string
  swatches: readonly [string, string, string]
}

export const SKINS: readonly Skin[] = [
  {
    id: 'elanthian-bronze',
    name: 'Elanthian Bronze',
    description: 'Dark parchment, aged bronze and warm lamplight.',
    swatches: ['#0d0c0a', '#211d16', '#d4a84b'],
  },
  {
    id: 'moonlit-iron',
    name: 'Moonlit Iron',
    description: 'Cool forge iron with a restrained silver-blue glow.',
    swatches: ['#090d12', '#17212b', '#9eb9c9'],
  },
  {
    id: 'ember-court',
    name: 'Ember Court',
    description: 'Oxblood leather, old gold and banked fire.',
    swatches: ['#100a09', '#271613', '#d49a4a'],
  },
] as const

const KEY = 'drc.skin.v1'
const CHANGED = 'drc-skin-change'
const DEFAULT: SkinId = 'elanthian-bronze'
const ids = new Set<SkinId>(SKINS.map((skin) => skin.id))

function read(): SkinId {
  if (typeof localStorage === 'undefined') return DEFAULT
  try {
    const value = localStorage.getItem(KEY)
    return value && ids.has(value as SkinId) ? value as SkinId : DEFAULT
  } catch {
    return DEFAULT
  }
}

let current: SkinId = DEFAULT

function apply(id: SkinId) {
  current = id
  if (typeof document !== 'undefined') document.documentElement.dataset.skin = id
}

/** Apply before React renders, so the window never flashes through another skin. */
export function initSkin(): SkinId {
  apply(read())
  return current
}

export function setSkin(id: SkinId): StorageWriteResult {
  apply(ids.has(id) ? id : DEFAULT)
  const result = writeText(KEY, current)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED))
  return result
}

function subscribe(notify: () => void) {
  if (typeof window === 'undefined') return () => undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return
    apply(read())
    notify()
  }
  // A local selection is already applied even if persistence failed. Only
  // notify React here; do not reread storage and silently undo the session.
  const onLocalChange = () => notify()
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGED, onLocalChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGED, onLocalChange)
  }
}

export function useSkin(): SkinId {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT)
}
