import { Banknote, Info } from 'lucide-react'
import { formatHundredths, formatMinor } from '@domain/money'
import { formatTime } from '@sim/tz'
import { bankOf, payoutsOf } from '@store/selectors'
import { useLedger } from '@store/useLedger'
import { fill, ui } from '../../copy'
import { dayText } from '../../format'
import { useApp } from '../../state/AppContext'
import { EmptyState } from '../chrome/EmptyState'
import { ListSection } from '../chrome/ListRow'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { DETAILS } from '../registry'

// Payout history (biz.payouts): what the business converted to euros. THIS WEEK is the last seven
// days (the euros, the number of payouts and the account they went to), then every conversion,
// newest first: the automatic ones of the week before and the cash-outs made here.

export function PayoutsView() {
  const app = useApp()
  const { persona, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const state = useLedger((s) => s)
  const now = app.runtime.node.now()
  const { rows, week } = payoutsOf(state, persona, now, tz)
  const bank = bankOf(app.content, persona) ?? ''
  return (
    <PhoneScreen
      id={DETAILS.payouts.screen}
      header="business"
      title={ui.payouts.title}
      businessName={app.persona(persona)?.displayName ?? ''}
      onBack={nav.back}
      onHome={nav.home}
    >
      {rows.length === 0 ? (
        <EmptyState icon={Info} title={ui.empty.filters.payouts.title} body={ui.empty.filters.payouts.body} />
      ) : (
        <div className="px-5 pt-3.5 pb-6">
          <p className="font-body text-caption font-medium uppercase tracking-[0.16em] text-grey-600">
            {ui.payouts.week}
          </p>
          <p data-testid="payouts-week" className="mt-1.5 font-display text-display-xl tnum text-navy-900">
            {fill(ui.payouts.weekEur, { eur: formatHundredths(week.eur) })}
          </p>
          <p data-testid="payouts-summary" className="mt-0.5 font-body text-body-s text-grey-600 tnum">
            {fill(week.count === 1 ? ui.payouts.summaryOne : ui.payouts.summary, { count: week.count, bank })}
          </p>
          <p data-testid="payouts-total" className="font-body text-body-s text-grey-600 tnum">
            {fill(ui.payouts.total, { amount: formatMinor(week.amount), fee: formatMinor(week.fee) })}
          </p>
          <ListSection>{ui.payouts.heading}</ListSection>
          <ul data-testid="payout-list">
            {rows.map((r) => (
              <li
                key={r.tx.id}
                data-testid={`payout-${r.tx.id}`}
                className="flex min-h-14 items-center gap-3 border-b border-line-100 py-2"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center bg-green-50 text-green-700"
                >
                  <Banknote size={20} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-body text-body font-semibold text-navy-900 tnum">
                    {fill(ui.payouts.rowDay, { day: dayText(r.date), time: formatTime(r.at, tz) })}
                  </span>
                  <span className="block truncate font-body text-caption text-grey-600 tnum">
                    {r.auto && r.sharePct !== undefined
                      ? fill(ui.payouts.rowAuto, { amount: formatMinor(r.amount), sharePct: r.sharePct })
                      : fill(ui.payouts.rowManual, { amount: formatMinor(r.amount) })}
                  </span>
                </span>
                <span className="shrink-0 font-body text-body font-semibold text-navy-900 tnum">
                  {fill(ui.payouts.rowEur, { eur: formatHundredths(r.eur) })}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 font-body text-body-s text-grey-600">{ui.payouts.included}</p>
        </div>
      )}
    </PhoneScreen>
  )
}
