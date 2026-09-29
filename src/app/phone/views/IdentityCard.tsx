import { fill, ui } from '../../copy'
import { PartyAvatar } from '../../kit/PartyAvatar'
import { useApp } from '../../state/AppContext'
import { usePersonaPhone } from '../PhoneContext'

/** The block above Profile's rows: who you are ("Ana Novak · @ana", "ID card · Slovenia · verified"). */
export function IdentityCard() {
  const app = useApp()
  const { persona } = usePersonaPhone()
  const account = app.persona(persona)
  if (!account) return null
  return (
    <div
      className="mx-5 mt-2 flex min-h-[60px] items-center gap-3 border-b border-line-100 py-2"
      data-testid="identity"
    >
      <PartyAvatar party={account} />
      <span className="min-w-0">
        <span className="block truncate font-body text-body font-semibold text-navy-900">
          {fill(ui.profile.who, { name: account.displayName, handle: account.handle })}
        </span>
        <span className="block font-body text-body-s text-grey-600">
          {fill(ui.profile.identity, { country: ui.profile.countries[account.country] })}
        </span>
      </span>
    </div>
  )
}
