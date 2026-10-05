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
import { asMinor, formatMinor } from '@domain/money'
import type { PaymentRequest, SimTime } from '@domain/types'
import { content, m } from './helpers'

// The Send and Scan flows against a real app state and ledger: what each step enables, what the
// commit sends, and what the ledger says afterwards. The screens themselves are drawn by the
// browser specs.

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
  const slot = opts.stage === false ? 'single' : 'left'
  const who: Who = { persona: 'ana', slot, shell: 'consumer' }
  if (opts.stage === false) app.actions.choose('single', 'ana')
  else {
    app.actions.choose('left', 'ana')
    app.actions.choose('right', 'cafe')
  }
  const nav = createPhoneNav(app, who)
  const node = app.runtime.node
  const flowNow = () => nav.top() as FlowScreen
  const open = (id: 'send' | 'scan', params?: Record<string, string>) => {
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
  /** The café's open code, as `request.create` will leave it. */
  const withCode = (patch: Partial<PaymentRequest> = {}) => {
    const s = node.getState()
    const request: PaymentRequest = {
      id: 'r_pos_1',
      requester: 'cafe',
      amount: m('11.00'),
      items: [
        { sku: 'flat-white', name: 'Flat white', qty: 2, price: m('3.30') },
        { sku: 'croissant', name: 'Croissant', qty: 2, price: m('2.20') },
      ],
      channel: 'pos',
      feePayer: 'recipient',
      policy: 'merchant',
      status: 'open',
      createdAt: node.now(),
      ...patch,
    }
    node.resetToSeed({ seed: { ...s, requests: { ...s.requests, [request.id]: request } }, t0: node.now() })
  }
  const balance = (id: string) => formatMinor(node.getState().balances[id]?.confirmed ?? asMinor(0))
  return { app, who, nav, node, open, flowNow, ctx, impl, phase, step, primary, withCode, balance }
}

describe('Send', () => {
  it('sends 16.50 to @marko with a note: total 16.67, Ana 230.83, Marko 149.48, sender pays the fee', () => {
    const f = fixture()
    const { top, api } = f.open('send')
    expect(f.flowNow().step).toBe(0)
    expect(f.primary().enabled).toBe(false) // nobody picked yet
    api.set({ query: '@marko' } as never)
    expect(f.primary().enabled).toBe(true)
    api.next()
    api.set({ amount: '16.50' } as never)
    expect(f.primary()).toMatchObject({ enabled: true, label: 'Continue' })
    api.next()
    api.set({ note: 'Cinema' } as never)
    api.next()
    expect(f.step()?.id).toBe('review')
    expect(f.primary()).toEqual({ label: 'Send 16.67 BCPS', tone: 'money', enabled: true })
    api.press()
    const tx = txOf(f.flowNow(), f.impl('send') as FlowImpl<unknown>, f.ctx())
    expect(tx).toMatchObject({ status: 'pending', channel: 'username', note: 'Cinema', to: 'marko' })
    expect(tx?.cmdId).toBe(`${top.instanceId}:review`)
    expect(f.phase()).toBe('sending')
    expect(f.nav.locked()).toBe(true)
    f.node.settleDue()
    expect(f.phase()).toBe('success')
    expect(f.balance('ana')).toBe('230.83')
    expect(f.balance('marko')).toBe('149.48')
    expect(formatMinor(tx?.fee.fee ?? asMinor(0))).toBe('0.17')
    expect(tx?.fee.payer).toBe('sender')
  })

  it('a double tap pays once, and the note may be skipped', () => {
    const f = fixture()
    const { api } = f.open('send')
    api.set({ query: '@marko', amount: '5.00' } as never)
    api.goto('review')
    api.press()
    api.press()
    api.press()
    f.node.settleDue()
    const state = f.node.getState()
    expect(state.txOrder.filter((id) => state.txs[id]?.cmdId).length).toBe(1)
    expect(state.txs[state.txOrder[state.txOrder.length - 1] ?? '']?.note).toBeUndefined()
    expect(f.flowNow().error).toBeUndefined()
  })

  it('an unknown handle or yourself cannot be continued; an amount above the balance cannot either', () => {
    const f = fixture()
    const { api } = f.open('send')
    api.set({ query: '@anaa' } as never)
    expect(f.primary().enabled).toBe(false)
    api.set({ query: '@ana' } as never)
    expect(f.primary().enabled).toBe(false)
    api.set({ query: '@marta_k' } as never)
    expect(f.primary().enabled).toBe(true) // an off-stage person
    api.set({ query: '@cafelipa' } as never)
    expect(f.primary().enabled).toBe(true) // a business
    api.next()
    api.set({ amount: '0' } as never)
    expect(f.primary().enabled).toBe(false)
    api.set({ amount: '250.00' } as never) // 247.50 available, fee on top
    expect(f.primary().enabled).toBe(false)
    api.set({ amount: '245.05' } as never) // Max: 245.05 + 2.45 fee = 247.50
    expect(f.primary().enabled).toBe(true)
  })

  it('the balance changing under the review is refused with the words of the error, on the step', () => {
    const f = fixture()
    const { api } = f.open('send')
    api.set({ query: '@marko', amount: '245.05' } as never)
    api.goto('review')
    // Another payment takes the money first.
    f.node.dispatch({
      type: 'pay',
      actor: 'ana',
      cmdId: 'aaaaaaaaaaaaaaaa:review',
      to: '@eva',
      amount: m('100.00'),
      channel: 'username',
      expect: { senderDebit: m('101.00') },
    })
    api.press()
    expect(f.flowNow().error).toBe('You have 146.50 BCPS. Top up 101.00 BCPS to pay.')
    expect(f.phase()).toBe('input')
  })

  it('Send again opens filled in on Review, with the note; Back leaves the flow; Edit opens a step', () => {
    const f = fixture()
    const { api } = f.open('send', { to: '@marko', amount: '16.50', note: 'Cinema' })
    expect(f.step()?.id).toBe('review')
    expect(f.flowNow().draft).toMatchObject({ query: '@marko', amount: '16.50', note: 'Cinema', templated: true })
    api.goto('amount', { editing: true })
    expect(f.primary().enabled).toBe(true)
    api.press()
    expect(f.step()?.id).toBe('review')
    api.back()
    expect(f.nav.top()).toEqual({ kind: 'home' })
  })

  it('Send opens from a hub or a detail only, never over another flow', () => {
    const f = fixture()
    f.open('send')
    expect(f.nav.top().kind).toBe('flow')
    f.nav.openFlow('scan')
    expect((f.nav.top() as FlowScreen).id).toBe('send')
  })
})

describe('Scan', () => {
  it('finds no code while the café shows none; "Pay by @username" hands over to Send', () => {
    const f = fixture()
    f.open('scan')
    const scan = f.impl('scan').steps[0]
    expect(scan?.hideDock?.(f.flowNow().draft as never, f.ctx())).toBe(true)
    f.nav.handoff('send')
    expect((f.nav.top() as FlowScreen).id).toBe('send')
    f.nav.back()
    expect(f.nav.top()).toEqual({ kind: 'home' })
  })

  it('locks onto the café’s code, reviews it and pays it: Ana 236.50, café 296.89, fee 0.11 paid by the café', () => {
    const f = fixture()
    f.withCode()
    const { top, api } = f.open('scan')
    const scan = f.impl('scan').steps[0]
    expect(scan?.hideDock?.(f.flowNow().draft as never, f.ctx())).toBe(false)
    expect(f.primary()).toMatchObject({ label: 'Continue', enabled: true })
    api.press()
    expect(f.step()?.id).toBe('review')
    expect(f.flowNow().draft).toMatchObject({ locked: 'r_pos_1', counter: null })
    expect(f.primary()).toEqual({ label: 'Pay 11.00 BCPS', tone: 'money', enabled: true })
    api.press()
    const tx = txOf(f.flowNow(), f.impl('scan') as FlowImpl<unknown>, f.ctx())
    expect(tx).toMatchObject({ kind: 'purchase', channel: 'qr', links: { requestId: 'r_pos_1' } })
    expect(tx?.cmdId).toBe(`${top.instanceId}:review`)
    expect(formatMinor(tx?.amount ?? asMinor(0))).toBe('11.00')
    expect(tx?.fee.payer).toBe('recipient')
    expect(tx?.items?.map((i) => i.qty)).toEqual([2, 2])
    f.node.settleDue()
    expect(f.phase()).toBe('success')
    expect(f.balance('ana')).toBe('236.50')
    expect(f.balance('cafe')).toBe('296.89')
    expect(f.node.getState().requests.r_pos_1?.status).toBe('paid')
    expect(formatMinor(tx?.fee.fee ?? asMinor(0))).toBe('0.11')
  })

  it('a code that carries a note ("Table 4") passes it on to the payment', () => {
    const f = fixture()
    f.withCode({ note: 'Table 4' })
    const { api } = f.open('scan')
    api.press()
    api.press()
    f.node.settleDue()
    const state = f.node.getState()
    expect(state.txs[state.txOrder[state.txOrder.length - 1] ?? '']?.note).toBe('Table 4')
  })

  it('a double tap on Pay pays once', () => {
    const f = fixture()
    f.withCode()
    const { api } = f.open('scan')
    api.press()
    api.press()
    api.press()
    f.node.settleDue()
    expect(f.balance('ana')).toBe('236.50')
  })

  it('a code that expires while in view unlocks the viewfinder; on the review Pay is off', () => {
    const f = fixture()
    f.withCode()
    const { api } = f.open('scan')
    const scan = f.impl('scan').steps[0]
    api.press() // locked, on the review
    f.node.advanceTo((f.node.now() + VALIDITY) as SimTime)
    expect(f.primary().enabled).toBe(false)
    api.goto('scan')
    expect(scan?.hideDock?.(f.flowNow().draft as never, f.ctx())).toBe(true)
  })

  it('a code cancelled or paid by someone else while the review is open: Pay is off and pressing says why', () => {
    const cancelled = fixture()
    cancelled.withCode()
    const a = cancelled.open('scan')
    a.api.press()
    cancelled.withCode({ status: 'cancelled' })
    expect(cancelled.primary().enabled).toBe(false)
    a.api.press()
    expect(cancelled.flowNow().error).toBe('This code was cancelled')

    const paid = fixture()
    paid.withCode()
    const b = paid.open('scan')
    b.api.press()
    paid.withCode({ status: 'paid' })
    b.api.press()
    expect(paid.flowNow().error).toBe('This code was already paid.')
    expect(paid.balance('ana')).toBe('247.50')
  })

  it('in phone mode there is no other phone: the open code and the counter code are both nearby', () => {
    const f = fixture({ stage: false })
    f.open('scan')
    const scan = f.impl('scan').steps[0]
    // Only the counter code is always there, so the dock offers Continue.
    expect(scan?.hideDock?.(f.flowNow().draft as never, f.ctx())).toBe(false)
    f.nav.back()
    f.withCode()
    f.open('scan')
    expect(scan?.hideDock?.(f.flowNow().draft as never, f.ctx())).toBe(false)
  })

  it('a code for 2.20 alone costs the café 0.02 and shows no card comparison', () => {
    const f = fixture()
    f.withCode({ amount: m('2.20'), items: [{ sku: 'espresso', name: 'Espresso', qty: 1, price: m('2.20') }] })
    const { api } = f.open('scan')
    api.press()
    api.press()
    f.node.settleDue()
    const state = f.node.getState()
    const tx = state.txs[state.txOrder[state.txOrder.length - 1] ?? '']
    expect(formatMinor(tx?.fee.fee ?? asMinor(0))).toBe('0.02')
    expect(tx?.fee.card).toBeUndefined()
  })
})
