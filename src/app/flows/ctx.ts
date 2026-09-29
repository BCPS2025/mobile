import type { PersonaId } from '@domain/types'
import type { AppState } from '../state/app'
import type { Params, Shell, SlotKey } from '../phone/types'
import type { FlowCtx } from './types'

/** What a flow reads right now: the ledger, the time and the account (built again on every render). */
export function makeFlowCtx(
  app: AppState,
  who: { persona: PersonaId; slot: SlotKey; shell: Shell },
  params: Params = {},
): FlowCtx {
  const state = app.runtime.node.getState()
  return {
    app,
    persona: who.persona,
    slot: who.slot,
    shell: who.shell,
    state,
    content: app.content,
    now: app.runtime.node.now(),
    rate: state.config.rate,
    params,
  }
}
