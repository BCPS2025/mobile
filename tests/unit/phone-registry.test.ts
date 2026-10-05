import { describe, expect, it } from 'vitest'
import {
  BELL,
  DETAILS,
  FEATURES,
  FLOWS,
  HOME_SCREENS,
  HUBS,
  LIVE_SHELLS,
  ROWS,
  TILES,
  VIEWS,
  homeOf,
  isPersistedScreenId,
  registeredRows,
  registeredTiles,
  tapsFromHome,
  targetKey,
} from '@app/phone/registry'
import type { Target } from '@app/phone/registry'
import { MAX_BEFORE_FLOW } from '@app/phone/stack'
import type { Shell } from '@app/phone/types'
import { content } from './helpers'

// The navigation graph as data: one hub level, at most five screens before a flow, every flow
// ends on a success screen (Home follows [Done]), the two-tap rule for the live features, and
// every id registered. No React is involved.

const PERSONA_OF: Partial<Record<Shell, string>> = { consumer: 'ana', pos: 'cafe' }
const homes = content.homes

describe('the registry against content/homes.yaml', () => {
  it('every live shell has a home, and only live shells are listed', () => {
    for (const shell of LIVE_SHELLS) expect(homeOf(homes, shell, PERSONA_OF[shell] ?? '')).toBeDefined()
    expect(homes.studio).toBeUndefined()
    expect(homes.trade).toBeUndefined()
  })

  it('every tile and every hub row of a home is registered, and every hub named exists', () => {
    for (const shell of LIVE_SHELLS) {
      const home = homeOf(homes, shell, PERSONA_OF[shell] ?? '')
      if (!home) throw new Error(`no home for ${shell}`)
      expect(registeredTiles(home).map((t) => t.tile)).toEqual(home.tiles.map((t) => t.tile))
      for (const t of home.tiles) expect(TILES[t.tile], `${shell} tile ${t.tile}`).toBeDefined()
      for (const [hubId, entries] of Object.entries(home.hubs)) {
        const spec = HUBS[hubId as keyof typeof HUBS]
        expect(spec, `hub ${hubId}`).toBeDefined()
        expect(spec?.shell).toBe(shell)
        for (const e of entries ?? []) {
          if ('row' in e) expect(ROWS[e.row], `${shell} ${hubId} row ${e.row}`).toBeDefined()
        }
      }
      expect(HUBS[home.avatar as keyof typeof HUBS]).toBeDefined()
      expect(home.tiles.length).toBeLessThanOrEqual(4)
    }
  })

  it('makes live the four tiles of a person and Charge, Sales, Pay for the café', () => {
    expect(homes.consumer.tiles.map((t) => t.tile)).toEqual(['scan', 'payRequest', 'wallet', 'history'])
    expect(homes.pos.tiles.map((t) => t.tile)).toEqual(['charge', 'sales', 'pay'])
    expect(registeredRows(homes.consumer, 'payRequest').map((r) => r.row)).toEqual([
      'send',
      'request',
      'paymentLink',
      'splitBill',
    ])
    expect(registeredRows(homes.consumer, 'wallet').map((r) => r.row)).toEqual(['myCode'])
    expect(registeredRows(homes.pos, 'sales').map((r) => r.row)).toEqual(['allPayments'])
    expect(registeredRows(homes.pos, 'pay').map((r) => r.row)).toEqual(['paySupplier'])
  })
})

describe('screens and flows', () => {
  const targets = (): Target[] => [
    ...Object.values(TILES),
    ...Object.values(ROWS),
    BELL,
    ...Object.keys(HUBS).map((id) => ({ kind: 'hub', id }) as Target),
  ]

  it('every target names a registered flow, view, hub or detail', () => {
    for (const t of targets()) {
      const known =
        t.kind === 'flow'
          ? FLOWS[t.id]
          : t.kind === 'view'
            ? VIEWS[t.id]
            : t.kind === 'hub'
              ? HUBS[t.id]
              : DETAILS[t.id]
      expect(known, targetKey(t)).toBeDefined()
    }
  })

  it('screen ids (data-screen) are unique across hubs, views, details, steps and successes', () => {
    const ids: string[] = []
    for (const shell of LIVE_SHELLS) ids.push(HOME_SCREENS[shell])
    for (const h of Object.values(HUBS)) ids.push(h.screen)
    for (const v of Object.values(VIEWS)) {
      ids.push(...new Set(typeof v.screen === 'string' ? [v.screen] : Object.values(v.screen)))
    }
    for (const d of Object.values(DETAILS)) ids.push(d.screen)
    for (const f of Object.values(FLOWS)) {
      ids.push(...f.steps.map((s) => s.screen))
      if (f.success !== 'welcome') ids.push(f.successScreen)
      ids.push(...(f.endsAlsoOn ?? []).map((e) => e.screen))
    }
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('a flow has steps, commit points on its own steps and success', () => {
    for (const [id, f] of Object.entries(FLOWS)) {
      expect(f.steps.length, id).toBeGreaterThan(0)
      const stepIds = f.steps.map((s) => s.id)
      expect(new Set(stepIds).size, `${id} step ids`).toBe(stepIds.length)
      for (const c of f.commits) expect(stepIds, `${id} commit ${c}`).toContain(c)
      expect(['money', 'neutral', 'welcome']).toContain(f.success)
      expect(f.successScreen).toBeTruthy()
      for (const other of [...f.followOns, ...f.handoffs]) expect(FLOWS[other], `${id} → ${other}`).toBeDefined()
      // A flow that moves money ends on a money success screen; one that does not, on a neutral one
      // (or Welcome).
      expect(f.success === 'money', `${id} success`).toBe(f.moves)
      for (const extra of f.endsAlsoOn ?? []) expect(extra.kind).toBe('neutral')
    }
  })

  it('a flow starts from Home, a hub, a view or a detail and never opens a hub, a view or another flow', () => {
    for (const [id, f] of Object.entries(FLOWS)) {
      expect(f.startsFrom.length, id).toBeGreaterThan(0)
      // The deepest stack a flow can sit on: home › hub › view › detail › detail is five, then the flow.
      const depth = { home: 1, hub: 2, view: 3, detail: MAX_BEFORE_FLOW } as const
      for (const from of f.startsFrom) expect(depth[from], `${id} from ${from}`).toBeLessThanOrEqual(MAX_BEFORE_FLOW)
    }
    // A hand-off replaces the flow (never stacks one on another), and a follow-on starts from Home.
    expect(FLOWS.scan.handoffs).toEqual(['send'])
    expect(FLOWS.charge.followOns).toEqual(['charge'])
  })

  it('a hub row opens a flow, a view or a detail, never a hub (one list level)', () => {
    for (const [row, target] of Object.entries(ROWS)) expect(target?.kind, row).not.toBe('hub')
    for (const v of Object.values(VIEWS)) for (const d of v.details) expect(DETAILS[d]).toBeDefined()
    for (const d of Object.values(DETAILS)) {
      for (const f of d.flows) expect(FLOWS[f]).toBeDefined()
      for (const r of d.related) expect(DETAILS[r]).toBeDefined()
    }
  })

  it('persisted screens are Home and the hubs, nothing else', () => {
    expect(isPersistedScreenId('home')).toBe(true)
    expect(isPersistedScreenId('hub:payRequest')).toBe(true)
    expect(isPersistedScreenId('hub:cashOut')).toBe(false)
    expect(isPersistedScreenId('view:history')).toBe(false)
    expect(isPersistedScreenId('hub:constructor')).toBe(false)
  })
})

describe('the two-tap rule', () => {
  it('every live feature is within its taps of Home, counting header controls, hub rows and buttons', () => {
    for (const f of FEATURES) {
      const taps = tapsFromHome(homes, f.shell, PERSONA_OF[f.shell] ?? '')
      const n = taps.get(targetKey(f.target))
      expect(n, `${f.shell} ${f.id}`).toBeDefined()
      expect(n as number, `${f.shell} ${f.id}`).toBeLessThanOrEqual(f.maxTaps)
      expect(f.maxTaps).toBeLessThanOrEqual(2)
    }
  })

  it('every registered target of a shell is reachable from its Home within two taps', () => {
    for (const shell of LIVE_SHELLS) {
      const taps = tapsFromHome(homes, shell, PERSONA_OF[shell] ?? '')
      for (const [key, n] of taps) expect(n, `${shell} ${key}`).toBeLessThanOrEqual(3)
      for (const f of FEATURES.filter((x) => x.shell === shell)) expect(taps.has(targetKey(f.target))).toBe(true)
    }
  })
})
