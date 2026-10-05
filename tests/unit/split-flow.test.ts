import { describe, expect, it } from 'vitest'
import { stepBar } from '@app/flows/engine'
import { errorText } from '@app/errors'
import { asMinor } from '@domain/money'
import type { Handle } from '@domain/types'
import { notificationsFor } from '@store/notifications'
import { equalSplit, splitCandidates, splitsOf } from '@store/selectors'
import { phoneFixture } from '../support/phone'
import { content, m } from './helpers'

// Split a bill: pick a payment, choose people, equal or custom shares, the check and the requests;
// then the payments of the shares and what the owner sees.

function brunchTxId(f: ReturnType<typeof phoneFixture>): string {
  const s = f.node.getState()
  const tx = Object.values(s.txs).find((t) => t.note === 'Brunch for two')
  return tx?.id ?? ''
}

describe('equal shares', () => {
  it('26.40 with one person is 13.20 each; 10.00 with two people is 3.33 each and 3.34 kept', () => {
    expect(equalSplit(m('26.40'), 1)).toEqual({ each: m('13.20'), own: m('13.20') })
    expect(equalSplit(m('10.00'), 2)).toEqual({ each: m('3.33'), own: m('3.34') })
    expect(equalSplit(m('26.40'), 3)).toEqual({ each: m('6.60'), own: m('6.60') })
    expect(equalSplit(m('0.02'), 3)).toEqual({ each: asMinor(0), own: m('0.02') })
  })
})

describe('split the Brunch with Marko', () => {
  it('offers the last outgoing payments, the newest first, with the Brunch chosen', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const picks = splitCandidates(f.node.getState(), 'ana')
    expect(picks.map((t) => t.note ?? t.items?.[0]?.name)).toEqual(['Brunch for two', 'Espresso', 'Pizza'])
    const { api } = ana.open('split')
    expect(ana.step().id).toBe('pick')
    expect(ana.flow().draft).toMatchObject({ source: brunchTxId(f) })
    expect(ana.primary().enabled).toBe(true)
    expect(stepBar(ana.impl() as never, ana.flow().draft as never, ana.ctx(), ana.flow().step)).toEqual({
      n: 1,
      total: 4,
    })
    api.next()
    expect(ana.step().id).toBe('people')
    expect(ana.primary().enabled).toBe(false)
  })

  it('sends one request of 13.20; Marko pays 13.33; Ana 260.70, Marko 119.65; everyone paid', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('split')
    api.next()
    api.set({ people: ['@marko'] })
    api.next()
    expect(ana.step().id).toBe('shares')
    expect(ana.primary().enabled).toBe(true)
    api.next()
    expect(ana.step().id).toBe('review')
    expect(ana.primary()).toEqual({ label: 'Send 1 request', tone: 'navy', enabled: true })
    api.press()
    expect(ana.phase()).toBe('success')
    const s = f.node.getState()
    const split = Object.values(s.splits)[0]
    expect(split).toMatchObject({
      owner: 'ana',
      total: 2640,
      note: 'Brunch for two',
      ownShare: 1320,
      sourceTxId: brunchTxId(f),
    })
    expect(split?.shares).toHaveLength(1)
    expect(ana.flow().draft).toMatchObject({ splitId: split?.id })

    const marko = f.as('marko')
    const share = Object.values(s.requests).find((r) => r.channel === 'split')
    marko.open('payItem', { request: share?.id ?? '' }).api.press()
    f.settle()
    expect(f.balance('ana')).toBe('260.70')
    expect(f.balance('marko')).toBe('119.65')
    const progress = splitsOf(f.node.getState(), 'ana')[0]
    expect(progress).toMatchObject({ paid: 1, count: 1, status: 'complete', collected: 1320 })
    const kinds = notificationsFor(f.node.getState(), 'ana', content).map((n) => n.kind)
    expect(kinds).toContain('split.completed')
  })

  it('a payment that has a split is no longer offered', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('split')
    api.next()
    api.set({ people: ['@marko'] })
    api.goto('review')
    api.press()
    expect(splitCandidates(f.node.getState(), 'ana').map((t) => t.note ?? t.items?.[0]?.name)).toEqual([
      'Espresso',
      'Pizza',
    ])
  })

  it('opened from the payment’s detail it starts on people, with three steps and Back leaving the flow', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('split', { txId: brunchTxId(f) })
    expect(ana.step().id).toBe('people')
    expect(stepBar(ana.impl() as never, ana.flow().draft as never, ana.ctx(), ana.flow().step)).toEqual({
      n: 1,
      total: 3,
    })
    api.back()
    expect(ana.stack()).toEqual(['home'])
  })
})

describe('an amount that is entered', () => {
  it('10.00 "Dinner" with two people: 3.33 each, 3.34 kept', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('split')
    api.set({ source: null })
    api.next()
    expect(ana.step().id).toBe('amount')
    expect(ana.primary().enabled).toBe(false)
    api.set({ total: '10.00' })
    api.next()
    expect(ana.step().id).toBe('note')
    expect(ana.primary().enabled).toBe(false)
    api.set({ note: 'Dinner' })
    api.next()
    api.set({ people: ['@marko', '@marta_k'] })
    api.next()
    api.next()
    expect(ana.step().id).toBe('review')
    expect(ana.primary().label).toBe('Send 2 requests')
    api.press()
    const split = Object.values(f.node.getState().splits)[0]
    expect(split).toMatchObject({ total: 1000, ownShare: 334, note: 'Dinner' })
    expect(split?.shares.map((x) => [x.party, x.amount])).toEqual([
      ['marko', 333],
      ['@marta_k', 333],
    ])
    expect(split?.sourceTxId).toBeUndefined()
  })
})

describe('custom shares', () => {
  it('over the total is refused with its words; the shares must cover each person', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('split', { txId: brunchTxId(f) })
    api.set({ people: ['@marko'] })
    api.next()
    api.set({ mode: 'custom' })
    expect(ana.primary().enabled).toBe(false) // nothing entered yet
    api.set({ custom: { '@marko': '30.00' } })
    expect(ana.primary().enabled).toBe(false)
    expect(errorText({ code: 'invalid-amount', max: m('26.40') }, { about: 'shares' })).toBe(
      'The shares add up to more than 26.40.',
    )
    api.set({ custom: { '@marko': '20.00' } })
    expect(ana.primary().enabled).toBe(true)
    api.next()
    api.press()
    const split = Object.values(f.node.getState().splits)[0]
    expect(split).toMatchObject({ ownShare: 640 })
    expect(split?.shares[0]?.amount).toBe(2000)
  })
})

describe('what is open can be cancelled', () => {
  it('Cancel open requests asks, then cancels every open share', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('split', { txId: brunchTxId(f) })
    api.set({ people: ['@marko', '@marta_k' as Handle] })
    api.goto('review')
    api.press()
    const split = Object.values(f.node.getState().splits)[0]
    ana.nav.home()
    const cancel = ana.open('cancelSplit', { splitId: split?.id ?? '' })
    expect(ana.primary()).toEqual({ label: 'Cancel requests', tone: 'navy', enabled: true })
    cancel.api.press()
    expect(ana.phase()).toBe('success')
    const requests = Object.values(f.node.getState().requests).filter((r) => r.channel === 'split')
    expect(requests.map((r) => r.status)).toEqual(['cancelled', 'cancelled'])
  })
})
