import { describe, expect, it } from 'vitest'
import { stepBar } from '@app/flows/engine'
import { errorText } from '@app/errors'
import { euroInput, parseEuros } from '@app/flows/steps/EuroAmountStep'
import type { SimTime } from '@domain/types'
import { formatTime, formatWeekday } from '@sim/tz'
import { rampByCmdId } from '@store/selectors'
import { phoneFixture } from '../support/phone'

// Top up: whole euros, a method on file, the check, and what each method ends on. A card or a local
// method settles at once; a bank transfer is asked for and arrives by the banking-hours rule. A
// payment the balance cannot cover offers Top up with the shortfall in whole euros.

const LJUBLJANA = 'Europe/Ljubljana'

describe('the euro keypad', () => {
  it('takes digits and the "00" key, never a leading zero, and stops after six digits', () => {
    expect(euroInput('', '5')).toBe('5')
    expect(euroInput('5', '0')).toBe('50')
    expect(euroInput('5', '00')).toBe('500')
    expect(euroInput('', '0')).toBe('')
    expect(euroInput('', '00')).toBe('')
    expect(euroInput('123456', '7')).toBe('123456')
    expect(euroInput('50', 'del')).toBe('5')
    expect(euroInput('', 'del')).toBe('')
    expect(euroInput('50', '.')).toBe('50')
    expect(parseEuros('')).toBe(0)
    expect(parseEuros('50')).toBe(50)
  })
})

describe('Top up by card', () => {
  it('€50 gives 55.00 BCPS without a fee: Ana 247.50 → 302.50', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('topUp')
    expect(ana.step().id).toBe('amount')
    expect(ana.primary()).toMatchObject({ label: 'Continue', enabled: false })
    api.set({ eur: '50' })
    expect(ana.primary().enabled).toBe(true)
    api.next()
    expect(ana.step().id).toBe('method')
    // The first method on file is chosen already: her card.
    expect(ana.flow().draft).toMatchObject({ method: 'card' })
    api.next()
    expect(ana.step().id).toBe('review')
    expect(ana.primary()).toEqual({ label: 'Top up €50.00', tone: 'money', enabled: true })
    expect(stepBar(ana.impl() as never, ana.flow().draft as never, ana.ctx(), ana.flow().step)).toEqual({
      n: 3,
      total: 3,
    })
    api.press()
    f.settle()
    expect(ana.phase()).toBe('success')
    expect(f.balance('ana')).toBe('302.50')
    const tx = ana.tx()
    expect(tx).toMatchObject({ kind: 'on-ramp', from: 'sys:issuance', to: 'ana', amount: 5500 })
    expect(tx?.fee.fee).toBe(0)
    const ramp = rampByCmdId(f.node.getState(), `${ana.flow().instanceId}:review`)
    expect(ramp).toMatchObject({ method: 'card', eur: 5000, amount: 5500, status: 'completed' })
  })

  it('more than €10,000 is not accepted: the step stays and the words are the limit', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('topUp')
    api.set({ eur: '10001' })
    expect(ana.primary().enabled).toBe(false)
    expect(errorText({ code: 'invalid-amount', maxEur: 10_000 })).toBe('The maximum top-up is €10,000.')
    api.set({ eur: '10000' })
    expect(ana.primary().enabled).toBe(true)
  })

  it('the Edit links of the check go back to the amount and the method, and Back returns to the check', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('topUp')
    api.set({ eur: '20' })
    api.next()
    api.next()
    api.goto('amount', { editing: true })
    expect(ana.primary().label).toBe('Continue')
    api.press()
    expect(ana.step().id).toBe('review')
    expect(ana.primary().label).toBe('Top up €20.00')
  })
})

describe('Top up by bank transfer', () => {
  it('asked for at Fri 12:15 it is expected at 14:15 and shows its timeline; it arrives by the clock', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('topUp')
    api.set({ eur: '50', method: 'bank-transfer' })
    api.goto('review')
    api.press()
    // No payment yet: the flow has ended, on the timeline.
    expect(ana.phase()).toBe('success')
    const ramp = rampByCmdId(f.node.getState(), `${ana.flow().instanceId}:review`)
    expect(ramp).toMatchObject({ method: 'bank-transfer', status: 'pending', eur: 5000, amount: 5500 })
    expect(ramp?.arrivesAt).toBeDefined()
    const at = ramp?.arrivesAt as SimTime
    expect(`${formatWeekday(at, LJUBLJANA)} ${formatTime(at, LJUBLJANA)}`).toBe('Fri 14:15')
    expect(f.balance('ana')).toBe('247.50')

    f.node.advanceTo(at)
    f.settle()
    expect(f.balance('ana')).toBe('302.50')
    expect(rampByCmdId(f.node.getState(), `${ana.flow().instanceId}:review`)?.status).toBe('completed')
  })
})

describe('a payment the balance cannot cover offers Top up', () => {
  it('Send of 250.00 to Marko is 5.00 BCPS short: the link opens Top up with €5 and keeps the stack below', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('send', { to: '@marko' })
    api.set({ amount: '250' })
    expect(ana.primary().enabled).toBe(false)
    const link = ana.step().secondary?.(ana.flow().draft as never, ana.ctx(), api)
    expect(link).toMatchObject({ kind: 'link', label: 'Top up' })
    const below = ana.stack().slice(0, -1)
    link?.onPress()
    expect(ana.flow().id).toBe('topUp')
    expect(ana.flow().draft).toMatchObject({ eur: '5' })
    expect(ana.stack().slice(0, -1)).toEqual(below)
    expect(ana.primary().enabled).toBe(true)
  })

  it('there is no link while the balance covers the payment', () => {
    const f = phoneFixture()
    const ana = f.as('ana')
    const { api } = ana.open('send', { to: '@marko' })
    api.set({ amount: '10' })
    expect(ana.step().secondary?.(ana.flow().draft as never, ana.ctx(), api)).toBeNull()
  })
})
