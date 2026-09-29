import { describe, expect, it } from 'vitest'
import { formatHundredths } from '@domain/money'
import type { SimTime, PayCommand } from '@domain/types'
import { instantOfAt } from '@sim/tz'
import { CLOCK_KEY, QUARANTINE_KEY, openStorage, readClockStamp, stateKey } from '@store/persistence'
import { LIMITS, parseRecord } from '@store/record'
import { personaIdsOf } from '@store/restore'
import { type PageLike, type RuntimeDeps, createRuntime } from '@store/runtime'
import { cafeQrBakery } from '../golden/journeys/cafe-qr-bakery'
import { fakeLocks, settle } from '../support/fake-locks'
import { type FakeTime, fakeTime } from '../support/fake-time'
import { STATE_VERSION, memoryStorage } from '../support/records'
import { content, m } from './helpers'

// Persistence, the writer lock and the runtime together: debounced writes and the
// synchronous pagehide flush, restore with fingerprint and quarantine, the version-mismatch path,
// one writer across tabs with queued takeover and writer epochs, Reset/Undo and state files.

const KEY = stateKey(STATE_VERSION)
const journey = cafeQrBakery(content)
const [saleCmd, bakeryCmd] = [journey[0]?.cmd as PayCommand, journey[1]?.cmd as PayCommand]
const bal = (
  rt: { node: { getState(): { balances: Record<string, { confirmed: number } | undefined> } } },
  a: string,
) => formatHundredths(rt.node.getState().balances[a]?.confirmed ?? Number.NaN)

interface Shared {
  storage: ReturnType<typeof memoryStorage> | null
  locks: ReturnType<typeof fakeLocks> | null
}

function tab(shared: Shared, over: Partial<RuntimeDeps> & { time?: FakeTime } = {}) {
  const time = over.time ?? fakeTime()
  const rt = createRuntime({
    content,
    build: 'dev',
    storage: shared.storage,
    locks: shared.locks,
    timers: time.timers,
    clock: { mode: 'manual' },
    epochDate: '2026-09-25',
    ...over,
  })
  return { rt, time }
}

const shared = (initial: Record<string, string> = {}, locks = true): Shared => ({
  storage: memoryStorage(initial),
  locks: locks ? fakeLocks() : null,
})

function page() {
  const handlers = new Map<string, Set<() => void>>()
  const target: PageLike & { visibilityState: string; fire(type: string): void } = {
    visibilityState: 'visible',
    addEventListener(type, fn) {
      let set = handlers.get(type)
      if (!set) {
        set = new Set()
        handlers.set(type, set)
      }
      set.add(fn)
    },
    removeEventListener(type, fn) {
      handlers.get(type)?.delete(fn)
    },
    fire(type) {
      for (const fn of [...(handlers.get(type) ?? [])]) fn()
    },
  }
  return target
}

const storedRecord = (s: Shared) => {
  const text = s.storage?.getItem(KEY)
  if (!text) return null
  const p = parseRecord(text, { stateVersion: STATE_VERSION, t0Weekday: 5, personaIds: personaIdsOf(content) })
  if (!p.ok) throw new Error(p.problem.code)
  return p.record
}

/** Dispatches at a calendar time of the runtime's T0. */
function at(rt: ReturnType<typeof tab>['rt'], time: string) {
  rt.node.clock.jumpTo(instantOfAt(rt.meta().t0Date, { day: 0, time }))
}

describe('boot and writing', () => {
  it('a fresh tab starts from the seed, takes the lock and claims writer epoch 1', async () => {
    const s = shared()
    const { rt } = tab(s)
    expect(rt.meta()).toMatchObject({ t0Date: '2026-09-25', startingState: 'fresh' })
    expect(rt.lock?.status()).toBe('pending')
    await settle()
    expect(rt.lock?.status()).toBe('writer')
    expect(rt.lock?.epoch()).toBe(1)
    expect(storedRecord(s)?.log).toEqual([])
    expect(s.storage && readClockStamp(s.storage)?.writerEpoch).toBe(1)
    expect(rt.notices()).toEqual([])
  })

  it('writes 250 ms after a command, and at once on pagehide or when the page is hidden', async () => {
    const s = shared()
    const { rt, time } = tab(s)
    await settle()
    const win = page()
    const doc = page()
    rt.attach(win, doc)
    at(rt, '12:16:00.000')
    expect(rt.dispatch(saleCmd).ok).toBe(true)
    expect(storedRecord(s)?.log).toHaveLength(0)
    time.advance(250)
    expect(storedRecord(s)?.log).toHaveLength(1)
    at(rt, '12:16:36.000')
    rt.dispatch(bakeryCmd)
    win.fire('pagehide') // synchronous: closing the tab never loses the last command
    expect(storedRecord(s)?.log).toHaveLength(2)
    rt.node.clock.advance(5000)
    doc.visibilityState = 'hidden'
    doc.fire('visibilitychange')
    const rec = storedRecord(s)
    expect(rec?.clock).toEqual({ day: 0, time: '12:16:41.000' })
  })

  it('a reload restores the byte-identical ledger, the clock and the UI', async () => {
    const s = shared()
    const a = tab(s)
    await settle()
    at(a.rt, '12:16:00.000')
    a.rt.dispatch(saleCmd)
    at(a.rt, '12:16:36.000')
    a.rt.dispatch(bakeryCmd)
    a.rt.node.settleDue()
    const ui = a.rt.ui.get()
    a.rt.ui.set({ ...ui, sessions: new Map([['ana', true]]), nav: new Map([['cafe', ['home', 'hub:cashOut']]]) })
    a.rt.flush()
    const before = JSON.stringify(a.rt.node.getState())
    a.rt.dispose()
    await settle()
    const b = tab(s)
    expect(JSON.stringify(b.rt.node.getState())).toBe(before)
    expect(b.rt.node.now()).toBe(a.rt.node.now())
    expect(b.rt.ui.get().sessions.get('ana')).toBe(true)
    expect(b.rt.ui.get().nav.get('cafe')).toEqual(['home', 'hub:cashOut'])
    expect(b.rt.notices()).toEqual([])
    expect(bal(b.rt, 'cafe')).toBe('288.00')
    // The next write keeps the stored bytes of the old entries.
    await settle()
    expect(storedRecord(s)?.log).toHaveLength(2)
  })

  it('without storage the app runs in memory and says so', () => {
    const { rt } = tab({ storage: null, locks: null })
    expect(rt.notices()).toEqual(['storage-unavailable'])
    expect(rt.lock).toBeNull()
    at(rt, '12:16:00.000')
    expect(rt.dispatch(saleCmd).ok).toBe(true)
    expect(rt.flush()).toBe('memory')
  })

  it('openStorage returns null when writing throws (private windows, blocked storage)', () => {
    const blocked = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(openStorage(() => blocked)).toBeNull()
    expect(openStorage(() => undefined)).toBeNull()
    expect(
      openStorage(() => {
        throw new Error('SecurityError')
      }),
    ).toBeNull()
  })
})

/** A stored record of the café loop (from a tab that ran it). */
async function storedLoop(): Promise<string> {
  const s = shared()
  const { rt } = tab(s)
  await settle()
  at(rt, '12:16:00.000')
  rt.dispatch(saleCmd)
  at(rt, '12:16:36.000')
  rt.dispatch(bakeryCmd)
  rt.node.settleDue()
  rt.flush()
  rt.dispose()
  return s.storage?.getItem(KEY) ?? ''
}

describe('restore failures and versions', () => {
  it('a corrupt record is quarantined, the session starts fresh with a one-time notice', async () => {
    const s = shared({ [KEY]: '{"format":"bcps-state", "log": [' })
    const { rt } = tab(s)
    expect(rt.notices()).toEqual(['restore-failed'])
    expect(rt.quarantined()).toBe('{"format":"bcps-state", "log": [')
    expect(rt.node.log()).toHaveLength(0)
    await settle() // storage changes wait for the writer lock
    expect(s.storage?.getItem(QUARANTINE_KEY)).toBe('{"format":"bcps-state", "log": [')
    expect(storedRecord(s)?.log).toEqual([]) // the fresh session is written; the quarantine stays
    expect(s.storage?.getItem(QUARANTINE_KEY)).not.toBeNull()
  })

  it('a record whose commands no longer replay is quarantined the same way', async () => {
    const j = JSON.parse(await storedLoop())
    j.log[1].cmd.expect.senderDebit = '8.80'
    const s = shared({ [KEY]: JSON.stringify(j) })
    const { rt } = tab(s)
    expect(rt.notices()).toEqual(['restore-failed'])
    expect(bal(rt, 'cafe')).toBe('286.00')
  })

  it('a record with an actor named after a prototype member is quarantined at boot, not thrown', async () => {
    const j = JSON.parse(await storedLoop())
    j.log[0].actor = 'constructor'
    const s = shared({ [KEY]: JSON.stringify(j) })
    const { rt } = tab(s)
    expect(rt.notices()).toEqual(['restore-failed'])
    expect(bal(rt, 'cafe')).toBe('286.00')
    await settle()
    expect(s.storage?.getItem(QUARANTINE_KEY)).toBe(JSON.stringify(j))
    // The same content as a state file is a bad file, not an exception.
    expect(rt.readStateFile(JSON.stringify(j))).toEqual({ ok: false, error: 'bad-file' })
  })

  it('a fingerprint mismatch still loads, with the recalculation notice', async () => {
    const j = JSON.parse(await storedLoop())
    j.fingerprint.balancesHash = '0000000000000000'
    const { rt } = tab(shared({ [KEY]: JSON.stringify(j) }))
    expect(rt.notices()).toEqual(['recalculated'])
    expect(bal(rt, 'cafe')).toBe('288.00')
  })

  it('an older version whose log still replays loads on the new seed; the old key goes', async () => {
    const j = JSON.parse(await storedLoop())
    j.stateVersion = STATE_VERSION - 1
    const oldKey = stateKey(STATE_VERSION - 1)
    const s = shared({ [oldKey]: JSON.stringify(j) })
    const { rt } = tab(s)
    expect(rt.notices()).toEqual(['recalculated'])
    expect(bal(rt, 'cafe')).toBe('288.00')
    await settle()
    expect(s.storage?.getItem(oldKey)).toBeNull()
    expect(storedRecord(s)?.log).toHaveLength(2)
  })

  it('an older version that does not replay is quarantined; the old key goes', async () => {
    const j = JSON.parse(await storedLoop())
    j.stateVersion = STATE_VERSION - 1
    j.log[0].actor = 'director'
    const oldKey = stateKey(STATE_VERSION - 1)
    const s = shared({ [oldKey]: JSON.stringify(j) })
    const { rt } = tab(s)
    expect(rt.notices()).toEqual(['restore-failed'])
    expect(rt.quarantined()).toBe(JSON.stringify(j))
    await settle()
    expect(s.storage?.getItem(oldKey)).toBeNull()
  })

  it('a tab that is not the writer changes nothing it finds in storage', async () => {
    const s = shared()
    const writer = tab(s)
    await settle()
    s.storage?.setItem(KEY, '{"broken":')
    const reader = tab(s)
    await settle()
    expect(reader.rt.lock?.status()).toBe('waiting')
    expect(reader.rt.notices()).toEqual(['restore-failed'])
    expect(s.storage?.getItem(KEY)).toBe('{"broken":')
    expect(s.storage?.getItem(QUARANTINE_KEY)).toBeNull()
    // The writer saves its session; when it closes, the reader takes over and loads that session.
    at(writer.rt, '12:16:00.000')
    writer.rt.dispatch(saleCmd)
    writer.rt.flush()
    writer.rt.dispose()
    await settle()
    expect(reader.rt.lock?.status()).toBe('writer')
    expect(reader.rt.node.log()).toHaveLength(1)
    expect(s.storage?.getItem(QUARANTINE_KEY)).toBeNull()
    expect(storedRecord(s)?.log).toHaveLength(1)
  })

  it('never touches keys of other apps on the shared origin', async () => {
    const s = shared({ 'other-app:state': 'x', theme: 'dark' })
    const { rt } = tab(s)
    await settle()
    at(rt, '12:16:00.000')
    rt.dispatch(saleCmd)
    rt.flush()
    expect(s.storage?.getItem('other-app:state')).toBe('x')
    expect(s.storage?.getItem('theme')).toBe('dark')
    expect(
      [...(s.storage?.data.keys() ?? [])]
        .filter((k) => !['other-app:state', 'theme'].includes(k))
        .every((k) => k.startsWith('bcps:')),
    ).toBe(true)
  })
})

describe('one writer across tabs', () => {
  it('a second tab waits, writes nothing, takes over with [Use here] and reloads', async () => {
    const s = shared()
    const a = tab(s)
    await settle()
    const b = tab(s)
    await settle()
    expect(a.rt.lock?.status()).toBe('writer')
    expect(b.rt.lock?.status()).toBe('waiting')
    // A writes the café sale.
    at(a.rt, '12:16:00.000')
    a.rt.dispatch(saleCmd)
    a.rt.flush()
    // B is stale and not the writer: its commands stay in memory.
    expect(b.rt.flush()).toBe('not-writer')
    expect(storedRecord(s)?.log).toHaveLength(1)
    // [Use here] on B: B becomes the writer with a newer epoch and picks up A's session.
    b.rt.lock?.takeOver()
    await settle()
    expect(b.rt.lock?.status()).toBe('writer')
    expect(a.rt.lock?.status()).toBe('waiting')
    expect(b.rt.lock?.epoch()).toBeGreaterThan(a.rt.lock?.epoch() ?? 0)
    expect(b.rt.node.log()).toHaveLength(1)
    // A's later writes are refused.
    at(a.rt, '12:16:36.000')
    a.rt.dispatch(bakeryCmd)
    expect(a.rt.flush()).toBe('not-writer')
    expect(storedRecord(s)?.log).toHaveLength(1)
    // B closes: A's queued request gets the lock and A silently reloads from storage.
    b.rt.dispose()
    await settle()
    expect(a.rt.lock?.status()).toBe('writer')
    expect(a.rt.node.log()).toHaveLength(1)
  })

  it('a #/pay tab that finishes releases the lock and the waiting tab takes it', async () => {
    const s = shared()
    const stage = tab(s)
    await settle()
    const pay = tab(s)
    await settle()
    pay.rt.lock?.takeOver()
    await settle()
    expect(stage.rt.lock?.status()).toBe('waiting')
    pay.rt.lock?.release()
    await settle()
    expect(pay.rt.lock?.status()).toBe('released')
    expect(stage.rt.lock?.status()).toBe('writer')
  })

  it('without Web Locks the writer epoch decides: an older epoch never overwrites a newer one', async () => {
    const s = shared({}, false)
    const a = tab(s)
    expect(a.rt.lock?.status()).toBe('writer')
    expect(a.rt.lock?.epoch()).toBe(1)
    const b = tab(s)
    expect(b.rt.lock?.epoch()).toBe(2)
    at(b.rt, '12:16:00.000')
    b.rt.dispatch(saleCmd)
    b.rt.flush()
    const written = s.storage?.getItem(KEY)
    at(a.rt, '12:17:00.000')
    a.rt.dispatch(bakeryCmd)
    expect(a.rt.flush()).toBe('stale')
    expect(a.rt.lock?.status()).toBe('waiting')
    expect(s.storage?.getItem(KEY)).toBe(written)
    // [Use here] on A: a newer epoch again, and A reloads B's session first.
    a.rt.lock?.takeOver()
    expect(a.rt.lock?.epoch()).toBe(3)
    expect(a.rt.node.log()).toHaveLength(1)
  })

  it('a queued tab that takes over a record it could not restore quarantines it before writing', async () => {
    const s = shared()
    const a = tab(s)
    await settle()
    s.storage?.setItem(KEY, '{"broken":')
    const b = tab(s)
    await settle()
    expect(b.rt.notices()).toEqual(['restore-failed'])
    // A closes without writing again: B becomes the writer; the unreadable record is kept first.
    a.rt.dispose()
    await settle()
    expect(b.rt.lock?.status()).toBe('writer')
    expect(s.storage?.getItem(QUARANTINE_KEY)).toBe('{"broken":')
    expect(storedRecord(s)?.log).toEqual([])
    // The quarantine survives the next boot.
    b.rt.dispose()
    await settle()
    expect(tab(s).rt.quarantined()).toBe('{"broken":')
  })

  it('a queued tab never silently overwrites newer work it cannot restore', async () => {
    const s = shared()
    const a = tab(s)
    await settle()
    const b = tab(s)
    await settle()
    expect(b.rt.notices()).toEqual([])
    // A's newer record does not restore in B (here: a command this version refuses).
    at(a.rt, '12:16:00.000')
    a.rt.dispatch(saleCmd)
    a.rt.flush()
    const j = JSON.parse(s.storage?.getItem(KEY) ?? '')
    j.log[0].cmd.expect.senderDebit = '10.00'
    const newer = JSON.stringify(j)
    s.storage?.setItem(KEY, newer)
    a.rt.dispose()
    await settle()
    expect(b.rt.lock?.status()).toBe('writer')
    expect(b.rt.notices()).toEqual(['restore-failed'])
    expect(b.rt.quarantined()).toBe(newer)
    expect(s.storage?.getItem(QUARANTINE_KEY)).toBe(newer)
  })

  it('without Web Locks, two tabs that boot together settle on one writer', () => {
    const s = shared({}, false)
    const storage = s.storage as NonNullable<Shared['storage']>
    const a = tab(s)
    expect(a.rt.lock?.epoch()).toBe(1)
    // B boots before it sees A's claim (session restore opens both at once): it takes epoch 1 too.
    let bWrote = false
    const lagging = {
      ...storage,
      getItem: (k: string) => (k === CLOCK_KEY && !bWrote ? null : storage.getItem(k)),
      setItem: (k: string, v: string) => {
        bWrote = true
        storage.setItem(k, v)
      },
      removeItem: (k: string) => storage.removeItem(k),
      key: (i: number) => storage.key(i),
      get length() {
        return storage.length
      },
    }
    const b = tab({ storage: lagging as typeof storage, locks: null })
    expect(b.rt.lock?.epoch()).toBe(1)
    expect(b.rt.lock?.status()).toBe('writer')
    // The next write of A sees B's token on the same epoch and steps down; B keeps writing.
    at(a.rt, '12:16:00.000')
    a.rt.dispatch(saleCmd)
    expect(a.rt.flush()).toBe('stale')
    expect(a.rt.lock?.status()).toBe('waiting')
    at(b.rt, '12:16:30.000')
    b.rt.dispatch(bakeryCmd)
    expect(b.rt.flush()).toBe('written')
    expect(storedRecord(s)?.log).toHaveLength(1)
    expect(b.rt.lock?.status()).toBe('writer')
  })

  it('the storage event makes a fallback writer with the same epoch but another token stale', () => {
    const s = shared({}, false)
    const listeners = new Set<() => void>()
    const onStorage = (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    }
    const a = tab(s, { onStorage })
    const stamp = JSON.parse(s.storage?.getItem(CLOCK_KEY) ?? '{}')
    s.storage?.setItem(CLOCK_KEY, JSON.stringify({ ...stamp, writer: 'ffffffffffffffff' }))
    for (const l of listeners) l()
    expect(a.rt.lock?.status()).toBe('waiting')
  })

  it('the storage event makes a fallback writer stale at once', () => {
    const s = shared({}, false)
    const listeners = new Set<() => void>()
    const onStorage = (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    }
    const a = tab(s, { onStorage })
    tab(s)
    for (const l of listeners) l()
    expect(a.rt.lock?.status()).toBe('waiting')
  })
})

describe('the live clock and the clock key', () => {
  it('writes the clock every 5 s while it runs and continues from it on reopen', async () => {
    const s = shared()
    const time = fakeTime()
    const a = tab(s, { time, clock: { mode: 'live', wallNow: time.wallNow } })
    await settle()
    const start = a.rt.node.now()
    time.advance(12_000)
    const stamp = s.storage ? readClockStamp(s.storage) : null
    expect(stamp?.at).toEqual({ day: 0, time: '12:15:10.000' })
    a.rt.dispose()
    // Reopened later: the clock continues from the stored value, not from wall time.
    const time2 = fakeTime(99_000_000)
    const b = tab(s, { time: time2, clock: { mode: 'live', wallNow: time2.wallNow } })
    expect(b.rt.node.now()).toBe(start + 10_000)
  })

  it('a fractional wall clock (performance.now) stamps, writes and restores the session', async () => {
    const s = shared()
    const time = fakeTime(1000.25)
    const wallNow = () => time.wallNow() + 0.3
    const a = tab(s, { time, clock: { mode: 'live', wallNow } })
    await settle()
    time.advance(60_000.4)
    expect(Number.isSafeInteger(a.rt.node.now())).toBe(true)
    expect(a.rt.dispatch(saleCmd).ok).toBe(true)
    time.advance(5_000.7) // the settle, the debounced write and the 5 s clock key
    expect(a.rt.flush()).toBe('written')
    expect(a.rt.exportState().ok).toBe(true)
    const before = JSON.stringify(a.rt.node.getState())
    a.rt.dispose()
    const b = tab(s, { time: fakeTime(5_000.5), clock: { mode: 'live', wallNow: () => 5_000.5 } })
    expect(b.rt.notices()).toEqual([])
    expect(JSON.stringify(b.rt.node.getState())).toBe(before)
    expect(bal(b.rt, 'cafe')).toBe('296.89')
  })

  it('input keeps the live clock running; focus catches up due work', async () => {
    const s = shared()
    const time = fakeTime()
    const { rt } = tab(s, { time, clock: { mode: 'live', wallNow: time.wallNow } })
    await settle()
    const win = page()
    const doc = page()
    rt.attach(win, doc)
    time.advance(content.config.clock.idlePauseMs + 60_000)
    expect(rt.clock.isRunning()).toBe(false)
    win.fire('pointerdown')
    expect(rt.clock.isRunning()).toBe(true)
    rt.dispatch(saleCmd)
    time.advance(1400)
    win.fire('focus')
    expect(rt.node.hasPending()).toBe(false)
  })
})

describe('limits', () => {
  it('warns at 80 % and refuses new commands at 100 %, so an export always re-imports', async () => {
    const { rt } = tab(shared())
    await settle()
    expect(rt.usage().level).toBe('ok')
    const t0 = rt.node.now()
    for (let i = 1; i <= LIMITS.entries * 0.8; i++) rt.jump((t0 + i * 1000) as SimTime)
    expect(rt.usage().level).toBe('warn')
    for (let i = LIMITS.entries * 0.8 + 1; i <= LIMITS.entries; i++) rt.jump((t0 + i * 1000) as SimTime)
    expect(rt.usage().level).toBe('full')
    expect(rt.dispatch(saleCmd)).toEqual({ ok: false, error: { code: 'session-full' } })
    const out = rt.exportState()
    expect(out.ok && rt.readStateFile(out.value.text).ok).toBe(true)
    rt.reset({ epochDate: '2026-09-25' })
    expect(rt.usage().level).toBe('ok')
  })

  it('at 100 % a jump is refused too, so the log never grows past what an import accepts', async () => {
    const s = shared()
    const { rt } = tab(s)
    await settle()
    const t0 = rt.node.now()
    for (let i = 1; i <= LIMITS.entries; i++) expect(rt.jump((t0 + i * 1000) as SimTime).ok).toBe(true)
    expect(rt.usage().level).toBe('full')
    expect(rt.jump((t0 + (LIMITS.entries + 1) * 1000) as SimTime)).toEqual({ ok: false, error: 'session-full' })
    expect(rt.node.log()).toHaveLength(LIMITS.entries)
    expect(rt.flush()).toBe('written')
    rt.dispose()
    await settle()
    const b = tab(s)
    expect(b.rt.notices()).toEqual([])
    expect(b.rt.node.log()).toHaveLength(LIMITS.entries)
  })

  it('a jump beyond day 400 after T0 is refused; day 400 itself is kept and reloads', async () => {
    const s = shared()
    const { rt } = tab(s)
    await settle()
    at(rt, '12:16:00.000')
    rt.dispatch(saleCmd)
    rt.node.settleDue()
    const t0Date = rt.meta().t0Date
    const day401 = instantOfAt(t0Date, { day: LIMITS.maxDay + 1, time: '00:00:00.000' })
    expect(rt.jump(day401)).toEqual({ ok: false, error: 'too-far' })
    expect(rt.jump((day401 - 1) as SimTime).ok).toBe(true)
    expect(rt.jump(Number.NaN as SimTime)).toEqual({ ok: false, error: 'invalid-time' })
    expect(rt.flush()).toBe('written')
    const out = rt.exportState()
    expect(out.ok && rt.readStateFile(out.value.text).ok).toBe(true)
    rt.dispose()
    await settle()
    const b = tab(s)
    expect(b.rt.notices()).toEqual([])
    expect(b.rt.node.now()).toBe(day401 - 1)
    expect(bal(b.rt, 'cafe')).toBe('296.89')
  })

  it('a malformed cmdId or actor is refused as not storable, so the session always reloads', async () => {
    const s = shared()
    const { rt } = tab(s)
    await settle()
    at(rt, '12:16:00.000')
    for (const bad of [
      { ...saleCmd, cmdId: 'not-a-flow-id' },
      { ...saleCmd, cmdId: '3be07a9c11f45d62:Review' },
      { ...saleCmd, cmdId: 42 as unknown as string },
      { ...saleCmd, actor: 'constructor' },
      { ...saleCmd, actor: 'Ana' },
    ]) {
      expect(rt.dispatch(bad), JSON.stringify([bad.cmdId, bad.actor])).toEqual({
        ok: false,
        error: { code: 'not-storable' },
      })
    }
    expect(rt.dispatch(saleCmd).ok).toBe(true)
    expect(rt.flush()).toBe('written')
    rt.dispose()
    await settle()
    const b = tab(s)
    expect(b.rt.notices()).toEqual([])
    expect(b.rt.node.log()).toHaveLength(1)
  })

  it('a UI outside the record caps is fitted before writing; the ledger always reloads', async () => {
    const s = shared()
    const { rt } = tab(s)
    await settle()
    at(rt, '12:16:00.000')
    rt.dispatch(saleCmd)
    rt.ui.set({
      ...rt.ui.get(),
      sessions: new Map([
        ['ana', true],
        ['mallory', true],
      ]),
      nav: new Map([
        ['cafe', ['home', 'hub:cashOut', 'tx:detail']],
        ['ana', ['Bad Screen!']],
      ]),
      read: new Map([['ana', { readUpTo: null, readIds: Array.from({ length: 600 }, (_, i) => `n:${i}`) }]]),
    })
    expect(rt.flush()).toBe('written')
    const rec = storedRecord(s)
    expect(rec?.ui.nav.get('cafe')).toEqual(['home', 'hub:cashOut'])
    expect(rec?.ui.nav.has('ana')).toBe(false)
    expect(rec?.ui.sessions.has('mallory')).toBe(false)
    expect(rec?.ui.read.get('ana')?.readIds).toHaveLength(LIMITS.readIds)
    expect(rec?.ui.read.get('ana')?.readIds[0]).toBe('n:100')
    rt.dispose()
    await settle()
    const b = tab(s)
    expect(b.rt.notices()).toEqual([])
    expect(b.rt.node.log()).toHaveLength(1)
  })

  it('a command the file rules cannot hold is refused before it is decided', async () => {
    const { rt } = tab(shared())
    const items = Array.from({ length: 21 }, () => ({ sku: 'croissant', name: 'Croissant', qty: 1, price: m('2.20') }))
    const big: PayCommand = {
      ...saleCmd,
      cmdId: 'aaaaaaaaaaaaaaaa:review',
      items,
      amount: m('46.20'),
      expect: { senderDebit: m('46.20') },
    }
    expect(rt.dispatch(big)).toEqual({ ok: false, error: { code: 'not-storable' } })
    // Notes are cleaned the way an import would clean them.
    const noted: PayCommand = { ...bakeryCmd, note: '​Croissant\u0007 delivery' }
    at(rt, '12:16:00.000')
    expect(rt.dispatch(noted).ok).toBe(true)
    const last = rt.node.getState().txOrder.at(-1) as string
    expect(rt.node.getState().txs[last]?.note).toBe('Croissant delivery')
  })

  it('refuses commands whose log entry would not replay to the same command (found by the property test)', () => {
    const { rt } = tab(shared())
    at(rt, '12:16:00.000')
    const flat = { sku: 'flat-white', name: 'Flat white', qty: 1, price: m('3.30') }
    const cases: [string, PayCommand][] = [
      ['an item without a sku', { ...saleCmd, items: [{ name: 'Custom', qty: 1, price: m('11.00') }] }],
      [
        "another merchant's item",
        {
          ...saleCmd,
          to: '@lintvern',
          items: [flat, { ...flat, qty: 2, sku: 'croissant', name: 'Croissant', price: m('2.20') }],
          amount: m('7.70'),
          expect: { senderDebit: m('7.70') },
        },
      ],
      ['an edited price', { ...saleCmd, items: [{ ...flat, price: m('11.00') }] }],
      ['a persona id in place of a handle', { ...bakeryCmd, to: 'bakery' as PayCommand['to'] }],
    ]
    for (const [name, cmd] of cases)
      expect(rt.dispatch(cmd), name).toEqual({ ok: false, error: { code: 'not-storable' } })
    expect(rt.node.log()).toHaveLength(0)
    // A malformed amount is the node's refusal, not an exception.
    expect(rt.dispatch({ ...saleCmd, amount: Number.NaN as PayCommand['amount'] })).toMatchObject({
      ok: false,
      error: { code: 'invalid-amount' },
    })
    expect(rt.dispatch({ ...saleCmd, expect: { senderDebit: Number.NaN as PayCommand['amount'] } })).toMatchObject({
      ok: false,
      error: { code: 'quote-changed' },
    })
    // An unknown request is refused by the domain as before.
    expect(rt.dispatch({ ...saleCmd, requestId: 'r_nothing' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-state' },
    })
    expect(rt.dispatch(saleCmd).ok).toBe(true)
  })
})

describe('Reset, Undo and state files', () => {
  it('Reset recomputes T0 and keeps one Undo until the next command', async () => {
    const { rt } = tab(shared())
    await settle()
    at(rt, '12:16:00.000')
    rt.dispatch(saleCmd)
    rt.node.settleDue()
    rt.reset({ epochDate: '2026-10-02' })
    expect(rt.meta().t0Date).toBe('2026-10-02')
    expect(bal(rt, 'ana')).toBe('247.50')
    expect(rt.canUndo()).toBe(true)
    expect(rt.undo()).toBe(true)
    expect(rt.meta().t0Date).toBe('2026-09-25')
    expect(bal(rt, 'ana')).toBe('236.50')
    rt.reset({ epochDate: '2026-10-02' })
    at(rt, '12:16:00.000')
    rt.dispatch(saleCmd)
    expect(rt.canUndo()).toBe(false)
    expect(rt.undo()).toBe(false)
  })

  it('export → read → open gives the same ledger; opening is undoable', async () => {
    const a = tab(shared())
    await settle()
    at(a.rt, '12:16:00.000')
    a.rt.dispatch(saleCmd)
    at(a.rt, '12:16:36.000')
    a.rt.dispatch(bakeryCmd)
    a.rt.node.settleDue()
    const out = a.rt.exportState('Café loop')
    if (!out.ok) throw new Error(out.error)
    expect(out.value.fileName).toBe('bcps-state-2026-09-25-1216.json')
    expect(a.rt.fileSizeAllowed(out.value.text.length)).toBe(true)
    expect(a.rt.fileSizeAllowed(LIMITS.bytes + 1)).toBe(false)
    const blank = a.rt.exportState(' \u0007 ')
    expect(blank.ok && a.rt.readStateFile(blank.value.text)).toMatchObject({ ok: true, value: { label: null } })

    const b = tab(shared())
    const cand = b.rt.readStateFile(out.value.text)
    if (!cand.ok) throw new Error(cand.error)
    expect(cand.value.label).toBe('Café loop')
    expect(bal(b.rt, 'cafe')).toBe('286.00') // reading changes nothing
    b.rt.openStateFile(cand.value)
    expect(JSON.stringify(b.rt.node.getState())).toBe(JSON.stringify(a.rt.node.getState()))
    expect(b.rt.meta().label).toBe('Café loop')
    expect(b.rt.undo()).toBe(true)
    expect(bal(b.rt, 'cafe')).toBe('286.00')
  })

  it('a file opens on this device’s T0 by calendar; a hostile file changes nothing', async () => {
    const a = tab(shared())
    at(a.rt, '12:16:00.000')
    a.rt.dispatch(saleCmd)
    a.rt.node.settleDue()
    const out = a.rt.exportState('Sale')
    if (!out.ok) throw new Error(out.error)
    const b = tab(shared(), { epochDate: '2027-03-26' })
    const cand = b.rt.readStateFile(out.value.text)
    if (!cand.ok) throw new Error(cand.error)
    b.rt.openStateFile(cand.value)
    expect(b.rt.meta().t0Date).toBe('2027-03-26')
    expect(bal(b.rt, 'ana')).toBe('236.50')
    const before = JSON.stringify(b.rt.node.getState())
    const hostile = out.value.text.replace('"actor":"ana"', '"actor":"director"')
    expect(b.rt.readStateFile(hostile)).toEqual({ ok: false, error: 'bad-file' })
    expect(b.rt.readStateFile('{"__proto__":{}}')).toEqual({ ok: false, error: 'bad-file' })
    expect(JSON.stringify(b.rt.node.getState())).toBe(before)
  })
})

describe('the stored clock key', () => {
  it('is validated like everything else (odd values read as absent)', () => {
    const s = memoryStorage({
      [CLOCK_KEY]: '{"t0Date":"2026-09-25","at":{"day":900,"time":"12:00:00.000"},"writerEpoch":3}',
    })
    expect(readClockStamp(s)).toBeNull()
    s.setItem(CLOCK_KEY, '{"t0Date":"2026-09-25","at":{"day":1,"time":"12:00:00.000"},"writerEpoch":3}')
    expect(readClockStamp(s)?.writerEpoch).toBe(3)
  })
})
