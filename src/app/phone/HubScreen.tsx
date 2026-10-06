import { Code, Link, ShoppingBag } from 'lucide-react'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { ui } from '../copy'
import { useApp, useTransient } from '../state/AppContext'
import { ListRow, ListSection, StaticRow, SwitchRow } from './chrome/ListRow'
import { PhoneScreen } from './chrome/PhoneScreen'
import { PlannedBadge } from './chrome/PlannedBadge'
import { iconFor } from './icons'
import { hubHeader, isImplemented } from './implemented'
import { usePhoneNav } from './nav'
import { usePersonaPhone } from './PhoneContext'
import { HUBS, type HubEntry, type HubId, type HubRow, ROWS, STATIC_ROWS, homeOf } from './registry'
import { sublineOf } from './sublines'
import { ToPaySection, WaitingSection } from './views/PayLists'
import { InvoicesToPaySection } from './views/Invoices'
import { SalesSection } from './views/SalesDashboard'

// One list of rows behind a Home tile or the avatar (Pay & request, Wallet, Sales, Profile …).
// Only rows whose feature is built are shown (a row that opens nothing, like a fact or a switch, always is). A hub may also hold sections filled from state (TO PAY
// and WAITING on Pay & request); the rows between them sit under a heading of their own. Consumer
// hubs have the light header; business hubs the navy one with the business name in small caps.

const rowLabels = ui.hubs.rows as Record<string, string>
const headings = ui.hubs.sections as Record<string, string>

type Block = { kind: 'section'; section: string } | { kind: 'rows'; rows: HubRow[] }

export function HubScreen({ id }: { id: string }) {
  const app = useApp()
  const { persona, shell, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const state = useLedger((s) => s)
  const biometricsOff = useTransient((t) => t.biometricsOff)
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
    if (!STATIC_ROWS[e.row] && (!target || !isImplemented(target, shell))) continue
    const last = blocks[blocks.length - 1]
    if (last?.kind === 'rows') last.rows.push(e)
    else blocks.push({ kind: 'rows', rows: [e] })
  }
  const hasSections = blocks.some((b) => b.kind === 'section')
  // The rows sit under a heading of their own when a list has sections, or when its spec names one.
  const rowsHeading = hasSections ? headings[id] : spec.heading ? headings[spec.heading] : undefined

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
            ) : b.section === 'todayKpis' ? (
              <SalesSection key="sales" persona={persona} />
            ) : b.section === 'invoicesToPay' ? (
              <InvoicesToPaySection key="invoices" persona={persona} />
            ) : null
          ) : (
            <section key={b.rows.map((r) => r.row).join()} data-testid="hub-rows">
              {rowsHeading && <ListSection>{rowsHeading}</ListSection>}
              <ul className={rowsHeading ? '' : 'pt-1'}>
                {b.rows.map((r) => {
                  const group = spec.rowHeadings?.[r.row]
                  const label = rowLabels[r.row] ?? r.row
                  const sub =
                    sublineOf(r.subline, { state, content: app.content, persona, now: node.now(), tz }) ?? undefined
                  const kind = STATIC_ROWS[r.row]
                  return (
                    <li key={r.row}>
                      {group && <ListSection>{headings[group]}</ListSection>}
                      {kind === 'switch' ? (
                        <SwitchRow
                          testId={`${r.row}-switch`}
                          icon={iconFor(r.icon)}
                          label={label}
                          on={!biometricsOff.includes(persona)}
                          onChange={(on) => app.actions.setBiometrics(persona, on)}
                        />
                      ) : kind === 'info' ? (
                        <StaticRow testId={`info-${r.row}`} icon={iconFor(r.icon)} label={label} sub={sub} />
                      ) : kind === 'integrations' ? (
                        <div data-testid="integrations">
                          <StaticRow testId="integration-webApi" icon={Code} label={rowLabels.webApi} />
                          <StaticRow testId="integration-paymentLinks" icon={Link} label={rowLabels.paymentLinks} />
                          <StaticRow
                            testId="integration-ecommercePlugins"
                            icon={ShoppingBag}
                            label={rowLabels.ecommercePlugins}
                            right={<PlannedBadge />}
                          />
                        </div>
                      ) : (
                        <ListRow
                          testId={`row-${r.row}`}
                          icon={iconFor(r.icon)}
                          label={label}
                          sub={sub}
                          onPress={() => nav.open(ROWS[r.row] as NonNullable<(typeof ROWS)[typeof r.row]>)}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ),
        )}
      </div>
    </PhoneScreen>
  )
}
