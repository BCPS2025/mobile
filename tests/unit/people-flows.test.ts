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
import type { PaymentRequest } from '@domain/types'
import { content, m } from './helpers'

// The Send flow against a real app state and ledger: what each step enables, what the
// commit sends, and what the ledger says afterwards. The screens themselves are drawn by the
// browser specs.

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
