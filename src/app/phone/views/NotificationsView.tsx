import { Bell, ChevronRight } from 'lucide-react'
import { localDateOf, formatTime, addDays } from '@sim/tz'
import { useLedgerNode } from '@store/useLedger'
import { fill, ui } from '../../copy'
import { dayText } from '../../format'
import { useApp, useNotifications } from '../../state/AppContext'
import { EmptyState } from '../chrome/EmptyState'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { usePhoneNav } from '../nav'
import { openNotification } from '../notify'
import { usePersonaPhone } from '../PhoneContext'
import { VIEWS } from '../registry'

// Notifications (shared.notifications): what happened to this account, newest first, under TODAY,
// YESTERDAY and EARLIER, with an unread square in front of what has not been opened. A row marks
// itself read and opens the payment; "Mark all as read" sits at the right of the first heading.

type Group = 'today' | 'yesterday' | 'earlier'
const HEADINGS: Record<Group, string> = {
  today: ui.notifications.today,
  yesterday: ui.notifications.yesterday,
  earlier: ui.notifications.earlier,
}

export function NotificationsView() {
  const app = useApp()
  const { persona, shell, tz, slot } = usePersonaPhone()
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const items = useNotifications(persona)
  const account = app.persona(persona)
  const today = localDateOf(node.now(), tz)
  const yesterday = addDays(today, -1)
  const unread = items.filter((i) => !i.read).length

  const groups: { key: Group; rows: typeof items }[] = []
  for (const item of items) {
    const date = localDateOf(item.notification.at, tz)
    const key: Group = date === today ? 'today' : date === yesterday ? 'yesterday' : 'earlier'
    const last = groups[groups.length - 1]
    if (last?.key === key) last.rows.push(item)
    else groups.push({ key, rows: [item] })
  }
  const screen = VIEWS.notifications.screen
  return (
    <PhoneScreen
      id={typeof screen === 'string' ? screen : (screen[shell] ?? '')}
      header={account?.kind === 'business' ? 'business' : 'light'}
      title={ui.notifications.title}
      businessName={account?.displayName ?? ''}
      onBack={nav.back}
      onHome={nav.home}
    >
      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={ui.empty.notifications.title}
          body={ui.empty.notifications.body}
          onNavy={false}
        />
      ) : (
        <div className="px-5 pb-3">
          {groups.map((g, i) => (
            <section key={g.key} aria-label={HEADINGS[g.key]}>
              <div className="flex items-start justify-between pt-3">
                <div className="pb-1">
                  <h2 className="font-display text-[13px] leading-4 font-semibold uppercase tracking-[0.14em] text-navy-900">
                    {HEADINGS[g.key]}
                  </h2>
                  <span aria-hidden="true" className="mt-1.5 block h-[3px] w-6 bg-green-600" />
                </div>
                {i === 0 && unread > 0 && (
                  <button
                    type="button"
                    data-testid="mark-all-read"
                    onClick={() => app.actions.markAllRead(persona)}
                    className="-mt-2.5 min-h-11 font-body text-[13px] leading-[18px] font-semibold text-green-700"
                  >
                    {ui.notifications.markAll}
                  </button>
                )}
              </div>
              <ul>
                {g.rows.map(({ notification: n, read }) => {
                  const when = g.key === 'earlier' ? dayText(localDateOf(n.at, tz)) : formatTime(n.at, tz)
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        data-testid={`notification-${n.id}`}
                        data-unread={read ? undefined : 'true'}
                        onClick={() =>
                          openNotification(
                            app,
                            { persona, slot, shell },
                            { id: n.id, txId: n.txId, subject: n.subject, kind: n.kind },
                          )
                        }
                        className="flex min-h-14 w-full items-center gap-3 border-b border-line-100 py-1 text-left active:bg-line-100"
                      >
                        <span aria-hidden="true" className={`size-2 shrink-0 ${read ? '' : 'bg-green-600'}`} />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate font-body text-body ${read ? 'font-medium' : 'font-semibold'} text-navy-900`}
                          >
                            {!read && <span className="sr-only">{ui.notifications.unread}: </span>}
                            {n.title}
                          </span>
                          <span className="block truncate font-body text-body-s text-grey-600">
                            {n.line ? fill(ui.tx.withNote, { label: n.line, note: when }) : when}
                          </span>
                        </span>
                        <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PhoneScreen>
  )
}
