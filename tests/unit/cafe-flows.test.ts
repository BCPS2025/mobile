import { describe, expect, it } from 'vitest'
import '@app/phone/register'
import { createFlowApi } from '@app/flows/actions'
import type { Who } from '@app/flows/actions'
import { makeFlowCtx } from '@app/flows/ctx'
import { phaseOf, txOf } from '@app/flows/engine'
import type { FlowImpl } from '@app/flows/types'
import { flowImpl } from '@app/phone/implemented'
import { createPhoneNav } from '@app/phone/nav'
import type { FlowScreen } from '@app/phone/types'
import { createAppState } from '@app/state/app'
import { formatMinor } from '@domain/money'
import type { PersonaId, SimTime, UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import { latestPosRequest, openPosRequest, posCodeState } from '@store/selectors'
import { content, m } from './helpers'

// The café flows against a real app state and ledger: Charge (items or a custom amount, the code,
// its expiry, Cancel, PAID) and Pay supplier (the order opens on Review). The screens themselves
// are drawn by the browser specs.

const VALIDITY = content.config.posCodeValidityMin * 60_000

function fixture(opts: { stage?: boolean } = {}) {
  const app = createAppState({
    content,
    build: 'dev',
    storage: null,
    locks: null,
    timers: null,
    clock: { mode: 'manual' },
    epochDate: () => '2026-09-25',
  })
  const stage = opts.stage !== false
  if (stage) {
    app.actions.choose('left', 'ana')
    app.actions.choose('right', 'cafe')
  } else app.actions.choose('single', 'cafe')
  const whoOf = (persona: PersonaId): Who =>
    persona === 'cafe'
      ? { persona, slot: stage ? 'right' : 'single', shell: 'pos' }
      : { persona, slot: 'left', shell: 'consumer' }
  const who = whoOf('cafe')
  const nav = createPhoneNav(app, who)
  const node = app.runtime.node
  const flowNow = () => nav.top() as FlowScreen
  const open = (id: 'charge' | 'paySupplier', params?: Record<string, string>) => {
    nav.openFlow(id, params)
    const top = flowNow()
    return { top, api: createFlowApi<never>(app, who, top.instanceId) }
  }
  const ctx = () => makeFlowCtx(app, who, flowNow().params)
  const impl = (id: string) => flowImpl(id) as unknown as FlowImpl<Record<string, unknown>>
  const phase = () => phaseOf(flowNow(), impl(flowNow().id) as FlowImpl<unknown>, ctx())
  const step = () => impl(flowNow().id).steps[flowNow().step]
  const primary = () => {
    const s = step()
    if (!s) throw new Error('no step')
    return s.primary(flowNow().draft as never, ctx())
  }
  const draft = () => flowNow().draft as Record<string, unknown> & { requestId: string | null; codes: number }
  const balance = (id: string) => formatMinor(node.getState().balances[id]?.confirmed ?? m('0'))
  const code = () => openPosRequest(node.getState(), 'cafe', node.now(), VALIDITY)
  /** Ana pays the café's open code, as her Scan review does. */
  let n = 0
  const anaPays = (over: Partial<UserCommand> = {}) => {
    const request = code()
    if (!request) throw new Error('no open code')
    return node.dispatch({
      type: 'pay',
      actor: 'ana',
      cmdId: `${(++n).toString(16).padStart(16, 'a')}:review`,
      to: '@cafelipa',
      amount: request.amount,
      channel: 'qr',
      requestId: request.id,
      ...(request.note ? { note: request.note } : {}),
      expect: { senderDebit: request.amount },
      ...over,
    } as UserCommand)
  }
  const tap = (sku: string, times = 1) => {
    const api = createFlowApi<Record<string, unknown>>(app, who, flowNow().instanceId)
    for (let i = 0; i < times; i++) {
      api.set((x) => {
        const items = x.items as { sku: string; qty: number }[]
        const at = items.findIndex((i) => i.sku === sku)
        const next =
          at < 0 ? [...items, { sku, qty: 1 }] : items.map((it, k) => (k === at ? { ...it, qty: it.qty + 1 } : it))
        return { ...x, items: next, custom: '' }
      })
    }
  }
  return { app, who, nav, node, open, flowNow, ctx, impl, phase, step, primary, draft, balance, code, anaPays, tap }
}

describe('Charge', () => {
  it('opens on the items with nothing to charge; two flat whites and two croissants make 11.00', () => {
    const f = fixture()
    const { api } = f.open('charge')
    expect(f.step()?.id).toBe('items')
    expect(f.primary()).toMatchObject({ label: 'Charge', tone: 'money', enabled: false })
    f.tap('flat-white', 2)
    f.tap('croissant', 2)
    expect(f.primary()).toEqual({ label: 'Charge 11.00 BCPS', tone: 'money', enabled: true })
    api.press()
    expect(f.step()?.id).toBe('code')
    const request = f.code()
    expect(request).toMatchObject({
      amount: 1100,
      note: 'Table 4',
      channel: 'pos',
      status: 'open',
      feePayer: 'recipient',
    })
    expect(request?.items?.map((i) => [i.sku, i.qty])).toEqual([
      ['flat-white', 2],
      ['croissant', 2],
    ])
    expect(f.draft().requestId).toBe(request?.id)
  })

  it('a custom amount charges without items; the keypad string is the amount', () => {
    const f = fixture()
    const { api } = f.open('charge')
    api.set({ keypad: true, custom: '7.25' } as never)
    expect(f.primary()).toMatchObject({ label: 'Charge 7.25 BCPS', enabled: true })
    api.press()
    expect(f.code()).toMatchObject({ amount: 725, note: 'Table 4' })
    expect(f.code()?.items).toBeUndefined()
  })

  it('an amount above 999.99 cannot be charged', () => {
    const f = fixture()
    const { api } = f.open('charge')
    api.set({ keypad: true, custom: '999.99' } as never)
    expect(f.primary().enabled).toBe(true)
    // The keypad stops at 999.99; a larger draft is still refused by the primary button.
    api.set({ custom: '1000.00' } as never)
    expect(f.primary().enabled).toBe(false)
  })

  it('the tile opens straight on the code while one is open; Home leaves it open', () => {
    const f = fixture()
    const first = f.open('charge')
    f.tap('espresso')
    first.api.press()
    const id = f.code()?.id
    f.nav.home()
    expect(f.nav.top()).toEqual({ kind: 'home' })
    expect(f.code()?.id).toBe(id)
    f.open('charge')
    expect(f.step()?.id).toBe('code')
    expect(f.draft().requestId).toBe(id)
  })

  it('Back on the code asks whether to cancel; Keep goes back to the code', () => {
    const f = fixture()
    const { api } = f.open('charge')
    f.tap('espresso')
    api.press()
    f.nav.back()
    expect(f.step()?.id).toBe('cancel')
    expect(f.primary()).toMatchObject({ label: 'Cancel charge', enabled: true })
    f.nav.back()
    expect(f.step()?.id).toBe('code')
    expect(f.code()).toBeDefined()
  })

  it('Cancel charge closes the code and leaves an empty Charge; a new charge in the same flow works', () => {
    const f = fixture()
    const { api } = f.open('charge')
    f.tap('espresso')
    api.press()
    const first = f.code()?.id
    api.goto('cancel')
    api.press()
    expect(f.node.getState().requests[first ?? '']?.status).toBe('cancelled')
    expect(f.code()).toBeUndefined()
    expect(f.step()?.id).toBe('items')
    expect(f.draft()).toMatchObject({ items: [], custom: '', requestId: null })
    // The second charge of the same flow uses its own command ids.
    f.tap('flat-white')
    api.press()
    expect(f.step()?.id).toBe('code')
    expect(f.code()?.amount).toBe(330)
    expect(f.code()?.id).not.toBe(first)
    expect(f.flowNow().error).toBeUndefined()
    api.goto('cancel')
    api.press()
    expect(f.code()).toBeUndefined()
  })

  it('a code that ran out shows [New code]; it makes a fresh code with the same items; the old one stays expired', () => {
    const f = fixture()
    const { api } = f.open('charge')
    f.tap('flat-white', 2)
    f.tap('croissant', 2)
    api.press()
    const first = f.code()
    expect(f.primary()).toMatchObject({ label: 'Cancel', tone: 'outline' })
    f.node.advanceTo((f.node.now() + VALIDITY) as SimTime)
    expect(f.code()).toBeUndefined()
    expect(f.primary()).toMatchObject({ label: 'New code', enabled: true })
    // Ana can no longer pay the old code.
    expect(
      f.node.dispatch({
        type: 'pay',
        actor: 'ana',
        cmdId: 'bbbbbbbbbbbbbbbb:review',
        to: '@cafelipa',
        amount: first?.amount,
        channel: 'qr',
        requestId: first?.id,
        expect: { senderDebit: first?.amount },
      } as UserCommand),
    ).toMatchObject({ ok: false, error: { code: 'invalid-state', status: 'expired' } })
    api.press()
    const second = f.code()
    expect(second?.id).not.toBe(first?.id)
    expect(second?.amount).toBe(1100)
    expect(second?.items).toEqual(first?.items)
    expect(second?.note).toBe('Table 4')
    // Nobody cancelled the old code: whoever still looks at it reads "expired", not "cancelled".
    expect(f.node.getState().requests[first?.id ?? '']?.status).toBe('open')
    expect(posCodeState(f.node.getState(), first?.id ?? '', f.node.now(), VALIDITY)).toBe('expired')
    expect(f.draft().requestId).toBe(second?.id)
    expect(f.step()?.id).toBe('code')
    // [New code] twice in a row (a second code after another expiry) still has fresh ids.
    f.node.advanceTo((f.node.now() + VALIDITY) as SimTime)
    api.press()
    expect(f.code()?.id).not.toBe(second?.id)
    expect(f.flowNow().error).toBeUndefined()
  })

  it('a paid code ends the flow on PAID once it settles; the payment is a purchase with the fee 0.11', () => {
    const f = fixture()
    const { api } = f.open('charge')
    f.tap('flat-white', 2)
    f.tap('croissant', 2)
    api.press()
    expect(f.anaPays().ok).toBe(true)
    // Submitted but not settled: the café still shows its code.
    expect(f.phase()).toBe('input')
    expect(f.step()?.id).toBe('code')
    f.node.settleDue()
    expect(f.phase()).toBe('success')
    expect(f.balance('ana')).toBe('236.50')
    expect(f.balance('cafe')).toBe('296.89')
    const request = latestPosRequest(f.node.getState(), 'cafe')
    expect(request?.status).toBe('paid')
    const tx = f.node.getState().txs[request?.txId ?? '']
    expect(tx).toMatchObject({ kind: 'purchase', channel: 'qr', note: 'Table 4', status: 'confirmed' })
    expect(formatMinor(tx?.fee.fee ?? m('0'))).toBe('0.11')
    // The flow covers the payment (no banner on top of PAID), and other payments are not covered.
    const flow = f.impl('charge')
    expect(flow.covers?.(f.flowNow().draft as never, f.ctx(), tx?.id ?? '')).toBe(true)
    expect(flow.covers?.(f.flowNow().draft as never, f.ctx(), 'BC-OTHER1')).toBe(false)
    // Back on the success screen is Home; [New sale] starts an empty Charge from Home.
    f.nav.followOn('charge')
    expect(f.step()?.id).toBe('items')
    expect(f.draft().requestId).toBeNull()
  })

  it('a code cancelled elsewhere or paid cannot be cancelled again: the step says why', () => {
    const f = fixture()
    const { api } = f.open('charge')
    f.tap('espresso')
    api.press()
    f.anaPays()
    api.goto('cancel')
    api.press()
    expect(f.flowNow().error).toBe('This code was already paid.')
    expect(f.step()?.id).toBe('cancel')
  })

  it('a payment while the café is on Home does not need the flow: the code is paid and the café sees a banner target', () => {
    const f = fixture()
    const { api } = f.open('charge')
    f.tap('espresso')
    api.press()
    f.nav.home()
    expect(f.anaPays().ok).toBe(true)
    f.node.settleDue()
    expect(f.balance('cafe')).toBe('288.18')
    expect(f.node.getState().requests[latestPosRequest(f.node.getState(), 'cafe')?.id ?? '']?.status).toBe('paid')
    // A new Charge opens on the items again.
    f.open('charge')
    expect(f.step()?.id).toBe('items')
  })

  it('works in phone mode too (no other phone needed to charge)', () => {
    const f = fixture({ stage: false })
    const { api } = f.open('charge')
    f.tap('brunch')
    api.press()
    expect(f.code()).toMatchObject({ amount: 1320 })
  })

  it('the item chips are the café’s catalogue: flat white 3.30, espresso 2.20, croissant 2.20, brunch 13.20', () => {
    const items = resolveItems(content, 'cafe', [
      { sku: 'flat-white', qty: 1 },
      { sku: 'espresso', qty: 1 },
      { sku: 'croissant', qty: 1 },
      { sku: 'brunch', qty: 1 },
    ])
    expect(items.map((i) => formatMinor(i.price))).toEqual(['3.30', '2.20', '2.20', '13.20'])
  })
})

describe('Pay supplier', () => {
  it('opens on Review with the usual order: Pekarna Zrno, 8.80, "Croissant delivery", total 8.89', () => {
    const f = fixture()
    f.open('paySupplier')
    expect(f.step()?.id).toBe('review')
    expect(f.flowNow().draft).toMatchObject({
      query: '@pekarnazrno',
      amount: '8.80',
      note: 'Croissant delivery',
      templated: true,
    })
    expect(f.primary()).toEqual({ label: 'Pay 8.89 BCPS', tone: 'money', enabled: true })
  })

  it('pays it: café 288.00 (277.11 without the sale), bakery 8.80, fees +0.20 with the sale', () => {
    const f = fixture()
    const { api } = f.open('paySupplier')
    api.press()
    const tx = txOf(f.flowNow(), f.impl('paySupplier') as FlowImpl<unknown>, f.ctx())
    expect(tx).toMatchObject({ kind: 'transfer', channel: 'username', to: 'bakery', note: 'Croissant delivery' })
    expect(tx?.fee.payer).toBe('sender')
    expect(f.phase()).toBe('sending')
    expect(f.nav.locked()).toBe(true)
    f.node.settleDue()
    expect(f.phase()).toBe('success')
    expect(f.balance('cafe')).toBe('277.11')
    expect(f.balance('bakery')).toBe('8.80')
  })

  it('after the sale: café 288.00, bakery 8.80, fees since fresh 0.20', () => {
    const f = fixture()
    const charge = f.open('charge')
    f.tap('flat-white', 2)
    f.tap('croissant', 2)
    charge.api.press()
    f.anaPays()
    f.node.settleDue()
    f.nav.home()
    const { api } = f.open('paySupplier')
    api.press()
    f.node.settleDue()
    expect(f.balance('cafe')).toBe('288.00')
    expect(f.balance('bakery')).toBe('8.80')
    const s = f.node.getState()
    expect(
      formatMinor(
        ((s.balances['sys:fees']?.confirmed ?? 0) - (f.node.seedState().balances['sys:fees']?.confirmed ?? 0)) as never,
      ),
    ).toBe('0.20')
  })

  it('each field has an Edit link; the business note chips are the supplier ones; Back leaves the flow', () => {
    const f = fixture()
    const { api } = f.open('paySupplier')
    api.goto('note', { editing: true })
    expect(f.step()?.id).toBe('note')
    expect(f.ctx().content.catalogue.noteChips.business).toEqual([
      'Croissant delivery',
      'Freight',
      'Stainless shelving',
    ])
    api.set({ note: 'Freight' } as never)
    api.press()
    expect(f.step()?.id).toBe('review')
    api.goto('amount', { editing: true })
    api.set({ amount: '20.00' } as never)
    api.press()
    expect(f.primary()).toEqual({ label: 'Pay 20.20 BCPS', tone: 'money', enabled: true })
    api.back()
    expect(f.nav.top()).toEqual({ kind: 'home' })
  })

  it('paying twice with a double tap pays once', () => {
    const f = fixture()
    const { api } = f.open('paySupplier')
    api.press()
    api.press()
    f.node.settleDue()
    expect(f.balance('bakery')).toBe('8.80')
  })

  it('more than the café has (with the fee on top) cannot be paid', () => {
    const f = fixture()
    const { api } = f.open('paySupplier')
    api.set({ amount: '283.00' } as never) // 283.00 + 2.83 = 285.83 of 286.00
    expect(f.primary().enabled).toBe(true)
    api.set({ amount: '284.00' } as never) // 284.00 + 2.84 = 286.84
    expect(f.primary().enabled).toBe(false)
  })
})
