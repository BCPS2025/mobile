import { ui } from '../copy'
import { AboutContent } from '../shell/AboutContent'
import { useApp } from '../state/AppContext'
import { PhoneScreen } from './chrome/PhoneScreen'
import { usePhoneNav } from './nav'
import { usePersonaPhone } from './PhoneContext'
import { VIEWS } from './registry'

/** Profile › About BCPS and Settings › About BCPS (shared.about). */
export function AboutView() {
  const app = useApp()
  const { persona, shell } = usePersonaPhone()
  const nav = usePhoneNav()
  const account = app.persona(persona)
  const screen = VIEWS.about.screen
  return (
    <PhoneScreen
      id={typeof screen === 'string' ? screen : (screen[shell] ?? '')}
      header={account?.kind === 'business' ? 'business' : 'light'}
      title={ui.about.title}
      businessName={account?.displayName ?? ''}
      onBack={nav.back}
      onHome={nav.home}
    >
      <div className="flex min-h-0 flex-1 flex-col px-5">
        <AboutContent />
      </div>
    </PhoneScreen>
  )
}
