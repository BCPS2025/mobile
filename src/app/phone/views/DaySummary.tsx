import { Banknote, ChartColumn, Clock, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { asMinor, formatMinor, formatSignedMinor, mustParseMinor } from '@domain/money'
import { formatTime } from '@sim/tz'
import { bankOf, daySummary, saleRow, salesCsvFile } from '@store/selectors'
import { useLedger } from '@store/useLedger'
import { fill, ui } from '../../copy'
import { saveTextFile } from '../../download'
import { approx, dayText, partyLabel, shortBank } from '../../format'
import { useApp } from '../../state/AppContext'
import { Dock } from '../chrome/Dock'
import { EmptyState } from '../chrome/EmptyState'
import { KpiTiles } from '../chrome/KpiTiles'
import { ListSection } from '../chrome/ListRow'
import { PhoneScreen } from '../chrome/PhoneScreen'
import type { ScreenProps } from '../implemented'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { DETAILS } from '../registry'

// One day of the café's sales (shared.daySummary), opened from a "Daily sales" row of History: the
// net sales, SALES / GROSS / FEES / NET, and THE DAY: its first sale, its busiest hour and the
// conversion to euros of that evening. [Export CSV] saves the day.

function DayRow({
  icon: Icon,
  title,
  sub,
  right,
}: {
  icon: typeof Clock
  title: string
  sub: string
  right?: ReactNode
}) {
  return (
    <li className="flex min-h-[52px] items-center gap-3 border-b border-line-100 py-1">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center bg-green-50 text-green-700">
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-body font-semibold text-navy-900">{title}</span>
        <span className="block truncate font-body text-body-s text-grey-600 tnum">{sub}</span>
      </span>
      {right && <span className="shrink-0 font-body text-body font-semibold text-navy-900 tnum">{right}</span>}
    </li>
  )
}

export function DaySummaryView({ params }: ScreenProps) {
  const app = useApp()
  const { persona, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const state = useLedger((s) => s)
  const day = daySummary(state, params.rowKey ?? '', tz)
  const account = app.persona(persona)
  const chrome = {
    id: DETAILS.daySummary.screen,
    header: 'business' as const,
    businessName: account?.displayName ?? '',
    onBack: nav.back,
    onHome: nav.home,
  }
  if (!day || day.tx.to !== persona) {
    return (
      <PhoneScreen {...chrome} title={ui.detail.title}>
        <EmptyState icon={Info} title={ui.detail.missing} />
      </PhoneScreen>
    )
  }
  const bank = bankOf(app.content, persona)
  const product = day.firstSale
    ? app.content.catalogue.products[persona]?.find((p) => p.sku === day.firstSale?.sku)
    : undefined
  const exportCsv = () => {
    // Named for the day it holds (cafe-lipa-sales-2026-09-19.csv), not for today.
    const file = salesCsvFile(state, persona, [saleRow(state, day.tx)], day.tx.createdAt, app.content)
    saveTextFile(file.fileName, file.text)
  }
  return (
    <PhoneScreen
      {...chrome}
      title={dayText(day.date)}
      dock={<Dock primary={{ label: ui.sales.exportCsv, tone: 'navy', onPress: exportCsv }} />}
    >
      <div className="px-5 pt-3.5 pb-3" data-testid="day-summary">
        <p className="font-body text-caption font-medium tracking-[0.16em] text-grey-600">{ui.daySummary.netSales}</p>
        <p data-testid="day-net" className="mt-1.5 font-display text-display-xl tnum text-navy-900">
          {formatMinor(day.net)}
          <span className="ml-2 text-[18px] leading-none font-medium tracking-normal text-grey-600">
            {ui.common.bcps}
          </span>
        </p>
        <p className="mt-0.5 font-body text-body-s text-grey-600 tnum">{approx(day.net, state.config.rate)}</p>
        <KpiTiles className="mt-4" sales={day.count} gross={day.gross} fees={day.fees} net={day.net} />
        <ListSection>{ui.daySummary.theDay}</ListSection>
        <ul data-testid="day-rows">
          {day.firstSale && (
            <DayRow
              icon={Clock}
              title={ui.daySummary.firstSale}
              sub={fill(ui.daySummary.firstSaleLine, {
                time: formatTime(day.firstSale.at, tz),
                who: day.firstSale.party ? partyLabel(day.firstSale.party) : '',
              })}
              right={product ? formatMinor(mustParseMinor(product.price)) : undefined}
            />
          )}
          {day.busiest && (
            <DayRow
              icon={ChartColumn}
              title={ui.daySummary.busiest}
              sub={fill(ui.daySummary.busiestLine, {
                from: formatTime(day.busiest.from, tz),
                to: formatTime((day.busiest.from + 3_600_000) as typeof day.busiest.from, tz),
                count: day.busiest.count,
              })}
            />
          )}
          {day.conversions.map((tx) => (
            <DayRow
              key={tx.id}
              icon={Banknote}
              title={
                tx.seedMeta?.sharePct !== undefined
                  ? fill(ui.daySummary.cashOutAuto, { sharePct: tx.seedMeta.sharePct })
                  : ui.daySummary.cashOut
              }
              sub={
                bank
                  ? fill(ui.history.cashOutLine, { time: formatTime(tx.createdAt, tz), bank: shortBank(bank) })
                  : formatTime(tx.createdAt, tz)
              }
              right={formatSignedMinor(asMinor(-tx.amount))}
            />
          ))}
        </ul>
      </div>
    </PhoneScreen>
  )
}
