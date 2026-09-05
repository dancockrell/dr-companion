/**
 * Elanthipedia, live - but only for a room the player asked to watch, and
 * never more than once a minute for the same room. Dan's own scoping, 30
 * Aug 2026: "live fetch on hover, fetch no more than every 1 minute. and
 * then only for rooms that the player chooses to WATCH CAREFULLY... This
 * is for rooms that need frequent updating for whatever reason, likely a
 * festival."
 *
 * The actual HTTP call lives in Rust (`src-tauri/src/elanthipedia.rs`) -
 * a browser fetch from this app's own origin to elanthipedia.play.net
 * would be blocked by CORS before it got an answer. This module is the
 * other half of the contract: the one-minute floor, enforced here rather
 * than in Rust, because "how often" is a product decision about how the
 * feature gets used, not a property of the wiki call itself.
 */
import { invokeTauri, isTauri } from './tauri.ts'

export interface ElanthipediaPage {
  found: boolean
  title: string
  extract: string
  imageUrl?: string
  pageUrl: string
  note: string
}

const MIN_INTERVAL_MS = 60_000

interface CacheEntry {
  fetchedAt: number
  page: ElanthipediaPage
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<ElanthipediaPage>>()

/**
 * The cached page for a title, or null if nothing has been fetched yet -
 * read-only, for a caller that wants to show what's already known without
 * triggering a fetch (the hover card shows a stale answer immediately,
 * then decides separately whether it's time to refresh it).
 */
export function cachedElanthipedia(title: string): { page: ElanthipediaPage; ageMs: number } | null {
  const entry = cache.get(title)
  if (!entry) return null
  return { page: entry.page, ageMs: Date.now() - entry.fetchedAt }
}

/**
 * Fetch a page, unless it was already fetched within the last minute - in
 * which case the cached answer comes back immediately, no request made.
 * `force` skips that floor for an explicit "refresh now" the player asks
 * for by hand, which is a deliberate single click rather than the kind of
 * repeated, automatic hover-driven traffic the floor exists to prevent.
 */
export async function fetchElanthipedia(title: string, force = false): Promise<ElanthipediaPage> {
  if (!isTauri()) {
    return {
      found: false,
      title,
      extract: '',
      pageUrl: '',
      note: 'Elanthipedia lookups only work in the desktop app - there is no way around browser CORS here.',
    }
  }

  const cached = cache.get(title)
  if (!force && cached && Date.now() - cached.fetchedAt < MIN_INTERVAL_MS) {
    return cached.page
  }

  // Two hovers landing close together must share one request, not fire two -
  // the floor above already stops repeats a minute apart; this stops
  // repeats a hundred milliseconds apart, while the first one is still out.
  const existing = inFlight.get(title)
  if (existing) return existing

  const promise = (async () => {
    try {
      const page = (await invokeTauri('fetch_elanthipedia', { title })) as ElanthipediaPage
      cache.set(title, { fetchedAt: Date.now(), page })
      return page
    } finally {
      inFlight.delete(title)
    }
  })()
  inFlight.set(title, promise)
  return promise
}
