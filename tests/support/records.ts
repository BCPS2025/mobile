// Records for the persistence tests: a session driven through a node, snapshotted in the
// production format, plus an in-memory Storage and hostile variants of a valid file.
import type { SimTime } from '@domain/types'
import { buildSeed } from '@sim/seed'
import { type IsoDate, instantOfAt } from '@sim/tz'
import { createLogEncoder } from '@store/log-codec'
import { createLedgerNode, type LedgerNode } from '@store/node'
import { type SessionMeta, type StorageLike, snapshotRecord } from '@store/persistence'
import { type StateRecord, freshUi, serializeRecord } from '@store/record'
import { cafeQrBakery } from '../golden/journeys/cafe-qr-bakery'
import { content } from '../unit/helpers'
import type { Journey } from './journey'

export const STATE_VERSION = content.config.stateVersion

export function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v)
    },
    removeItem: (k) => {
      data.delete(k)
    },
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size
    },
  }
}

/** Drives a journey on a fresh node (settling after every entry's time as live use would). */
export function sessionOf(
  epochDate: IsoDate,
  journey: Journey = cafeQrBakery(content),
  until?: { day: number; time: string },
) {
  const seed = buildSeed(content, epochDate)
  const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
  for (const e of journey) {
    node.clock.jumpTo(instantOfAt(seed.t0Date, e.at))
    const r = node.dispatch(e.cmd)
    if (!r.ok) throw new Error(`refused: ${r.error.code}`)
  }
  node.settleDue()
  if (until) node.advanceTo(instantOfAt(seed.t0Date, until) as SimTime, 'catch-up')
  return { seed, node }
}

export function recordOf(node: LedgerNode, t0Date: IsoDate, extra: Partial<SessionMeta> = {}): StateRecord {
  const meta: SessionMeta = { stateVersion: STATE_VERSION, build: 'dev', t0Date, ...extra }
  const r = snapshotRecord({ node, meta, ui: freshUi(), writerEpoch: 1, encoder: createLogEncoder() })
  if (!r.ok) throw new Error(r.error)
  return r.value
}

/** A valid record of the café loop as JSON text and as a mutable object. */
export function validFile(epochDate: IsoDate = '2026-09-25') {
  const { seed, node } = sessionOf(epochDate)
  const record = recordOf(node, seed.t0Date, { label: 'Café loop' })
  const text = serializeRecord(record)
  // biome-ignore lint/suspicious/noExplicitAny: hostile-file tests mutate the parsed JSON freely
  return { seed, node, record, text, json: () => JSON.parse(text) as Record<string, any> }
}
