import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initTypeScale } from './lib/typeScale'
import App from './App.tsx'

// Before the first render, so a scaled interface does not visibly reflow.
initTypeScale()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
