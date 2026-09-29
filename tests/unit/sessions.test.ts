import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { SimTime } from '@domain/types'
import { freshUi } from '@store/record'
import {
  chooseForSlot,
  codeForLogin,
  completeLogin,
  isVisible,
  loginChoices,
  loginCode,
  loginInstant,
  loginsOf,
  logoutSlot,
  markAllRead,
  markRead,
  personaOn,
  remember,
  resetUi,
  stageKeyOf,
  swapStage,
} from '@store/sessions'
import { content } from './helpers'

// The pure reducers behind the phones: who is on which phone, the rotating login codes (D19),
// read marks and what Reset starts from. The same persona is never on both stage phones.

const seedCode = (id: string) => content.personas.personas.find((p) => p.id === id)?.login?.code ?? ''

describe('login codes', () => {
  it('rotate by 7919 per login, modulo 1,000,000, as six digits', () => {
    expect(loginCode('482916', 0)).toBe('482916')
    expect(loginCode('482916', 1)).toBe('490835')
    expect(loginCode('264903', 0)).toBe('264903')
    expect(loginCode('999999', 1)).toBe('007918')
    expect(loginCode('000000', 0)).toBe('000000')
  })

  it('the first login after Reset shows the seed code, the next one and "Send again" a different one', () => {
    let ui = freshUi()
    expect(codeForLogin(ui, 'ana', seedCode('ana'))).toBe('482916')
    expect(codeForLogin(ui, 'ana', seedCode('ana'), 1)).not.toBe('482916')
    ui = completeLogin(ui, 'left', 'ana')
    expect(loginsOf(ui, 'ana')).toBe(1)
    ui = logoutSlot(ui, 'left')
    expect(codeForLogin(ui, 'ana', seedCode('ana'))).toBe(loginCode('482916', 1))
    // A login after one "Send again" moves past both codes that were shown.
    const again = completeLogin(ui, 'left', 'ana', 1)
    expect(loginsOf(again, 'ana')).toBe(3)
    expect(codeForLogin(logoutSlot(again, 'left'), 'ana', seedCode('ana'))).toBe(loginCode('482916', 3))
  })
})

describe('sessions on the phones', () => {
  it('starts logged out: left remembers Ana, right the café, phone mode Ana', () => {
    const ui = freshUi()
    expect(personaOn(ui, 'left')).toBeNull()
    expect(ui.phones.stage.left.remembered).toBe('ana')
    expect(ui.phones.stage.right.remembered).toBe('cafe')
    expect(ui.phones.phone.remembered).toBe('ana')
    expect(ui.sessions.size).toBe(0)
  })

  it('a login puts the account on the phone and marks it in `sessions`', () => {
    let ui = completeLogin(freshUi(), 'left', 'ana')
    ui = completeLogin(ui, 'right', 'cafe')
    expect(personaOn(ui, 'left')).toBe('ana')
    expect(personaOn(ui, 'right')).toBe('cafe')
    expect([...ui.sessions.keys()]).toEqual(['ana', 'cafe'])
    expect(stageKeyOf(ui, 'cafe')).toBe('right')
    expect(isVisible(ui, 'ana', 'stage')).toBe(true)
    expect(isVisible(ui, 'ana', 'phone')).toBe(false)
  })

  it('refuses the account that is on the other stage phone', () => {
    const ui = completeLogin(freshUi(), 'left', 'ana')
    expect(completeLogin(ui, 'right', 'ana')).toBe(ui)
    expect(loginInstant(ui, 'right', 'ana')).toBe(ui)
    // The phone-mode phone is separate from the stage phones.
    expect(personaOn(loginInstant(ui, 'single', 'ana'), 'single')).toBe('ana')
  })

  it('an account-menu login does not move the code counter', () => {
    const ui = loginInstant(freshUi(), 'left', 'ana')
    expect(loginsOf(ui, 'ana')).toBe(0)
  })

  it('log out returns to Welcome and remembers the account', () => {
    const on = completeLogin(freshUi(), 'left', 'marko')
    const off = logoutSlot(on, 'left')
    expect(personaOn(off, 'left')).toBeNull()
    expect(off.phones.stage.left.remembered).toBe('marko')
    expect(off.sessions.size).toBe(0)
    expect(logoutSlot(off, 'left')).toBe(off)
  })

  it('swap exchanges the two stage phones with what they remember', () => {
    let ui = completeLogin(freshUi(), 'left', 'ana')
    ui = logoutSlot(completeLogin(ui, 'right', 'cafe'), 'right')
    const swapped = swapStage(ui)
    expect(personaOn(swapped, 'right')).toBe('ana')
    expect(swapped.phones.stage.left.remembered).toBe('cafe')
    expect(swapStage(swapped).phones).toEqual(ui.phones)
  })

  it('the account menu swaps when the account is on the other phone, otherwise logs in at once', () => {
    let ui = loginInstant(loginInstant(freshUi(), 'left', 'ana'), 'right', 'cafe')
    const swapped = chooseForSlot(ui, 'left', 'cafe')
    expect(personaOn(swapped, 'left')).toBe('cafe')
    expect(personaOn(swapped, 'right')).toBe('ana')
    expect(chooseForSlot(ui, 'left', 'ana')).toBe(ui)
    ui = chooseForSlot(ui, 'left', 'marko')
    expect(personaOn(ui, 'left')).toBe('marko')
    expect(personaOn(ui, 'right')).toBe('cafe')
    expect([...ui.sessions.keys()]).toEqual(['cafe', 'marko'])
  })

  it('the chooser lists the remembered account first and greys the other phone’s account', () => {
    const live = ['ana', 'marko', 'cafe']
    let ui = completeLogin(freshUi(), 'right', 'cafe')
    ui = remember(ui, 'left', 'marko')
    const rows = loginChoices(ui, 'left', live)
    expect(rows.map((r) => r.persona)).toEqual(['marko', 'ana', 'cafe'])
    expect(rows.find((r) => r.persona === 'cafe')?.disabled).toBe(true)
    expect(rows.filter((r) => r.disabled)).toHaveLength(1)
    expect(loginChoices(ui, 'single', live).some((r) => r.disabled)).toBe(false)
  })

  it('the same persona is never on both stage phones, whatever the sequence', () => {
    const personas = ['ana', 'marko', 'cafe'] as const
    const action = fc.oneof(
      fc.record({
        op: fc.constant('login' as const),
        key: fc.constantFrom('left', 'right'),
        p: fc.constantFrom(...personas),
      }),
      fc.record({
        op: fc.constant('instant' as const),
        key: fc.constantFrom('left', 'right'),
        p: fc.constantFrom(...personas),
      }),
      fc.record({
        op: fc.constant('choose' as const),
        key: fc.constantFrom('left', 'right'),
        p: fc.constantFrom(...personas),
      }),
      fc.record({ op: fc.constant('logout' as const), key: fc.constantFrom('left', 'right') }),
      fc.record({ op: fc.constant('swap' as const) }),
    )
    fc.assert(
      fc.property(fc.array(action, { maxLength: 40 }), (steps) => {
        let ui = freshUi()
        for (const s of steps) {
          if (s.op === 'login') ui = completeLogin(ui, s.key, s.p)
          else if (s.op === 'instant') ui = loginInstant(ui, s.key, s.p)
          else if (s.op === 'choose') ui = chooseForSlot(ui, s.key, s.p)
          else if (s.op === 'logout') ui = logoutSlot(ui, s.key)
          else ui = swapStage(ui)
          const { left, right } = ui.phones.stage
          if (left.persona !== null && left.persona === right.persona) return false
        }
        return true
      }),
      { numRuns: 300 },
    )
  })
})

describe('read marks', () => {
  const t0Date = '2026-09-25'
  const tz = 'Europe/Ljubljana'

  it('marks one notification read once', () => {
    const ui = markRead(freshUi(), 'ana', 'tx:BC-AAAAAA')
    expect(ui.read.get('ana')?.readIds).toEqual(['tx:BC-AAAAAA'])
    expect(markRead(ui, 'ana', 'tx:BC-AAAAAA')).toBe(ui)
  })

  it('"Mark all as read" reads everything up to now and keeps the single marks', () => {
    const now = Date.UTC(2026, 8, 25, 10, 20, 0) as SimTime
    const ui = markAllRead(markRead(freshUi(), 'ana', 'tx:BC-AAAAAA'), 'ana', now, t0Date, tz)
    expect(ui.read.get('ana')?.readUpTo).toEqual({ day: 0, time: '12:20:00.000' })
    expect(ui.read.get('ana')?.readIds).toEqual(['tx:BC-AAAAAA'])
  })
})

describe('Reset', () => {
  it('everyone logged out, counters at zero; Ana left, the café right', () => {
    const before = completeLogin(loginInstant(freshUi(), 'right', 'cafe'), 'left', 'ana')
    expect(loginsOf(before, 'ana')).toBe(1)
    const ui = resetUi({ mode: 'stage', loginAgain: false })
    expect(personaOn(ui, 'left')).toBeNull()
    expect(ui.phones.stage.left.remembered).toBe('ana')
    expect(ui.phones.stage.right.remembered).toBe('cafe')
    expect(ui.logins.size).toBe(0)
  })

  it('with the option: Ana and the café logged in again on the stage, Ana on the phone in phone mode', () => {
    const stage = resetUi({ mode: 'stage', loginAgain: true })
    expect(personaOn(stage, 'left')).toBe('ana')
    expect(personaOn(stage, 'right')).toBe('cafe')
    expect(loginsOf(stage, 'ana')).toBe(0)
    const phone = resetUi({ mode: 'phone', loginAgain: true })
    expect(personaOn(phone, 'single')).toBe('ana')
    expect(personaOn(phone, 'left')).toBeNull()
  })
})
