import { useTransient } from '../state/AppContext'
import { authScreen } from './implemented'
import { usePhone } from './PhoneContext'

// What a phone with no account shows: Welcome, or the login screen its state names (`login`,
// `code`), each registered in register.ts. An unbuilt screen falls back to Welcome.

export function AuthRoot() {
  const { slot } = usePhone()
  const state = useTransient((t) => t.auth[slot])
  const Screen = authScreen(state.screen) ?? authScreen('welcome')
  return Screen ? <Screen /> : null
}
