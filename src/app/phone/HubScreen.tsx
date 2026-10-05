import { ui } from '../copy'
import { useApp } from '../state/AppContext'
import { ListRow, ListSection } from './chrome/ListRow'
import { PhoneScreen } from './chrome/PhoneScreen'
import { iconFor } from './icons'
import { hubHeader, isImplemented } from './implemented'
import { usePhoneNav } from './nav'
import { usePersonaPhone } from './PhoneContext'
import { HUBS, type HubEntry, type HubId, type HubRow, ROWS, homeOf } from './registry'
import { ToPaySection, WaitingSection } from './views/PayLists'

// One list of rows behind a Home tile or the avatar (Pay & request, Wallet, Sales, Profile …).
// Only rows whose feature is built are shown. A hub may also hold sections filled from state (TO PAY
// and WAITING on Pay & request); the rows between them sit under a heading of their own. Consumer
// hubs have the light header; business hubs the navy one with the business name in small caps.

const rowLabels = ui.hubs.rows as Record<string, string>
const sublines = ui.hubs.sublines as Record<string, string>
const headings = ui.hubs.sections as Record<string, string>

type Block = { kind: 'section'; section: string } | { kind: 'rows'; rows: HubRow[] }

export function HubScreen({ id }: { id: string }) {
  const app = useApp()
  const { persona, shell } = usePersonaPhone()
  const nav = usePhoneNav()
  const spec = HUBS[id as HubId]
  const home = homeOf(app.content.homes, shell, persona)
  const account = app.persona(persona)
  if (!spec || !home || !account) return null
  const Header = hubHeader(spec.header)

  const entries = (home.hubs as Record<string, readonly HubEntry[] | undefined>)[id] ?? []
  const blocks: Block[] = []
  for (const e of entries) {
    if ('section' in e) {
      blocks.push({ kind: 'section', section: e.section })
      continue
    }
    const target = ROWS[e.row]
    if (!target || !isImplemented(target, shell)) continue
    const last = blocks[blocks.length - 1]
    if (last?.kind === 'rows') last.rows.push(e)
    else blocks.push({ kind: 'rows', rows: [e] })
  }
  const hasSections = blocks.some((b) => b.kind === 'section')

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
      <div className="px-5 pt-1 pb-3">
        {blocks.map((b) =>
          b.kind === 'section' ? (
            b.section === 'toPay' ? (
              <ToPaySection key="toPay" persona={persona} />
            ) : b.section === 'waiting' ? (
              <WaitingSection key="waiting" persona={persona} />
            ) : null
          ) : (
            <section key={b.rows.map((r) => r.row).join()} data-testid="hub-rows">
              {hasSections && headings[id] && <ListSection>{headings[id]}</ListSection>}
              <ul className={hasSections ? '' : 'pt-1'}>
                {b.rows.map((r) => (
                  <li key={r.row}>
                    <ListRow
                      testId={`row-${r.row}`}
                      icon={iconFor(r.icon)}
                      label={rowLabels[r.row] ?? r.row}
                      sub={r.subline ? sublines[r.subline] : undefined}
                      onPress={() => nav.open(ROWS[r.row] as NonNullable<(typeof ROWS)[typeof r.row]>)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </PhoneScreen>
  )
}
