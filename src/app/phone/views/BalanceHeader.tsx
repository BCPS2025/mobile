import { Clock } from 'lucide-react'
import { formatMinor } from '@domain/money'
import { selectAvailable } from '@store/selectors'
import { useLedger } from '@store/useLedger'
import { ui } from '../../copy'
import { approx } from '../../format'
import { stripText } from '../autoconvert'
import { usePersonaPhone } from '../PhoneContext'
import { autoConvertOf } from '../sublines'

// The block above a money list (Wallet, Cash out): the balance, and for a business the auto-convert
// schedule it has saved ("Auto-convert 50% · every day 23:00").

export function BalanceHeader() {
  const { persona } = usePersonaPhone()
  const balance = useLedger(selectAvailable(persona))
  const rate = useLedger((s) => s.config.rate)
  const auto = useLedger((s) => autoConvertOf(s, persona))
  return (
    <div className="px-5 pt-3.5" data-testid="hub-balance">
      <p className="font-body text-caption font-medium uppercase tracking-[0.16em] text-grey-600">
        {ui.common.balance}
      </p>
      <p className="mt-1.5 font-display text-display-xl tnum text-navy-900">
        {formatMinor(balance)}
        <span className="ml-2 text-[18px] leading-none font-medium tracking-normal text-grey-600">
          {ui.common.bcps}
        </span>
      </p>
      <p className="mt-0.5 font-body text-body-s text-grey-600 tnum">{approx(balance, rate)}</p>
      {auto && (
        <p
          data-testid="auto-convert-strip"
          className="mt-3.5 flex items-center gap-2.5 bg-green-50 px-3.5 py-3 font-body text-body text-navy-900"
        >
          <Clock size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {stripText(auto)}
        </p>
      )}
    </div>
  )
}
