import { describe, expect, it } from 'vitest'
import '@app/phone/register'
import { authScreen, detailScreen, flowImpl, hubHeader, isImplemented, viewScreen } from '@app/phone/implemented'
import { DETAILS, FLOWS, HUBS, LIVE_SHELLS, VIEWS } from '@app/phone/registry'

// What is built (screens registered in src/app/phone/register.ts) against what the registry names:
// a registered flow has exactly the steps, screens and commit points of its registry entry, and a
// registered view or detail belongs to one the registry knows. Every milestone adds to both.

describe('registered screens and flows agree with the registry', () => {
  it('a registered flow has the registry’s steps, screens, kinds and commit points, and a success screen', () => {
    for (const [id, spec] of Object.entries(FLOWS)) {
      const impl = flowImpl(id)
      if (!impl) continue
      expect(
        impl.steps.map((s) => s.id),
        `${id} steps`,
      ).toEqual(spec.steps.map((s) => s.id))
      expect(
        impl.steps.map((s) => s.screen),
        `${id} screens`,
      ).toEqual(spec.steps.map((s) => s.screen))
      expect(
        impl.steps.map((s) => s.kind),
        `${id} kinds`,
      ).toEqual(spec.steps.map((s) => s.kind))
      expect(
        impl.commits.map((c) => c.step),
        `${id} commits`,
      ).toEqual([...spec.commits])
      // A flow that ends on a success screen has one; Log out ends on Welcome.
      if (spec.success !== 'welcome') expect(impl.Success, `${id} success`).toBeDefined()
    }
  })

  it('a registered view or detail is one the registry knows, and the shells it serves are live', () => {
    for (const id of Object.keys(VIEWS)) {
      for (const shell of LIVE_SHELLS)
        if (viewScreen(id, shell)) expect(VIEWS[id as keyof typeof VIEWS].shells).toContain(shell)
    }
    for (const id of Object.keys(DETAILS))
      if (detailScreen(id)) expect(DETAILS[id as keyof typeof DETAILS]).toBeDefined()
  })

  it('has the screens of a logged-out phone the shell needs, and hubs open for their own shell only', () => {
    expect(authScreen('welcome')).toBeDefined()
    expect(isImplemented({ kind: 'hub', id: 'payRequest' }, 'consumer')).toBe(true)
    expect(isImplemented({ kind: 'hub', id: 'payRequest' }, 'pos')).toBe(false)
    expect(isImplemented({ kind: 'hub', id: 'sales' }, 'pos')).toBe(true)
    for (const [id, spec] of Object.entries(HUBS)) expect(LIVE_SHELLS, id).toContain(spec.shell)
  })

  it('the shell ships About and Log out', () => {
    expect(viewScreen('about', 'consumer')).toBeDefined()
    expect(viewScreen('about', 'pos')).toBeDefined()
    expect(flowImpl('logout')).toBeDefined()
  })
})

describe('the people screens ship', () => {
  it('Scan, Send, History, Notifications, the payment detail, Log in, the code screen and the Profile card', () => {
    expect(flowImpl('scan')).toBeDefined()
    expect(flowImpl('send')).toBeDefined()
    expect(viewScreen('history', 'consumer')).toBeDefined()
    expect(viewScreen('notifications', 'consumer')).toBeDefined()
    expect(viewScreen('notifications', 'pos')).toBeDefined()
    expect(detailScreen('tx')).toBeDefined()
    expect(authScreen('login')).toBeDefined()
    expect(authScreen('code')).toBeDefined()
    expect(hubHeader('identity')).toBeDefined()
  })

  it('every consumer tile is visible: Scan, Pay & request (its Send row) and History', () => {
    for (const target of [
      { kind: 'flow', id: 'scan' },
      { kind: 'hub', id: 'payRequest' },
      { kind: 'view', id: 'history' },
      { kind: 'flow', id: 'send' },
    ] as const)
      expect(isImplemented(target, 'consumer'), `${target.kind}:${target.id}`).toBe(true)
  })
})
