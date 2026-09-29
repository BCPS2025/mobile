import { ui } from '../copy'
import { useApp } from '../state/AppContext'
import { PhoneScreen } from './chrome/PhoneScreen'
import { ListRow } from './chrome/ListRow'
import { iconFor } from './icons'
import { hubHeader, isImplemented } from './implemented'
import { usePhoneNav } from './nav'
import { usePersonaPhone } from './PhoneContext'
import { HUBS, type HubId, homeOf, registeredRows } from './registry'

// One list of rows behind a Home tile or the avatar (Pay & request, Sales, Profile …). Only rows
// whose feature is built are shown. Consumer hubs have the light header; business hubs the navy
// one with the business name in small caps.

const rowLabels = ui.hubs.rows as Record<string, string>
const sublines = ui.hubs.sublines as Record<string, string>

export function HubScreen({ id }: { id: string }) {
  const app = useApp()
  const { persona, shell } = usePersonaPhone()
  const nav = usePhoneNav()
  const spec = HUBS[id as HubId]
  const home = homeOf(app.content.homes, shell, persona)
  const account = app.persona(persona)
  if (!spec || !home || !account) return null
  const Header = hubHeader(spec.header)
  const rows = registeredRows(home, id).filter((r) => isImplemented(r.target, shell))
  return (
    <PhoneScreen
      id={spec.screen}
      header={account.kind === 'person' ? 'light' : 'business'}
      title={ui.hubs.titles[id as keyof typeof ui.hubs.titles]}
      businessName={account.displayName}
      onBack={nav.back}
      onHome={nav.home}
    >
      {Header && <Header />}
      <ul className="px-5 pt-2 pb-3">
        {rows.map((r) => (
          <li key={r.row}>
            <ListRow
              testId={`row-${r.row}`}
              icon={iconFor(r.entry.icon)}
              label={rowLabels[r.row] ?? r.row}
              sub={r.entry.subline ? sublines[r.entry.subline] : undefined}
              onPress={() => nav.open(r.target)}
            />
          </li>
        ))}
      </ul>
    </PhoneScreen>
  )
}
