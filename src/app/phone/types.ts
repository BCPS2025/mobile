import type { PersonaId } from '@domain/types'
import type { SlotKey } from '@store/sessions'

// Types of the phone runtime. The registry (registry.ts) names every screen; these are the
// values a persona's screen stack holds.

export type { SlotKey }

/** The shell (set of screens) an account uses: content/personas.yaml `shell`. */
export type Shell = 'consumer' | 'pos' | 'studio' | 'trade'

export type Params = Readonly<Record<string, string>>

/**
 * One screen of a persona's stack. `stack[0]` is always Home; a hub only sits directly on Home; a
 * flow's steps and its success screen are one `flow` entry on top (`step`, `draft`, `sent`) and
 * do not count towards the depth rule.
 */
export type Screen =
  | { kind: 'home' }
  | { kind: 'hub'; id: string }
  | { kind: 'view'; id: string; params?: Params }
  | { kind: 'detail'; id: string; params: Params }
  | FlowScreen

export interface FlowScreen {
  kind: 'flow'
  id: string
  /** 64 random bits per flow instance: commit points dispatch with `cmdIdFor(instanceId, stepId)`. */
  instanceId: string
  /** Index into the flow's steps. */
  step: number
  /** The step the instance opened on (Back from it leaves the flow). */
  openedOn: number
  /** The flow's own data, kept while the persona is away (discarded by Reset and Log out). */
  draft: unknown
  params?: Params
  /** The commit was accepted and dispatched; the phase then comes from the ledger. */
  sent: boolean
  /** The step's primary action was refused; shown as the error line until the next change. */
  error?: string
  /** Opened from a review step's Edit link: the step's button reads "Back to review". */
  editing?: boolean
}

export const HOME_SCREEN: Screen = { kind: 'home' }

export interface PhoneAddress {
  persona: PersonaId
  slot: SlotKey
}
