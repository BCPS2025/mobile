import type { ComponentType } from 'react'
import type { Content } from '@content/schema'
import type { LedgerState, PersonaId, Rate, SimTime, Tx, UserCommand } from '@domain/types'
import type { AppState } from '../state/app'
import type { FlowId, StepKind } from '../phone/registry'
import type { Params, Shell, SlotKey } from '../phone/types'

// The flow engine's types. A flow is a linear task, one step per screen, ending on a success
// screen whose [Done] returns Home. Registered per id (src/app/phone/register.ts); the graph
// (steps, commit points, success kind) is in the pure registry, and the two must agree.

/** What a step or a flow can read: the account, the ledger now and the page's app state. */
export interface FlowCtx {
  app: AppState
  persona: PersonaId
  slot: SlotKey
  shell: Shell
  state: LedgerState
  content: Content
  now: SimTime
  rate: Rate
  params: Params
}

/** What a step's buttons can do to the running flow. */
export interface FlowApi<D> {
  /** Changes the draft (and clears the error line). */
  set(patch: Partial<D> | ((d: D) => D)): void
  /** The next step (skipped steps are passed over). */
  next(): void
  /** The previous step, or leaves the flow from the first one. */
  back(): void
  /** Jumps to a step by id (Edit links on Review); `editing` makes its button read "Back to review". */
  goto(stepId: string, opts?: { editing?: boolean }): void
  /** Leaves the flow (pops it, discarding the draft). */
  leave(): void
  /** Leaves the flow and Home follows (Done). */
  done(): void
  /** Runs the step's primary action (the commit, or on to the next step). */
  press(): void
  /** Shows an error line on this step. */
  fail(message: string | null): void
}

export interface StepProps<D> {
  d: D
  ctx: FlowCtx
  api: FlowApi<D>
  /** A commit is in flight (Sending…). */
  sending: boolean
  error: string | null
  /** Opened from an Edit link on the review step. */
  editing: boolean
}

export interface PrimaryDef {
  label: string
  /** `outline` is a bordered button on a navy dock (the café's Cancel). */
  tone: 'money' | 'navy' | 'white' | 'outline'
  enabled: boolean
}

export interface SecondaryDef {
  kind: 'link' | 'outline'
  label: string
  onPress: () => void
  disabled?: boolean
}

export interface StepDef<D> {
  id: string
  /** data-screen of the step (as in the registry). */
  screen: string
  kind: StepKind
  /** The step's screen body; the engine draws the header, step bar, error line and dock. */
  Screen: ComponentType<StepProps<D>>
  /** The dock's big button. */
  primary(d: D, ctx: FlowCtx): PrimaryDef
  /** The dock's second control: a text link (Skip) or an outline button (Keep, Cancel). */
  secondary?(d: D, ctx: FlowCtx, api: FlowApi<D>): SecondaryDef | null
  /** Passed over when true (a field a template already filled). */
  skip?(d: D, ctx: FlowCtx): boolean
  /** Not on the linear path, not numbered in the step bar (reached with `goto` only). */
  offPath?: boolean
  /** Runs instead of "on to the next step" when the primary button is pressed (not a commit). */
  onPrimary?(d: D, ctx: FlowCtx, api: FlowApi<D>): void
  /** Where Back goes when it is not the previous step; 'leave' pops the flow. */
  back?(d: D, ctx: FlowCtx, api: FlowApi<D>): 'default' | 'leave' | { step: string }
  /** The task header title of this step when it differs from the flow's (the café's code and Cancel read "Payment code"). */
  title?(d: D, ctx: FlowCtx): string
  /** Screen body colour (default light; Scan, Charge and Pay code are navy). */
  body?: 'light' | 'navy'
  /** The task header of this step when it differs from the flow's (Scan is navy, its review light). */
  header?(d: D, ctx: FlowCtx): 'light' | 'navy' | 'business'
  /** No dock under this step (Scan while no code is in view). */
  hideDock?(d: D, ctx: FlowCtx): boolean
  /** The step shows something that changes with the clock (a code that can expire): it renders every second. */
  live?: boolean
}

/** A commit point: the step whose primary button dispatches this command. */
export interface CommitDef<D> {
  step: string
  /**
   * The step id the command id is made from, when the flow may dispatch this commit more than once
   * (the café's Charge makes a new code after a cancel or an expiry): every command id is used
   * once. Default: `step`.
   */
  cmdStep?(d: D): string
  /** Whether the step's primary button runs this commit now (default true); otherwise `onPrimary` runs. */
  when?(d: D, ctx: FlowCtx): boolean
  /** The command, or null when the draft is not ready. `cmdId` is `${instanceId}:${stepId}`. */
  command(d: D, ctx: FlowCtx, cmdId: string): UserCommand | null
  /**
   * `tx`: wait for the transaction this command creates (Sending… then the success screen, read
   * from the ledger). `none`: the command has no payment to wait for; the flow goes on to the
   * next step at once (unless `onAccepted` is given: it then decides where the flow goes).
   */
  await: 'tx' | 'none'
  /**
   * Called after an accepted command. With `await: 'none'` it replaces the automatic move to the
   * next step: move the flow yourself (`api.goto`, `api.next`, `api.leave`) or stay where it is.
   */
  onAccepted?(d: D, ctx: FlowCtx, api: FlowApi<D>): void
}

export interface SuccessProps<D> {
  d: D
  ctx: FlowCtx
  /** The payment that ended the flow, when it has one. */
  tx: Tx | undefined
  /** [Done]: Home. */
  done(): void
  /** Starts another flow from Home (allowed follow-ons only). */
  followOn(id: FlowId, params?: Params): void
}

export interface FlowImpl<D = unknown> {
  id: FlowId
  /** The task header title. */
  title(ctx: FlowCtx): string
  /** `light` (people), `navy` (Scan) or `business` (navy with the business name). */
  tone(ctx: FlowCtx): 'light' | 'navy' | 'business'
  /** The draft of a new instance (filled from `ctx.params` or a template). */
  init(ctx: FlowCtx): D
  steps: StepDef<D>[]
  /** The step id a new instance opens on (default: the first not skipped). `review` for template-filled flows. */
  openOn?(d: D, ctx: FlowCtx): string
  commits: CommitDef<D>[]
  /** The success screen (money or neutral); use SuccessScreen. */
  Success?: ComponentType<SuccessProps<D>>
  /** True once the flow has ended although no payment says so (the café's code was paid). */
  done?(d: D, ctx: FlowCtx): boolean
  /**
   * True when the flow already shows this payment (the café's code step, once its code is paid), so
   * the account gets no banner for it on top of the flow's own screen.
   */
  covers?(d: D, ctx: FlowCtx, txId: string): boolean
}
