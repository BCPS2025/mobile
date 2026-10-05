import { describe, expect, it } from 'vitest'
import { linkPayload } from '@app/paymentCode'
import { parsePaymentUri } from '@domain/uri'
import { payItems, waitingItems } from '@store/selectors'
import { phoneFixture } from '../support/phone'

// Payment link: make one, show and copy it, send it to one person, share it again, and its
// payment by that person.

function makeLink(f: ReturnType<typeof phoneFixture>, amount = '13.20', note = 'Pizza') {
  const ana = f.as('ana')
  const { api } = ana.open('paymentLink')
  expect(ana.step().id).toBe('amount')
  expect(ana.primary().enabled).toBe(false)
  api.set({ amount })
  expect(ana.primary().enabled).toBe(true)
  api.next()
  api.set({ note })
  api.next()
  expect(ana.step().id).toBe('review')
  expect(ana.primary()).toEqual({ label: 'Create link', tone: 'navy', enabled: true })
  api.press()
  return { ana, api }
}

describe('payment link', () => {
  it('creates a single-use link priced as a transfer, the payer paying the fee; Link ready follows', () => {
    const f = phoneFixture()
    const { ana } = makeLink(f)
    expect(ana.step().id).toBe('ready')
    const link = Object.values(f.node.getState().links)[0]
    expect(link).toMatchObject({
      id: 'L-000001',
      owner: 'ana',
      amount: 1320,
      note: 'Pizza',
      reusable: false,
      policy: 'transfer',
      feePayer: 'sender',
      status: 'open',
      sharedWith: [],
    })
    expect(ana.flow().draft).toMatchObject({ linkId: 'L-000001', made: true })
    // Nothing moved, and the link waits under Waiting.
    expect(f.balance('ana')).toBe('247.50')
    expect(waitingItems(f.node.getState(), 'ana', f.node.now()).map((w) => [w.kind, w.outcome])).toEqual([
      ['link', 'open'],
    ])
  })

  it('Link ready is offered as stacked buttons; Done leaves the link waiting', () => {
    const f = phoneFixture()
    const { ana, api } = makeLink(f)
    const stack = ana.step().stack?.(ana.flow().draft as never, ana.ctx(), api)
    expect(stack?.map((s) => [s.label, s.kind])).toEqual([
      ['Send in BCPS', 'white'],
      ['Done', 'outline'],
    ])
    stack?.[1]?.onPress()
    expect(ana.stack()).toEqual(['home'])
    expect(f.node.getState().links['L-000001']?.status).toBe('open')
  })

  it('sends the link to one person: Marko has it to pay; Back from sending returns to Link ready', () => {
    const f = phoneFixture()
    const { ana, api } = makeLink(f)
    api.goto('to')
    expect(ana.primary().enabled).toBe(false)
    api.set({ query: '@cafelipa' })
    expect(ana.primary().enabled).toBe(false) // people only
    api.back()
    expect(ana.step().id).toBe('ready')
    api.goto('to')
    api.set({ query: '@marko' })
    expect(ana.primary()).toEqual({ label: 'Send link', tone: 'navy', enabled: true })
    api.press()
    expect(ana.phase()).toBe('success')
    expect(ana.flow().draft).toMatchObject({ sharedTo: '@marko' })
    const items = payItems(f.node.getState(), 'marko')
    expect(items.map((i) => i.kind)).toEqual(['link'])
    expect(f.node.getState().links['L-000001']?.sharedWith).toEqual(['marko'])
  })

  it('Marko pays 13.33: Ana 260.70, Marko 119.65, the link is paid and closed', () => {
    const f = phoneFixture()
    const { api } = makeLink(f)
    api.goto('to')
    api.set({ query: '@marko' })
    api.press()
    const marko = f.as('marko')
    marko.open('payItem', { link: 'L-000001' }).api.press()
    f.settle()
    expect(marko.phase()).toBe('success')
    expect(f.balance('ana')).toBe('260.70')
    expect(f.balance('marko')).toBe('119.65')
    expect(f.node.getState().links['L-000001']).toMatchObject({ status: 'paid', payments: [marko.tx()?.id] })
    expect(waitingItems(f.node.getState(), 'ana', f.node.now()).map((w) => [w.kind, w.outcome])).toEqual([
      ['link', 'paid'],
    ])
  })

  it('Share again opens on sending; Back leaves; the same person cannot be sent it twice', () => {
    const f = phoneFixture()
    const { ana, api } = makeLink(f)
    api.goto('to')
    api.set({ query: '@marko' })
    api.press()
    ana.nav.home()
    const again = ana.open('paymentLink', { linkId: 'L-000001' })
    expect(ana.step().id).toBe('to')
    again.api.set({ query: '@marko' })
    again.api.press()
    expect(ana.flow().error).toBe('This was already shared.')
    again.api.back()
    expect(ana.stack()).toEqual(['home'])
    // Another person can have it.
    const other = ana.open('paymentLink', { linkId: 'L-000001' })
    other.api.set({ query: '@marta_k' })
    other.api.press()
    expect(ana.phase()).toBe('success')
    expect(f.node.getState().links['L-000001']?.sharedWith).toEqual(['marko', '@marta_k'])
  })

  it('shows the code for ten minutes to the phone beside it', () => {
    const f = phoneFixture()
    const { ana } = makeLink(f)
    expect(f.app.transient.get().shownQr).toEqual([])
    f.app.actions.showQr('ana', 'link', 'L-000001')
    expect(f.app.transient.get().shownQr).toMatchObject([{ persona: 'ana', kind: 'link', linkId: 'L-000001' }])
    expect(ana.step().id).toBe('ready')
  })

  it('the copied address names the owner, the amount and the link', () => {
    const parsed = parsePaymentUri(linkPayload('@ana', 1320 as never, 'L-000001'))
    expect(parsed).toEqual({ ok: true, value: { v: 1, to: '@ana', amount: 1320, link: 'L-000001' } })
  })
})
