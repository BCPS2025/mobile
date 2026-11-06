import { describe, expect, it } from 'vitest'
import { errorText } from '@app/errors'
import type { Handle } from '@domain/types'
import { requestByCmdId } from '@store/selectors'
import { phoneFixture } from '../support/phone'
import { m } from './helpers'

// Paying or declining what someone asked (Pay & request › a request, a payment link, a split
// share): the check, the pay and decline commits, what the ledger says afterwards.

const LUNCH = 'r_seed_lunch'

describe('pay a request', () => {
  it('shows the seeded Lunch request and pays it: fee 0.13, total 13.33, Ana 234.17, Marko 146.18', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('payItem', { request: LUNCH })
    expect(ana.step().id).toBe('review')
    expect(ana.primary()).toEqual({ label: 'Pay 13.33', tone: 'money', enabled: true })
    api.press()
    expect(ana.phase()).toBe('sending')
    f.settle()
    expect(ana.phase()).toBe('success')
    expect(ana.tx()).toMatchObject({ channel: 'request', note: 'Lunch', to: 'marko', links: { requestId: LUNCH } })
    expect(f.balance('ana')).toBe('234.17')
    expect(f.balance('marko')).toBe('146.18')
    expect(f.node.getState().requests[LUNCH]?.status).toBe('paid')
  })

  it('a double tap pays once', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('payItem', { request: LUNCH })
    api.press()
    api.press()
    f.settle()
    expect(f.balance('ana')).toBe('234.17')
  })

  it('declining asks first, tells the requester and moves no money', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('payItem', { request: LUNCH })
    expect(ana.primary().label).toBe('Pay 13.33')
    api.goto('decline')
    expect(ana.step().id).toBe('decline')
    expect(ana.primary()).toEqual({ label: 'Decline', tone: 'navy', enabled: true })
    // Keep goes back to the check; the request is still open.
    api.back()
    expect(ana.step().id).toBe('review')
    expect(f.node.getState().requests[LUNCH]?.status).toBe('open')
    api.goto('decline')
    api.press()
    expect(ana.phase()).toBe('success')
    expect(f.node.getState().requests[LUNCH]?.status).toBe('declined')
    expect(f.balance('ana')).toBe('247.50')
    expect(f.balance('marko')).toBe('132.98')
  })

  it('a request that was cancelled meanwhile says so when it is paid', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('payItem', { request: LUNCH })
    expect(f.dispatch('marko', { type: 'request.cancel', requestId: LUNCH }).ok).toBe(true)
    api.press()
    expect(ana.flow().error).toBe('This request was cancelled.')
    expect(ana.phase()).toBe('input')
    expect(f.balance('ana')).toBe('247.50')
  })

  it('cannot be paid without the money: the shortfall is named and Pay is off', () => {
    const f = phoneFixture()
    const made = f.dispatch('marko', {
      type: 'request.create',
      channel: 'username',
      payer: '@ana' as Handle,
      amount: m('300.00'),
    })
    expect(made.ok).toBe(true)
    const id = Object.values(f.node.getState().requests).find((r) => r.amount === m('300.00'))?.id ?? ''
    const ana = f.as('ana')
    ana.open('payItem', { request: id })
    // 300.00 + 3.00 fee against 247.50.
    expect(ana.primary()).toEqual({ label: 'Pay 303.00', tone: 'money', enabled: false })
  })
})

describe('pay a payment link and a split share', () => {
  it('pays a link that was shared: no Decline, Pay 13.33, the link closes', () => {
    const f = phoneFixture()
    const made = f.dispatch('marko', { type: 'link.create', amount: m('13.20'), note: 'Pizza' })
    expect(made.ok).toBe(true)
    const link = Object.values(f.node.getState().links)[0]
    expect(link).toBeDefined()
    expect(f.dispatch('marko', { type: 'link.share', linkId: link?.id ?? '', to: '@ana' as Handle }).ok).toBe(true)
    const ana = f.as('ana')
    const { api } = ana.open('payItem', { link: link?.id ?? '' })
    expect(ana.impl().steps[0]?.secondary?.(ana.flow().draft as never, ana.ctx(), api)).toBeNull()
    expect(ana.primary().label).toBe('Pay 13.33')
    api.press()
    f.settle()
    expect(ana.phase()).toBe('success')
    expect(ana.tx()).toMatchObject({ channel: 'link', to: 'marko', note: 'Pizza' })
    expect(f.node.getState().links[link?.id ?? '']?.status).toBe('paid')
    expect(f.balance('ana')).toBe('234.17')
    expect(f.balance('marko')).toBe('146.18')
    // Paid already: nothing more to pay.
    ana.nav.home()
    const again = f.as('ana')
    again.open('payItem', { link: link?.id ?? '' })
    again.api().press()
    expect(again.flow().error).toBe('This link has already been paid.')
  })

  it('pays a split share and can decline it', () => {
    const f = phoneFixture()
    const made = f.dispatch('marko', {
      type: 'split.create',
      total: m('26.40'),
      note: 'Brunch for two',
      shares: [{ party: '@ana' as Handle, amount: m('13.20') }],
    })
    expect(made.ok).toBe(true)
    const share = Object.values(f.node.getState().requests).find((r) => r.channel === 'split')
    const ana = f.as('ana')
    const { api } = ana.open('payItem', { request: share?.id ?? '' })
    expect(ana.impl().steps[0]?.secondary?.(ana.flow().draft as never, ana.ctx(), api)).toMatchObject({
      label: 'Decline',
    })
    api.press()
    f.settle()
    expect(f.balance('ana')).toBe('234.17')
    expect(f.balance('marko')).toBe('146.18')
  })
})

describe('the words of the refusals', () => {
  it('a cancelled request and a paid link', () => {
    expect(errorText({ code: 'invalid-state', status: 'cancelled' }, { about: 'request' })).toBe(
      'This request was cancelled.',
    )
    expect(errorText({ code: 'invalid-state', status: 'paid' }, { about: 'link' })).toBe(
      'This link has already been paid.',
    )
  })

  it('a request is found by the command that made it', () => {
    const f = phoneFixture()
    const res = f.dispatch('ana', {
      type: 'request.create',
      channel: 'username',
      payer: '@marko' as Handle,
      amount: m('5.00'),
    })
    expect(res.ok).toBe(true)
    const r = Object.values(f.node.getState().requests).find((x) => x.requester === 'ana')
    expect(requestByCmdId(f.node.getState(), r?.cmdId ?? '')?.id).toBe(r?.id)
  })
})
