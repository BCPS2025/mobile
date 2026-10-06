import { cancelRequestFlow, cancelSplitFlow } from '../flows/cancel'
import { chargeFlow } from '../flows/charge'
import { invoiceFlow } from '../flows/invoice'
import { logoutFlow } from '../flows/logout'
import { payItemFlow } from '../flows/payItem'
import { paymentLinkFlow } from '../flows/paymentLink'
import { requestFlow } from '../flows/request'
import { splitFlow } from '../flows/split'
import { autoConvertFlow } from '../flows/autoConvert'
import { cashOutFlow } from '../flows/cashOut'
import { topUpFlow } from '../flows/topUp'
import { paySupplierFlow } from '../flows/paySupplier'
import { refundFlow } from '../flows/refund'
import { scanFlow } from '../flows/scan'
import { sendFlow } from '../flows/send'
import { CodeScreen } from './auth/CodeScreen'
import { LoginScreen } from './auth/LoginScreen'
import { WelcomeScreen } from './auth/WelcomeScreen'
import { AboutView } from './AboutView'
import { HistoryView } from './views/HistoryView'
import { InvoicesView } from './views/Invoices'
import { IdentityCard } from './views/IdentityCard'
import { NotificationsView } from './views/NotificationsView'
import { BalanceHeader } from './views/BalanceHeader'
import { PayoutsView } from './views/Payouts'
import { RampDetailView } from './views/RampDetail'
import { LinkDetail } from './views/LinkDetail'
import { MyCodeView } from './views/MyCode'
import { ReceivedDetail } from './views/ReceivedDetail'
import { RequestDetail } from './views/RequestDetail'
import { SplitDetail } from './views/SplitDetail'
import { TxDetailView } from './views/TxDetail'
import { registerAuthScreen, registerDetail, registerFlow, registerHubHeader, registerView } from './implemented'

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
registerView('history', HistoryView)
registerView('notifications', NotificationsView)
registerView('myCode', { consumer: MyCodeView })
registerView('invoices', { pos: InvoicesView })
registerHubHeader('identity', IdentityCard)
registerHubHeader('balance', BalanceHeader)
registerDetail('tx', TxDetailView)
registerDetail('received', ReceivedDetail)
registerDetail('request', RequestDetail)
registerDetail('link', LinkDetail)
registerDetail('split', SplitDetail)
registerDetail('ramp', RampDetailView)
registerDetail('payouts', PayoutsView)
registerFlow(logoutFlow)
registerFlow(scanFlow)
registerFlow(sendFlow)
registerFlow(chargeFlow)
registerFlow(paySupplierFlow)
registerFlow(payItemFlow)
registerFlow(requestFlow)
registerFlow(paymentLinkFlow)
registerFlow(cancelRequestFlow)
registerFlow(splitFlow)
registerFlow(cancelSplitFlow)
registerFlow(topUpFlow)
registerFlow(cashOutFlow)
registerFlow(autoConvertFlow)
registerFlow(refundFlow)
registerFlow(invoiceFlow)
