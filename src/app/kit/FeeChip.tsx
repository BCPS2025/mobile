import { isConversionPolicy } from '@domain/fees'
import { formatMinor } from '@domain/money'
import type { FeeQuote, Rate } from '@domain/types'
import { fill, ui } from '../copy'
import { eur } from '../format'
import { InfoButton, InfoText, useInfoToggle } from './InfoToggle'

// ▪ Fee 1% · 0.11 (≈ €0.10) · café | Cards 1.5–3% +
// The card segment appears only when the quote carries a card comparison (merchant,
// web-checkout or subscription payments of 5.50 BCPS or more).

export function FeeChip({ quote, rate, payerName }: { quote: FeeQuote; rate: Rate; payerName: string }) {
  const feeInfo = useInfoToggle()
  const cardInfo = useInfoToggle()
  let left: string
  // "No fee" only for zero-fee policies; a 1 % fee that rounds to 0.00 still shows its line.
  if (quote.rule === 'zero') left = ui.fee.chipNone
  else if (isConversionPolicy(quote.policy)) left = fill(ui.fee.chipConversion, { fee: formatMinor(quote.fee) })
  else left = fill(ui.fee.chipShort, { fee: formatMinor(quote.fee), eur: eur(quote.fee, rate), payer: payerName })

  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-y-1">
        <div className="flex min-h-9 items-center gap-2 bg-green-500 pl-3 whitespace-nowrap font-body text-body-s font-medium text-navy-900 tnum">
          <span aria-hidden="true" className="inline-block size-2 bg-navy-900" />
          <span>{left}</span>
          <button
            type="button"
            aria-label={ui.fee.infoLabel}
            aria-expanded={feeInfo.open}
            aria-controls={feeInfo.id}
            onClick={() => {
              feeInfo.toggle()
              cardInfo.close()
            }}
            className="inline-flex h-9 w-8 items-center justify-center text-navy-900"
          >
            <span
              aria-hidden="true"
              className="flex size-4 items-center justify-center border border-navy-900 text-[10px] font-semibold"
            >
              i
            </span>
          </button>
        </div>
        {quote.card && (
          <div className="flex min-h-9 items-center border border-line-300 bg-surface pl-3 font-body text-body-s whitespace-nowrap text-ink">
            <span>{ui.fee.chipCards}</span>
            <InfoButton
              label={ui.fee.cardInfoLabel}
              open={cardInfo.open}
              controls={cardInfo.id}
              onClick={() => {
                cardInfo.toggle()
                feeInfo.close()
              }}
            />
          </div>
        )}
      </div>
      <InfoText id={feeInfo.id} open={feeInfo.open}>
        {ui.fee.feeInfo}
      </InfoText>
      <InfoText id={cardInfo.id} open={cardInfo.open}>
        {ui.fee.cardInfo}
      </InfoText>
    </div>
  )
}
