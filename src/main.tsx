import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DevCubeView } from './ui/DevCubeView.tsx'

// Dev-only route for manually verifying the 3D renderer (PR-06 acceptance).
// Never reachable in a production build. Compared against BASE_URL so it
// works under the GitHub Pages base path (/cube-coach/dev) and at / in dev.
const isDevRoute =
  import.meta.env.DEV && window.location.pathname === `${import.meta.env.BASE_URL}dev`

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isDevRoute ? <DevCubeView /> : <App />}</StrictMode>,
)
