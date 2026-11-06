import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { LedgerEvent, PaymentLink, Tx, UserCommand } from '@domain/types'
import { encodePaymentUri, parsePaymentUri } from '@domain/uri'
import { decodeCommand, encodeCommand } from '@store/log-codec'
import { checkWireCommand } from '@store/record'
import { type Headless, headless } from '../support/journey'
import { content, m } from './helpers'

// Single-use payment links between people: link.create, link.share, and paying a link (the payer
// pays the 1 % on top; the link closes after one payment).

let n = 0
const id = (step = 'review') => `${(++n).toString(16).padStart(16, '0')}:${step}`

const create = (over: Record<string, unknown> = {}, actor = 'ana'): UserCommand =>
  ({ type: 'link.create', actor, cmdId: id('link'), amount: m('13.20'), note: 'Pizza', ...over }) as UserCommand
const share = (linkId: string, to: string, actor = 'ana'): UserCommand => ({
  type: 'link.share',
  actor,
  cmdId: id('share'),
  linkId,
  to: to as `@${string}`,
})
const payLink = (link: PaymentLink, actor: string, over: Record<string, unknown> = {}): UserCommand =>
  ({
    type: 'pay',
    actor,
    cmdId: id(),
    to: '@ana',
    amount: link.amount,
    channel: 'link',
    linkId: link.id,
    expect: { senderDebit: m('13.33') },
    ...over,
  }) as UserCommand

const fresh = () => headless('2026-09-25')
const run = (h: Headless, c: UserCommand): LedgerEvent[] => {
  const r = h.node.dispatch(c)
  if (!r.ok) throw new Error(`refused ${r.error.code}`)
  return r.value
}
const refusal = (h: Headless, c: UserCommand) => {
  const r = h.node.dispatch(c)
  return r.ok ? 'accepted' : r.error
}
const link = (h: Headless, linkId = 'L-000001'): PaymentLink => {
  const l = h.node.getState().links[linkId]
  if (!l) throw new Error(`no link ${linkId}`)
  return l
}
const bal = (h: Headless, a: string) => formatHundredths(h.node.getState().balances[a]?.confirmed ?? Number.NaN)

describe('link.create', () => {
  it('Ana makes a single-use link for 13.20 "Pizza": open, the payer pays the fee', () => {
    const h = fresh()
    const events = run(h, create())
    expect(events.map((e) => e.type)).toEqual(['link.created'])
    expect(link(h)).toMatchObject({
      id: 'L-000001',
      owner: 'ana',
      amount: 1320,
      note: 'Pizza',
      reusable: false,
      policy: 'transfer',
      feePayer: 'sender',
      status: 'open',
      payments: [],
      sharedWith: [],
      sharedAt: [],
      createdAt: h.node.now(),
    })
    expect(link(h).cmdId).toMatch(/:link$/)
    expect(h.node.getState().counters.linkSeq).toBe(1)
    expect(bal(h, 'ana')).toBe('247.50')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('needs no note; ids count on', () => {
    const h = fresh()
    run(h, create({ note: undefined }))
    run(h, create({ amount: m('2.00') }))
    expect(link(h).note).toBeUndefined()
    expect(link(h, 'L-000002').amount).toBe(200)
    expect(h.node.getState().counters.linkSeq).toBe(2)
  })

  it('refuses: a business, a bad amount, more than 999.99; accepts exactly 999.99', () => {
    const h = fresh()
    expect(refusal(h, create({}, 'cafe'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, create({}, 'nobody'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, create({ amount: 0 }))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, create({ amount: Number.NaN }))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, create({ amount: m('1000.00') }))).toEqual({ code: 'invalid-amount', max: m('999.99') })
    expect(h.node.getState().counters.linkSeq).toBe(0)
    run(h, create({ amount: m('999.99') }))
    expect(link(h).amount).toBe(99999)
  })
})

describe('link.share', () => {
  it('sends an open link to Marko: it records who and when', () => {
    const h = fresh()
    run(h, create())
    h.node.clock.advance(60_000)
    const events = run(h, share('L-000001', '@marko'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'link.shared', linkId: 'L-000001', to: 'marko' })
    expect(link(h).sharedWith).toEqual(['marko'])
    expect(link(h).sharedAt).toEqual([h.node.now()])
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('an off-stage person can be sent the link; one person can be sent it once', () => {
    const h = fresh()
    run(h, create())
    run(h, share('L-000001', '@marta_k'))
    run(h, share('L-000001', '@marko'))
    expect(link(h).sharedWith).toEqual(['@marta_k', 'marko'])
    expect(refusal(h, share('L-000001', '@marko'))).toEqual({ code: 'invalid-state', status: 'shared' })
    expect(link(h).sharedWith).toHaveLength(2)
  })

  it('refuses: not the owner, yourself, an unknown person, an unknown link, a link that is no longer open', () => {
    const h = fresh()
    run(h, create())
    expect(refusal(h, share('L-000001', '@studio', 'marko'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, share('L-000001', '@ana'))).toEqual({ code: 'self-payment' })
    expect(refusal(h, share('L-000001', '@nobody'))).toEqual({ code: 'unknown-recipient', handle: '@nobody' })
    expect(refusal(h, share('L-999999', '@marko'))).toEqual({ code: 'invalid-state' })
    run(h, payLink(link(h), 'marko'))
    expect(refusal(h, share('L-000001', '@eva'))).toEqual({ code: 'invalid-state', status: 'paid' })
  })
})

describe('paying a link', () => {
  it('Marko pays 13.33 (13.20 + 0.13): Ana receives the full 13.20 and the link is paid', () => {
    const h = fresh()
    run(h, create())
    run(h, share('L-000001', '@marko'))
    const events = run(h, payLink(link(h), 'marko'))
    const tx = (events[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx
    expect(tx).toMatchObject({ kind: 'transfer', channel: 'link', from: 'marko', to: 'ana', amount: 1320 })
    expect(tx.links).toEqual({ linkId: 'L-000001' })
    expect(tx.fee).toMatchObject({
      policy: 'transfer',
      payer: 'sender',
      fee: 13,
      senderDebit: 1333,
      recipientCredit: 1320,
    })
    h.node.settleDue()
    expect(bal(h, 'marko')).toBe('119.65')
    expect(bal(h, 'ana')).toBe('260.70')
    expect(link(h)).toMatchObject({ status: 'paid', payments: [tx.id] })
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('a link nobody was sent can be paid by anyone but its owner (the address is enough)', () => {
    const h = fresh()
    run(h, create())
    run(h, payLink(link(h), 'studio', { expect: { senderDebit: m('13.33') } }))
    h.node.settleDue()
    expect(bal(h, 'ana')).toBe('260.70')
  })

  it('a paid link cannot be paid again: "This link has already been paid."', () => {
    const h = fresh()
    run(h, create())
    run(h, payLink(link(h), 'marko'))
    expect(refusal(h, payLink(link(h), 'studio'))).toEqual({ code: 'invalid-state', status: 'paid' })
    expect(link(h).payments).toHaveLength(1)
  })

  it('the owner cannot pay their own link: "This is your own link."', () => {
    const h = fresh()
    run(h, create())
    expect(refusal(h, payLink(link(h), 'ana', { to: '@ana' }))).toEqual({ code: 'self-payment' })
    expect(link(h).status).toBe('open')
  })

  it('the amount must equal the link and a stale debit is quote-changed', () => {
    const h = fresh()
    run(h, create())
    expect(refusal(h, payLink(link(h), 'marko', { amount: m('13.21'), expect: { senderDebit: m('13.34') } }))).toEqual({
      code: 'invalid-amount',
    })
    expect(refusal(h, payLink(link(h), 'marko', { expect: { senderDebit: m('13.20') } }))).toEqual({
      code: 'quote-changed',
      senderDebit: m('13.33'),
    })
    expect(link(h).status).toBe('open')
  })

  it('the channel of a link payment is link, whatever the caller names', () => {
    const h = fresh()
    run(h, create())
    const events = run(h, payLink(link(h), 'marko', { channel: 'username' }))
    expect((events[0] as Extract<LedgerEvent, { type: 'tx.submitted' }>).tx.channel).toBe('link')
  })

  it('funds: a link of 300.00 needs 303.00 available; Marko has 132.98', () => {
    const h = fresh()
    run(h, create({ amount: m('300.00') }))
    const l = link(h)
    expect(refusal(h, payLink(l, 'marko', { expect: { senderDebit: m('303.00') } }))).toMatchObject({
      code: 'insufficient-funds',
    })
    expect(link(h).status).toBe('open')
  })
})

describe('the log form and the address of a link', () => {
  it('link.create and link.share are stored by the command that made the link', () => {
    const h = fresh()
    const c = create()
    run(h, c)
    const s = h.node.getState()
    const wire = encodeCommand(s, c)
    expect(wire).toEqual({ ok: true, value: { type: 'link.create', amount: '13.20', note: 'Pizza' } })
    if (!wire.ok) return
    expect(decodeCommand(s, content, { actor: 'ana', cmdId: c.cmdId, cmd: wire.value })).toEqual({ ok: true, value: c })
    const sh = share('L-000001', '@marko')
    const w2 = encodeCommand(s, sh)
    expect(w2).toEqual({
      ok: true,
      value: { type: 'link.share', linkRef: { cmdId: c.cmdId }, to: '@marko' },
    })
    if (!w2.ok) return
    expect(checkWireCommand(w2.value)).toBeNull()
    expect(decodeCommand(s, content, { actor: 'ana', cmdId: sh.cmdId, cmd: w2.value })).toEqual({ ok: true, value: sh })
    expect(encodeCommand(s, share('L-424242', '@marko'))).toEqual({ ok: false, error: 'unknown-ref' })
  })

  it('a payment address carries the link: ...#/pay?v=1&to=@ana&amount=13.20&link=L-000001', () => {
    const url = encodePaymentUri(
      { v: 1, to: '@ana', amount: m('13.20'), link: 'L-000001' },
      'https://example.test/app/',
    )
    expect(url).toBe('https://example.test/app/#/pay?v=1&to=@ana&amount=13.20&link=L-000001')
    expect(parsePaymentUri(url)).toEqual({ ok: true, value: { v: 1, to: '@ana', amount: 1320, link: 'L-000001' } })
  })

  it('a paid link is a Tx of the payer with the link id', () => {
    const h = fresh()
    run(h, create())
    run(h, payLink(link(h), 'marko'))
    const tx = Object.values(h.node.getState().txs).find((t) => t.links?.linkId === 'L-000001') as Tx
    expect(tx.cmdId).toMatch(/:review$/)
  })
})
