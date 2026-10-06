import { Info } from 'lucide-react'
import { entryOf } from '@domain/ledger'
import { useLedger } from '@store/useLedger'
import { ui } from '../../copy'
import { useApp } from '../../state/AppContext'
import { EmptyState } from '../chrome/EmptyState'
import { PhoneScreen } from '../chrome/PhoneScreen'
import type { ScreenProps } from '../implemented'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { DETAILS } from '../registry'
import { TopUpResult } from './TopUpResult'

// A top-up as the History row or the notification opens it (shared.topup.onItsWay): a bank
// transfer on its way with its timeline, or the top-up once it has arrived. [Done] goes back.

export function RampDetailView({ params }: ScreenProps) {
  const app = useApp()
  const { persona, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const state = useLedger((s) => s)
  const account = app.persona(persona)
  const business = account?.kind === 'business'
  const ramp = entryOf(state.ramps, params.rampId ?? '')
  if (!ramp || ramp.persona !== persona) {
    return (
      <PhoneScreen
        id={DETAILS.ramp.screen}
        header={business ? 'business' : 'light'}
        title={ui.topUp.title}
        businessName={account?.displayName ?? ''}
        onBack={nav.back}
        onHome={nav.home}
      >
        <EmptyState icon={Info} title={ui.detail.missing} />
      </PhoneScreen>
    )
  }
  return (
    <TopUpResult
      ramp={ramp}
      state={state}
      content={app.content}
      persona={persona}
      tz={tz}
      business={business}
      onDone={nav.back}
    />
  )
}
