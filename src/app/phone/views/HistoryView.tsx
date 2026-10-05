import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Landmark,
  List,
  type LucideIcon,
  RotateCcw,
  Search,
  Store,
  Truck,
  Users,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { entryOf } from '@domain/ledger'
import { asMinor } from '@domain/money'
import type { PersonaId, SimTime, Tx } from '@domain/types'
import {
  type ActivityFilter,
  type ActivityGroup,
  type ActivityStatusRow,
  CAFE_FILTERS,
  PEOPLE_FILTERS,
  activity,
} from '@store/selectors'
import { useLedger, useLedgerNode } from '@store/useLedger'
import { ui } from '../../copy'
import { dayText } from '../../format'
import { useApp, useTransient } from '../../state/AppContext'
import { EmptyState } from '../chrome/EmptyState'
import { ListSection } from '../chrome/ListRow'
import { PhoneScreen } from '../chrome/PhoneScreen'
import { usePhoneNav } from '../nav'
import { usePersonaPhone } from '../PhoneContext'
import { VIEWS } from '../registry'
import { ActivityRowView, RampRowView, StatusRowView, rampSub, rowText, statusText } from './ActivityRow'

// History (c.history, biz.history): a search field, the filter chips and the account's payments
// under a heading for each day, newest first: Today, Yesterday, then one heading per older day. A
// person's list also holds what is waiting (a request, a payment link, a split share) and a bank
// transfer that has not arrived. A row opens the payment, the request or the link. The chip and the
// search are kept for the account while the page stays open.

const heading = (key: string): string =>
  key === 'today' ? ui.groups.today : key === 'yesterday' ? ui.groups.yesterday : dayText(key).toUpperCase()

const EMPTY_ICON: Record<ActivityFilter, LucideIcon> = {
  all: List,
  in: ArrowDownLeft,
  out: ArrowUpRight,
  shops: Store,
  people: Users,
  topupsCashouts: Landmark,
  requests: ArrowDownLeft,
  sales: Store,
  refunds: RotateCcw,
  suppliers: Truck,
  payouts: Banknote,
  topups: Landmark,
}

/** A payment as the list draws it (the search looks through what the row says). */
const rowOf = (tx: Tx, viewer: PersonaId) => ({
  tx,
  signed: asMinor(tx.from === viewer ? -tx.amount : tx.amount),
  direction: tx.from === viewer ? ('out' as const) : ('in' as const),
  at: tx.createdAt as SimTime,
  pending: tx.status === 'pending',
})

type Item =
  | { at: SimTime; kind: 'tx'; row: ActivityGroup['rows'][number] }
  | { at: SimTime; kind: 'status'; row: ActivityStatusRow }
  | { at: SimTime; kind: 'ramp'; row: ActivityGroup['ramps'][number] }

/** The group's payments, waiting items and top-ups on their way as one list, newest first. */
function itemsOf(g: ActivityGroup): Item[] {
  const items: Item[] = [
    ...g.rows.map((row): Item => ({ at: row.at, kind: 'tx', row })),
    ...g.status.map((row): Item => ({ at: row.at, kind: 'status', row })),
    ...g.ramps.map((row): Item => ({ at: row.at, kind: 'ramp', row })),
  ]
  return items.sort((a, b) => b.at - a.at)
}

export function HistoryView() {
  const app = useApp()
  const { persona, shell, tz } = usePersonaPhone()
  const nav = usePhoneNav()
  const node = useLedgerNode()
  const state = useLedger((s) => s)
  const saved = useTransient((t) => t.history[persona])
  const account = app.persona(persona)
  const business = account?.kind === 'business'
  const bank = app.content.personas.personas.find((p) => p.id === persona)?.methods?.bank
  const filter = saved?.filter ?? 'all'
  const query = saved?.query ?? ''
  const chips = business ? CAFE_FILTERS : PEOPLE_FILTERS
  const set = (next: Partial<{ filter: ActivityFilter; query: string }>) =>
    app.actions.setHistory(persona, { filter, query, ...next })

  const groups = activity(state, persona, node.now(), tz, {
    filter,
    query,
    status: !business,
    label: (tx) => {
      const text = rowText(rowOf(tx, persona), state, persona, tz, bank)
      return `${text.title} ${text.sub}`
    },
    rampLabel: (ramp) =>
      rampSub({ ramp, signed: ramp.amount, at: ramp.requestedAt, arrivesAt: ramp.arrivesAt ?? ramp.requestedAt }),
  })

  // The chosen chip stays in view when the row of chips is longer than the phone is wide.
  const chipRow = useRef<HTMLFieldSetElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the chosen chip decides
  useEffect(() => {
    const on = chipRow.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    const row = chipRow.current
    if (!on || !row) return
    const left = on.offsetLeft - 20
    const right = on.offsetLeft + on.offsetWidth + 20 - row.clientWidth
    if (left < row.scrollLeft) row.scrollLeft = Math.max(0, left)
    else if (right > row.scrollLeft) row.scrollLeft = right
  }, [filter])

  const openStatus = (row: ActivityStatusRow): (() => void) | null => {
    if (row.kind === 'link') {
      return row.direction === 'waiting'
        ? () => nav.open({ kind: 'detail', id: 'link' }, { linkId: row.id })
        : row.status === 'open'
          ? () => nav.openFlow('payItem', { link: row.id })
          : null
    }
    if (row.direction === 'waiting') {
      return row.splitId
        ? () => nav.open({ kind: 'detail', id: 'split' }, { splitId: row.splitId as string })
        : () => nav.open({ kind: 'detail', id: 'request' }, { requestId: row.id })
    }
    if (row.status === 'open') return () => nav.openFlow('payItem', { request: row.id })
    const txId = entryOf(state.requests, row.id)?.txId
    return txId === undefined ? null : () => nav.open({ kind: 'detail', id: 'tx' }, { txId })
  }

  const screen = VIEWS.history.screen
  const searching = query.trim() !== ''
  return (
    <PhoneScreen
      id={typeof screen === 'string' ? screen : (screen[shell] ?? '')}
      header={business ? 'business' : 'light'}
      title={ui.history.title}
      businessName={account?.displayName ?? ''}
      onBack={nav.back}
      onHome={nav.home}
    >
      <div className="field mx-5 mt-3.5 flex h-12 shrink-0 items-center gap-2.5 bg-surface px-3">
        <Search size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-grey-600" />
        <input
          type="text"
          name="history-search"
          id="history-search"
          data-testid="history-search"
          aria-label={ui.history.searchLabel}
          placeholder={business ? ui.history.searchBusiness : ui.history.searchPeople}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          inputMode="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => set({ query: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-body text-body-l text-navy-900 outline-none placeholder:text-grey-500"
        />
      </div>
      <fieldset
        ref={chipRow}
        data-testid="history-chips"
        className="no-scrollbar mt-3 flex min-w-0 shrink-0 gap-2 overflow-x-auto px-5 pb-1"
      >
        <legend className="sr-only">{ui.history.filtersLabel}</legend>
        {chips.map((chip) => {
          const on = chip === filter
          return (
            <button
              key={chip}
              type="button"
              data-testid={`chip-${chip}`}
              aria-pressed={on}
              onClick={() => set({ filter: chip })}
              className={`inline-flex h-9 shrink-0 items-center border px-3.5 font-body text-body whitespace-nowrap ${
                on ? 'border-navy-900 bg-navy-900 font-semibold text-white' : 'border-line-300 bg-surface text-navy-900'
              }`}
            >
              {ui.history.filters[chip]}
            </button>
          )
        })}
      </fieldset>
      {groups.length === 0 ? (
        <EmptyState
          icon={searching ? Search : EMPTY_ICON[filter]}
          title={searching ? ui.empty.search.title : ui.empty.filters[filter].title}
          body={searching ? ui.empty.search.body : ui.empty.filters[filter].body}
        />
      ) : (
        <div className="px-5 pb-3" data-testid="history-list">
          {groups.map((g) => (
            <section key={g.key} aria-label={heading(g.key)}>
              <ListSection>{heading(g.key)}</ListSection>
              <ul>
                {itemsOf(g).map((item) => (
                  <li
                    key={`${item.kind}:${item.kind === 'tx' ? item.row.tx.id : item.kind === 'status' ? item.row.id : item.row.ramp.id}`}
                  >
                    {item.kind === 'tx' ? (
                      <ActivityRowView
                        row={item.row}
                        text={rowText(item.row, state, persona, tz, bank)}
                        onOpen={() => nav.open({ kind: 'detail', id: 'tx' }, { txId: item.row.tx.id })}
                      />
                    ) : item.kind === 'status' ? (
                      <StatusRowView row={item.row} text={statusText(item.row, tz)} onOpen={openStatus(item.row)} />
                    ) : (
                      <RampRowView row={item.row} />
                    )}
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
