import { describe, expect, it } from 'vitest'
import { ui } from '@app/copy'
import { RampRowView, rampSub, rowText, statusText } from '@app/phone/views/ActivityRow'
import { createAppState } from '@app/state/app'
import type { UserCommand } from '@domain/types'
import { type ActivityFilter, CAFE_FILTERS, PEOPLE_FILTERS, activity } from '@store/selectors'
import { type Headless, headless } from '../support/journey'
import { content, m } from './helpers'

// What the History list holds and says: the chips and the search over a person's payments, the
// requests and links that wait, a bank transfer on its way, and what the screen keeps of the chip
// and the search. The screen itself is drawn by the browser specs.

const TZ = content.config.t0.tz
let n = 0
const cmd = (c: Record<string, unknown>): UserCommand =>
  ({ ...c, cmdId: `${(0xb1b100 + ++n).toString(16).padStart(16, '0')}:t` }) as UserCommand
const run = (h: Headless, c: Record<string, unknown>) => {
  const r = h.node.dispatch(cmd(c))
  if (!r.ok) throw new Error(`refused ${r.error.code}`)
  return r.value
}

const labelOf = (h: Headless, persona: string) => (tx: Parameters<typeof rowText>[0]['tx']) => {
  const s = h.node.getState()
  const text = rowText(
    {
      tx,
      signed: (tx.from === persona ? -tx.amount : tx.amount) as never,
      direction: tx.from === persona ? 'out' : 'in',
      at: tx.createdAt,
      pending: tx.status === 'pending',
    },
    s,
    persona,
    TZ,
  )
  return `${text.title} ${text.sub}`
}

const count = (h: Headless, persona: string, filter: ActivityFilter, query = '') =>
  activity(h.node.getState(), persona, h.node.now(), TZ, {
    filter,
    query,
    status: true,
    label: labelOf(h, persona),
  }).flatMap((g) => [...g.rows, ...g.status, ...g.ramps]).length

describe('History chips and search from a fresh start', () => {
  it('Ana: All 7 payments and the Lunch request; each chip holds what it names', () => {
    const h = headless('2026-09-25')
    expect(count(h, 'ana', 'all')).toBe(8)
    expect(count(h, 'ana', 'in')).toBe(4)
    expect(count(h, 'ana', 'out')).toBe(3)
    expect(count(h, 'ana', 'shops')).toBe(2)
    expect(count(h, 'ana', 'people')).toBe(3)
    expect(count(h, 'ana', 'topupsCashouts')).toBe(2)
    expect(count(h, 'ana', 'requests')).toBe(1)
  })

  it('search finds a person, a note, an item and what a row says; nothing else matches', () => {
    const h = headless('2026-09-25')
    expect(count(h, 'ana', 'all', 'pizza')).toBe(1)
    expect(count(h, 'ana', 'all', 'PIZZA')).toBe(1)
    expect(count(h, 'ana', 'all', '@marko')).toBe(3) // the concert, the taxi and the Lunch request
    expect(count(h, 'ana', 'all', 'espresso')).toBe(1)
    expect(count(h, 'ana', 'all', 'cafe')).toBe(2)
    expect(count(h, 'ana', 'all', 'zzz')).toBe(0)
    // The search stays inside the chip.
    expect(count(h, 'ana', 'in', 'pizza')).toBe(0)
  })

  it('every chip of both lists has a label and an empty state', () => {
    for (const chip of [...PEOPLE_FILTERS, ...CAFE_FILTERS]) {
      expect(ui.history.filters[chip]).toBeTruthy()
      expect(ui.empty.filters[chip].title).toMatch(/\.$/)
      expect(ui.empty.filters[chip].body).toMatch(/\.$/)
    }
  })

  it('the café: its own chips split sales, refunds, supplier payments, payouts and top-ups', () => {
    const h = headless('2026-09-25')
    const all = count(h, 'cafe', 'all')
    const parts = (['sales', 'refunds', 'suppliers', 'payouts', 'topups'] as const).map((c) => count(h, 'cafe', c))
    expect(all).toBeGreaterThan(0)
    expect(parts[1]).toBe(0)
    expect(parts[0]).toBeGreaterThan(0)
    expect(parts[3]).toBeGreaterThan(0)
  })
})

describe('Requests, links and splits in the list', () => {
  it('a request Ana makes waits under All and Requests, and says so; declined shows DECLINED', () => {
    const h = headless('2026-09-25')
    run(h, {
      type: 'request.create',
      actor: 'ana',
      channel: 'username',
      payer: '@marko',
      amount: m('13.20'),
      note: 'Lunch',
    })
    const s = h.node.getState()
    const groups = activity(s, 'ana', h.node.now(), TZ, { filter: 'requests', status: true })
    const rows = groups.flatMap((g) => g.status)
    expect(rows.map((r) => [r.direction, r.status, r.note])).toEqual([
      ['waiting', 'open', 'Lunch'],
      ['to-pay', 'open', 'Lunch'],
    ])
    const mine = rows[0]
    if (!mine) throw new Error('no row')
    expect(statusText(mine, TZ)).toMatchObject({ title: '@marko · Lunch', sub: 'You asked · 12:15', openable: true })
    const theirs = rows[1]
    if (!theirs) throw new Error('no row')
    expect(statusText(theirs, TZ)).toMatchObject({ title: '@marko · Lunch', sub: 'Asked you · 11:52' })
    // Marko declines the new one: it stays in the list with its outcome.
    const requestId = mine.id
    run(h, { type: 'request.decline', actor: 'marko', requestId })
    const after = activity(h.node.getState(), 'ana', h.node.now(), TZ, { filter: 'requests', status: true })
    expect(after.flatMap((g) => g.status).map((r) => r.status)).toContain('declined')
  })

  it('a payment link Ana made waits as her link; the one shared with Marko is his to pay', () => {
    const h = headless('2026-09-25')
    run(h, { type: 'link.create', actor: 'ana', amount: m('13.20'), note: 'Pizza' })
    const linkId = Object.keys(h.node.getState().links)[0] ?? ''
    run(h, { type: 'link.share', actor: 'ana', linkId, to: '@marko' })
    const ana = activity(h.node.getState(), 'ana', h.node.now(), TZ, { filter: 'requests', status: true })
    const row = ana.flatMap((g) => g.status).find((r) => r.kind === 'link')
    expect(row && statusText(row, TZ)).toMatchObject({ title: 'Pizza', sub: 'Your payment link · 12:15' })
    const marko = activity(h.node.getState(), 'marko', h.node.now(), TZ, { filter: 'requests', status: true })
    const theirs = marko.flatMap((g) => g.status).find((r) => r.kind === 'link')
    expect(theirs).toMatchObject({ direction: 'to-pay', status: 'open' })
    expect(theirs && statusText(theirs, TZ).sub).toBe('Payment link for you · 12:15')
  })
})

describe('A bank transfer that has not arrived', () => {
  it('is a PENDING row of its own under All, Money in, Top-ups & cash-outs; it becomes the payment when it arrives', () => {
    const h = headless('2026-09-25')
    run(h, { type: 'ramp.on', actor: 'ana', method: 'bank-transfer', eur: 50 })
    for (const chip of ['all', 'in', 'topupsCashouts'] as const) {
      const rows = activity(h.node.getState(), 'ana', h.node.now(), TZ, { filter: chip }).flatMap((g) => g.ramps)
      expect(rows, chip).toHaveLength(1)
      expect(rows[0] && rampSub(rows[0])).toBe('Bank transfer · on its way')
    }
    for (const chip of ['out', 'shops', 'people', 'requests'] as const) {
      const rows = activity(h.node.getState(), 'ana', h.node.now(), TZ, { filter: chip }).flatMap((g) => g.ramps)
      expect(rows, chip).toHaveLength(0)
    }
    expect(RampRowView).toBeTypeOf('function')
    // A search for it finds it by what it says.
    const found = activity(h.node.getState(), 'ana', h.node.now(), TZ, {
      query: 'on its way',
      rampLabel: (ramp) =>
        rampSub({ ramp, signed: ramp.amount, at: ramp.requestedAt, arrivesAt: ramp.arrivesAt ?? ramp.requestedAt }),
    })
    expect(found.flatMap((g) => g.ramps)).toHaveLength(1)
    // 2 h later it has arrived: no ramp row, a top-up payment.
    h.node.advanceTo((h.node.now() + 2 * 3600_000) as never, 'timer')
    h.node.settleDue()
    const s = h.node.getState()
    const groups = activity(s, 'ana', h.node.now(), TZ, { filter: 'topupsCashouts' })
    expect(groups.flatMap((g) => g.ramps)).toHaveLength(0)
    const arrived = groups.flatMap((g) => g.rows).find((r) => r.tx.rampId !== undefined)
    if (!arrived) throw new Error('no top-up payment')
    const text = rowText(arrived, s, 'ana', TZ)
    expect(text).toMatchObject({ title: 'Top up', openable: true })
    expect(text.sub).toMatch(/ · Bank transfer$/)
  })
})

describe('What the History screen keeps', () => {
  it('the chip and the search of each account are kept apart while the page stays open', () => {
    const app = createAppState({
      content,
      build: 'dev',
      storage: null,
      locks: null,
      timers: null,
      clock: { mode: 'manual' },
      epochDate: () => '2026-09-25',
    })
    app.actions.setHistory('ana', { filter: 'requests', query: 'lunch' })
    app.actions.setHistory('marko', { filter: 'in', query: '' })
    const kept = app.transient.get().history
    expect(kept.ana).toEqual({ filter: 'requests', query: 'lunch' })
    expect(kept.marko).toEqual({ filter: 'in', query: '' })
  })
})
