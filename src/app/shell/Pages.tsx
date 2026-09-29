import { BUILD_SHA } from '../boot/build-info'
import { content } from '@content/load'
import { formatMinor } from '@domain/money'
import type { PersonaId } from '@domain/types'
import { parsePaymentUri } from '@domain/uri'
import { fill, ui } from '../copy'
import { persona } from '../format'
import { Overline, SectionTitle } from '../kit/Overline'
import { Wordmark } from '../kit/Wordmark'
import { useUpdateReady } from '../pwa'

// Start (branded landing), About (product description), the #/pay landing and not-found.

function Pillars({ onNavy = false, four = true }: { onNavy?: boolean; four?: boolean }) {
  return (
    <ul
      className={`grid grid-cols-1 gap-px sm:grid-cols-2 ${four ? 'lg:grid-cols-4' : ''} ${onNavy ? 'bg-navy-700' : 'bg-line-200'}`}
    >
      {ui.pillars.map((p) => (
        <li key={p.title} className={`p-5 ${onNavy ? 'bg-navy-900' : 'bg-surface'}`}>
          <span aria-hidden="true" className={`block h-[3px] w-6 ${onNavy ? 'bg-green-500' : 'bg-green-600'}`} />
          <p className={`mt-3 font-display text-title ${onNavy ? 'text-white' : 'text-navy-900'}`}>{p.title}</p>
          <p className={`mt-1 font-body text-body ${onNavy ? 'text-muted-navy' : 'text-ink'}`}>{p.body}</p>
        </li>
      ))}
    </ul>
  )
}

export function StartPage() {
  const update = useUpdateReady()
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
        <div className="mx-auto max-w-5xl px-5 pt-12 pb-14 sm:px-8 sm:pt-20">
          <Wordmark className="text-5xl" />
          <p className="mt-8 font-body text-overline uppercase text-green-500">{ui.start.overline}</p>
          <h1 className="mt-3 max-w-3xl font-display text-[40px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[56px]">
            {ui.start.headline}
          </h1>
          <p className="mt-5 max-w-2xl font-body text-body-l text-muted-navy">{ui.start.lede}</p>
        </div>
      </section>
      <section className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <Overline bar>{ui.start.pillarsLabel}</Overline>
        <div className="mt-4">
          <Pillars />
        </div>
      </section>
      <footer className="mx-auto flex max-w-5xl items-center justify-between border-t border-line-200 px-5 py-6 sm:px-8">
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
    <div className="min-h-dvh bg-bg">
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
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <h1 className="font-display text-display-l text-navy-900">{ui.about.title}</h1>
        <p className="mt-4 font-body text-body-l text-ink">{ui.about.intro}</p>
        <p className="mt-2 font-body text-body-l text-ink">{ui.about.simple}</p>

        <section className="mt-10">
          <SectionTitle>{ui.about.pillarsTitle}</SectionTitle>
          <div className="mt-4">
            <Pillars four={false} />
          </div>
        </section>

        <section className="mt-10">
          <SectionTitle>{ui.about.feesTitle}</SectionTitle>
          <ul className="mt-4 border-t border-line-200">
            {ui.about.fees.map((f) => (
              <li key={f} className="flex gap-3 border-b border-line-200 py-3 font-body text-body text-ink">
                <span aria-hidden="true" className="mt-2 inline-block size-2 shrink-0 bg-green-600" />
                {f}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <SectionTitle>{ui.about.privacyTitle}</SectionTitle>
          <p className="mt-4 font-body text-body text-ink">{ui.common.privacy}</p>
        </section>

        <section className="mt-10">
          <SectionTitle>{ui.about.safetyTitle}</SectionTitle>
          <p className="mt-4 border-l-4 border-green-600 bg-surface px-4 py-3 font-body text-body text-ink">
            {ui.about.safety}
          </p>
        </section>

        <p className="mt-12 font-mono text-mono text-grey-600">{fill(ui.about.build, { sha: BUILD_SHA })}</p>
      </main>
    </div>
  )
}

export function PayLanding() {
  const parsed = parsePaymentUri(location.href)
  const to = parsed.ok ? content.personas.personas.find((p) => p.handle === parsed.value.to) : undefined
  const name = to ? (persona(to.id as PersonaId)?.displayName ?? to.handle) : parsed.ok ? parsed.value.to : ''
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="on-navy bg-navy-900 px-5 py-4 text-white">
        <Wordmark className="text-2xl" />
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-10">
        <Overline bar>{ui.pay.title}</Overline>
        {parsed.ok ? (
          <>
            <p className="mt-4 font-display text-title text-navy-900">{ui.pay.body}</p>
            <dl className="mt-5 border-t border-line-200">
              <div className="flex justify-between border-b border-line-200 py-3 font-body text-body">
                <dt className="text-grey-600">{ui.pay.to}</dt>
                <dd className="text-ink">{name}</dd>
              </div>
              {parsed.value.amount !== undefined && (
                <div className="flex justify-between border-b border-line-200 py-3 font-body text-body">
                  <dt className="text-grey-600">{ui.pay.amount}</dt>
                  <dd className="text-ink tnum">
                    {formatMinor(parsed.value.amount)} {ui.common.bcps}
                  </dd>
                </div>
              )}
            </dl>
          </>
        ) : (
          <p className="mt-4 font-display text-title text-navy-900">{ui.pay.invalid}</p>
        )}
        <a
          href="#/"
          className="mt-8 inline-flex h-13 items-center gap-3 bg-navy-900 px-6 font-display text-button text-white"
        >
          <span aria-hidden="true" className="inline-block size-2.5 bg-green-500" />
          {ui.pay.open}
        </a>
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
