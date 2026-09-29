import { useEffect } from 'react'
import { ui } from './copy'
import { parseHash, useHash } from './router'
import { AboutPage, LandingPage, NotFoundPage } from './shell/Pages'

export function App() {
  const route = parseHash(useHash())
  useEffect(() => {
    document.title = ui.app.title
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the top whenever the route changes
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route.name])
  switch (route.name) {
    case 'landing':
      return <LandingPage />
    case 'about':
      return <AboutPage />
    default:
      return <NotFoundPage />
  }
}
