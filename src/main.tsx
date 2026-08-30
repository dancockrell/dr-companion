import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initTypeScale } from './lib/typeScale'
import { loadArtManifest } from './lib/creatureArt'
import { loadPlayerArtManifest } from './lib/playerArt'
import { loadNpcDefaultManifest, loadBulkNpcManifest } from './lib/npcDefaults'
import { loadPortraitManifest } from './lib/portraits'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
