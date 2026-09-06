import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initTypeScale } from './lib/typeScale.ts'
import { loadArtManifest } from './lib/creatureArt.ts'
import { loadPlayerArtManifest } from './lib/playerArt.ts'
import { loadNpcDefaultManifest, loadBulkNpcManifest } from './lib/npcDefaults.ts'
import { loadPortraitManifest } from './lib/portraits.ts'
import { installBridgePauseRelay } from './lib/bridgePauseRelay.ts'
import { installLinkReplay } from './lib/linkReplay.ts'
import App from './App.tsx'

// Before the first render, so a scaled interface does not visibly reflow.
initTypeScale()

// Not awaited. Cards draw silhouettes until this lands, and until the art pack
// is installed it never lands, which is the ordinary case rather than a fault.
void loadArtManifest()
// Separate manifest, separate fetch — see playerArt.ts's own header for why
// it must never be folded into the creature one.
void loadPlayerArtManifest()
void loadNpcDefaultManifest()
// The bulk GPU-rendered fallback pool — see npcDefaults.ts's own doc
// comment for why it is always asked second, never first.
void loadBulkNpcManifest()
void loadPortraitManifest()

// Pause has a second half the Rust lane cannot reach - travel and script
// starts happen inside Lich, never in `command_gate` - so the bridge has to
// hear it too. Subscribed once per window here rather than at each button, so
// a new caller of `requestPauseAll` cannot forget it. See bridgePauseRelay.ts
// and issue #462.
installBridgePauseRelay()

// Lich replays only part of the state on a reconnect, and up to ten seconds
// late. Room, occupants, roundtime and the script list are not in that replay
// at all, so they would go on reading as current while describing the session
// before the drop. Subscribed once per window, same as Pause above, so a
// window that reconnects always asks for the rest. See linkReplay.ts and
// issue #479.
installLinkReplay()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
