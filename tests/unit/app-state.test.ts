import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, createPrefsStore, parsePrefs } from '@app/state/prefs'
import { createAppState } from '@app/state/app'
import { resolveItems } from '@sim/seed'
import { PREFS_KEY } from '@store/persistence'
import { personaOn } from '@store/sessions'
import type { UserCommand } from '@domain/types'
import { memoryStorage } from '../support/records'
import { content, m } from './helpers'

// The app state of a page: who is on which phone, banners for accounts on a phone, toasts for
// accounts that are not, the saved screens, Reset with its option and Undo, and the presenter
// preferences (kept apart from the session, never touched by Reset).

const items = resolveItems(content, 'cafe', [
  { sku: 'flat-white', qty: 2 },
  { sku: 'croissant', qty: 2 },
])
let n = 0
const cmdId = () => `${(++n).toString(16).padStart(16, '0')}:review`
const sale = (): UserCommand => ({
  type: 'pay',
  actor: 'ana',
  cmdId: cmdId(),
  to: '@cafelipa',
  amount: m('11.00'),
  channel: 'qr',
  items,
  expect: { senderDebit: m('11.00') },
})
const send = (): UserCommand => ({
  type: 'pay',
  actor: 'ana',
  cmdId: cmdId(),
  to: '@marko',
  amount: m('16.50'),
  channel: 'username',
  note: 'Cinema',
  expect: { senderDebit: m('16.67') },
})

function app(storage: ReturnType<typeof memoryStorage> | null = null) {
  return createAppState({
    content,
    build: 'dev',
    storage,
    locks: null,
    timers: null,
    clock: { mode: 'manual' },
    epochDate: () => '2026-09-25',
  })
}

describe('accounts on the phones', () => {
  it('starts logged out, logs in, swaps, and logs out remembering the account', () => {
    const a = app()
    expect(personaOn(a.runtime.ui.get(), 'left')).toBeNull()
    a.actions.choose('left', 'ana')
    a.actions.choose('right', 'cafe')
    expect(personaOn(a.runtime.ui.get(), 'left')).toBe('ana')
    a.actions.swap()
    expect(personaOn(a.runtime.ui.get(), 'left')).toBe('cafe')
    expect(personaOn(a.runtime.ui.get(), 'right')).toBe('ana')
    // Choosing the account on the other phone swaps, and shows the handover card on both.
    a.actions.choose('left', 'ana')
    expect(personaOn(a.runtime.ui.get(), 'left')).toBe('ana')
    expect(a.transient.get().handover.left?.persona).toBe('ana')
    expect(a.transient.get().handover.right?.persona).toBe('cafe')
    a.actions.logout('left')
    expect(personaOn(a.runtime.ui.get(), 'left')).toBeNull()
    expect(a.runtime.ui.get().phones.stage.left.remembered).toBe('ana')
    expect(a.nav.stack('ana')).toEqual([{ kind: 'home' }])
    a.dispose()
  })

  it('a login through the screens moves the code counter, the account menu does not', () => {
    const a = app()
    a.actions.choose('left', 'ana')
    expect(a.runtime.ui.get().logins.get('ana')).toBeUndefined()
    a.actions.logout('left')
    a.actions.completeLogin('left', 'ana')
    expect(a.runtime.ui.get().logins.get('ana')).toBe(1)
    a.dispose()
  })
})

describe('notifications become banners or toasts', () => {
  it('a payment for an account on a phone is a banner; for an account that is not, a toast', () => {
    const a = app()
    a.actions.setMode('stage')
    a.actions.choose('left', 'ana')
    a.actions.choose('right', 'cafe')
    a.runtime.dispatch(sale())
    a.runtime.dispatch({ ...send(), cmdId: cmdId() })
    a.runtime.node.settleDue()
    const t = a.transient.get()
    expect(t.banners.cafe).toMatchObject({ title: 'Payment received · 11.00 BCPS', kind: 'sale.received' })
    expect(t.banners.marko).toBeUndefined()
    expect(t.toasts).toHaveLength(1)
    expect(t.toasts[0]).toMatchObject({
      persona: 'marko',
      name: 'Marko Kovač',
      text: "On Marko Kovač's phone: @ana sent you 16.50 BCPS · Cinema",
    })
    // Marko arriving on a phone takes his toast away.
    a.actions.choose('left', 'marko')
    expect(a.transient.get().toasts).toHaveLength(0)
    a.actions.dismissBanner('cafe')
    expect(a.transient.get().banners.cafe).toBeUndefined()
    a.dispose()
  })

  it('shows nothing on a page without phones, and keeps at most three toasts', () => {
    const a = app()
    a.runtime.dispatch(sale())
    a.runtime.node.settleDue()
    expect(a.transient.get().banners).toEqual({})
    expect(a.transient.get().toasts).toEqual([])
    a.actions.setMode('phone')
    a.actions.choose('single', 'marko')
    for (let i = 0; i < 5; i++) {
      a.runtime.dispatch({ ...sale(), cmdId: cmdId() })
      a.runtime.node.settleDue()
    }
    expect(a.transient.get().toasts.length).toBeLessThanOrEqual(3)
    expect(a.transient.get().toasts.every((x) => x.persona === 'cafe')).toBe(true)
    a.dispose()
  })

  it('read marks keep the count honest', () => {
    const a = app()
    a.actions.markRead('cafe', 'tx:BC-AAAAAA')
    expect(a.runtime.ui.get().read.get('cafe')?.readIds).toEqual(['tx:BC-AAAAAA'])
    a.actions.markAllRead('cafe')
    expect(a.runtime.ui.get().read.get('cafe')?.readUpTo).not.toBeNull()
    a.dispose()
  })
})

describe('screens are saved as Home and one hub', () => {
  it('mirrors Home and a hub into the saved UI and follows Reset', () => {
    const a = app()
    a.nav.set('ana', [{ kind: 'home' }, { kind: 'hub', id: 'payRequest' }, { kind: 'view', id: 'history' }])
    expect(a.runtime.ui.get().nav.get('ana')).toEqual(['home', 'hub:payRequest'])
    a.actions.reset('stage', false)
    expect(a.nav.stack('ana')).toEqual([])
    expect(a.runtime.ui.get().nav.get('ana')).toBeUndefined()
    a.dispose()
  })
})

describe('Reset and Undo', () => {
  it('with the option both phones come back logged in; Undo restores balances and sessions', () => {
    const a = app()
    a.actions.setMode('stage')
    a.actions.choose('left', 'ana')
    a.actions.choose('right', 'cafe')
    a.runtime.dispatch(sale())
    a.runtime.node.settleDue()
    expect(a.runtime.node.getState().balances.ana?.confirmed).toBe(m('236.50'))
    a.actions.choose('left', 'marko')
    a.actions.reset('stage', true)
    expect(a.runtime.node.getState().balances.ana?.confirmed).toBe(m('247.50'))
    expect(personaOn(a.runtime.ui.get(), 'left')).toBe('ana')
    expect(personaOn(a.runtime.ui.get(), 'right')).toBe('cafe')
    expect(a.transient.get().resetToast).not.toBeNull()
    a.actions.undo()
    expect(a.runtime.node.getState().balances.ana?.confirmed).toBe(m('236.50'))
    expect(personaOn(a.runtime.ui.get(), 'left')).toBe('marko')
    expect(a.transient.get().resetToast).toBeNull()
    a.dispose()
  })

  it('without the option everyone is on Welcome, Ana left and the café right', () => {
    const a = app()
    a.actions.choose('left', 'marko')
    a.actions.reset('stage', false)
    expect(personaOn(a.runtime.ui.get(), 'left')).toBeNull()
    expect(a.runtime.ui.get().phones.stage.left.remembered).toBe('ana')
    expect(a.runtime.ui.get().phones.stage.right.remembered).toBe('cafe')
    a.dispose()
  })

  it('phone mode: with the option Ana is logged in on the one phone', () => {
    const a = app()
    a.actions.reset('phone', true)
    expect(personaOn(a.runtime.ui.get(), 'single')).toBe('ana')
    expect(personaOn(a.runtime.ui.get(), 'left')).toBeNull()
    a.dispose()
  })
})

describe('presenter preferences', () => {
  it('read defaults, fall back key by key and ignore anything odd', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('[]')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('{"largeText":true,"tape":"yes","reduceMotion":false,"sound":1}')).toEqual({
      ...DEFAULT_PREFS,
      largeText: true,
      reduceMotion: false,
    })
    expect(parsePrefs(JSON.stringify({ largeText: 'x'.repeat(3000) }))).toEqual(DEFAULT_PREFS)
  })

  it('are saved under bcps:prefs and survive Reset', () => {
    const storage = memoryStorage()
    const a = app(storage)
    a.prefs.update((p) => ({ ...p, largeText: true, tape: false }))
    expect(JSON.parse(storage.getItem(PREFS_KEY) ?? '{}')).toMatchObject({ largeText: true, tape: false })
    a.actions.reset('stage', true)
    expect(a.prefs.get()).toMatchObject({ largeText: true, tape: false })
    const b = createPrefsStore(storage)
    expect(b.get()).toMatchObject({ largeText: true, tape: false })
    a.dispose()
  })

  it('a browser that refuses storage still works', () => {
    const blocked = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const store = createPrefsStore(blocked)
    expect(store.get()).toEqual(DEFAULT_PREFS)
    expect(() => store.update((p) => ({ ...p, sound: true }))).not.toThrow()
  })
})
