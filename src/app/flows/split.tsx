import { Check, Search, Split as SplitGlyph } from 'lucide-react'
import { entryOf, limitFor, selectParty } from '@domain/ledger'
import { asMinor, formatMinor } from '@domain/money'
import { MAX_SPLIT_SHARES, type Minor, type Party, type Tx } from '@domain/types'
import { counterpartyOf, searchParties } from '@store/parties'
import { equalSplit, quoteFor, splitByCmdId, splitCandidates } from '@store/selectors'
import { fill, ui } from '../copy'
import { errorText } from '../errors'
import { approx, dateChipText, firstName, itemsText, partyLabel } from '../format'
import { PartyAvatar } from '../kit/PartyAvatar'
import { EmptyState } from '../phone/chrome/EmptyState'
import { ErrorLine } from '../phone/chrome/ErrorLine'
import { FactsCard } from '../phone/chrome/FactsCard'
import { InfoNote } from '../phone/chrome/InfoNote'
import { ListSection } from '../phone/chrome/ListRow'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import { AmountKeys, AmountStep, keypadKeyOf, parseAmount } from './steps/AmountStep'
import { NoteStep } from './steps/NoteStep'
import { partyLines } from './steps/PickPartyStep'
import { keypadInput } from '../kit/Keypad'
import type { FlowCtx, FlowImpl, StepProps } from './types'

// Split a bill (c.split.*): pick a payment (or enter an amount), choose who shares it, split it
// equally or by custom amounts, check, and send a request for each person's share. Each person
// pays the 1% fee on their share when they pay, so the owner receives the full amounts. The owner
// keeps what is left of the total.

interface Draft {
  /** The payment that is split, or null for an amount that is entered. */
  source: string | null
  /** The payment was chosen before the flow opened (from its detail): no first step. */
  fixed: boolean
  /** The entered total (keypad string) and the name of the split, when no payment is chosen. */
  total: string
  note: string
  /** The @handles of the people who share it. */
  people: string[]
  query: string
  mode: 'equal' | 'custom'
  /** Custom amounts by @handle (keypad strings), and the one the keypad edits. */
  custom: Record<string, string>
  active: string | null
  /** The split that was made, once it is. */
  splitId?: string
}

const isPerson = (p: Party): boolean => p.kind === 'person'

/** What a payment is called as a split: its note, else what was bought, else who was paid (at most the note limit). */
function nameOfTx(tx: Tx, ctx: FlowCtx): string {
  const other = counterpartyOf(ctx.state, tx.to, tx.party)
  const text = tx.note ?? (itemsText(tx.items) || (other ? partyLabel(other) : ''))
  return [...text].slice(0, ctx.state.config.limits.noteMaxChars).join('')
}

/** Everything the steps derive from the draft and the ledger right now. */
function figures(d: Draft, ctx: FlowCtx) {
  const s = ctx.state
  const source = d.source === null ? undefined : entryOf(s.txs, d.source)
  const total = source ? source.amount : parseAmount(d.total)
  const note = source ? nameOfTx(source, ctx) : d.note.trim()
  const people = d.people.map((h) => selectParty(s, h)).filter((p): p is Party => p !== undefined && isPerson(p))
  const n = people.length
  const equal = n > 0 && total > 0 ? equalSplit(total, n) : { each: asMinor(0), own: total }
  const shares = people.map((p) => ({
    party: p,
    amount: d.mode === 'equal' ? equal.each : parseAmount(d.custom[p.handle] ?? ''),
  }))
  const sum = shares.reduce((acc, x) => acc + x.amount, 0)
  const own = asMinor(Math.max(0, total - sum))
  const over = sum > total
  const ready = total > 0 && note.length > 0 && n > 0 && shares.every((x) => x.amount > 0) && !over
  return { source, total, note, people, n, shares, sum, own, over, ready }
}

// ---- pick a payment

function PickBody({ d, ctx, api }: StepProps<Draft>) {
  const candidates = splitCandidates(ctx.state, ctx.persona)
  if (candidates.length === 0 && d.source === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-5">
        <h2 className="pt-4 font-display text-display-m text-navy-900">{ui.split.pickTitle}</h2>
        <EmptyState icon={SplitGlyph} title={ui.split.none} />
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 font-display text-display-m text-navy-900">{ui.split.pickTitle}</h2>
      <ListSection>{ui.split.recent}</ListSection>
      <ul className="pt-1" data-testid="split-payments">
        {candidates.map((tx) => {
          const other = counterpartyOf(ctx.state, tx.to, tx.party)
          const what = tx.note ?? itemsText(tx.items)
          const on = d.source === tx.id
          return (
            <li key={tx.id} className={on ? '' : 'border-b border-line-100'}>
              <button
                type="button"
                data-testid={`split-tx-${tx.id}`}
                aria-pressed={on}
                onClick={() => api.set({ source: tx.id })}
                className={`flex min-h-[61px] w-full items-center gap-3 border-2 px-2.5 py-2 text-left active:bg-line-100 ${
                  on ? 'border-navy-900 bg-surface' : 'border-transparent'
                }`}
              >
                {other && <PartyAvatar party={other} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-body text-body font-semibold text-navy-900">
                    {other ? partyLabel(other) : ''}
                    {what ? ` · ${what}` : ''}
                  </span>
                  <span className="block truncate font-body text-body-s text-grey-600">
                    {dateChipText(tx.createdAt)}
                  </span>
                </span>
                <span className="shrink-0 font-body text-body font-semibold text-navy-900 tnum">
                  {`−${formatMinor(tx.amount)}`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---- an entered amount and its name

function AmountBody({ d, ctx, api }: StepProps<Draft>) {
  return (
    <AmountStep
      title={ui.split.amountTitle}
      value={d.total}
      onChange={(total) => api.set({ total })}
      rate={ctx.rate}
      maxMinor={limitFor(ctx.state, ctx.persona)}
      available={null}
      max={null}
      onEnter={api.press}
    />
  )
}

function NoteBody({ d, ctx, api }: StepProps<Draft>) {
  return (
    <NoteStep
      title={ui.split.noteTitle}
      value={d.note}
      chips={ctx.content.catalogue.noteChips.person}
      onChange={(note) => api.set({ note })}
      visibility={ui.split.noteVisibility}
    />
  )
}

// ---- who shares it

function PeopleBody({ d, ctx, api }: StepProps<Draft>) {
  const { n } = figures(d, ctx)
  const selected = d.people
    .map((h) => selectParty(ctx.state, h))
    .filter((p): p is Party => p !== undefined && isPerson(p))
  const found = searchParties(ctx.state, ctx.persona, d.query, { filter: isPerson })
  const rows = [...selected, ...found.filter((p) => !d.people.includes(p.handle))]
  const full = n >= MAX_SPLIT_SHARES
  const toggle = (p: Party) =>
    api.set({ people: d.people.includes(p.handle) ? d.people.filter((h) => h !== p.handle) : [...d.people, p.handle] })
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 font-display text-display-m text-navy-900">{ui.split.peopleTitle}</h2>
      <div className="field mt-3.5 flex h-12 shrink-0 items-center gap-2.5 bg-surface px-3">
        <Search size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-grey-600" />
        <input
          type="text"
          name="party-search"
          id="party-search"
          data-testid="party-search"
          aria-label={ui.party.searchLabel}
          placeholder={ui.party.placeholder}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          value={d.query}
          onChange={(e) => api.set({ query: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-body text-body-l text-navy-900 outline-none placeholder:text-grey-500"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto pt-1" data-testid="party-list">
        {rows.map((p) => {
          const on = d.people.includes(p.handle)
          const t = partyLines(p, ctx.content)
          return (
            <li key={p.id}>
              {/* biome-ignore lint/a11y/useSemanticElements: the row is the checkbox */}
              <button
                type="button"
                data-testid={`party-${p.handle.replace('@', '')}`}
                role="checkbox"
                aria-checked={on}
                disabled={!on && full}
                onClick={() => toggle(p)}
                className="flex min-h-[61px] w-full items-center gap-3 border-b border-line-100 py-2 text-left active:bg-line-100 disabled:opacity-40"
              >
                <span
                  aria-hidden="true"
                  className={`flex size-6 shrink-0 items-center justify-center border-2 ${
                    on ? 'border-navy-900 bg-navy-900 text-white' : 'border-line-300 bg-surface'
                  }`}
                >
                  {on && <Check size={16} strokeWidth={2.5} />}
                </span>
                <PartyAvatar party={p} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-body text-body font-semibold text-navy-900">{t.first}</span>
                  <span className="block truncate font-body text-body-s text-grey-600">{t.second}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p data-testid="people-count" className="py-3 font-body text-body-s text-grey-600">
        {n > 0 && fill(n === 1 ? ui.split.peopleSelected : ui.split.peopleSelectedMany, { n })}
        {full && ` ${fill(ui.split.tooMany, { max: MAX_SPLIT_SHARES })}`}
      </p>
    </div>
  )
}

// ---- how it is split

function SharesBody({ d, ctx, api }: StepProps<Draft>) {
  const { total, shares, own, over } = figures(d, ctx)
  const custom = d.mode === 'custom'
  const active = d.active ?? shares[0]?.party.handle ?? null
  const maxMinor = limitFor(ctx.state, ctx.persona)
  const press = (key: string) => {
    if (!custom || active === null) return
    api.set({ custom: { ...d.custom, [active]: keypadInput(d.custom[active] ?? '', key, maxMinor) } })
  }
  const seg = (mode: Draft['mode'], label: string) => (
    <button
      type="button"
      data-testid={`mode-${mode}`}
      aria-pressed={d.mode === mode}
      onClick={() => api.set({ mode })}
      className={`h-[45px] flex-1 border font-display text-[16px] font-semibold ${
        d.mode === mode ? 'border-navy-900 bg-navy-900 text-white' : 'border-navy-900 bg-surface text-navy-900'
      }`}
    >
      {label}
    </button>
  )
  const amountText = (a: Minor) => `${formatMinor(a)} ${ui.common.bcps}`
  const row = 'flex min-h-11 items-center justify-between gap-4 border-b border-line-100 px-3.5 py-1.5 last:border-b-0'
  return (
    // biome-ignore lint/a11y/useSemanticElements: a keypad region that takes keyboard input
    <div
      role="group"
      aria-label={ui.steps.keypad}
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col px-5 outline-none"
      onKeyDown={(e) => {
        const key = keypadKeyOf(e)
        if (key === null || !custom) return
        press(key)
        e.preventDefault()
      }}
    >
      <h2 className="pt-4 font-display text-display-m text-navy-900">{ui.split.sharesTitle}</h2>
      <div className="mt-3.5 flex">
        {seg('equal', ui.split.equal)}
        {seg('custom', ui.split.custom)}
      </div>
      <div className="mt-3.5 min-h-0 flex-1 overflow-y-auto">
        <dl className="border border-line-200 bg-surface" data-testid="shares">
          <div className={row} data-testid="share-you">
            <dt className="font-body text-body-s text-grey-600">{ui.split.you}</dt>
            <dd className="font-body text-body font-semibold text-navy-900 tnum">{amountText(own)}</dd>
          </div>
          {shares.map((x) => {
            const on = custom && active === x.party.handle
            const inner = (
              <>
                <dt className="font-body text-body-s text-grey-600">{x.party.handle}</dt>
                <dd className={`font-body text-body font-semibold tnum ${on ? 'text-navy-900' : 'text-navy-900'}`}>
                  {custom && d.custom[x.party.handle] === undefined ? '0.00' : amountText(x.amount)}
                </dd>
              </>
            )
            return custom ? (
              <div key={x.party.id} className={`${row} ${on ? 'bg-green-50' : ''}`}>
                <button
                  type="button"
                  data-testid={`share-${x.party.handle.replace('@', '')}`}
                  aria-pressed={on}
                  onClick={() => api.set({ active: x.party.handle })}
                  className="flex w-full items-center justify-between gap-4 text-left"
                >
                  {inner}
                </button>
              </div>
            ) : (
              <div key={x.party.id} className={row} data-testid={`share-${x.party.handle.replace('@', '')}`}>
                {inner}
              </div>
            )
          })}
          <div className={row} data-testid="share-total">
            <dt className="font-body text-body-s text-grey-600">{ui.split.total}</dt>
            <dd className="font-body text-body font-semibold text-navy-900 tnum">{amountText(total)}</dd>
          </div>
        </dl>
      </div>
      {over && (
        <ErrorLine className="py-2">{errorText({ code: 'invalid-amount', max: total }, { about: 'shares' })}</ErrorLine>
      )}
      {custom && <AmountKeys onPress={press} compact />}
    </div>
  )
}

// ---- the check

function ReviewBody({ d, ctx, api }: StepProps<Draft>) {
  const { source, total, note, people, n, shares, own } = figures(d, ctx)
  const edit = (step: string) => () => api.goto(step, { editing: true })
  const other = source ? counterpartyOf(ctx.state, source.to, source.party) : undefined
  const payment = other && source ? `${partyLabel(other)} · ${note}` : note
  const fee = n === 1 && shares[0] ? quoteFor(ctx.state, ctx.persona, 'username', shares[0].amount)?.fee : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5">
      <h2 className="pt-4 pb-3.5 font-display text-display-m text-navy-900">{ui.split.reviewTitle}</h2>
      <FactsCard
        accent
        facts={[
          {
            label: ui.split.rowPayment,
            value: payment,
            sub: `${formatMinor(total)} ${ui.common.bcps}`,
            ...(d.fixed ? {} : { onEdit: edit(source ? 'pick' : 'amount') }),
          },
          {
            label: ui.split.rowSplit,
            value: fill(d.mode === 'equal' ? ui.split.splitEqual : ui.split.splitCustom, { n: n + 1 }),
            onEdit: edit('shares'),
          },
          ...shares.map((x) => ({
            label: fill(ui.split.pays, { name: x.party.handle }),
            value: `${formatMinor(x.amount)} ${ui.common.bcps}`,
            sub: approx(x.amount, ctx.rate),
          })),
          {
            label: source ? ui.split.youPaid : ui.split.yourShare,
            value: `${formatMinor(own)} ${ui.common.bcps}`,
          },
        ]}
      />
      <InfoNote>
        {n === 1 && people[0] && fee !== undefined
          ? fill(ui.split.feeOne, { name: firstName(people[0]), fee: formatMinor(fee) })
          : ui.split.feeMany}
      </InfoNote>
    </div>
  )
}

export const splitFlow: FlowImpl<Draft> = {
  id: 'split',
  title: () => ui.split.title,
  tone: () => 'light',
  init: (ctx) => {
    const chosen = ctx.params.txId
    const first = chosen ?? splitCandidates(ctx.state, ctx.persona)[0]?.id ?? null
    return {
      source: first,
      fixed: chosen !== undefined,
      total: '',
      note: '',
      people: [],
      query: '',
      mode: 'equal',
      custom: {},
      active: null,
    }
  },
  openOn: (d) => (d.fixed ? 'people' : 'pick'),
  steps: [
    {
      id: 'pick',
      screen: 'c.split.pick',
      kind: 'input',
      skip: (d) => d.fixed,
      Screen: PickBody,
      primary: (d) => ({ label: ui.common.continue, tone: 'navy', enabled: d.source !== null }),
      secondary: (_d, _ctx, api) => ({
        kind: 'link',
        label: ui.split.enterAmount,
        onPress: () => {
          api.set({ source: null })
          api.next()
        },
      }),
    },
    {
      id: 'amount',
      screen: 'c.split.amount',
      kind: 'input',
      skip: (d) => d.source !== null,
      Screen: AmountBody,
      primary: (d) => ({ label: ui.common.continue, tone: 'navy', enabled: parseAmount(d.total) > 0 }),
    },
    {
      id: 'note',
      screen: 'c.split.note',
      kind: 'input',
      skip: (d) => d.source !== null,
      Screen: NoteBody,
      primary: (d) => ({ label: ui.common.continue, tone: 'navy', enabled: d.note.trim().length > 0 }),
    },
    {
      id: 'people',
      screen: 'c.split.people',
      kind: 'input',
      Screen: PeopleBody,
      primary: (d) => ({ label: ui.common.continue, tone: 'navy', enabled: d.people.length > 0 }),
    },
    {
      id: 'shares',
      screen: 'c.split.shares',
      kind: 'input',
      Screen: SharesBody,
      primary: (d, ctx) => ({ label: ui.common.continue, tone: 'navy', enabled: figures(d, ctx).ready }),
    },
    {
      id: 'review',
      screen: 'c.split.review',
      kind: 'review',
      Screen: ReviewBody,
      primary: (d, ctx) => {
        const { n, ready } = figures(d, ctx)
        return {
          label: n === 1 ? ui.split.sendOne : fill(ui.split.sendMany, { n }),
          tone: 'navy',
          enabled: ready,
        }
      },
    },
  ],
  commits: [
    {
      step: 'review',
      await: 'none',
      refusal: () => ({ about: 'shares' }),
      command: (d, ctx, cmdId) => {
        const { source, total, note, shares, ready } = figures(d, ctx)
        if (!ready) return null
        return {
          type: 'split.create',
          actor: ctx.persona,
          cmdId,
          ...(source ? { sourceTxId: source.id } : {}),
          total,
          note,
          shares: shares.map((x) => ({ party: x.party.handle, amount: x.amount })),
        }
      },
      onAccepted: (_d, ctx, api, cmdId) => {
        const made = splitByCmdId(ctx.app.runtime.node.getState(), cmdId)
        if (made) api.set({ splitId: made.id })
      },
    },
  ],
  done: (d) => d.splitId !== undefined,
  Success: ({ d, ctx, done }) => {
    const { note, n, shares } = figures(d, ctx)
    const first = shares[0]
    return (
      <SuccessScreen
        id="c.split.sent"
        variant="neutral"
        overline={ui.split.sentOverline}
        title={ui.split.sentTitle}
        body={
          n === 1 && first
            ? fill(ui.split.sentBodyOne, { amount: formatMinor(first.amount), handle: first.party.handle, note })
            : fill(ui.split.sentBodyMany, { n, note })
        }
        lines={d.splitId ? [{ label: ui.receipt.reference, value: d.splitId, mono: true }] : []}
        onDone={done}
      />
    )
  },
}
