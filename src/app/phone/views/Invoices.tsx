import { FileText } from 'lucide-react'
import { formatMinor } from '@domain/money'
import type { PersonaId } from '@domain/types'
import type { SimTime } from '@domain/types'
import { localDateOf } from '@sim/tz'
import { type InvoiceRow, invoiceTag, invoices } from '@store/selectors'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { fill, ui } from '../../copy'
import { dayText, partyLabel } from '../../format'
import { PartyAvatar } from '../../kit/PartyAvatar'
import { useApp } from '../../state/AppContext'
import { EmptyState } from '../chrome/EmptyState'
import { ListSection } from '../chrome/ListRow'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { Tag } from '../chrome/Tag'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { VIEWS } from '../registry'

// The invoices a business is asked to pay: on the Pay list under TO PAY, and on Invoices. A row
// names the invoice and who sent it, says when it is due and carries DUE, or OVERDUE once its day is
// over; it opens the invoice, where it is paid or declined. A list with nothing in it says so.

/** "Due today", or "Due 25 Sep". */
function dueLine(row: InvoiceRow, now: SimTime, tz: string): string {
  const due = localDateOf(row.dueAt, tz)
  return due === localDateOf(now, tz)
    ? ui.invoices.dueTodayLine
    : fill(ui.invoices.dueLine, { date: dayText(due).replace(/^\w+ /, '') })
}

function InvoiceItem({ row, sub, tz }: { row: InvoiceRow; sub: 'description' | 'due'; tz: string }) {
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const now = node.now()
  const tag = invoiceTag(row.request, now, tz)
  const name = row.issuer ? partyLabel(row.issuer) : ''
  return (
    <button
      type="button"
      data-testid={`invoice-${row.number}`}
      onClick={() => nav.openFlow('invoice', { request: row.request.id })}
      className="flex min-h-[61px] w-full items-center gap-3 border-b border-line-100 py-2 text-left active:bg-line-100"
    >
      {row.issuer && <PartyAvatar party={row.issuer} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-body font-semibold text-navy-900">
          {fill(ui.invoices.rowTitle, { number: row.number, name })}
        </span>
        <span className="block truncate font-body text-body-s text-grey-600">
          {sub === 'description' ? row.description : dueLine(row, now, tz)}
        </span>
      </span>
      <Tag tone={tag === 'overdue' ? 'danger' : 'warning'}>
        {tag === 'overdue' ? ui.invoices.overdue : ui.invoices.due}
      </Tag>
      <span className="shrink-0 font-body text-body font-semibold text-navy-900 tnum">{formatMinor(row.amount)}</span>
    </button>
  )
}

/** TO PAY on the Pay list: the open invoices, earliest due first. Nothing when there are none. */
export function InvoicesToPaySection({ persona }: { persona: PersonaId }) {
  const { tz } = usePersonaPhone()
  const rows = useLedger((s) => invoices(s, persona, 'toPay'))
  if (rows.length === 0) return null
  return (
    <section aria-label={ui.hubs.sections.toPay} data-testid="to-pay">
      <ListSection>{ui.hubs.sections.toPay}</ListSection>
      <ul>
        {rows.map((row) => (
          <li key={row.request.id}>
            <InvoiceItem row={row} sub="description" tz={tz} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Invoices (biz.invoices): everything the business is asked to pay. */
export function InvoicesView() {
  const app = useApp()
  const { persona, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const rows = useLedger((s) => invoices(s, persona, 'toPay'))
  const screen = VIEWS.invoices.screen
  return (
    <PhoneScreen
      id={typeof screen === 'string' ? screen : (screen.pos ?? '')}
      header="business"
      title={ui.invoices.title}
      businessName={app.persona(persona)?.displayName ?? ''}
      onBack={nav.back}
      onHome={nav.home}
    >
      {rows.length === 0 ? (
        <EmptyState icon={FileText} title={ui.invoices.none} body={ui.invoices.noneBody} />
      ) : (
        <div className="px-5 pb-3">
          <section aria-label={ui.hubs.sections.toPay}>
            <ListSection>{ui.hubs.sections.toPay}</ListSection>
            <ul data-testid="invoice-list">
              {rows.map((row) => (
                <li key={row.request.id}>
                  <InvoiceItem row={row} sub="due" tz={tz} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </PhoneScreen>
  )
}
