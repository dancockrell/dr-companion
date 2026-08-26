import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initTypeScale } from './lib/typeScale'
import { loadArtManifest } from './lib/creatureArt'
import App from './App.tsx'

// Before the first render, so a scaled interface does not visibly reflow.
initTypeScale()

// Not awaited. Cards draw silhouettes until this lands, and until the art pack
// is installed it never lands, which is the ordinary case rather than a fault.
void loadArtManifest()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
