import { describe, expect, it } from 'vitest'
import { authUnits, unitsOf } from '@app/shell/history'
import { keyAction, keyBelongsToPage } from '@app/shell/keys'
import { PHONE_H, PHONE_W, stageLayout } from '@app/shell/layout'
import { HOME_SCREEN } from '@app/phone/types'
import { dateChipText } from '@app/format'
import type { SimTime } from '@domain/types'
import { instantOfAt } from '@sim/tz'

// The stage's arithmetic, the presenter keys and the phone-mode history units: pure functions.

const tape = { tape: true, zoomed: false }

describe('the stage layout', () => {
  it('at 1,280 × 720 the phones are drawn at 0.88 or more, with the labels beside them', () => {
    const l = stageLayout(1280, 720, tape)
    expect(l.scale).toBeGreaterThanOrEqual(0.88)
    expect(l.labels).toBe('side')
    expect(l.toasts).toBe('gutter')
    expect(l.width).toBeCloseTo(PHONE_W * l.scale)
    expect(l.height).toBeCloseTo(PHONE_H * l.scale)
  })

  it('never draws a phone larger than its design, and grows with the window height', () => {
    expect(stageLayout(1440, 900, tape).scale).toBe(1)
    expect(stageLayout(1280, 800, tape).scale).toBe(1)
    let last = 0
    for (const h of [500, 600, 700, 720, 800]) {
      const s = stageLayout(1280, h, tape).scale
      expect(s).toBeGreaterThanOrEqual(last)
      last = s
    }
    expect(stageLayout(1280, 300, tape).scale).toBe(0.5)
  })

  it('with the tape off the phones take the room of its rows', () => {
    expect(stageLayout(1280, 720, { tape: false, zoomed: false }).scale).toBeGreaterThan(
      stageLayout(1280, 720, tape).scale,
    )
  })

  it('between 768 and 1,279 px the labels sit above the phones and the phones share the width', () => {
    const l = stageLayout(1024, 720, tape)
    expect(l.labels).toBe('above')
    expect(2 * l.width + 44).toBeLessThanOrEqual(1024)
    expect(l.toasts).toBe('gutter')
    const narrow = stageLayout(768, 700, tape)
    expect(2 * narrow.width + 44).toBeLessThanOrEqual(768)
    expect(narrow.toasts).toBe('bar') // no gutter wide enough: toasts move into the top bar row
  })

  it('zoomed, one phone takes the height of the window', () => {
    const l = stageLayout(1280, 720, { tape: true, zoomed: true })
    expect(l.scale).toBeGreaterThan(stageLayout(1280, 720, tape).scale)
    expect(l.height).toBeLessThanOrEqual(720 - 44)
    expect(stageLayout(1440, 900, { tape: true, zoomed: true }).scale).toBeGreaterThan(1.1)
    expect(stageLayout(1440, 2000, { tape: true, zoomed: true }).scale).toBe(1.6)
  })

  it('the gutter beside a phone is never narrower than a toast when the toasts stand there', () => {
    for (const w of [800, 900, 1024, 1100, 1279, 1280, 1440, 1920]) {
      const l = stageLayout(w, 720, tape)
      if (l.toasts === 'gutter') expect(l.gutter).toBeGreaterThanOrEqual(120)
    }
  })
})

describe('the presenter keys', () => {
  const press = (key: string, extra: object = {}) => keyAction({ key, ...extra })

  it('F, Z, Esc and ? are the presenter keys, in either case', () => {
    expect(press('f')).toBe('fullscreen')
    expect(press('F')).toBe('fullscreen')
    expect(press('z')).toBe('zoom')
    expect(press('Z')).toBe('zoom')
    expect(press('Escape')).toBe('escape')
    expect(press('?')).toBe('help')
  })

  it('Space, Enter, ".", digits, P and the arrows are never intercepted', () => {
    for (const key of [
      ' ',
      'Enter',
      '.',
      ',',
      '0',
      '7',
      'p',
      'P',
      'ArrowLeft',
      'ArrowDown',
      's',
      'c',
      'r',
      'Backspace',
      'Tab',
    ]) {
      expect(press(key), key).toBeNull()
    }
  })

  it('a modifier, a text field, a keypad or an editable element take the key instead', () => {
    expect(press('f', { ctrlKey: true })).toBeNull()
    expect(press('z', { metaKey: true })).toBeNull()
    expect(press('f', { altKey: true })).toBeNull()
    expect(press('z', { target: { tagName: 'INPUT' } })).toBeNull()
    expect(press('z', { target: { tagName: 'textarea' } })).toBeNull()
    expect(press('z', { target: { tagName: 'DIV', isContentEditable: true } })).toBeNull()
    expect(
      press('f', { target: { tagName: 'BUTTON', closest: (s: string) => (s === '[data-keypad]' ? {} : null) } }),
    ).toBeNull()
    expect(press('f', { target: { tagName: 'BUTTON', closest: () => null } })).toBe('fullscreen')
    expect(keyBelongsToPage(null)).toBe(false)
  })
})

describe('the date chip', () => {
  it('reads "Fri 25 Sep · 12:15" at the start of the session', () => {
    const t0 = instantOfAt('2026-09-25', { day: 0, time: '12:15' }) as SimTime
    expect(dateChipText(t0)).toBe('Fri 25 Sep · 12:15')
    expect(dateChipText(instantOfAt('2026-09-25', { day: 3, time: '07:05' }) as SimTime)).toBe('Mon 28 Sep · 07:05')
  })
})

describe('history units of phone mode', () => {
  const flow = (step: number, openedOn = 0) =>
    ({ kind: 'flow', id: 'send', instanceId: 'x', step, openedOn, draft: {}, sent: false }) as const

  it('count the screens above Home and the steps taken inside the flow on top', () => {
    expect(unitsOf([HOME_SCREEN])).toBe(0)
    expect(unitsOf([HOME_SCREEN, { kind: 'hub', id: 'payRequest' }])).toBe(1)
    expect(unitsOf([HOME_SCREEN, { kind: 'hub', id: 'payRequest' }, flow(0)])).toBe(2)
    expect(unitsOf([HOME_SCREEN, { kind: 'hub', id: 'payRequest' }, flow(2)])).toBe(4)
    // A flow that opened on Review counts steps from there.
    expect(unitsOf([HOME_SCREEN, flow(3, 3)])).toBe(1)
  })

  it('count the login screens of a logged-out phone', () => {
    expect(authUnits({ screen: 'welcome' })).toBe(0)
    expect(authUnits({ screen: 'login', chosen: null })).toBe(1)
    expect(authUnits({ screen: 'code', persona: 'ana', resends: 0 })).toBe(2)
  })
})
