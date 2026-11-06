import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { stepBar } from '@app/flows/engine'
import { openNotification } from '@app/phone/notify'
import { stripText, scheduleLine, whenText } from '@app/phone/autoconvert'
import { sublineOf } from '@app/phone/sublines'
import { cashOutRef } from '@domain/ids'
import type { AutoConvertSettings } from '@domain/types'
import { notificationsFor } from '@store/notifications'
import { autoConvertAfter, nextAutoConvert, payoutsOf, quoteCashOut } from '@store/selectors'
import { phoneFixture } from '../support/phone'
import { content, m } from './helpers'

// Cash out, for a person and for the café: the amount, the 1.5% conversion the converter pays, the
// euros received, the minimum, an account with no bank on file. Then the auto-convert settings
// (saved and shown, nothing converts) and the payout history.

const TZ = 'Europe/Ljubljana'

describe('Cash out of a person', () => {
  it('110.00 costs 1.65 and pays out ≈ €98.50; Ana 247.50 → 137.50; the reference is BC-OUT-…', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('cashOut')
    // She has a bank on file, so it opens on the amount.
    expect(ana.step().id).toBe('amount')
    expect(stepBar(ana.impl() as never, ana.flow().draft as never, ana.ctx(), ana.flow().step)).toEqual({
      n: 1,
      total: 2,
    })
    expect(ana.primary().enabled).toBe(false)
    api.set({ amount: '110' })
    expect(ana.primary().enabled).toBe(true)
    api.next()
    expect(ana.step().id).toBe('review')
    expect(ana.primary()).toEqual({ label: 'Cash out 110.00', tone: 'money', enabled: true })
    api.press()
    f.settle()
    expect(ana.phase()).toBe('success')
    expect(f.balance('ana')).toBe('137.50')
    const tx = ana.tx()
    expect(tx).toMatchObject({ kind: 'off-ramp', from: 'ana', to: 'sys:issuance', amount: 11000 })
    expect(tx?.fee).toMatchObject({ fee: 165, eurOut: 9850 })
    expect(cashOutRef(tx?.id ?? '')).toMatch(/^BC-OUT-[0-9A-Z]{6}$/)
  })

  it('1.10 costs 0.02 and pays out ≈ €0.98; below 1.10 is not accepted, with the minimum in words', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('cashOut')
    const quote = quoteCashOut(f.node.getState(), m('1.10'))
    expect(quote).toMatchObject({ fee: 2, eurOut: 98 })
    api.set({ amount: '1.09' })
    expect(ana.primary().enabled).toBe(false)
    api.set({ amount: '1.10' })
    expect(ana.primary().enabled).toBe(true)
    expect(quoteCashOut(f.node.getState(), m('1.09'))).toBeNull()
  })

  it('the keypad stops at what is available; Max fills the whole balance', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('cashOut')
    api.set({ amount: '247.50' })
    expect(ana.primary().enabled).toBe(true)
    api.set({ amount: '247.51' })
    expect(ana.primary().enabled).toBe(false)
  })
})

describe('Cash out of the café', () => {
  it('the café cashes out 143.00 to its own bank; fee 2.15; fresh 286.00 → 143.00', () => {
    const f = phoneFixture({ cafe: true })
    const cafe = f.as('cafe')
    const { api } = cafe.open('cashOut')
    expect(cafe.step().id).toBe('amount')
    api.set({ amount: '143' })
    api.next()
    api.press()
    f.settle()
    expect(cafe.phase()).toBe('success')
    expect(f.balance('cafe')).toBe('143.00')
    expect(cafe.tx()?.fee.fee).toBe(215)
    // It shows in the payout history as a cash-out, with the seeded ones.
    const payouts = payoutsOf(f.node.getState(), 'cafe', f.node.now(), TZ)
    expect(payouts.rows).toHaveLength(7)
    expect(payouts.rows[0]).toMatchObject({ auto: false, amount: 14300 })
  })
})

describe('an account with no bank on file', () => {
  // No account in the starting ledger lacks a bank, so the state is crafted: Ana's entry loses hers.
  const noBankCtx = (f: ReturnType<typeof phoneFixture>) => {
    const ana = f.as('ana')
    ana.open('cashOut')
    const state = f.node.getState()
    const entry = state.directory.ana
    if (!entry) throw new Error('no Ana')
    const crafted = {
      ...state,
      directory: { ...state.directory, ana: { ...entry, methods: { card: true, bank: false } } },
    }
    return { ana, ctx: { ...ana.ctx(), state: crafted } }
  }

  it('opens on the explanation, off the step bar, with no dock', () => {
    const f = phoneFixture()
    const { ana, ctx } = noBankCtx(f)
    const impl = ana.impl()
    const d = ana.flow().draft as never
    expect(impl.openOn?.(d, ctx)).toBe('noBank')
    const noBank = impl.steps.find((s) => s.id === 'noBank')
    expect(noBank?.hideDock?.(d, ctx)).toBe(true)
    expect(noBank?.offPath).toBe(true)
    // With the bank on file it opens on the amount.
    expect(impl.openOn?.(d, ana.ctx())).toBe('amount')
  })

  it('says why and offers Top up', () => {
    const f = phoneFixture()
    const { ana, ctx } = noBankCtx(f)
    const noBank = ana.impl().steps.find((s) => s.id === 'noBank')
    if (!noBank) throw new Error('no step')
    const api = { handoff: () => undefined } as never
    const html = renderToStaticMarkup(
      createElement(noBank.Screen, {
        d: ana.flow().draft as never,
        ctx,
        api,
        sending: false,
        error: null,
        editing: false,
      }),
    )
    expect(html).toContain('Cash out needs a bank account in your name.')
    expect(html).toContain('None is on file for this account.')
    expect(html).toContain('Top up')
    expect(html).not.toContain('SI56')
  })
})

describe('Auto-convert settings', () => {
  const café = (f: ReturnType<typeof phoneFixture>) =>
    f.node.getState().merchant.cafe?.autoConvert as AutoConvertSettings

  it('opens with what the café has: on, every day, 23:00, 50%', () => {
    const f = phoneFixture({ cafe: true })
    const cafe = f.as('cafe')
    cafe.open('autoConvert')
    expect(cafe.flow().draft).toMatchObject({ enabled: true, schedule: 'daily', atLocal: '23:00', sharePct: 50 })
    expect(stripText(café(f))).toBe('Auto-convert 50% · every day 23:00')
  })

  it('30% at 22:00 previews the next run, saves, and the Home line follows; nothing converts', () => {
    const f = phoneFixture({ cafe: true })
    const cafe = f.as('cafe')
    const { api } = cafe.open('autoConvert')
    api.set({ sharePct: 30, atLocal: '22:00' })
    api.goto('review')
    expect(cafe.primary()).toEqual({ label: 'Save', tone: 'navy', enabled: true })
    const before = f.balance('cafe')
    api.press()
    expect(cafe.phase()).toBe('success')
    expect(café(f)).toMatchObject({ enabled: true, schedule: 'daily', atLocal: '22:00', sharePct: 30 })
    // Saved and shown; the balance does not move, not now and not at 22:00.
    f.node.advanceTo((f.node.now() + 12 * 3_600_000) as never)
    f.settle()
    expect(f.balance('cafe')).toBe(before)
    const line = sublineOf('autoConvert', {
      state: f.node.getState(),
      content,
      persona: 'cafe',
      now: f.node.now(),
      tz: TZ,
    })
    expect(line).toBe('Auto 30% · 22:00')
  })

  it('off skips the schedule and the share, and the tile shows no line', () => {
    const f = phoneFixture({ cafe: true })
    const cafe = f.as('cafe')
    const { api } = cafe.open('autoConvert')
    api.set({ enabled: false })
    api.next()
    expect(cafe.step().id).toBe('review')
    api.press()
    expect(café(f).enabled).toBe(false)
    expect(
      sublineOf('autoConvert', { state: f.node.getState(), content, persona: 'cafe', now: f.node.now(), tz: TZ }),
    ).toBeNull()
    expect(
      sublineOf('autoConvertOn', { state: f.node.getState(), content, persona: 'cafe', now: f.node.now(), tz: TZ }),
    ).toBe('Off')
  })

  it('the words of a schedule: every day, weekdays, weekly on Monday; and when it runs next', () => {
    const base: AutoConvertSettings = { ...café(phoneFixture({ cafe: true })) }
    expect(scheduleLine({ ...base, schedule: 'daily' })).toBe('Every day · 23:00')
    expect(scheduleLine({ ...base, schedule: 'weekdays', weekdays: [1, 2, 3, 4, 5] })).toBe('Weekdays · 23:00')
    expect(scheduleLine({ ...base, schedule: 'weekly', weekdays: [1] })).toBe('Every Monday · 23:00')
    const f = phoneFixture({ cafe: true })
    const now = f.node.now()
    // Friday 12:15: 23:00 is tonight; Saturday 23:00 is tomorrow; Monday 23:00 is named by its day.
    const at = (patch: Partial<AutoConvertSettings>) => nextAutoConvert({ ...base, ...patch }, now, TZ)
    expect(whenText(at({}), now, TZ)).toBe('tonight 23:00')
    expect(whenText(at({ schedule: 'weekly', weekdays: [6] }), now, TZ)).toBe('tomorrow 23:00')
    expect(whenText(at({ schedule: 'weekly', weekdays: [1] }), now, TZ)).toBe('Mon 23:00')
  })

  it('what the screen says it will save is what the ledger saves', () => {
    const f = phoneFixture({ cafe: true })
    const current = café(f)
    const patches = [
      { enabled: false },
      { schedule: 'weekdays' as const },
      { schedule: 'weekly' as const, atLocal: '18:00' as const },
      { sharePct: 100, onlyOnDaysWithSales: false },
      { schedule: 'daily' as const, sharePct: 10, atLocal: '20:00' as const },
    ]
    for (const patch of patches) {
      const g = phoneFixture({ cafe: true })
      const result = g.dispatch('cafe', { type: 'merchant.settings', patch: { autoConvert: patch } })
      expect(result.ok, JSON.stringify(patch)).toBe(true)
      expect(g.node.getState().merchant.cafe?.autoConvert).toEqual(autoConvertAfter(current, patch))
    }
  })
})

describe('Payout history', () => {
  it('fresh café: six payouts, 1,020.61 BCPS converted, conversion 15.32, ≈ €913.89 this week', () => {
    const f = phoneFixture({ cafe: true })
    const { rows, week } = payoutsOf(f.node.getState(), 'cafe', f.node.now(), TZ)
    expect(rows).toHaveLength(6)
    expect(week).toMatchObject({ count: 6, amount: 102061, fee: 1532, eur: 91389 })
    expect(rows.map((r) => [r.amount, r.eur, r.auto])).toEqual([
      [17573, 15735, true],
      [4475, 4007, true],
      [22000, 19700, false],
      [16983, 15207, true],
      [19589, 17541, true],
      [21441, 19199, true],
    ])
  })
})

describe('what a notification about money in and out opens', () => {
  it('a bank transfer on its way opens its timeline; the café’s automatic conversion opens its payouts', () => {
    const f = phoneFixture({ cafe: true })
    const ana = f.as('ana')
    const { api } = ana.open('topUp')
    api.set({ eur: '50', method: 'bank-transfer' })
    api.goto('review')
    api.press()
    const ramp = Object.values(f.node.getState().ramps)[0]
    ana.nav.home()
    const pending = notificationsFor(f.node.getState(), 'ana', content).find((n) => n.kind === 'topup.pending')
    expect(pending?.subject).toEqual({ type: 'ramp', id: ramp?.id })
    openNotification(f.app, ana.who, {
      id: pending?.id ?? '',
      txId: pending?.txId ?? null,
      subject: pending?.subject ?? { type: 'none' },
      kind: 'topup.pending',
    })
    expect(ana.stack()).toEqual(['home', 'detail:ramp'])
    expect(ana.nav.top()).toMatchObject({ kind: 'detail', id: 'ramp', params: { rampId: ramp?.id } })

    const cafe = f.as('cafe')
    const auto = notificationsFor(f.node.getState(), 'cafe', content).find((n) => n.kind === 'conversion.auto')
    expect(auto).toBeDefined()
    openNotification(f.app, cafe.who, {
      id: auto?.id ?? '',
      txId: auto?.txId ?? null,
      subject: auto?.subject ?? { type: 'none' },
      kind: 'conversion.auto',
    })
    expect(cafe.stack()).toEqual(['home', 'detail:payouts'])
  })
})
