import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { LedgerEvent, LedgerState, MerchantSettingsPatch, UserCommand } from '@domain/types'
import { decodeCommand, encodeCommand } from '@store/log-codec'
import { checkWireCommand } from '@store/record'
import { replay } from '@store/replay'
import { quoteFor } from '@store/selectors'
import { type Headless, headless } from '../support/journey'
import { recordOf } from '../support/records'
import { content, m } from './helpers'

// merchant.settings: who pays the fee on new sales, and the auto-convert schedule (saved and shown,
// nothing converts).

let n = 0
const id = (step = 'settings') => `${(++n).toString(16).padStart(16, '0')}:${step}`
const settings = (patch: unknown, actor = 'cafe'): UserCommand =>
  ({ type: 'merchant.settings', actor, cmdId: id(), patch }) as UserCommand
const run = (h: Headless, c: UserCommand): LedgerEvent[] => {
  const r = h.node.dispatch(c)
  if (!r.ok) throw new Error(`refused ${r.error.code}`)
  return r.value
}
const refusal = (h: Headless, c: UserCommand) => {
  const r = h.node.dispatch(c)
  return r.ok ? 'accepted' : r.error
}
const bal = (s: LedgerState, a: string) => formatHundredths(s.balances[a]?.confirmed ?? Number.NaN)
const cafe = (h: Headless) => h.node.getState().merchant.cafe as NonNullable<LedgerState['merchant'][string]>

describe('who pays the fee on sales', () => {
  it('the café switches to "Customer pays": a new code snapshots it, the customer pays on top', () => {
    const h = headless('2026-09-25')
    expect(cafe(h).feePayer).toBe('recipient')
    const events = run(h, settings({ feePayer: 'sender' }))
    expect(events.map((e) => e.type)).toEqual(['merchant.settings'])
    expect(events[0]).toMatchObject({ persona: 'cafe', settings: { feePayer: 'sender' } })
    expect(cafe(h).feePayer).toBe('sender')
    // A Brunch code for 13.20: Ana pays 13.33, the café receives 13.20.
    run(h, { type: 'request.create', actor: 'cafe', cmdId: id('items'), channel: 'pos', amount: m('13.20') })
    const code = Object.values(h.node.getState().requests).find((r) => r.channel === 'pos')
    expect(code).toMatchObject({ feePayer: 'sender', policy: 'merchant' })
    if (!code) return
    run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId: id('review'),
      to: '@cafelipa',
      amount: m('13.20'),
      channel: 'qr',
      requestId: code.id,
      expect: { senderDebit: m('13.33') },
    })
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('234.17')
    expect(bal(h.node.getState(), 'cafe')).toBe('299.20')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('a code that is already open keeps the payer it was made with', () => {
    const h = headless('2026-09-25')
    run(h, { type: 'request.create', actor: 'cafe', cmdId: id('items'), channel: 'pos', amount: m('11.00') })
    const code = Object.values(h.node.getState().requests).find((r) => r.channel === 'pos')
    run(h, settings({ feePayer: 'sender' }))
    expect(h.node.getState().requests[code?.id ?? '']?.feePayer).toBe('recipient')
    run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId: id('review'),
      to: '@cafelipa',
      amount: m('11.00'),
      channel: 'qr',
      requestId: code?.id,
      expect: { senderDebit: m('11.00') },
    })
    h.node.settleDue()
    expect(bal(h.node.getState(), 'cafe')).toBe('296.89')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('the counter code follows the setting: an 11.00 code reads 11.11; a stale review is quote-changed with the new total', () => {
    const h = headless('2026-09-25')
    const counter = (senderDebit: string): UserCommand => ({
      type: 'pay',
      actor: 'ana',
      cmdId: id('review'),
      to: '@cafelipa',
      amount: m('3.30'),
      channel: 'qr',
      expect: { senderDebit: m(senderDebit) },
    })
    expect(quoteFor(h.node.getState(), 'cafe', 'qr', m('11.00'))?.senderDebit).toBe(1100)
    const stale = counter('3.30')
    run(h, settings({ feePayer: 'sender' }))
    expect(quoteFor(h.node.getState(), 'cafe', 'qr', m('11.00'))?.senderDebit).toBe(1111)
    expect(refusal(h, stale)).toEqual({ code: 'quote-changed', senderDebit: m('3.33') })
    expect(bal(h.node.getState(), 'ana')).toBe('247.50')
    run(h, counter('3.33'))
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('244.17')
    expect(bal(h.node.getState(), 'cafe')).toBe('289.30')
  })

  it('the studio can change it too; the trade businesses and people cannot', () => {
    const h = headless('2026-09-25')
    run(h, settings({ feePayer: 'sender' }, 'studio'))
    expect(h.node.getState().merchant.studio?.feePayer).toBe('sender')
    expect(refusal(h, settings({ feePayer: 'sender' }, 'firm'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, settings({ feePayer: 'sender' }, 'supplier'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, settings({ feePayer: 'sender' }, 'ana'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, settings({ feePayer: 'sender' }, 'nobody'))).toEqual({ code: 'not-allowed' })
    expect(h.node.getState().merchant.firm?.feePayer).toBe('recipient')
  })

  it('saving what is already set is accepted', () => {
    const h = headless('2026-09-25')
    run(h, settings({ feePayer: 'recipient' }))
    expect(cafe(h).feePayer).toBe('recipient')
  })
})

describe('the auto-convert schedule', () => {
  it('30 % at 22:00: saved; the café stays otherwise as it was', () => {
    const h = headless('2026-09-25')
    const before = cafe(h).autoConvert
    run(h, settings({ autoConvert: { sharePct: 30, atLocal: '22:00' } }))
    expect(cafe(h).autoConvert).toEqual({ ...before, sharePct: 30, atLocal: '22:00' })
    expect(cafe(h).feePayer).toBe('recipient')
  })

  it('every day, weekdays or weekly: the days follow the schedule', () => {
    const h = headless('2026-09-25')
    run(h, settings({ autoConvert: { schedule: 'weekdays' } }))
    expect(cafe(h).autoConvert).toMatchObject({ schedule: 'weekdays', weekdays: [1, 2, 3, 4, 5] })
    run(h, settings({ autoConvert: { schedule: 'weekly' } }))
    expect(cafe(h).autoConvert).toMatchObject({ schedule: 'weekly', weekdays: [1] })
    run(h, settings({ autoConvert: { schedule: 'daily' } }))
    expect(cafe(h).autoConvert).toMatchObject({ schedule: 'daily', weekdays: [] })
    // The studio's weekly day is kept when only the time changes.
    run(h, settings({ autoConvert: { atLocal: '18:00' } }, 'studio'))
    expect(h.node.getState().merchant.studio?.autoConvert).toMatchObject({
      schedule: 'weekly',
      weekdays: [1],
      atLocal: '18:00',
    })
  })

  it('turned on and off; every time and share the sheet offers is accepted', () => {
    const h = headless('2026-09-25')
    run(h, settings({ autoConvert: { enabled: false } }))
    expect(cafe(h).autoConvert.enabled).toBe(false)
    run(h, settings({ autoConvert: { enabled: true } }))
    for (const atLocal of ['18:00', '20:00', '22:00', '23:00']) {
      run(h, settings({ autoConvert: { atLocal } }))
      expect(cafe(h).autoConvert.atLocal).toBe(atLocal)
    }
    for (const sharePct of [10, 20, 50, 90, 100]) {
      run(h, settings({ autoConvert: { sharePct } }))
      expect(cafe(h).autoConvert.sharePct).toBe(sharePct)
    }
    run(h, settings({ autoConvert: { onlyOnDaysWithSales: false } }))
    expect(cafe(h).autoConvert.onlyOnDaysWithSales).toBe(false)
  })

  it('refuses a time, a share or a schedule the sheet does not offer, and unknown or empty patches', () => {
    const h = headless('2026-09-25')
    for (const autoConvert of [
      { atLocal: '21:00' },
      { atLocal: '7:00' },
      { sharePct: 5 },
      { sharePct: 15 },
      { sharePct: 110 },
      { sharePct: 0 },
      { sharePct: 50.5 },
      { schedule: 'custom' },
      { enabled: 'yes' },
      { onlyOnDaysWithSales: 1 },
      { weekdays: [1, 2] },
      {},
    ]) {
      expect(refusal(h, settings({ autoConvert })), JSON.stringify(autoConvert)).toEqual({ code: 'invalid-state' })
    }
    expect(refusal(h, settings({}))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, settings({ colour: 'red' }))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, settings({ feePayer: 'nobody' }))).toEqual({ code: 'invalid-state' })
    expect(refusal(h, settings(null))).toEqual({ code: 'invalid-state' })
    expect(cafe(h).autoConvert).toMatchObject({ enabled: true, sharePct: 50, atLocal: '23:00' })
  })

  it('a person cannot; a trade business has no "only on days with sales" choice', () => {
    const h = headless('2026-09-25')
    expect(refusal(h, settings({ autoConvert: { sharePct: 30 } }, 'ana'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, settings({ autoConvert: { onlyOnDaysWithSales: true } }, 'firm'))).toEqual({
      code: 'not-allowed',
    })
    run(h, settings({ autoConvert: { enabled: true, sharePct: 30, atLocal: '22:00' } }, 'firm'))
    expect(h.node.getState().merchant.firm?.autoConvert).toMatchObject({
      enabled: true,
      sharePct: 30,
      atLocal: '22:00',
      onlyOnDaysWithSales: false,
    })
  })

  it('nothing converts by itself: past the scheduled time the balances are untouched (D34)', () => {
    const h = headless('2026-09-25')
    run(h, settings({ autoConvert: { sharePct: 30, atLocal: '22:00' } }))
    h.node.advanceTo((h.node.now() + 36 * 3_600_000) as never, 'timer')
    expect(bal(h.node.getState(), 'cafe')).toBe('286.00')
    expect(Object.keys(h.node.getState().ramps)).toEqual([])
    expect(h.node.events().map((e) => e.type)).toEqual(['merchant.settings'])
  })
})

describe('the log form of a settings change', () => {
  it('is stored as it is and replays to the same ledger', () => {
    const h = headless('2026-09-25')
    const patches: MerchantSettingsPatch[] = [
      { feePayer: 'sender' },
      {
        autoConvert: {
          sharePct: 30,
          atLocal: '22:00',
          schedule: 'weekdays',
          enabled: true,
          onlyOnDaysWithSales: false,
        },
      },
    ]
    for (const patch of patches) {
      const c = settings(patch)
      const wire = encodeCommand(h.node.getState(), c)
      expect(wire).toEqual({ ok: true, value: { type: 'merchant.settings', patch } })
      if (!wire.ok) return
      expect(checkWireCommand(wire.value)).toBeNull()
      expect(decodeCommand(h.node.getState(), content, { actor: 'cafe', cmdId: c.cmdId, cmd: wire.value })).toEqual({
        ok: true,
        value: c,
      })
      run(h, c)
    }
    const record = recordOf(h.node, h.seed.t0Date)
    const r = replay({
      seed: h.seed.state,
      t0: h.seed.t0,
      t0Date: h.seed.t0Date,
      content,
      log: record.log,
      clock: record.clock,
    })
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    expect(JSON.stringify(r.value.state)).toBe(JSON.stringify(h.node.getState()))
  })

  it('a stored patch the sheet could not have made is refused by the file rules', () => {
    for (const patch of [
      { autoConvert: { atLocal: '21:00' } },
      { autoConvert: { schedule: 'custom' } },
      { feePayer: 'nobody' },
      { extra: 1 },
    ]) {
      expect(checkWireCommand({ type: 'merchant.settings', patch } as never)).not.toBeNull()
    }
  })
})
