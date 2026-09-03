import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initTypeScale } from './lib/typeScale'
import App from './App.tsx'

// Before the first render, so a scaled interface does not visibly reflow.
initTypeScale()

// The five art-manifest preloads that used to run here are gone with the 2D
// art, and are deleted rather than made to throw.
//
// The distinction is deliberate and worth keeping straight: a *render* path
// that asks for a creature portrait is a real feature the rewrite still owes,
// so it fails loudly (see lib/removed2d.tsx). This was not that. It was
// bootstrapping a subsystem that no longer exists, and throwing here would
// brick the app at startup — which stops the rewrite rather than driving it.
//
// Loud where something is owed; silent where nothing is.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
