import { formatMinor } from '@domain/money'
import type { Minor } from '@domain/types'
import { ui } from '../../copy'
import { groupedInt } from '../../format'

// SALES / GROSS / FEES / NET: four white tiles in two rows, each with a navy edge on top (green on
// NET). Used by Sales and by the summary of a day.

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

export function KpiTiles({
  sales,
  gross,
  fees,
  net,
  className = '',
}: {
  sales: number
  gross: Minor
  fees: Minor
  net: Minor
  className?: string
}) {
  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`} data-testid="sales-kpis">
      <Kpi testId="kpi-sales" label={ui.sales.kpiSales} value={groupedInt(sales)} />
      <Kpi testId="kpi-gross" label={ui.sales.kpiGross} value={formatMinor(gross)} />
      <Kpi testId="kpi-fees" label={ui.sales.kpiFees} value={formatMinor(fees)} />
      <Kpi testId="kpi-net" label={ui.sales.kpiNet} value={formatMinor(net)} accent />
    </div>
  )
}
