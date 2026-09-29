import { ui } from '../copy'
import { openTarget } from '../router'
import { Wordmark } from '../kit/Wordmark'
import { useUpdateReady } from '../pwa'
import { AboutContent } from './AboutContent'
import { useViewport } from './useViewport'

// The pages outside the phones: the landing, About BCPS and the not-found page.

const BUTTON_ON_NAVY =
  'inline-flex h-13 items-center bg-white px-6 font-display text-button text-navy-900 hover:bg-line-100'

export function LandingPage() {
  const update = useUpdateReady()
  const { w, h } = useViewport()
  return (
    <div className="min-h-dvh bg-bg">
      {update.ready && (
        <div
          role="status"
          className="on-navy flex items-center justify-center gap-4 border-b border-navy-700 bg-navy-800 px-5 py-2 font-body text-body-s text-white"
        >
          {ui.start.updateReady}
          <button
            type="button"
            onClick={update.apply}
            className="inline-flex h-9 items-center font-display text-button text-green-500"
          >
            {ui.start.updateApply}
          </button>
        </div>
      )}
      <section className="on-navy bg-navy-900 text-white">
        <div className="mx-auto max-w-[1280px] px-6 pt-10 pb-16 sm:px-12 lg:px-24 lg:pb-[88px]">
          <Wordmark className="text-[28px]" />
          <p className="mt-24 font-body text-overline font-medium uppercase text-green-500 lg:mt-[100px]">
            {ui.start.overline}
          </p>
          <span aria-hidden="true" className="mt-2 block h-[3px] w-6 bg-green-500" />
          <h1 className="mt-6 max-w-4xl font-display text-[40px] leading-[1.06] font-semibold tracking-[-0.02em] sm:text-[56px] lg:text-[64px] lg:leading-[68px]">
            {ui.start.headline}
          </h1>
          <p className="mt-4 max-w-2xl font-body text-[20px] leading-7 text-line-300">{ui.start.lede}</p>
          <a href={openTarget(w, h)} data-testid="open-bcps" className={`${BUTTON_ON_NAVY} mt-9`}>
            {ui.start.open}
          </a>
        </div>
      </section>
      <section className="mx-auto max-w-[1280px] px-6 pt-12 pb-8 sm:px-12 lg:px-24">
        <ul className="grid grid-cols-1 gap-x-7 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {ui.pillars.map((p) => (
            <li key={p.title} className="border-t-[3px] border-green-600 pt-4">
              <p className="font-display text-[24px] leading-[30px] font-semibold text-navy-900">{p.title}</p>
              <p className="mt-2 font-body text-body text-ink">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>
      <footer className="mx-auto flex max-w-[1280px] items-center justify-between border-t border-line-200 px-6 py-6 sm:px-12 lg:px-24">
        <Wordmark className="text-lg text-navy-900" />
        <a href="#/about" className="inline-flex h-12 items-center font-body text-body text-green-700 underline">
          {ui.common.about}
        </a>
      </footer>
    </div>
  )
}

export function AboutPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="on-navy bg-navy-900 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 sm:px-8">
          <a href="#/" aria-label={ui.common.toStart} className="text-white">
            <Wordmark className="text-2xl" />
          </a>
          <a href="#/" className="inline-flex h-11 items-center font-body text-body-s text-muted-navy hover:text-white">
            {ui.common.back}
          </a>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-8 sm:px-8">
        <h1 className="font-display text-display-l text-navy-900">{ui.about.title}</h1>
        <AboutContent page />
      </main>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div data-testid="not-found" className="flex min-h-dvh flex-col bg-bg">
      <header className="on-navy bg-navy-900 px-5 py-4 text-white">
        <a href="#/" aria-label={ui.common.toStart} className="text-white">
          <Wordmark className="text-2xl" />
        </a>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-16">
        <h1 className="font-display text-display-m text-navy-900">{ui.notFound.title}</h1>
        <p className="mt-3 font-body text-body text-ink">{ui.notFound.body}</p>
        <a
          href="#/"
          className="mt-8 inline-flex h-13 items-center gap-3 bg-navy-900 px-6 font-display text-button text-white"
        >
          <span aria-hidden="true" className="inline-block size-2.5 bg-green-500" />
          {ui.notFound.home}
        </a>
      </main>
    </div>
  )
}
