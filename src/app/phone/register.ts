import { logoutFlow } from '../flows/logout'
import { CodeScreen } from './auth/CodeScreen'
import { LoginScreen } from './auth/LoginScreen'
import { WelcomeScreen } from './auth/WelcomeScreen'
import { AboutView } from './AboutView'
import { registerAuthScreen, registerFlow, registerView } from './implemented'

// Everything that is built, registered once. This is where a milestone adds its screens:
//   registerAuthScreen('login', LoginScreen)         a screen of a logged-out phone
//   registerView('history', { consumer: …, pos: … }) a list, page or tool (one per shell, or one for all)
//   registerDetail('tx', TxDetail)                   one payment
//   registerFlow(sendFlow)                           a flow: steps and commit points, as in the registry
//   registerHubHeader('identity', IdentityCard)      a block above a hub's rows
// A tile or hub row shows only once its target is registered here, listed in the registry
// (registry.ts) and in content/homes.yaml.

registerAuthScreen('welcome', WelcomeScreen)
registerAuthScreen('login', LoginScreen)
registerAuthScreen('code', CodeScreen)
registerView('about', AboutView)
registerFlow(logoutFlow)
