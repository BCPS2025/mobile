import { List } from 'lucide-react'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { activity } from '@store/selectors'
import { ui } from '../../copy'
import { dayText } from '../../format'
import { useApp } from '../../state/AppContext'
import { EmptyState } from '../chrome/EmptyState'
import { ListSection } from '../chrome/ListRow'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { VIEWS } from '../registry'
import { ActivityRowView, rowText } from './ActivityRow'

// History (c.history, biz.history): the account's payments grouped by day, newest first: Today,
// Yesterday, then one heading per older day. A row opens the payment detail. No filters or
// search yet, no empty groups.

const heading = (key: string): string =>
  key === 'today' ? ui.groups.today : key === 'yesterday' ? ui.groups.yesterday : dayText(key).toUpperCase()

export function HistoryView() {
  const app = useApp()
  const { persona, shell, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const state = useLedger((s) => s)
  const account = app.persona(persona)
  const groups = activity(state, persona, node.now(), tz)
  const screen = VIEWS.history.screen
  return (
    <PhoneScreen
      id={typeof screen === 'string' ? screen : (screen[shell] ?? '')}
      header={account?.kind === 'business' ? 'business' : 'light'}
      title={ui.history.title}
      businessName={account?.displayName ?? ''}
      onBack={nav.back}
      onHome={nav.home}
    >
      {groups.length === 0 ? (
        <EmptyState icon={List} title={ui.empty.history} />
      ) : (
        <div className="px-5 pb-3">
          {groups.map((g) => (
            <section key={g.key} aria-label={heading(g.key)}>
              <ListSection>{heading(g.key)}</ListSection>
              <ul>
                {g.rows.map((row) => (
                  <li key={row.tx.id}>
                    <ActivityRowView
                      row={row}
                      text={rowText(row, state, persona, tz)}
                      onOpen={() => nav.open({ kind: 'detail', id: 'tx' }, { txId: row.tx.id })}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PhoneScreen>
  )
}
