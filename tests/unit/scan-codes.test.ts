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
import type { UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import { quoteFor } from '@store/selectors'
import { content, m } from './helpers'

// Scan beyond the café's open code: the counter code (the payer enters the amount, the café's fee
// setting decides who pays), several codes nearby, and the personal code and payment link that the
// phone beside this one shows.

type Draft = Record<string, unknown>

function fixture(mode: 'phone' | 'stage' = 'phone') {
  const app = createAppState({
    content,
    build: 'dev',
    storage: null,
    locks: null,
    timers: null,
    clock: { mode: 'manual' },
    epochDate: () => '2026-09-25',
  })
  const slot = mode === 'phone' ? 'single' : 'left'
  const persona = 'ana'
  const who: Who = { persona, slot, shell: 'consumer' }
  app.actions.choose(slot, persona)
  if (mode === 'stage') app.actions.choose('right', 'marko')
  const nav = createPhoneNav(app, who)
  const node = app.runtime.node
  const top = () => nav.top() as FlowScreen
  const ctx = () => makeFlowCtx(app, who, top().params)
  const impl = () => flowImpl(top().id) as unknown as FlowImpl<Draft>
  const step = () => impl().steps[top().step]
  const primary = () => {
    const s = step()
    if (!s) throw new Error('no step')
    return s.primary(top().draft as Draft, ctx())
  }
  const open = () => {
    nav.openFlow('scan')
    return createFlowApi<Draft>(app, who, top().instanceId)
  }
  const balance = (id: string) => formatMinor(node.getState().balances[id]?.confirmed ?? asMinor(0))
  let n = 0
  const dispatch = (actor: string, body: Record<string, unknown>) =>
    app.runtime.dispatch({
      ...body,
      actor,
      cmdId: `${(0xabc000 + ++n).toString(16).padStart(16, '0')}:t`,
    } as UserCommand)
  const phase = () => phaseOf(top(), impl() as FlowImpl<unknown>, ctx())
  const tx = () => txOf(top(), impl() as FlowImpl<unknown>, ctx())
  return { app, who, nav, node, top, ctx, impl, step, primary, open, balance, dispatch, phase, tx }
}

/** The café shows a code for the flat whites and croissants, as Charge leaves it. */
function cafeCharges(f: ReturnType<typeof fixture>) {
  const items = resolveItems(content, 'cafe', [
    { sku: 'flat-white', qty: 2 },
    { sku: 'croissant', qty: 2 },
  ])
  const r = f.dispatch('cafe', { type: 'request.create', channel: 'pos', amount: m('11.00'), note: 'Table 4', items })
  if (!r.ok) throw new Error(`refused ${r.error.code}`)
}

describe('the counter code', () => {
  it('phone mode: one code is nearby, Continue asks for the amount, the review quotes the café’s fee', () => {
    const f = fixture()
    const api = f.open()
    expect(f.step()?.id).toBe('scan')
    expect(f.primary()).toMatchObject({ label: 'Continue', enabled: true })
    api.press()
    expect(f.step()?.id).toBe('counter')
    expect(f.step()?.title?.(f.top().draft as Draft, f.ctx())).toBe('Pay Café Lipa')
    expect(f.primary().enabled).toBe(false)
    api.set({ amount: '3.30' })
    expect(f.primary()).toMatchObject({ label: 'Continue', enabled: true })
  })

  it('3.30 at the counter, as quoted while typing: the café pays 0.03, Ana 244.20, café 289.27, no request behind it', () => {
    const f = fixture()
    const api = f.open()
    api.press()
    api.set({ amount: '3.30', quoted: quoteOf(f, '3.30') } as never)
    api.press()
    expect(f.step()?.id).toBe('review')
    expect(f.primary()).toEqual({ label: 'Pay 3.30 BCPS', tone: 'money', enabled: true })
    api.press()
    const paid = f.tx()
    expect(paid).toMatchObject({ kind: 'purchase', channel: 'qr', to: 'cafe' })
    expect(paid?.links?.requestId).toBeUndefined()
    expect(paid?.fee.payer).toBe('recipient')
    expect(formatMinor(paid?.fee.fee ?? asMinor(0))).toBe('0.03')
    f.node.settleDue()
    expect(f.phase()).toBe('success')
    expect(f.balance('ana')).toBe('244.20')
    expect(f.balance('cafe')).toBe('289.27')
  })

  it('the café switches to "Customer pays" meanwhile: Pay is refused as changed, the review shows 3.33, then pays', () => {
    const f = fixture()
    const api = f.open()
    api.press()
    api.set({ amount: '3.30', quoted: quoteOf(f, '3.30') } as never)
    api.press()
    expect(f.primary().label).toBe('Pay 3.30 BCPS')
    const flipped = f.dispatch('cafe', { type: 'merchant.settings', patch: { feePayer: 'sender' } })
    expect(flipped.ok).toBe(true)
    api.press()
    expect(f.top().error).toBe('The amount changed. Check it and try again.')
    expect(f.phase()).toBe('input')
    expect(f.primary()).toEqual({ label: 'Pay 3.33 BCPS', tone: 'money', enabled: true })
    api.press()
    f.node.settleDue()
    expect(f.phase()).toBe('success')
    expect(f.tx()?.fee.payer).toBe('sender')
    expect(f.balance('ana')).toBe('244.17')
    expect(f.balance('cafe')).toBe('289.30')
  })

  it('an amount above the balance cannot be continued; a repeated press pays once', () => {
    const f = fixture()
    const api = f.open()
    api.press()
    api.set({ amount: '999', quoted: quoteOf(f, '999') } as never)
    expect(f.primary().enabled).toBe(false)
    api.set({ amount: '3.30', quoted: quoteOf(f, '3.30') } as never)
    api.press()
    api.press()
    api.press()
    f.node.settleDue()
    expect(f.balance('ana')).toBe('244.20')
  })

  it('Back: from the check to the amount, from the amount to Scan; a code chosen from the list returns to the list', () => {
    const f = fixture()
    cafeCharges(f)
    const api = f.open()
    expect(f.primary().enabled).toBe(true)
    api.press() // two codes: the list
    expect(f.step()?.id).toBe('nearby')
    api.back()
    expect(f.step()?.id).toBe('scan')
    api.goto('nearby')
    api.goto('counter')
    api.set({ counter: 'cafe', fromList: true } as never)
    api.back()
    expect(f.step()?.id).toBe('nearby')
    api.set({ counter: 'cafe', fromList: false, amount: '3.30', quoted: quoteOf(f, '3.30') } as never)
    api.goto('counter')
    api.back()
    expect(f.step()?.id).toBe('scan')
    api.goto('review')
    api.back()
    expect(f.step()?.id).toBe('counter')
  })
})

/** The quote the amount step takes while the amount is typed (the café's setting now). */
const quoteOf = (f: ReturnType<typeof fixture>, amount: string) => quoteFor(f.node.getState(), 'cafe', 'qr', m(amount))

describe('several codes nearby', () => {
  it('phone mode: the café’s open code and its counter code are two; Continue opens the list', () => {
    const f = fixture()
    cafeCharges(f)
    const api = f.open()
    api.press()
    expect(f.step()?.id).toBe('nearby')
    expect(f.step()?.screen).toBe('c.scan.nearby')
    expect(f.step()?.hideDock?.(f.top().draft as Draft, f.ctx())).toBe(true)
  })

  it('choosing the open code goes to its check and pays it as before', () => {
    const f = fixture()
    cafeCharges(f)
    const api = f.open()
    api.press()
    const request = Object.values(f.node.getState().requests).find((r) => r.channel === 'pos')
    api.set({ locked: request?.id ?? '', counter: null } as never)
    api.goto('review')
    expect(f.primary()).toEqual({ label: 'Pay 11.00 BCPS', tone: 'money', enabled: true })
    api.press()
    f.node.settleDue()
    expect(f.balance('ana')).toBe('236.50')
  })
})

describe('a personal code and a payment link on the phone beside', () => {
  it('stage: Marko shows his code; Scan locks onto it and hands over to Send, opened on the amount', () => {
    const f = fixture('stage')
    const api = f.open()
    expect(f.step()?.id).toBe('scan')
    // Nothing is shown yet: the dock is hidden.
    expect(f.step()?.hideDock?.(f.top().draft as Draft, f.ctx())).toBe(true)
    f.app.actions.showQr('marko', 'code')
    expect(f.step()?.hideDock?.(f.top().draft as Draft, f.ctx())).toBe(false)
    api.press()
    const sent = f.top()
    expect(sent.id).toBe('send')
    expect(f.step()?.id).toBe('amount')
    expect(sent.draft).toMatchObject({ query: '@marko', amount: '', fixedTo: true, templated: false })
    // Back from the first step leaves the flow.
    createFlowApi<Draft>(f.app, f.who, sent.instanceId).back()
    expect(f.nav.top()).toEqual({ kind: 'home' })
  })

  it('stage: a code shown by the café’s phone is not Ana’s to scan if it is her own; her own code is ignored', () => {
    const f = fixture('stage')
    f.app.actions.showQr('ana', 'code')
    f.open()
    expect(f.step()?.hideDock?.(f.top().draft as Draft, f.ctx())).toBe(true)
  })

  it('stage: Marko’s payment link, shown as a code, hands over to the check of the link', () => {
    const f = fixture('stage')
    const made = f.dispatch('marko', { type: 'link.create', amount: m('13.20'), note: 'Pizza' })
    expect(made.ok).toBe(true)
    const linkId = Object.keys(f.node.getState().links)[0] ?? ''
    f.app.actions.showQr('marko', 'link', linkId)
    const api = f.open()
    api.press()
    const next = f.top()
    expect(next.id).toBe('payItem')
    expect(next.draft).toMatchObject({ kind: 'link', id: linkId })
    createFlowApi<Draft>(f.app, f.who, next.instanceId).press()
    f.node.settleDue()
    expect(f.balance('marko')).toBe('146.18')
    expect(f.balance('ana')).toBe('234.17')
  })

  it('a code shown more than ten minutes ago is no longer in view', () => {
    const f = fixture('stage')
    f.app.actions.showQr('marko', 'code')
    f.open()
    f.node.advanceTo((f.node.now() + 10 * 60_000 + 1000) as never)
    expect(f.step()?.hideDock?.(f.top().draft as Draft, f.ctx())).toBe(true)
  })
})
