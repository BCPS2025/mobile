import { ScanFace } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ui } from '../../copy'
import { maskEmail } from '../../format'
import { Emblem } from '../../kit/Emblem'
import { useApp, useUi } from '../../state/AppContext'
import { Dock } from '../chrome/Dock'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { authScreen } from '../implemented'
import { usePhone } from '../PhoneContext'
import { fill } from '../../copy'
import { slotOf } from '@store/sessions'
import { BIOMETRIC_MS } from './timing'

// Welcome (auth.welcome): navy, the emblem, "Pay and get paid in seconds.", the account this
// phone remembers under the headline, and the dock: [Log in] and [Log in with biometrics]. There
// is no [Create account]. Biometrics logs the remembered account in after a glyph in the button
// (500 ms). [Log in] opens the Log in screen (choose your account), when it is built.

export function WelcomeScreen() {
  const app = useApp()
  const { slot } = usePhone()
  const ui_ = useUi()
  const remembered = slotOf(ui_, slot).remembered
  const [busy, setBusy] = useState(false)
  const persona = remembered ? app.persona(remembered) : undefined
  const login = remembered ? app.content.personas.personas.find((p) => p.id === remembered)?.login : undefined

  useEffect(() => {
    if (!busy || !remembered) return
    const id = window.setTimeout(() => app.actions.completeLogin(slot, remembered), BIOMETRIC_MS)
    return () => window.clearTimeout(id)
  }, [busy, remembered, slot, app])

  const who = persona
    ? persona.kind === 'business'
      ? fill(ui.login.welcomeBusiness, { name: persona.displayName })
      : fill(ui.login.welcomePerson, { name: persona.displayName, email: login ? maskEmail(login.email) : '' })
    : null

  const logIn = () => {
    if (authScreen('login')) app.actions.setAuth(slot, { screen: 'login', chosen: null })
    else if (remembered) app.actions.completeLogin(slot, remembered)
  }

  return (
    <PhoneScreen
      id="auth.welcome"
      bare
      header="navy"
      body="navy"
      banner={false}
      dock={
        <Dock
          tone="navy"
          stack={[
            { label: ui.login.logIn, kind: 'white', onPress: logIn, disabled: busy },
            {
              label: ui.login.biometrics,
              kind: 'outline',
              icon: <ScanFace size={20} strokeWidth={1.75} aria-hidden="true" />,
              onPress: () => remembered && setBusy(true),
              sending: busy,
              keepLabel: true,
              disabled: !remembered,
            },
          ]}
        />
      }
    >
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="sr-only">BCPS</h1>
        <Emblem size="welcome" />
        <p className="mt-9 font-display text-display-m text-white">{ui.start.headline}</p>
        {who && (
          <p data-testid="welcome-account" className="mt-3 font-body text-body text-line-300">
            {who}
          </p>
        )}
      </div>
    </PhoneScreen>
  )
}
