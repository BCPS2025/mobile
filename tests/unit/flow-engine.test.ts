import { describe, expect, it } from 'vitest'
import { createFlowApi, newFlowScreen } from '@app/flows/actions'
import type { Who } from '@app/flows/actions'
import { makeFlowCtx } from '@app/flows/ctx'
import { nextIndex, openIndex, pathIndices, phaseOf, prevIndex, stepBar, txOf } from '@app/flows/engine'
import type { FlowCtx, FlowImpl, StepDef } from '@app/flows/types'
import { createPhoneNav } from '@app/phone/nav'
import { registerFlow } from '@app/phone/implemented'
import { HOME_SCREEN } from '@app/phone/types'
import type { FlowScreen } from '@app/phone/types'
import { errorText } from '@app/errors'
import { createAppState } from '@app/state/app'
import { asMinor, formatMinor, mustParseMinor } from '@domain/money'
import { cmdIdFor } from '@store/cmdIds'
import { quoteFor } from '@store/selectors'
import { content } from './helpers'

// The flow engine: the steps a flow visits, the step bar, and the phase of an instance, which
// comes from the ledger (never from an event or a timer); the actions behind the buttons, with a
// real app state and the ledger underneath.

type Draft = { to: string; amount: string; note: string; templated: boolean; debit?: string }

const Nothing = () => null
const step = (id: string, kind: StepDef<Draft>['kind'], extra: Partial<StepDef<Draft>> = {}): StepDef<Draft> => ({
  id,
  screen: `test.${id}`,
  kind,
  Screen: Nothing,
  primary: () => ({ label: 'Next', tone: 'navy', enabled: true }),
  ...extra,
})

const testFlow: FlowImpl<Draft> = {
  id: 'send',
  title: () => 'Send',
  tone: () => 'light',
  init: (ctx) => ({
    to: ctx.params.to ?? '',
    amount: ctx.params.amount ?? '',
    note: '',
    templated: ctx.params.to !== undefined,
  }),
  openOn: (d) => (d.templated ? 'review' : 'to'),
  steps: [
    step('to', 'input', { skip: (d) => d.templated }),
    step('amount', 'input', { skip: (d) => d.templated }),
    step('note', 'input', { skip: (d) => d.templated }),
    step('review', 'review'),
  ],
  commits: [
    {
      step: 'review',
      await: 'tx',
      command: (d, ctx, cmdId) => {
        const amount = mustParseMinor(d.amount)
        const quote = quoteFor(ctx.state, '@marko', 'username', amount)
        return {
          type: 'pay',
          actor: ctx.persona,
          cmdId,
          to: '@marko',
          amount,
          channel: 'username',
          ...(d.note ? { note: d.note } : {}),
          expect: { senderDebit: d.debit ? mustParseMinor(d.debit) : (quote?.senderDebit ?? amount) },
        }
      },
    },
  ],
}
registerFlow(testFlow)

function fixture() {
  const app = createAppState({
    content,
    build: 'dev',
    storage: null,
    locks: null,
    timers: null,
    clock: { mode: 'manual' },
    epochDate: () => '2026-09-25',
  })
  const who: Who = { persona: 'ana', slot: 'left', shell: 'consumer' }
  const nav = createPhoneNav(app, who)
  const open = (params?: Record<string, string>) => {
    nav.openFlow('send', params)
    const top = nav.top() as FlowScreen
    return { top, api: createFlowApi<Draft>(app, who, top.instanceId) }
  }
  const flowNow = () => nav.top() as FlowScreen
  const phase = () => phaseOf(flowNow(), testFlow, makeFlowCtx(app, who))
  return { app, who, nav, open, flowNow, phase }
}

const ctxOf = (d: Draft = { to: '', amount: '', note: '', templated: false }) =>
  ({ state: fixture().app.runtime.node.getState(), params: {}, _d: d }) as unknown as FlowCtx

describe('the steps of a flow', () => {
  const d = (templated: boolean): Draft => ({ to: '', amount: '', note: '', templated })
  const ctx = ctxOf()

  it('visits the steps not skipped, and knows the next and previous one', () => {
    expect(pathIndices(testFlow, d(false), ctx)).toEqual([0, 1, 2, 3])
    expect(pathIndices(testFlow, d(true), ctx)).toEqual([3])
    expect(nextIndex(testFlow, d(false), ctx, 0)).toBe(1)
    expect(nextIndex(testFlow, d(false), ctx, 3)).toBeNull()
    expect(prevIndex(testFlow, d(false), ctx, 2)).toBe(1)
    expect(prevIndex(testFlow, d(false), ctx, 0)).toBeNull()
  })

  it('a template-filled flow opens on Review, the others on the first step', () => {
    expect(openIndex(testFlow, d(true), ctx)).toBe(3)
    expect(openIndex(testFlow, d(false), ctx)).toBe(0)
  })

  it('shows "Step n of total" only on flows of three or more steps, counting input, review and confirm', () => {
    expect(stepBar(testFlow, d(false), ctx, 1)).toEqual({ n: 2, total: 4 })
    expect(stepBar(testFlow, d(false), ctx, 3)).toEqual({ n: 4, total: 4 })
    expect(stepBar(testFlow, d(true), ctx, 3)).toBeNull()
    const short = { ...testFlow, steps: testFlow.steps.slice(2) }
    expect(stepBar(short, d(false), ctx, 0)).toBeNull()
    const waits = { ...testFlow, steps: [...testFlow.steps, step('code', 'waitFor')] }
    expect(stepBar(waits, d(false), ctx, 4)).toBeNull()
    const off = { ...testFlow, steps: [...testFlow.steps, step('cancel', 'confirm', { offPath: true })] }
    expect(stepBar(off, d(false), ctx, 1)).toEqual({ n: 2, total: 4 })
  })
})

describe('moving through a flow', () => {
  it('Next goes on, Back goes back, and Back on the first step leaves the flow with its draft', () => {
    const { nav, open, flowNow } = fixture()
    const { api } = open()
    expect(flowNow().step).toBe(0)
    api.set({ to: '@marko' })
    api.next()
    expect(flowNow().step).toBe(1)
    api.back()
    expect(flowNow().step).toBe(0)
    expect((flowNow().draft as Draft).to).toBe('@marko')
    api.back()
    expect(nav.top()).toEqual(HOME_SCREEN)
  })

  it('an Edit link opens a step whose button returns to Review; Back there returns to Review too', () => {
    const { open, flowNow } = fixture()
    const { api } = open({ to: '@marko', amount: '16.50' })
    expect(flowNow().step).toBe(3)
    api.goto('amount', { editing: true })
    expect(flowNow().editing).toBe(true)
    api.press()
    expect(flowNow().step).toBe(3)
    expect(flowNow().editing).toBe(false)
    api.goto('to', { editing: true })
    api.back()
    expect(flowNow().step).toBe(3)
  })

  it('Back on Review of a template-filled flow leaves the flow', () => {
    const { nav, open } = fixture()
    const { api } = open({ to: '@marko', amount: '16.50' })
    api.back()
    expect(nav.top()).toEqual(HOME_SCREEN)
  })

  it('changing the draft clears the error line', () => {
    const { open, flowNow } = fixture()
    const { api } = open()
    api.fail('Something')
    expect(flowNow().error).toBe('Something')
    api.set({ amount: '1' })
    expect(flowNow().error).toBeUndefined()
  })
})

describe('the commit point', () => {
  it('dispatches once with the command id of the instance and step, and reads its phase from the ledger', () => {
    const { app, open, flowNow, phase, nav } = fixture()
    const { top, api } = open({ to: '@marko', amount: '16.50' })
    expect(phase()).toBe('input')
    api.press()
    const tx = txOf(flowNow(), testFlow, makeFlowCtx(app, { persona: 'ana', slot: 'left', shell: 'consumer' }))
    expect(tx?.cmdId).toBe(cmdIdFor(top.instanceId, 'review'))
    expect(tx?.status).toBe('pending')
    expect(phase()).toBe('sending')
    expect(nav.locked()).toBe(true)
    // A double tap is refused as a duplicate, silently: one payment, no error line.
    api.press()
    expect(app.runtime.node.getState().txOrder.filter((id) => app.runtime.node.getState().txs[id]?.cmdId).length).toBe(
      1,
    )
    expect(flowNow().error).toBeUndefined()
    // Back and Home do nothing while it sends.
    nav.back()
    nav.home()
    expect(nav.top().kind).toBe('flow')
    app.runtime.node.settleDue()
    expect(phase()).toBe('success')
    expect(nav.locked()).toBe(false)
    expect(formatMinor(app.runtime.node.getState().balances.ana?.confirmed ?? asMinor(0))).toBe('230.83')
    expect(formatMinor(app.runtime.node.getState().balances.marko?.confirmed ?? asMinor(0))).toBe('149.48')
    // On a success screen Back is Home.
    nav.back()
    expect(nav.stack()).toEqual([HOME_SCREEN])
  })

  it('a persona that was away finds the success screen when it comes back', () => {
    const { app, open, phase } = fixture()
    const { api } = open({ to: '@marko', amount: '16.50' })
    api.press()
    app.runtime.node.settleDue() // settled while nobody looked
    expect(phase()).toBe('success')
  })

  it('a refusal stays on the step as the error line, and the same command can be sent again', () => {
    const { app, open, flowNow, phase } = fixture()
    const { api } = open({ to: '@marko', amount: '999.99' })
    api.press()
    expect(flowNow().error).toBe('You have 247.50 BCPS. Top up 762.49 BCPS to pay.')
    expect(phase()).toBe('input')
    expect(flowNow().sent).toBe(false)
    api.set({ amount: '16.50' })
    api.press()
    expect(phase()).toBe('sending')
    expect(app.runtime.node.getState().txOrder.some((id) => app.runtime.node.getState().txs[id]?.cmdId)).toBe(true)
  })

  it('a changed quote is refused with the "amount changed" line', () => {
    const { open, flowNow } = fixture()
    const { api } = open({ to: '@marko', amount: '16.50' })
    api.set({ debit: '16.60' })
    api.press()
    expect(flowNow().error).toBe('The amount changed. Check it and try again.')
  })
})

describe('starting and ending flows', () => {
  it('Done goes Home; a follow-on starts from Home; a hand-off replaces the flow below the same stack', () => {
    const { nav, open } = fixture()
    nav.open({ kind: 'hub', id: 'payRequest' })
    open()
    expect(nav.stack().map((s) => s.kind)).toEqual(['home', 'hub', 'flow'])
    nav.handoff('send')
    expect(nav.stack().map((s) => s.kind)).toEqual(['home', 'hub', 'flow'])
    nav.followOn('send')
    expect(nav.stack().map((s) => s.kind)).toEqual(['home', 'flow'])
    nav.home()
    expect(nav.stack()).toEqual([HOME_SCREEN])
  })
})

describe('the words of a refusal', () => {
  const have = mustParseMinor('5.20')
  const short = mustParseMinor('5.80')
  it('uses the interface copy, and stays silent on a repeat', () => {
    expect(errorText({ code: 'insufficient-funds', have, short })).toBe('You have 5.20 BCPS. Top up 5.80 BCPS to pay.')
    expect(errorText({ code: 'unknown-recipient', handle: '@anaa' })).toBe("No BCPS user '@anaa'. Check the spelling.")
    expect(errorText({ code: 'self-payment' })).toBe("You can't pay yourself.")
    expect(errorText({ code: 'invalid-amount' })).toBe('Enter an amount above 0.00.')
    expect(errorText({ code: 'invalid-amount', max: mustParseMinor('999.99') })).toBe('The maximum is 999.99 BCPS.')
    expect(errorText({ code: 'invalid-state', status: 'paid' })).toBe('This code was already paid.')
    expect(errorText({ code: 'invalid-state', status: 'cancelled' })).toBe('This code was cancelled')
    expect(errorText({ code: 'invalid-state', status: 'expired' })).toBe('This code has expired')
    expect(errorText({ code: 'invalid-state', status: 'declined' })).toBe('This was already declined.')
    expect(errorText({ code: 'quote-changed' })).toBe('The amount changed. Check it and try again.')
    expect(errorText({ code: 'not-allowed' }, { name: 'Café Lipa' })).toBe('Only Café Lipa can do this.')
    expect(errorText({ code: 'duplicate' })).toBeNull()
    expect(errorText({ code: 'session-full' })).toContain('session')
    expect(errorText({ code: 'handle-taken' })).toBe('Something went wrong. Try again.')
  })
})

describe('a new flow screen', () => {
  it('has a fresh instance id, its draft from init and the step openOn names', () => {
    const { app, who } = fixture()
    const a = newFlowScreen(app, who, testFlow as never, { to: '@marko', amount: '1' })
    const b = newFlowScreen(app, who, testFlow as never)
    expect(a.instanceId).not.toBe(b.instanceId)
    expect(a.instanceId).toMatch(/^[0-9a-f]{16}$/)
    expect(a.step).toBe(3)
    expect(a.openedOn).toBe(3)
    expect(b.step).toBe(0)
    expect(a.sent).toBe(false)
  })
})
