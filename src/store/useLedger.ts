import { createContext, useContext, useSyncExternalStore } from 'react'
import type { LedgerState, SimTime } from '@domain/types'
import type { LedgerNode } from './node'

// React bindings over the LedgerNode and its clock store (useSyncExternalStore). The ledger
// re-renders on events only; the time hooks subscribe to the clock store.
// Wrap the app in <LedgerContext.Provider value={node}>.

export const LedgerContext = createContext<LedgerNode | null>(null)

export function useLedgerNode(): LedgerNode {
  const node = useContext(LedgerContext)
  if (!node) throw new Error('useLedgerNode: missing <LedgerContext.Provider>')
  return node
}

/** The whole ledger state; re-renders on every ledger change. */
export function useLedgerState(): LedgerState {
  const node = useLedgerNode()
  return useSyncExternalStore(node.subscribe, node.getState, node.getState)
}

/**
 * Select from the ledger: const bal = useLedger(s => s.balances.ana.confirmed).
 * The component re-renders on every ledger change and the selector runs during render,
 * so it may return fresh objects or arrays safely.
 */
export function useLedger<T>(selector: (s: LedgerState) => T): T {
  return selector(useLedgerState())
}

/** The virtual time to the minute (status bars, dates); re-renders once a minute while it runs. */
export function useClockMinute(): SimTime {
  const { clock } = useLedgerNode()
  return useSyncExternalStore(clock.subscribeMinute, clock.minute, clock.minute)
}

/** The virtual time to the second; only for a code countdown (re-renders every second). */
export function useClockSecond(): SimTime {
  const { clock } = useLedgerNode()
  return useSyncExternalStore(clock.subscribeSecond, clock.second, clock.second)
}

/** Generation counter: choreography timers capture it and exit when it changes. */
export function useGeneration(): number {
  const node = useLedgerNode()
  return useSyncExternalStore(node.subscribe, node.generation, node.generation)
}
