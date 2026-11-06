import { describe, expect, it } from 'vitest'
import { content } from '@content/load'
import { fitsStage, openTarget, parseHash } from '@app/router'
import { ui } from '@app/copy'
import { payerShort, rateText, txRef } from '@app/format'
import { keypadInput } from '@app/kit/Keypad'
import type { Tx } from '@domain/types'

describe('hash routes', () => {
  it('maps the routes and sends everything else to not-found', () => {
    expect(parseHash('')).toEqual({ name: 'landing' })
    expect(parseHash('#/')).toEqual({ name: 'landing' })
    expect(parseHash('#/about')).toEqual({ name: 'about' })
    expect(parseHash('#/about/')).toEqual({ name: 'about' })
    expect(parseHash('#/stage')).toEqual({ name: 'stage' })
    expect(parseHash('#/phone')).toEqual({ name: 'phone' })
    expect(parseHash('#/phone/ana')).toEqual({ name: 'phone', persona: 'ana' })
    expect(parseHash('#/pay?v=1&to=@cafelipa&amount=11.00')).toEqual({ name: 'pay' })
    for (const bad of ['#/stage/1', '#/present/1', '#/phone/ana/x', '#/tour/1', '#/x', '#/about/more', '#/pay/x']) {
      expect(parseHash(bad)).toEqual({ name: 'notFound' })
    }
  })

  it('opens the stage on a wide landscape window and phone mode otherwise', () => {
    expect(openTarget(1280, 720)).toBe('#/stage')
    expect(openTarget(768, 700)).toBe('#/stage')
    expect(openTarget(767, 700)).toBe('#/phone')
    expect(openTarget(1024, 1366)).toBe('#/phone')
    expect(openTarget(390, 844)).toBe('#/phone')
    expect(fitsStage(1280, 1280)).toBe(false)
  })
})

describe('keypad', () => {
  const max = 100_000
  const type = (keys: string[]) => keys.reduce((v, k) => keypadInput(v, k, max), '')
  it('allows at most two decimals and one point', () => {
    expect(type(['1', '2', '.', '4', '0', '5'])).toBe('12.40')
    expect(type(['.', '5'])).toBe('0.5')
    expect(type(['1', '.', '.', '2'])).toBe('1.2')
    expect(type(['0', '7'])).toBe('7')
  })
  it('guards the maximum amount and deletes', () => {
    expect(type(['1', '0', '0', '0', '0'])).toBe('1000')
    expect(keypadInput('1000', '1', max)).toBe('1000')
    expect(keypadInput('12.4', 'del', max)).toBe('12.')
  })
})

describe('display helpers', () => {
  it('shows neutral references, the café as payer and the reference rate', () => {
    expect(txRef({ id: 'BC-4F7K2Q' } as Tx)).toBe('BC-4F7K2Q')
    expect(payerShort('cafe')).toBe('café')
    expect(payerShort('ana')).toBe('Ana Novak')
    expect(rateText(content.config.rate)).toBe('1.10')
  })
  it('interface copy is complete (validated at load)', () => {
    expect(ui.start.headline).toBe('Pay and get paid in seconds.')
    expect(ui.start.overline).toBe('BLOCKCHAIN PAYMENT SYSTEM')
    expect(ui.pillars.map((p) => p.title)).toEqual(['Settles in seconds', 'Low-cost', 'One network', 'Always open'])
    expect(ui.common.rateChip.replace('{rate}', '1.10')).toBe('€1 ≈ 1.10 BCPS · BCPS is not pegged')
  })
})
