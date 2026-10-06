import { formatMinor } from '@domain/money'
import { selectAvailable } from '@store/selectors'
import { useLedger } from '@store/useLedger'
import { ui } from '../../copy'
import { approx } from '../../format'
import { usePersonaPhone } from '../PhoneContext'

// The block above a money list (Wallet, Cash out): the balance.

export function BalanceHeader() {
  const { persona } = usePersonaPhone()
  const balance = useLedger(selectAvailable(persona))
  const rate = useLedger((s) => s.config.rate)
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
    </div>
  )
}
