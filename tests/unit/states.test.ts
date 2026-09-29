// Shipped starting states: every content/states/*.json must replay on the
// current seed with the build's stateVersion and its own fingerprint. The files arrive with
// make-states (milestone F); until then the list is empty and this checks the harness only.
import { describe, expect, it } from 'vitest'
import { restoreText } from '@store/restore'
import { content } from './helpers'

const files = import.meta.glob('/content/states/*.json', { query: '?raw', import: 'default', eager: true })

describe('shipped starting states', () => {
  it('each replays with the current stateVersion and matches its fingerprint', () => {
    for (const [path, text] of Object.entries(files)) {
      const r = restoreText(text as string, { content }, { acceptOlder: false })
      expect(r.ok, path).toBe(true)
      if (r.ok) expect(r.value.recalculated, path).toBe(false)
    }
    expect(Object.keys(files).every((p) => p.endsWith('.json'))).toBe(true)
  })
})
