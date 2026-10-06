import { Banknote, ChartColumn, Code, Download } from 'lucide-react'
import { useState } from 'react'
import { formatHundredths, formatMinor } from '@domain/money'
import type { PersonaId } from '@domain/types'
import { formatTime } from '@sim/tz'
import {
  type SaleRow,
  type SalesDashboard,
  type SalesDay,
  type SalesRange,
  payoutsOf,
  salesCsvFile,
  salesDashboard,
} from '@store/selectors'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { fill, ui } from '../../copy'
import { saveTextFile } from '../../download'
import { dayText, groupedInt, itemsText, partyLabel, txLabel } from '../../format'
import { PartyAvatar } from '../../kit/PartyAvatar'
import { useApp, useTransient } from '../../state/AppContext'
import { ListSection } from '../chrome/ListRow'
import { PlannedBadge } from '../chrome/PlannedBadge'
import { Segmented } from '../chrome/Segmented'
import { DoneTag } from '../chrome/Tag'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'

// What the café sells (pos.sales): a Today | 7 days switch, SALES / GROSS / FEES / NET, and then
// either today's sales (the ones made now, then the seeded "Today so far" row) or the last seven
// days as a chart, the conversions to euros in them, Export CSV and the accounting integration
// that is planned. Every figure comes from the ledger.

const RANGES: readonly SalesRange[] = ['today', '7d']
const rangeLabel: Record<SalesRange, string> = { today: ui.sales.today, '7d': ui.sales.week }

function Kpi({
  label,
  value,
  accent = false,
  testId,
}: {
  label: string
  value: string
  accent?: boolean
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      className={`border border-t-[3px] border-line-200 bg-surface px-3 py-2.5 ${accent ? 'border-t-green-600' : 'border-t-navy-900'}`}
    >
      <p className="font-body text-[12px] leading-4 font-medium tracking-[0.16em] text-grey-600">{label}</p>
      <p className="mt-0.5 font-display text-[24px] leading-[30px] font-semibold tnum text-navy-900">{value}</p>
    </div>
  )
}

function Tiles({ dash }: { dash: SalesDashboard }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2" data-testid="sales-kpis">
      <Kpi testId="kpi-sales" label={ui.sales.kpiSales} value={groupedInt(dash.sales)} />
      <Kpi testId="kpi-gross" label={ui.sales.kpiGross} value={formatMinor(dash.gross)} />
      <Kpi testId="kpi-fees" label={ui.sales.kpiFees} value={formatMinor(dash.fees)} />
      <Kpi testId="kpi-net" label={ui.sales.kpiNet} value={formatMinor(dash.net)} accent />
    </div>
  )
}

// ---- today

function SaleListRow({ row, tz, persona }: { row: SaleRow; tz: string; persona: PersonaId }) {
  const nav = usePhoneNav()
  const time = formatTime(row.at, tz)
  const cls = 'flex min-h-[52px] w-full items-center gap-3 border-b border-line-100 py-1 text-left'
  const amount = (
    <span className="shrink-0 font-body text-body font-semibold text-navy-900 tnum">{formatMinor(row.gross)}</span>
  )
  if (row.kind === 'summary') {
    return (
      <div className={cls} data-testid="sales-summary">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center bg-green-50 text-green-700"
        >
          <ChartColumn size={20} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-body text-body font-semibold text-navy-900">
            {txLabel(row.tx, persona)}
          </span>
          <span className="block truncate font-body text-body-s text-grey-600">{time}</span>
        </span>
        {amount}
      </div>
    )
  }
  const who = row.payer ? partyLabel(row.payer) : ''
  const items = itemsText(row.tx.items)
  return (
    <button
      type="button"
      data-testid={`sale-${row.tx.id}`}
      onClick={() => nav.open({ kind: 'detail', id: 'tx' }, { txId: row.tx.id })}
      className={`${cls} active:bg-line-100`}
    >
      {row.payer && <PartyAvatar party={row.payer} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-body font-semibold text-navy-900">
          {row.tx.note ? fill(ui.tx.withNote, { label: who, note: row.tx.note }) : who}
        </span>
        <span className="block truncate font-body text-body-s text-grey-600">
          {items ? fill(ui.tx.withNote, { label: time, note: items }) : time}
        </span>
      </span>
      {row.refunded && <DoneTag>{ui.sales.refunded}</DoneTag>}
      {amount}
    </button>
  )
}

function TodayList({ dash, tz, persona }: { dash: SalesDashboard; tz: string; persona: PersonaId }) {
  return (
    <section aria-label={ui.sales.listHeading}>
      <ListSection>{ui.sales.listHeading}</ListSection>
      <ul data-testid="sales-list">
        {dash.rows.map((row) => (
          <li key={row.tx.id}>
            <SaleListRow row={row} tz={tz} persona={persona} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---- the last seven days

/** The tallest bar, in px; the labels sit above it. */
const BAR_MAX = 88

function Chart({ dash }: { dash: SalesDashboard }) {
  const [picked, setPicked] = useState<string | null>(null)
  const top = Math.max(0, ...dash.days.map((d) => d.gross))
  const barOf = (d: SalesDay): number => (top > 0 ? Math.round((d.gross / top) * BAR_MAX) : 0)
  const lineOf = (d: SalesDay): string =>
    d.closed
      ? fill(ui.sales.barClosed, { day: dayText(d.date) })
      : fill(ui.sales.barLine, { day: dayText(d.date), count: groupedInt(d.count), gross: formatMinor(d.gross) })
  const chosen = dash.days.find((d) => d.date === picked)
  return (
    <div data-testid="sales-chart" className="mt-3 border border-line-200 bg-surface px-3 pt-3 pb-2">
      <fieldset className="m-0 grid min-w-0 grid-cols-7 gap-2 border-0 border-b border-line-300 p-0">
        <legend className="sr-only">{ui.sales.chartLabel}</legend>
        {dash.days.map((d) => (
          <button
            key={d.date}
            type="button"
            data-testid={`bar-${d.date}`}
            aria-pressed={picked === d.date}
            aria-label={lineOf(d)}
            onClick={() => setPicked(picked === d.date ? null : d.date)}
            className="flex h-[120px] min-w-0 flex-col items-center justify-end"
          >
            <span aria-hidden="true" className="font-body text-[11px] leading-[14px] text-grey-600 tnum">
              {d.closed ? ui.sales.closed : groupedInt(Math.round(d.gross / 100))}
            </span>
            {d.closed ? (
              <span
                aria-hidden="true"
                className="mt-1 h-0.5 w-full max-w-[39px] border-t-2 border-dashed border-line-300"
              />
            ) : (
              <span
                aria-hidden="true"
                className={`mt-1 block w-full max-w-[39px] ${d.today ? 'bg-green-600' : 'bg-navy-700'}`}
                style={{ height: Math.max(barOf(d), d.gross > 0 ? 2 : 0) }}
              />
            )}
          </button>
        ))}
      </fieldset>
      <div aria-hidden="true" className="mt-1.5 grid grid-cols-7 gap-2">
        {dash.days.map((d) => (
          <span
            key={d.date}
            className={`text-center font-body text-[12px] leading-4 ${d.today ? 'font-semibold text-navy-900' : 'text-grey-600'}`}
          >
            {dayText(d.date).split(' ')[0]}
          </span>
        ))}
      </div>
      <div aria-live="polite">
        {chosen && (
          <p data-testid="bar-detail" className="pt-1.5 text-center font-body text-body-s text-grey-600 tnum">
            {lineOf(chosen)}
          </p>
        )}
      </div>
      <table className="sr-only">
        <caption>{ui.sales.chartLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{ui.sales.tableDay}</th>
            <th scope="col">{ui.sales.tableSales}</th>
            <th scope="col">{ui.sales.tableGross}</th>
          </tr>
        </thead>
        <tbody>
          {dash.days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{dayText(d.date)}</th>
              <td>{d.closed ? ui.sales.closed : d.count}</td>
              <td>{d.closed ? '' : formatMinor(d.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Conversions({ dash, tz, persona }: { dash: SalesDashboard; tz: string; persona: PersonaId }) {
  const node = useLedgerNode()
  const rows = useLedger((s) => payoutsOf(s, persona, node.now(), tz).rows).filter((r) => r.date >= dash.from)
  if (rows.length === 0) return null
  return (
    <section aria-label={ui.sales.conversions}>
      <ListSection>{ui.sales.conversions}</ListSection>
      <ul data-testid="sales-conversions">
        {rows.map((r) => (
          <li
            key={r.tx.id}
            className="flex min-h-[49px] items-center gap-3 border-b border-line-100 py-1"
            data-testid={`conversion-${r.tx.id}`}
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
              <span className="block truncate font-body text-body-s text-grey-600 tnum">
                {fill(ui.sales.conversionLine, { amount: formatMinor(r.amount) })}
              </span>
            </span>
            <span className="shrink-0 font-body text-body font-semibold text-navy-900 tnum">
              {fill(ui.payouts.rowEur, { eur: formatHundredths(r.eur) })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SalesSection({ persona }: { persona: PersonaId }) {
  const app = useApp()
  const { tz } = usePersonaPhone()
  const node = useLedgerNode()
  const range = useTransient((t) => t.salesRange[persona] ?? 'today')
  const state = useLedger((s) => s)
  const now = node.now()
  const dash = salesDashboard(state, persona, range, now, app.content)
  const exportCsv = () => {
    const file = salesCsvFile(state, persona, dash.rows, now, app.content)
    saveTextFile(file.fileName, file.text)
  }
  return (
    <div className="pt-2.5 pb-1" data-testid="sales">
      <Segmented
        group={ui.sales.rangeLabel}
        options={RANGES}
        value={range}
        label={(r) => rangeLabel[r]}
        onPick={(r) => app.actions.setSalesRange(persona, r)}
        testId="range"
      />
      <Tiles dash={dash} />
      {dash.refunds.amount > 0 && (
        <p data-testid="sales-refunds" className="mt-2 font-body text-body-s text-grey-600 tnum">
          {fill(ui.sales.refunds, { amount: formatMinor(dash.refunds.amount) })}
        </p>
      )}
      {range === 'today' ? (
        <TodayList dash={dash} tz={tz} persona={persona} />
      ) : (
        <>
          <Chart dash={dash} />
          <Conversions dash={dash} tz={tz} persona={persona} />
          <button
            type="button"
            data-testid="export-csv"
            onClick={exportCsv}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2.5 border border-line-300 bg-surface font-display text-[15px] font-semibold text-navy-900 active:bg-line-100"
          >
            <Download size={18} strokeWidth={1.75} aria-hidden="true" />
            {ui.sales.exportCsv}
          </button>
          <div
            data-testid="accounting-planned"
            className="flex min-h-[49px] items-center gap-3 border-b border-line-100 py-1"
          >
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center bg-green-50 text-green-700"
            >
              <Code size={20} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 truncate font-body text-body font-semibold text-navy-900">
              {ui.sales.accounting}
            </span>
            <PlannedBadge />
          </div>
        </>
      )}
    </div>
  )
}
