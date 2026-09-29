import { useEffect } from 'react'
import { parseHash, useHash } from './router'
import { ui } from './copy'
import { AboutPage, NotFoundPage, PayLanding, StartPage } from './shell/Pages'

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
    case 'start':
      return <StartPage />
    case 'about':
      return <AboutPage />
    case 'pay':
      return <PayLanding />
    case 'notFound':
      return <NotFoundPage />
  }
}
