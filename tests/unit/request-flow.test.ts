import { describe, expect, it } from 'vitest'
import { openNotification } from '@app/phone/notify'
import { payItems, waitingItems } from '@store/selectors'
import { notificationsFor } from '@store/notifications'
import { phoneFixture } from '../support/phone'
import { content } from './helpers'

// Request money, cancelling a request, and the screens a request notification opens.

function toReview(f: ReturnType<typeof phoneFixture>, who: 'ana' | 'marko', payer: string, amount: string, note = '') {
  const phone = f.as(who)
  phone.nav.home()
  const { api } = phone.open('request')
  api.set({ query: payer, amount, note })
  api.goto('review')
  return { phone, api }
}

describe('request money', () => {
  it('asks Marko for 13.20 "Lunch": the steps, the fee note, the request and Marko’s list', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('request')
    expect(ana.step().id).toBe('from')
    expect(ana.primary().enabled).toBe(false)
    api.set({ query: '@cafelipa' })
    expect(ana.primary().enabled).toBe(false) // businesses pay by invoice
    api.set({ query: '@ana' })
    expect(ana.primary().enabled).toBe(false) // not yourself
    api.set({ query: '@marko' })
    expect(ana.primary().enabled).toBe(true)
    api.next()
    expect(ana.primary().enabled).toBe(false)
    api.set({ amount: '13.20' })
    api.next()
    api.set({ note: 'Lunch' })
    api.next()
    expect(ana.step().id).toBe('review')
    expect(ana.primary()).toEqual({ label: 'Send request', tone: 'navy', enabled: true })
    api.press()
    expect(ana.phase()).toBe('success')
    const request = Object.values(f.node.getState().requests).find((r) => r.requester === 'ana')
    expect(request).toMatchObject({ payer: 'marko', amount: 1320, note: 'Lunch', channel: 'username', status: 'open' })
    expect(ana.flow().draft).toMatchObject({ requestId: request?.id })
    const items = payItems(f.node.getState(), 'marko')
    expect(items.map((i) => i.kind)).toEqual(['request'])
    // Nothing moved.
    expect(f.balance('ana')).toBe('247.50')
    expect(f.balance('marko')).toBe('132.98')
  })

  it('Marko pays it: Ana +13.20, Marko pays 13.33', () => {
    const f = phoneFixture()
    const { api } = toReview(f, 'ana', '@marko', '13.20', 'Lunch')
    api.press()
    const id = Object.values(f.node.getState().requests).find((r) => r.requester === 'ana')?.id ?? ''
    const marko = f.as('marko')
    marko.open('payItem', { request: id }).api.press()
    f.settle()
    expect(marko.phase()).toBe('success')
    expect(f.balance('ana')).toBe('260.70')
    expect(f.balance('marko')).toBe('119.65')
  })

  it('asking again for the same amount and note asks first; Send another makes a second request', () => {
    const f = phoneFixture()
    toReview(f, 'ana', '@marko', '13.20', 'Lunch').api.press()
    const { phone, api } = toReview(f, 'ana', '@marko', '13.20', 'Lunch')
    api.press()
    expect(phone.step().id).toBe('again')
    expect(phone.primary()).toEqual({ label: 'Send another', tone: 'navy', enabled: true })
    expect(Object.values(f.node.getState().requests).filter((r) => r.requester === 'ana')).toHaveLength(1)
    api.press()
    expect(phone.phase()).toBe('success')
    expect(Object.values(f.node.getState().requests).filter((r) => r.requester === 'ana')).toHaveLength(2)
  })

  it('a different note is not a repeat', () => {
    const f = phoneFixture()
    toReview(f, 'ana', '@marko', '13.20', 'Lunch').api.press()
    const { phone, api } = toReview(f, 'ana', '@marko', '13.20', 'Pizza')
    api.press()
    expect(phone.phase()).toBe('success')
  })

  it('shows the request under Waiting, newest first, and its outcome for two days', () => {
    const f = phoneFixture()
    toReview(f, 'ana', '@marko', '13.20', 'Lunch').api.press()
    const id = Object.values(f.node.getState().requests).find((r) => r.requester === 'ana')?.id ?? ''
    const now = f.node.now()
    expect(waitingItems(f.node.getState(), 'ana', now).map((w) => [w.kind, w.outcome])).toEqual([['request', 'open']])
    f.as('marko').open('payItem', { request: id })
    const marko = f.as('marko')
    marko.api().goto('decline')
    marko.api().press()
    expect(waitingItems(f.node.getState(), 'ana', now).map((w) => [w.kind, w.outcome])).toEqual([
      ['request', 'declined'],
    ])
    // Two days later it is gone from the list.
    expect(waitingItems(f.node.getState(), 'ana', (now + 49 * 3_600_000) as typeof now)).toEqual([])
  })
})

describe('cancel a request', () => {
  it('asks first, cancels the request and tells nothing else', () => {
    const f = phoneFixture()
    toReview(f, 'ana', '@marko', '13.20', 'Lunch').api.press()
    const id = Object.values(f.node.getState().requests).find((r) => r.requester === 'ana')?.id ?? ''
    const ana = f.as('ana')
    ana.nav.home()
    const { api } = ana.open('cancelRequest', { requestId: id })
    expect(ana.step().id).toBe('confirm')
    expect(ana.primary()).toEqual({ label: 'Cancel request', tone: 'navy', enabled: true })
    api.press()
    expect(ana.phase()).toBe('success')
    expect(f.node.getState().requests[id]?.status).toBe('cancelled')
    expect(payItems(f.node.getState(), 'marko')).toEqual([])
    const kinds = notificationsFor(f.node.getState(), 'marko', content).map((n) => n.kind)
    expect(kinds).toContain('request.cancelled')
  })
})

describe('what a request notification opens', () => {
  it('the check for the one asked, the detail of a declined request for the requester', () => {
    const f = phoneFixture()
    toReview(f, 'ana', '@marko', '13.20', 'Lunch').api.press()
    const id = Object.values(f.node.getState().requests).find((r) => r.requester === 'ana')?.id ?? ''
    const marko = f.as('marko')
    openNotification(f.app, marko.who, {
      id: `request:${id}`,
      txId: null,
      subject: { type: 'request', id },
      kind: 'request.received',
    })
    expect(marko.stack()).toEqual(['home', `flow:payItem`])
    marko.api().goto('decline')
    marko.api().press()
    const ana = f.as('ana')
    ana.nav.home()
    openNotification(f.app, ana.who, {
      id: `declined:${id}`,
      txId: null,
      subject: { type: 'request', id },
      kind: 'request.declined',
    })
    expect(ana.stack()).toEqual(['home', 'detail:request'])
  })
})
