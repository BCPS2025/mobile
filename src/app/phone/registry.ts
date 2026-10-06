import type { HomesContent, ROW_IDS, ShellHomeContent, TILE_IDS } from '@content/schema'
import type { Shell } from './types'

// The navigation graph of the phones, as pure data (no React): every tile, hub, view, detail and
// flow that is live, with its edges and the follow-ons a flow may hand off to. The unit test
// walks it (one hub level, at most five screens before a flow, every flow ends on a success that
// returns Home, the two-tap rule, every id registered). Components are registered separately
// (screens.tsx, flows/index.ts); a tile or row whose target has no component yet is hidden.
//
// What a milestone makes live is added here, in content/homes.yaml and in copy.en.yaml.

export type TileId = (typeof TILE_IDS)[number]
export type RowId = (typeof ROW_IDS)[number]

export type FlowId =
  | 'scan'
  | 'send'
  | 'charge'
  | 'paySupplier'
  | 'logout'
  | 'payItem'
  | 'request'
  | 'paymentLink'
  | 'split'
  | 'cancelRequest'
  | 'cancelSplit'
  | 'topUp'
  | 'cashOut'
  | 'autoConvert'
export type ViewId = 'history' | 'notifications' | 'about' | 'myCode'
export type DetailId = 'tx' | 'received' | 'request' | 'link' | 'split' | 'ramp' | 'payouts'
export type HubId = 'payRequest' | 'wallet' | 'sales' | 'pay' | 'cashOut' | 'profile' | 'settings'

export type Target =
  | { kind: 'flow'; id: FlowId }
  | { kind: 'view'; id: ViewId }
  | { kind: 'hub'; id: HubId }
  | { kind: 'detail'; id: DetailId }

export const targetKey = (t: Target): string => `${t.kind}:${t.id}`

const flow = (id: FlowId): Target => ({ kind: 'flow', id })
const view = (id: ViewId): Target => ({ kind: 'view', id })
const hub = (id: HubId): Target => ({ kind: 'hub', id })
const detail = (id: DetailId): Target => ({ kind: 'detail', id })

/** The shells whose screens exist. A shell's accounts appear in the menus once it is live. */
export const LIVE_SHELLS: readonly Shell[] = ['consumer', 'pos']

/** data-screen of each shell's Home. */
export const HOME_SCREENS: Record<Shell, string> = {
  consumer: 'c.home',
  pos: 'pos.home',
  studio: 'studio.home',
  trade: 'trade.home',
}

/** What each Home tile opens. */
export const TILES: Partial<Record<TileId, Target>> = {
  scan: flow('scan'),
  payRequest: hub('payRequest'),
  wallet: hub('wallet'),
  history: view('history'),
  charge: flow('charge'),
  sales: hub('sales'),
  pay: hub('pay'),
  cashOut: hub('cashOut'),
}

/** What each hub row opens. */
export const ROWS: Partial<Record<RowId, Target>> = {
  send: flow('send'),
  request: flow('request'),
  paymentLink: flow('paymentLink'),
  splitBill: flow('split'),
  myCode: view('myCode'),
  allPayments: view('history'),
  paySupplier: flow('paySupplier'),
  topup: flow('topUp'),
  cashOut: flow('cashOut'),
  autoConvert: flow('autoConvert'),
  payoutHistory: detail('payouts'),
  notifications: view('notifications'),
  about: view('about'),
  logout: flow('logout'),
}

/** The bell in every Home header. */
export const BELL: Target = view('notifications')

export interface HubSpec {
  /** data-screen of the hub. */
  screen: string
  shell: Shell
  /** A block above the rows (Profile's identity card, the balance of a money list); the component is registered by name. */
  header?: 'identity' | 'balance'
  /** The rows sit under a small-caps heading of this name (copy `hubs.sections`). */
  heading?: 'money'
}
export const HUBS: Record<HubId, HubSpec> = {
  payRequest: { screen: 'c.payRequest.hub', shell: 'consumer' },
  wallet: { screen: 'c.wallet.hub', shell: 'consumer', header: 'balance', heading: 'money' },
  profile: { screen: 'c.profile', shell: 'consumer', header: 'identity' },
  sales: { screen: 'pos.sales', shell: 'pos' },
  pay: { screen: 'pos.pay', shell: 'pos' },
  cashOut: { screen: 'pos.cashOut', shell: 'pos', header: 'balance', heading: 'money' },
  settings: { screen: 'biz.settings', shell: 'pos' },
}

export interface ViewSpec {
  /** data-screen, by shell (or one for all). */
  screen: string | Partial<Record<Shell, string>>
  shells: readonly Shell[]
  /** Details its rows open. */
  details: readonly DetailId[]
  /** Flows its buttons start (My code: Share payment link). */
  flows?: readonly FlowId[]
}
export const VIEWS: Record<ViewId, ViewSpec> = {
  history: {
    screen: { consumer: 'c.history', pos: 'biz.history' },
    shells: ['consumer', 'pos'],
    details: ['tx', 'request', 'link', 'split', 'ramp'],
  },
  notifications: {
    screen: 'shared.notifications',
    shells: ['consumer', 'pos'],
    details: ['tx', 'received', 'request', 'link', 'split', 'ramp', 'payouts'],
  },
  about: { screen: 'shared.about', shells: ['consumer', 'pos'], details: [] },
  myCode: { screen: 'c.mycode', shells: ['consumer'], details: [], flows: ['paymentLink'] },
}

export interface DetailSpec {
  screen: string
  /** One related detail a detail may link to (a second detail replaces the top one). */
  related: readonly DetailId[]
  /** Flows its buttons start. */
  flows: readonly FlowId[]
}
export const DETAILS: Record<DetailId, DetailSpec> = {
  tx: { screen: 'shared.tx', related: ['split'], flows: ['send', 'split'] },
  received: { screen: 'biz.received', related: ['tx'], flows: [] },
  request: { screen: 'c.request.detail', related: ['tx'], flows: ['cancelRequest'] },
  link: { screen: 'c.link.detail', related: ['tx'], flows: ['paymentLink'] },
  split: { screen: 'c.split.detail', related: ['tx'], flows: ['cancelSplit'] },
  // A bank-transfer top-up on its way (or arrived): its timeline. It shares the screen of the flow's ending.
  ramp: { screen: 'shared.topup.onItsWay', related: [], flows: [] },
  // What the business converted to euros, newest first (a detail of Cash out: a notification opens it too).
  payouts: { screen: 'biz.payouts', related: [], flows: [] },
}

export type StepKind = 'input' | 'review' | 'confirm' | 'waitFor' | 'committed'
export interface StepSpec {
  id: string
  /** data-screen of the step. */
  screen: string
  kind: StepKind
}

export type SuccessKind = 'money' | 'neutral' | 'welcome'

export interface FlowSpec {
  shells: readonly Shell[]
  /** The kinds of screen the flow may be started from. */
  startsFrom: readonly ('home' | 'hub' | 'view' | 'detail')[]
  steps: readonly StepSpec[]
  /** Steps whose primary action dispatches a ledger command. */
  commits: readonly string[]
  /**
   * How the flow ends: `money` and `neutral` are the two success screens ([Done] returns Home,
   * or a follow-on below); `welcome` ends on the Welcome screen (Log out).
   */
  success: SuccessKind
  /** data-screen of the success screen. */
  successScreen: string
  /** Whether the flow's commit moves money (its success is then a `money` one). */
  moves: boolean
  /** Other screens the flow may end on (declining a request ends on a neutral one, paying on the money one). */
  endsAlsoOn?: readonly { screen: string; kind: 'neutral' }[]
  /** Flows this one may start once it has ended (from its success screen: Home first). */
  followOns: readonly FlowId[]
  /** Flows this one may replace itself with, keeping the stack below it ("Pay by @username"). */
  handoffs: readonly FlowId[]
}

export const FLOWS: Record<FlowId, FlowSpec> = {
  scan: {
    shells: ['consumer'],
    startsFrom: ['home'],
    steps: [
      { id: 'scan', screen: 'c.scan', kind: 'input' },
      { id: 'nearby', screen: 'c.scan.nearby', kind: 'input' },
      { id: 'counter', screen: 'c.scan.counterAmount', kind: 'input' },
      { id: 'review', screen: 'c.payCode.review', kind: 'review' },
    ],
    commits: ['review'],
    success: 'money',
    successScreen: 'c.payCode.success',
    moves: true,
    followOns: [],
    // A personal code opens Send for that person, a payment link opens its check; an amount the
    // balance cannot cover offers Top up.
    handoffs: ['send', 'payItem', 'topUp'],
  },
  send: {
    shells: ['consumer'],
    startsFrom: ['hub', 'detail'],
    steps: [
      { id: 'to', screen: 'c.send.to', kind: 'input' },
      { id: 'amount', screen: 'c.send.amount', kind: 'input' },
      { id: 'note', screen: 'c.send.note', kind: 'input' },
      { id: 'review', screen: 'c.send.review', kind: 'review' },
    ],
    commits: ['review'],
    success: 'money',
    successScreen: 'c.send.success',
    moves: true,
    followOns: [],
    // Not enough balance: the error line offers Top up, which replaces this flow.
    handoffs: ['topUp'],
  },
  charge: {
    shells: ['pos'],
    startsFrom: ['home'],
    steps: [
      { id: 'items', screen: 'pos.charge', kind: 'input' },
      { id: 'code', screen: 'pos.code', kind: 'waitFor' },
      { id: 'cancel', screen: 'pos.code.cancel', kind: 'confirm' },
    ],
    // Charge (items), [New code] on a code that ran out (code) and Cancel charge (cancel).
    commits: ['items', 'code', 'cancel'],
    success: 'money',
    successScreen: 'pos.paid',
    moves: true,
    followOns: ['charge'],
    handoffs: [],
  },
  paySupplier: {
    shells: ['pos'],
    startsFrom: ['hub'],
    steps: [
      { id: 'to', screen: 'biz.send.to', kind: 'input' },
      { id: 'amount', screen: 'biz.send.amount', kind: 'input' },
      { id: 'note', screen: 'biz.send.note', kind: 'input' },
      { id: 'review', screen: 'biz.send.review', kind: 'review' },
    ],
    commits: ['review'],
    success: 'money',
    successScreen: 'biz.send.done',
    moves: true,
    followOns: [],
    handoffs: ['topUp'],
  },
  // Pay what someone asked: a request, a payment link sent to you, a share of a split. Declining
  // (requests and shares) ends on a neutral screen.
  payItem: {
    shells: ['consumer'],
    startsFrom: ['home', 'hub', 'view'],
    steps: [
      { id: 'review', screen: 'c.payItem.review', kind: 'review' },
      { id: 'decline', screen: 'c.payItem.decline', kind: 'confirm' },
    ],
    commits: ['review', 'decline'],
    success: 'money',
    successScreen: 'c.payItem.success',
    moves: true,
    endsAlsoOn: [{ screen: 'c.payItem.declined', kind: 'neutral' }],
    followOns: [],
    handoffs: ['topUp'],
  },
  request: {
    shells: ['consumer'],
    startsFrom: ['hub'],
    steps: [
      { id: 'from', screen: 'c.request.from', kind: 'input' },
      { id: 'amount', screen: 'c.request.amount', kind: 'input' },
      { id: 'note', screen: 'c.request.note', kind: 'input' },
      { id: 'review', screen: 'c.request.review', kind: 'review' },
      { id: 'again', screen: 'c.request.again', kind: 'confirm' },
    ],
    // Send request, and Send another when the same request is already open.
    commits: ['review', 'again'],
    success: 'neutral',
    successScreen: 'c.request.sent',
    moves: false,
    followOns: [],
    handoffs: [],
  },
  paymentLink: {
    shells: ['consumer'],
    startsFrom: ['hub', 'view', 'detail'],
    steps: [
      { id: 'amount', screen: 'c.link.amount', kind: 'input' },
      { id: 'note', screen: 'c.link.note', kind: 'input' },
      { id: 'review', screen: 'c.link.review', kind: 'review' },
      { id: 'ready', screen: 'c.link.ready', kind: 'committed' },
      { id: 'qr', screen: 'c.link.qr', kind: 'committed' },
      { id: 'to', screen: 'c.link.to', kind: 'input' },
    ],
    // Create link, and the send to one person from Link ready or from a link that waits.
    commits: ['review', 'to'],
    success: 'neutral',
    successScreen: 'c.link.shared',
    moves: false,
    followOns: [],
    handoffs: [],
  },
  split: {
    shells: ['consumer'],
    startsFrom: ['hub', 'detail'],
    steps: [
      { id: 'pick', screen: 'c.split.pick', kind: 'input' },
      { id: 'amount', screen: 'c.split.amount', kind: 'input' },
      { id: 'note', screen: 'c.split.note', kind: 'input' },
      { id: 'people', screen: 'c.split.people', kind: 'input' },
      { id: 'shares', screen: 'c.split.shares', kind: 'input' },
      { id: 'review', screen: 'c.split.review', kind: 'review' },
    ],
    commits: ['review'],
    success: 'neutral',
    successScreen: 'c.split.sent',
    moves: false,
    followOns: [],
    handoffs: [],
  },
  cancelRequest: {
    shells: ['consumer'],
    startsFrom: ['detail'],
    steps: [{ id: 'confirm', screen: 'c.request.cancel', kind: 'confirm' }],
    commits: ['confirm'],
    success: 'neutral',
    successScreen: 'c.request.cancelled',
    moves: false,
    followOns: [],
    handoffs: [],
  },
  cancelSplit: {
    shells: ['consumer'],
    startsFrom: ['detail'],
    steps: [{ id: 'confirm', screen: 'c.split.cancel', kind: 'confirm' }],
    commits: ['confirm'],
    success: 'neutral',
    successScreen: 'c.split.cancelled',
    moves: false,
    followOns: [],
    handoffs: [],
  },
  // Top up (shared.topup.*): whole euros, a method on file, Check and top up. A card or a local
  // method settles like a payment; a bank transfer ends on its timeline (shared.topup.onItsWay).
  topUp: {
    shells: ['consumer', 'pos'],
    startsFrom: ['hub'],
    steps: [
      { id: 'amount', screen: 'shared.topup.amount', kind: 'input' },
      { id: 'method', screen: 'shared.topup.method', kind: 'input' },
      { id: 'review', screen: 'shared.topup.review', kind: 'review' },
    ],
    commits: ['review'],
    success: 'money',
    successScreen: 'shared.topup.done',
    moves: true,
    followOns: [],
    handoffs: [],
  },
  // Cash out (shared.cashout.*): an amount, Check and cash out. An account with no bank on file
  // sees why instead (shared.cashout.noBank) and can top up.
  cashOut: {
    shells: ['consumer', 'pos'],
    startsFrom: ['hub'],
    steps: [
      { id: 'noBank', screen: 'shared.cashout.noBank', kind: 'input' },
      { id: 'amount', screen: 'shared.cashout.amount', kind: 'input' },
      { id: 'review', screen: 'shared.cashout.review', kind: 'review' },
    ],
    commits: ['review'],
    success: 'money',
    successScreen: 'shared.cashout.done',
    moves: true,
    followOns: [],
    handoffs: ['topUp'],
  },
  // Auto-convert (biz.autoconvert.*): on or off, when, how much, Check and save. It saves the
  // schedule and shows it; nothing converts by itself.
  autoConvert: {
    shells: ['pos'],
    startsFrom: ['hub'],
    steps: [
      { id: 'onoff', screen: 'biz.autoconvert.onoff', kind: 'input' },
      { id: 'schedule', screen: 'biz.autoconvert.schedule', kind: 'input' },
      { id: 'share', screen: 'biz.autoconvert.share', kind: 'input' },
      { id: 'review', screen: 'biz.autoconvert.review', kind: 'review' },
    ],
    commits: ['review'],
    success: 'neutral',
    successScreen: 'biz.autoconvert.saved',
    moves: false,
    followOns: [],
    handoffs: [],
  },
  logout: {
    shells: ['consumer', 'pos'],
    startsFrom: ['hub'],
    steps: [{ id: 'confirm', screen: 'auth.logout', kind: 'confirm' }],
    commits: [],
    success: 'welcome',
    successScreen: 'auth.welcome',
    moves: false,
    followOns: [],
    handoffs: [],
  },
}

/** A feature the two-tap rule covers: the screen that offers its entry action, from Home. */
export interface Feature {
  id: string
  shell: Shell
  target: Target
  /** Most taps from Home to reach the target (header controls and hub rows count). */
  maxTaps: number
}
export const FEATURES: readonly Feature[] = [
  { id: 'scan', shell: 'consumer', target: flow('scan'), maxTaps: 1 },
  { id: 'send', shell: 'consumer', target: flow('send'), maxTaps: 2 },
  { id: 'request', shell: 'consumer', target: flow('request'), maxTaps: 2 },
  { id: 'paymentLink', shell: 'consumer', target: flow('paymentLink'), maxTaps: 2 },
  { id: 'split', shell: 'consumer', target: flow('split'), maxTaps: 2 },
  { id: 'myCode', shell: 'consumer', target: view('myCode'), maxTaps: 2 },
  { id: 'history', shell: 'consumer', target: view('history'), maxTaps: 1 },
  { id: 'notifications', shell: 'consumer', target: view('notifications'), maxTaps: 1 },
  { id: 'about', shell: 'consumer', target: view('about'), maxTaps: 2 },
  { id: 'logout', shell: 'consumer', target: flow('logout'), maxTaps: 2 },
  { id: 'charge', shell: 'pos', target: flow('charge'), maxTaps: 1 },
  { id: 'salesHistory', shell: 'pos', target: view('history'), maxTaps: 2 },
  { id: 'paySupplier', shell: 'pos', target: flow('paySupplier'), maxTaps: 2 },
  { id: 'topUp', shell: 'consumer', target: flow('topUp'), maxTaps: 2 },
  { id: 'cashOut', shell: 'consumer', target: flow('cashOut'), maxTaps: 2 },
  { id: 'topUp', shell: 'pos', target: flow('topUp'), maxTaps: 2 },
  { id: 'cashOut', shell: 'pos', target: flow('cashOut'), maxTaps: 2 },
  { id: 'autoConvert', shell: 'pos', target: flow('autoConvert'), maxTaps: 2 },
  { id: 'payouts', shell: 'pos', target: detail('payouts'), maxTaps: 2 },
  { id: 'notifications', shell: 'pos', target: view('notifications'), maxTaps: 1 },
  { id: 'about', shell: 'pos', target: view('about'), maxTaps: 2 },
  { id: 'logout', shell: 'pos', target: flow('logout'), maxTaps: 2 },
]

// ---- reading the registry against content/homes.yaml

export type HomeContent = ShellHomeContent
export type HubEntry = NonNullable<HomeContent['hubs'][keyof HomeContent['hubs']]>[number]
export type HubRow = Extract<HubEntry, { row: RowId }>

/** The home of an account (its shell's tiles and hubs), when that shell has one. */
export function homeOf(homes: HomesContent, shell: Shell, personaId: string): HomeContent | undefined {
  switch (shell) {
    case 'consumer':
      return homes.consumer
    case 'pos':
      return homes.pos
    case 'studio':
      return homes.studio
    case 'trade':
      return personaId === 'firm' ? homes.trade?.firm : homes.trade?.supplier
  }
}

/** The tiles of a Home whose target is registered, in order. */
export function registeredTiles(
  home: HomeContent,
): { tile: TileId; target: Target; entry: HomeContent['tiles'][number] }[] {
  const out: { tile: TileId; target: Target; entry: HomeContent['tiles'][number] }[] = []
  for (const entry of home.tiles) {
    const target = TILES[entry.tile]
    if (target) out.push({ tile: entry.tile, target, entry })
  }
  return out
}

/** The rows of a hub whose target is registered, in order (sections are not built yet). */
export function registeredRows(home: HomeContent, hubId: string): { row: RowId; target: Target; entry: HubRow }[] {
  const out: { row: RowId; target: Target; entry: HubRow }[] = []
  const entries = (home.hubs as Record<string, HomeContent['hubs'][keyof HomeContent['hubs']]>)[hubId] ?? []
  for (const entry of entries) {
    if (!('row' in entry)) continue
    const target = ROWS[entry.row]
    if (target) out.push({ row: entry.row, target, entry })
  }
  return out
}

/** Screen ids a persisted stack may hold (`home`, `hub:<id>`); anything else is dropped on restore. */
export function isPersistedScreenId(id: string): boolean {
  if (id === 'home') return true
  return id.startsWith('hub:') && Object.hasOwn(HUBS, id.slice(4))
}

/**
 * Taps from Home to every registered target of a shell: header controls (avatar, bell), tiles,
 * hub rows, a view's rows and a detail's buttons each count one tap. A target that offers a flow
 * is the flow itself.
 */
export function tapsFromHome(homes: HomesContent, shell: Shell, personaId: string): Map<string, number> {
  const taps = new Map<string, number>()
  const home = homeOf(homes, shell, personaId)
  if (!home) return taps
  const queue: { target: Target; taps: number }[] = []
  const see = (target: Target, n: number) => {
    const key = targetKey(target)
    if (taps.has(key)) return
    taps.set(key, n)
    queue.push({ target, taps: n })
  }
  see(BELL, 1)
  see(hub(home.avatar as HubId), 1)
  for (const t of registeredTiles(home)) see(t.target, 1)
  while (queue.length > 0) {
    const { target, taps: n } = queue.shift() as { target: Target; taps: number }
    if (target.kind === 'hub') for (const r of registeredRows(home, target.id)) see(r.target, n + 1)
    if (target.kind === 'view') {
      for (const d of VIEWS[target.id].details) see({ kind: 'detail', id: d }, n + 1)
      for (const f of VIEWS[target.id].flows ?? []) see(flow(f), n + 1)
    }
    if (target.kind === 'detail') {
      for (const f of DETAILS[target.id].flows) see(flow(f), n + 1)
      for (const d of DETAILS[target.id].related) see({ kind: 'detail', id: d }, n + 1)
    }
  }
  return taps
}
