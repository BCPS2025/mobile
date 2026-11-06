import { Suspense, lazy, useEffect } from 'react'
import { ui } from './copy'
import { parseHash, useHash } from './router'
import { AboutPage, LandingPage, NotFoundPage } from './shell/Pages'

// The two pages with phones load on demand: the landing page and About never create the ledger
// (so a tab showing them does not take the writer lock), and they stay small.
const StagePage = lazy(() => import('./shell/StagePage'))
const PhonePage = lazy(() => import('./shell/PhonePage'))
const PayPage = lazy(() => import('./shell/PayPage'))

const Waiting = () => <div className="min-h-dvh bg-navy-900" />

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
    case 'stage':
      return (
        <Suspense fallback={<Waiting />}>
          <StagePage />
        </Suspense>
      )
    case 'phone':
      return (
        <Suspense fallback={<Waiting />}>
          <PhonePage {...(route.persona !== undefined ? { persona: route.persona } : {})} />
        </Suspense>
      )
    case 'pay':
      // A payment link, request or code this browser knows opens its payment page; any other address opens phone mode.
      return (
        <Suspense fallback={<Waiting />}>
          <PayPage />
        </Suspense>
      )
    case 'notFound':
      return <NotFoundPage />
  }
}
