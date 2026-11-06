import { describe, expect, it } from 'vitest'
import {
  MAX_BEFORE_FLOW,
  fromPersistedIds,
  hasFlow,
  home,
  normalise,
  persistedIds,
  pop,
  push,
  replaceFlow,
  samePersisted,
  topFlow,
  topOf,
  updateFlow,
} from '@app/phone/stack'
import type { FlowScreen, Screen } from '@app/phone/types'

// The rules of a persona's screen stack: home › [hub] › [view] › [detail] › [detail], a flow on
// top, one hub level, and what a reload keeps.

const hub = (id = 'payRequest'): Screen => ({ kind: 'hub', id })
const view = (id = 'history'): Screen => ({ kind: 'view', id })
const detail = (n: number): Screen => ({ kind: 'detail', id: 'tx', params: { txId: `BC-${n}` } })
const flow = (id = 'send', step = 0): FlowScreen => ({
  kind: 'flow',
  id,
  instanceId: `${id}0000000000000000`.slice(0, 16),
  step,
  openedOn: 0,
  draft: {},
  sent: false,
})
const kinds = (s: readonly Screen[]) => s.map((x) => x.kind)

describe('pushing screens', () => {
  it('opens one hub, only directly on Home', () => {
    const inHub = push(home(), hub())
    expect(kinds(inHub)).toEqual(['home', 'hub'])
    expect(push(inHub, hub('sales'))).toBe(inHub)
    const inView = push(push(home(), view()), hub())
    expect(kinds(inView)).toEqual(['home', 'view'])
  })

  it('opens one view, from Home or from a hub', () => {
    expect(kinds(push(push(home(), hub()), view()))).toEqual(['home', 'hub', 'view'])
    const inView = push(home(), view())
    expect(push(inView, view('notifications'))).toBe(inView)
  })

  it('allows two details and replaces the top one after that; five screens at most before a flow', () => {
    let s = push(push(push(home(), hub()), view()), detail(1))
    s = push(s, detail(2))
    expect(kinds(s)).toEqual(['home', 'hub', 'view', 'detail', 'detail'])
    expect(s.length).toBe(MAX_BEFORE_FLOW)
    const replaced = push(s, detail(3))
    expect(replaced).toHaveLength(MAX_BEFORE_FLOW)
    expect(replaced[4]).toMatchObject({ params: { txId: 'BC-3' } })
    expect(replaced[3]).toMatchObject({ params: { txId: 'BC-1' } })
    // A shorter stack takes the second detail on top; from a deep stack it replaces the top.
    expect(kinds(push(push(home(), detail(1)), detail(2)))).toEqual(['home', 'detail', 'detail'])
  })

  it('a flow sits on top of any of these, and nothing opens over a flow', () => {
    const base = push(push(push(home(), hub()), view()), detail(1))
    const inFlow = push(base, flow())
    expect(kinds(inFlow)).toEqual(['home', 'hub', 'view', 'detail', 'flow'])
    expect(push(inFlow, hub())).toBe(inFlow)
    expect(push(inFlow, view())).toBe(inFlow)
    expect(push(inFlow, detail(2))).toBe(inFlow)
    expect(push(inFlow, flow('charge'))).toBe(inFlow)
  })

  it('opening Home resets the stack', () => {
    expect(push(push(home(), hub()), { kind: 'home' })).toEqual(home())
  })

  it('a stack always starts with Home', () => {
    expect(kinds(normalise([hub()]))).toEqual(['home', 'hub'])
    expect(kinds(push([], hub()))).toEqual(['home', 'hub'])
    expect(topOf([])).toEqual({ kind: 'home' })
  })
})

describe('leaving screens', () => {
  it('Back pops one screen and stops at Home', () => {
    const s = push(push(home(), hub()), view())
    expect(kinds(pop(s))).toEqual(['home', 'hub'])
    expect(pop(home())).toEqual(home())
  })

  it('a hand-off replaces the flow and keeps the stack below it', () => {
    const base = push(home(), flow('scan'))
    const next = replaceFlow(base, flow('send'))
    expect(kinds(next)).toEqual(['home', 'flow'])
    expect(topFlow(next)?.id).toBe('send')
    expect(replaceFlow(home(), flow('send'))).toEqual(home())
  })
})

describe('the flow on top', () => {
  it('is found by instance and changed only for that instance', () => {
    const f = flow('send')
    const s = push(push(home(), hub()), f)
    expect(hasFlow(s, 'send')).toBe(true)
    expect(hasFlow(s, 'scan')).toBe(false)
    const moved = updateFlow(s, f.instanceId, (x) => ({ ...x, step: 2 }))
    expect(topFlow(moved)?.step).toBe(2)
    expect(updateFlow(s, 'someone-else', (x) => ({ ...x, step: 3 }))).toBe(s)
    expect(topFlow(home())).toBeNull()
  })
})

describe('what a reload keeps', () => {
  it('is Home, or Home and the hub above it', () => {
    expect(persistedIds(home())).toEqual(['home'])
    expect(persistedIds(push(home(), hub()))).toEqual(['home', 'hub:payRequest'])
    expect(persistedIds(push(push(home(), hub()), view()))).toEqual(['home', 'hub:payRequest'])
    expect(persistedIds(push(push(home(), hub()), flow()))).toEqual(['home', 'hub:payRequest'])
    expect(persistedIds(push(home(), view()))).toEqual(['home'])
  })

  it('is restored from ids, dropping the unknown ones', () => {
    expect(kinds(fromPersistedIds(['home', 'hub:payRequest']))).toEqual(['home', 'hub'])
    expect(fromPersistedIds(['home', 'hub:gone'])).toEqual(home())
    expect(fromPersistedIds(['home', 'hub:payRequest', 'hub:sales'])).toHaveLength(2)
    expect(fromPersistedIds([])).toEqual(home())
  })

  it('compares lists, an empty one standing for Home', () => {
    expect(samePersisted(undefined, ['home'])).toBe(true)
    expect(samePersisted(['home', 'hub:sales'], ['home'])).toBe(false)
  })
})
