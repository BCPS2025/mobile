import '@app/phone/register'
import { createFlowApi } from '@app/flows/actions'
import type { Who } from '@app/flows/actions'
import { makeFlowCtx } from '@app/flows/ctx'
import { phaseOf, txOf } from '@app/flows/engine'
import type { FlowImpl } from '@app/flows/types'
import { flowImpl } from '@app/phone/implemented'
import { createPhoneNav } from '@app/phone/nav'
import type { FlowId } from '@app/phone/registry'
import type { FlowScreen, Params, Shell } from '@app/phone/types'
import { createAppState } from '@app/state/app'
import { asMinor, formatMinor } from '@domain/money'
import type { UserCommand, UserCommandBody } from '@domain/types'
import { content } from '../unit/helpers'

// Drives the phone flows of the people screens against a real app state and ledger, with two
// accounts on the stage (Ana on the left, Marko on the right). `as('ana')` is one phone: it opens
// flows and details, presses the dock, and reads what the step enables. The screens themselves
// are drawn by the browser specs.

export type AnyDraft = Record<string, unknown>

export interface Phone {
  who: Who
  nav: ReturnType<typeof createPhoneNav>
  open(id: FlowId, params?: Params): { top: FlowScreen; api: ReturnType<typeof createFlowApi<AnyDraft>> }
  flow(): FlowScreen
  api(): ReturnType<typeof createFlowApi<AnyDraft>>
  ctx(): ReturnType<typeof makeFlowCtx>
  impl(): FlowImpl<AnyDraft>
  phase(): ReturnType<typeof phaseOf>
  step(): FlowImpl<AnyDraft>['steps'][number]
  primary(): ReturnType<FlowImpl<AnyDraft>['steps'][number]['primary']>
  tx(): ReturnType<typeof txOf>
  /** The screens on the stack, as `kind:id`. */
  stack(): string[]
}

/** `cafe: true` puts Café Lipa on the right phone in place of Marko (the pos shell). */
export function phoneFixture(opts: { cafe?: boolean } = {}) {
  const app = createAppState({
    content,
    build: 'dev',
    storage: null,
    locks: null,
    timers: null,
    clock: { mode: 'manual' },
    epochDate: () => '2026-09-25',
  })
  app.actions.choose('left', 'ana')
  app.actions.choose('right', opts.cafe ? 'cafe' : 'marko')
  const node = app.runtime.node
  const as = (
    persona: 'ana' | 'marko' | 'cafe',
    slot: 'left' | 'right' = persona === 'ana' ? 'left' : 'right',
  ): Phone => {
    const shell: Shell = persona === 'cafe' ? 'pos' : 'consumer'
    const who: Who = { persona, slot, shell }
    const nav = createPhoneNav(app, who)
    const flow = () => nav.top() as FlowScreen
    const ctx = () => makeFlowCtx(app, who, flow().params)
    const impl = () => flowImpl(flow().id) as unknown as FlowImpl<AnyDraft>
    return {
      who,
      nav,
      open(id, params) {
        nav.openFlow(id, params)
        const top = flow()
        return { top, api: createFlowApi<AnyDraft>(app, who, top.instanceId) }
      },
      flow,
      api: () => createFlowApi<AnyDraft>(app, who, flow().instanceId),
      ctx,
      impl,
      phase: () => phaseOf(flow(), impl() as FlowImpl<unknown>, ctx()),
      step: () => impl().steps[flow().step] as FlowImpl<AnyDraft>['steps'][number],
      primary() {
        const s = impl().steps[flow().step]
        if (!s) throw new Error('no step')
        return s.primary(flow().draft as AnyDraft, ctx())
      },
      tx: () => txOf(flow(), impl() as FlowImpl<unknown>, ctx()),
      stack: () => nav.stack().map((s) => (s.kind === 'home' ? 'home' : `${s.kind}:${'id' in s ? s.id : ''}`)),
    }
  }
  const balance = (id: string) => formatMinor(node.getState().balances[id]?.confirmed ?? asMinor(0))
  /** Lets every pending payment settle. */
  const settle = () => node.settleDue()
  /** A command another account sends (the other side of a request, a payment, a refund …). */
  let counter = 0
  const dispatch = (actor: string, body: UserCommandBody) =>
    app.runtime.dispatch({
      ...body,
      actor,
      cmdId: `${(0xc0de00 + ++counter).toString(16).padStart(16, '0')}:t`,
    } as UserCommand)
  return { app, node, as, balance, settle, dispatch }
}
