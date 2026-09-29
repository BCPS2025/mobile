import { formatMinor } from '@domain/money'
import type { Minor, PersonaId, Rate } from '@domain/types'
import { fill, ui } from '../../copy'
import { approx, rateText } from '../../format'
import { InfoButton, InfoText, useInfoToggle } from '../../kit/InfoToggle'

// The navy balance band: "BALANCE", the amount, "≈ €225.00 (i)". The (i) opens the rate text in
// place as one extra line (never a popover).

export function BalanceBand({
  persona,
  balance,
  rate,
  bordered,
}: {
  persona: PersonaId
  balance: Minor
  rate: Rate
  /** Business homes have a hairline above the band. */
  bordered: boolean
}) {
  const info = useInfoToggle()
  return (
    <div className={`on-navy shrink-0 bg-navy-900 px-5 pt-3 pb-3.5 ${bordered ? 'border-t border-navy-700' : ''}`}>
      <p className="font-body text-caption font-medium uppercase tracking-[0.16em] text-grey-400">
        {ui.common.balance}
      </p>
      <p data-testid={`balance-${persona}`} className="mt-1.5 font-display text-display-xl tnum text-white">
        {formatMinor(balance)}
        <span className="ml-2 text-[18px] leading-none font-medium tracking-normal text-grey-400">
          {ui.common.bcps}
        </span>
      </p>
      <p className="mt-0.5 flex items-center gap-1 font-body text-body-s text-line-300 tnum">
        {approx(balance, rate)}
        <InfoButton label={ui.common.rateInfoLabel} open={info.open} controls={info.id} onClick={info.toggle} onNavy />
      </p>
      <InfoText id={info.id} open={info.open} onNavy>
        {fill(ui.common.rateInfo, { rate: rateText(rate) })}
      </InfoText>
    </div>
  )
}
