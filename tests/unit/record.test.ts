import { describe, expect, it } from 'vitest'
import { fingerprintOf, fnv1a64, LIMITS, serializeRecord, stableStringify, utf8Length } from '@store/record'
import { parseFor, restoreRecord, restoreText } from '@store/restore'
import { validFile } from '../support/records'
import { content } from './helpers'

// The record and state-file validator: a strict, hand-written parser that
// treats every file as untrusted. Hostile fixtures are built from a valid file and must all be
// refused with nothing changed.

const parse = (text: string, acceptOlder = false) => parseFor(content, text, acceptOlder)
const env = { content }

describe('fingerprint', () => {
  it('FNV-1a 64 matches the reference values (UTF-16LE bytes)', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325')
    expect(fnv1a64('a')).toBe('089be207b544f1e4')
    expect(fnv1a64('ana=24750/0;')).toBe('88bcc60bdb7123e6')
  })

  it('covers every balance and the last seq', () => {
    const { node } = validFile()
    const s = node.getState()
    const fp = fingerprintOf(s)
    expect(fp.seq).toBe(s.seq)
    const moved = {
      ...s,
      balances: { ...s.balances, ana: { confirmed: (s.balances.ana?.confirmed ?? 0) + 1, held: 0 } },
    }
    expect(fingerprintOf(moved as unknown as typeof s).balancesHash).not.toBe(fp.balancesHash)
  })
})

describe('record round trip', () => {
  it('a record serialises byte-stable and parses back to the same bytes', () => {
    const { record, text } = validFile()
    expect(serializeRecord(record)).toBe(text)
    const p = parse(text)
    expect(p.ok).toBe(true)
    if (p.ok) expect(serializeRecord(p.record)).toBe(text)
  })

  it('the log uses calendar stamps, two-decimal amounts, items by sku and seed refs', () => {
    const { json } = validFile()
    const j = json()
    expect(j.t0Date).toBe('2026-09-25')
    expect(j.log[0]).toEqual({
      at: { day: 0, time: '12:16:00.000' },
      actor: 'ana',
      cmdId: '3be07a9c11f45d62:review',
      cmd: {
        type: 'pay',
        to: '@cafelipa',
        amount: '11.00',
        channel: 'qr',
        items: [
          { sku: 'flat-white', qty: 2 },
          { sku: 'croissant', qty: 2 },
        ],
        expect: { senderDebit: '11.00' },
      },
    })
    expect(j.log[1].cmd.expect.senderDebit).toBe('8.89')
    expect(j.clock).toEqual({ day: 0, time: '12:16:37.400' })
    expect(j.fingerprint.balancesHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('notes and the label lose control and format characters instead of being refused', () => {
    const { json } = validFile()
    const j = json()
    j.label = 'Café‮ loop\u0007'
    j.log[1].cmd.note = '​Croissant\u0000 delivery'
    const p = parse(JSON.stringify(j))
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.record.label).toBe('Café loop')
    const e = p.record.log[1]
    expect(e && 'cmd' in e && e.cmd.note).toBe('Croissant delivery')
  })

  it('prefs in a file are ignored', () => {
    const j = validFile().json()
    j.prefs = { largeText: true }
    expect(parse(JSON.stringify(j)).ok).toBe(true)
  })

  it('stableStringify sorts keys at every level', () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: [{ f: 1, e: 2 }] } })).toBe('{"a":{"c":[{"e":2,"f":1}],"d":1},"b":1}')
  })
})

// biome-ignore lint/suspicious/noExplicitAny: hostile-file tests mutate the parsed JSON freely
type Mutate = (j: Record<string, any>) => void

/** Hostile variants of a valid file; each must be refused (parse or replay). */
const HOSTILE: [name: string, code: string, mutate: Mutate | string][] = [
  // size
  ['oversized: more than 1 MB', 'too-large', `{"format":"bcps-state","pad":"${'x'.repeat(LIMITS.bytes)}"}`],
  [
    'oversized: more than 5,000 log entries',
    'too-many',
    (j) => (j.log = Array.from({ length: 5001 }, () => ({ at: j.clock, jump: true }))),
  ],
  // time
  ['out-of-order times', 'time-order', (j) => ([j.log[0], j.log[1]] = [j.log[1], j.log[0]])],
  ['clock before the last entry', 'time-order', (j) => (j.clock = { day: 0, time: '12:16:10.000' })],
  ['day beyond 400', 'shape', (j) => (j.log[1].at.day = 401)],
  ['negative day', 'shape', (j) => (j.log[0].at.day = -1)],
  ['a time that is not HH:MM:SS.mmm', 'shape', (j) => (j.log[0].at.time = '25:00:00.000')],
  ['T0 date that is not a Friday', 'shape', (j) => (j.t0Date = '2026-09-24')],
  // prototype keys
  ['__proto__ key', 'hostile-key', `{"format":"bcps-state","__proto__":{"polluted":true}}`],
  ['constructor key in a command', 'hostile-key', (j) => (j.log[0].cmd.constructor = { prototype: {} })],
  ['prototype key in a persona map', 'hostile-key', (j) => (j.ui.sessions.prototype = true)],
  // control characters
  ['control character in a cmdId', 'control-character', (j) => (j.log[0].cmdId = '3be07a9c11f45d62:rev\u0000iew')],
  ['bidi override in a handle', 'control-character', (j) => (j.log[0].cmd.to = '@cafe‮lipa')],
  ['control character in a key', 'control-character', (j) => (j.ui.sessions['ana\u0007'] = true)],
  // unknown or internal commands
  ['sys.run in the log', 'unknown-command', (j) => (j.log[0].cmd = { type: 'sys.run', until: 0 })],
  ['an unknown command', 'unknown-command', (j) => (j.log[0].cmd.type = 'mint')],
  ['an unknown field on a command', 'shape', (j) => (j.log[0].cmd.balance = '1000000.00')],
  ['a balances section', 'shape', (j) => (j.balances = { ana: 100000 })],
  // excessive arrays and fields
  [
    'more than 20 items',
    'limit',
    (j) => (j.log[0].cmd.items = Array.from({ length: 21 }, () => ({ sku: 'croissant', qty: 1 }))),
  ],
  [
    'more than 500 read ids',
    'limit',
    (j) => (j.ui.read = { ana: { readUpTo: null, readIds: Array.from({ length: 501 }, (_, i) => `n:${i}`) } }),
  ],
  ['a nav stack deeper than two', 'limit', (j) => (j.ui.nav = { ana: ['home', 'hub:pay', 'detail:tx'] })],
  ['a note over 40 characters', 'limit', (j) => (j.log[1].cmd.note = 'x'.repeat(41))],
  ['a label over 60 characters', 'limit', (j) => (j.label = 'x'.repeat(61))],
  [
    'nesting deeper than the format allows',
    'too-deep',
    (j) => {
      let o: Record<string, unknown> = {}
      j.ui.deep = o
      for (let i = 0; i < 20; i++) o = o.x = {}
    },
  ],
  // identity and amounts
  ['a persona-keyed map with an unknown persona', 'shape', (j) => (j.ui.sessions = { mallory: true })],
  ['an actor named "constructor"', 'shape', (j) => (j.log[0].actor = 'constructor')],
  ['an actor named "toString"', 'shape', (j) => (j.log[0].actor = 'toString')],
  ['an actor named "__proto__"', 'shape', (j) => (j.log[0].actor = '__proto__')],
  ['a recipient named "constructor"', 'shape', (j) => (j.log[0].cmd.to = 'constructor')],
  ['a cmdId of "__proto__"', 'shape', (j) => (j.log[0].cmdId = '__proto__')],
  ['a negative amount', 'shape', (j) => (j.log[0].cmd.amount = '-11.00')],
  ['an amount with three decimals', 'shape', (j) => (j.log[0].cmd.amount = '11.000')],
  ['a newer stateVersion', 'state-version', (j) => (j.stateVersion = content.config.stateVersion + 1)],
  ['another format', 'format', (j) => (j.format = 'other')],
  ['not JSON', 'not-json', '{"format": "bcps-state",'],
]

describe('hostile files are refused', () => {
  for (const [name, code, m] of HOSTILE) {
    it(name, () => {
      let text: string
      if (typeof m === 'string') text = m
      else {
        const j = validFile().json()
        m(j)
        text = JSON.stringify(j)
      }
      const p = parse(text, true)
      expect(p.ok).toBe(false)
      if (!p.ok) expect(p.problem.code).toBe(code)
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })
  }

  it('an older stateVersion parses only when the caller replays it on the new seed', () => {
    const j = validFile().json()
    j.stateVersion = content.config.stateVersion - 1
    expect(parse(JSON.stringify(j)).ok).toBe(false)
    const p = parse(JSON.stringify(j), true)
    expect(p.ok && p.olderVersion).toBe(true)
  })

  it('files that parse but do not replay are refused: unknown actor, wrong quote, unknown sku', () => {
    const cases: Mutate[] = [
      (j) => (j.log[0].actor = 'director'),
      (j) => (j.log[0].actor = 'system'),
      (j) => (j.log[1].cmd.expect.senderDebit = '8.80'),
      (j) => (j.log[0].cmd.items[0].sku = 'gold-bar'),
      (j) => (j.log[0].cmd.requestRef = { cmdId: '0000000000000000:charge' }),
      (j) => (j.log[1].cmdId = j.log[0].cmdId),
      (j) => (j.log[0].at = { day: 0, time: '09:00:00.000' }), // before T0
    ]
    for (const m of cases) {
      const j = validFile().json()
      m(j)
      const r = restoreText(JSON.stringify(j), env, { acceptOlder: false })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.stage).toBe('replay')
    }
  })

  it('a record that makes replay throw is refused, never thrown', () => {
    const p = parse(validFile().text)
    if (!p.ok) throw new Error(p.problem.code)
    // Past the parser (an unknown command type decodes to nothing): replay must refuse it.
    const broken = { ...p.record, log: p.record.log.map((e) => ({ ...e, cmd: { type: 'mint' } })) }
    const r = restoreRecord(broken as unknown as typeof p.record, false, env)
    expect(r).toEqual({ ok: false, error: { stage: 'replay', failure: { code: 'exception', index: 0 } } })
  })

  it('a record cannot inject balances: only the log counts', () => {
    const j = validFile().json()
    j.fingerprint = { seq: 99_999, balancesHash: 'ffffffffffffffff' }
    const r = restoreText(JSON.stringify(j), env, { acceptOlder: false })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.recalculated).toBe(true)
    expect(r.value.session.state.balances.ana?.confirmed).toBe(23650)
  })

  it('the size check counts UTF-8 bytes', () => {
    expect(utf8Length('abc')).toBe(3)
    expect(utf8Length('é')).toBe(2)
    expect(utf8Length('≈')).toBe(3)
    expect(utf8Length('😀')).toBe(4)
  })
})
