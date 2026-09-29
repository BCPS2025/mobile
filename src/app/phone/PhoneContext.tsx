import { createContext, useContext } from 'react'
import type { PersonaId } from '@domain/types'
import type { Shell, SlotKey } from './types'

// Who a phone shows and how it is hosted. Everything inside a phone reads it.

export interface PhoneContextValue {
  slot: SlotKey
  /** The logged-in account, or null on Welcome and the login screens. */
  persona: PersonaId | null
  shell: Shell | null
  mode: 'stage' | 'phone'
  /** The in-app status bar (hidden on a touch device in phone mode: the device has its own). */
  statusBar: boolean
  /** IANA zone of the account (the status bar's clock). */
  tz: string
}

export const PhoneContext = createContext<PhoneContextValue | null>(null)

export function usePhone(): PhoneContextValue {
  const v = useContext(PhoneContext)
  if (!v) throw new Error('usePhone: missing <PhoneContext.Provider>')
  return v
}

/** The phone of a logged-in account (its screens); throws on the login screens. */
export function usePersonaPhone(): PhoneContextValue & { persona: PersonaId; shell: Shell } {
  const v = usePhone()
  if (v.persona === null || v.shell === null) throw new Error('usePersonaPhone: no account on this phone')
  return v as PhoneContextValue & { persona: PersonaId; shell: Shell }
}
