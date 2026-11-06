import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import { App } from './App'
import { runBootGuards } from './boot/guards'
import { initPwa } from './pwa'

// Boot guards first (a framed copy is refused before anything renders).
if (runBootGuards()) {
  initPwa()
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root')
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
