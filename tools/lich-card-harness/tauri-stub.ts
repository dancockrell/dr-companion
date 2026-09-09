/**
 * The one module the harness fakes: the Rust boundary.
 *
 * Aliased in place of `src/lib/tauri.ts` by `vite.harness.config.ts`, and only
 * there. Everything else the card imports is the real thing.
 *
 * An unexpected command throws rather than returning a plausible empty value.
 * A stub that answers everything would let the card render a state built out
 * of the stub's own defaults, and a screenshot of that is a photograph of the
 * fixture rather than of the app.
 */
import { STATES } from './states.ts'

const slug = new URLSearchParams(location.search).get('state') ?? STATES[0].slug
const state = STATES.find((s) => s.slug === slug)

export function isTauri(): boolean {
  return true
}

export async function invokeTauri(cmd: string): Promise<unknown> {
  if (!state) throw new Error(`no such harness state: ${slug}`)
  if (cmd === 'lich_status') return state.status
  if (cmd === 'lich_health') {
    if (!state.health) throw new Error(`state ${slug} has no health answer`)
    return state.health
  }
  throw new Error(`harness stub: unexpected command ${cmd}`)
}

/**
 * Present because `src/lib/tauri.ts` exports it and something the card pulls
 * in transitively may reach for it. It throws for the same reason as above.
 */
export function tauriUnavailable(): never {
  throw new Error('harness stub: tauriUnavailable')
}
