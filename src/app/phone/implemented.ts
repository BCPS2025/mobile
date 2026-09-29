import type { ComponentType } from 'react'
import type { FlowImpl } from '../flows/types'
import type { DetailId, FlowId, Target, ViewId } from './registry'
import { HUBS } from './registry'
import type { Params, Shell } from './types'

// Which screens have components yet. The registry (registry.ts) is the graph as data; this holds
// what is built. A tile or hub row whose target is not built is hidden, never disabled. The
// screens register themselves in register.ts, which the phone host imports once; nothing here
// imports a screen, so chrome and navigation can ask without an import cycle.

export interface ScreenProps {
  params: Params
}

const views = new Map<ViewId, Partial<Record<Shell, ComponentType<ScreenProps>>>>()
const details = new Map<DetailId, ComponentType<ScreenProps>>()
const flows = new Map<FlowId, FlowImpl<never>>()
const hubHeaders = new Map<string, ComponentType>()
const authScreens = new Map<string, ComponentType>()

/** A view (a list, a page or a tool). Give one component for every shell, or one per shell. */
export function registerView(
  id: ViewId,
  screen: ComponentType<ScreenProps> | Partial<Record<Shell, ComponentType<ScreenProps>>>,
): void {
  views.set(
    id,
    typeof screen === 'function' ? { consumer: screen, pos: screen, studio: screen, trade: screen } : screen,
  )
}

/** A detail (one payment, a received screen). */
export function registerDetail(id: DetailId, screen: ComponentType<ScreenProps>): void {
  details.set(id, screen)
}

/** A flow. Its steps and commit points must match the registry entry. */
export function registerFlow<D>(impl: FlowImpl<D>): void {
  flows.set(impl.id, impl as unknown as FlowImpl<never>)
}

/** A block above a hub's rows (the identity card on Profile), named in the registry. */
export function registerHubHeader(name: string, block: ComponentType): void {
  hubHeaders.set(name, block)
}

/** A screen of a logged-out phone: `welcome`, `login`, `code`. */
export function registerAuthScreen(name: string, screen: ComponentType): void {
  authScreens.set(name, screen)
}

export const viewScreen = (id: string, shell: Shell): ComponentType<ScreenProps> | undefined =>
  views.get(id as ViewId)?.[shell]
export const detailScreen = (id: string): ComponentType<ScreenProps> | undefined => details.get(id as DetailId)
export const flowImpl = (id: string): FlowImpl<never> | undefined => flows.get(id as FlowId)
export const hubHeader = (name: string | undefined): ComponentType | undefined =>
  name ? hubHeaders.get(name) : undefined
export const authScreen = (name: string): ComponentType | undefined => authScreens.get(name)

/** Whether a target can be opened by an account of this shell (a hub is built when the registry names it for the shell). */
export function isImplemented(target: Target, shell: Shell): boolean {
  switch (target.kind) {
    case 'flow':
      return flows.has(target.id)
    case 'view':
      return views.get(target.id)?.[shell] !== undefined
    case 'detail':
      return details.has(target.id)
    case 'hub':
      return HUBS[target.id].shell === shell
  }
}
