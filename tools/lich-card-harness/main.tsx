/**
 * The Lich card, rendered on its own so every state can be photographed.
 *
 * # Why this exists outside `src/`
 *
 * `LichLauncher` returns `null` when `isTauri()` is false, so a dev server in
 * a browser renders nothing at all, and which of its states you see is decided
 * by what `lich_status` reports about the machine you happen to be on - one
 * state out of six, on any given machine. Neither the app nor a browser can
 * show the other five.
 *
 * The alternative would have been a `?state=` parameter in the product, which
 * is test scaffolding shipped to players and is the mistake `tools/browser.mjs`
 * was built to stop making. So this lives here instead: `vite.harness.config.ts`
 * aliases the one module that reaches Rust, nothing under `src/` knows this
 * file exists, and what is rendered is the real component with the real
 * stylesheet, faking only the machine's answers.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { LichLauncher } from '../../src/components/shared/LichLauncher.tsx'
import { STATES } from './states.ts'

const slug = new URLSearchParams(location.search).get('state') ?? STATES[0].slug
const state = STATES.find((s) => s.slug === slug)
if (!state) {
  // Never render a default over an unknown name: a shot of the wrong state
  // filed under the right name is worse than no shot.
  document.title = `unknown state ${slug}`
  document.body.innerHTML = `<pre style="color:red">unknown state "${slug}"; known: ${STATES.map((s) => s.slug).join(', ')}</pre>`
} else {
  // The harness's own record of which state it is showing, read back by
  // `tools/lich-card-shots.mjs` so a shot cannot be filed under a name the
  // page was not actually rendering.
  document.title = `lich-card:${state.slug}`
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div className="p-4" style={{ width: 460 }}>
        <LichLauncher />
      </div>
    </StrictMode>,
  )
}
