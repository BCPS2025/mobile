// Meta-test of check-state-version: the committed manifest matches the tree, and
// a changed replay input fails until stateVersion is bumped or the manifest is regenerated with a
// reason. Runs the pure core over the real tree in memory.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  MANIFEST_PATH,
  checkManifest,
  collectInputs,
  hashInputs,
  nextManifest,
  parseManifest,
  stateVersionOf,
} from '../../scripts/state-version-core'
import manifestText from '../../content/replay-fingerprint.json?raw'

const code = import.meta.glob(['/src/domain/**/*.{ts,tsx}', '/src/sim/**/*.{ts,tsx}', '/src/store/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
const yamls = import.meta.glob('/content/*.yaml', { query: '?raw', import: 'default', eager: true })
const tree = new Map<string, string>(
  [...Object.entries(code), ...Object.entries(yamls)].map(([p, t]) => [p.slice(1), t as string]),
)

const parseYaml = (t: string) => parse(t, { schema: 'core' })
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

function hashesOf(files: ReadonlyMap<string, string>) {
  const src = {
    list: (dir: string) => [...files.keys()].filter((p) => p.startsWith(dir)),
    read: (p: string) => files.get(p) ?? null,
  }
  return hashInputs(collectInputs(src, parseYaml), sha256)
}
const with_ = (path: string, text: string) => new Map([...tree, [path, text]])

const stateVersion = stateVersionOf(tree.get('content/config.yaml') ?? '', parseYaml)
const manifest = parseManifest(manifestText)

describe('check-state-version', () => {
  it(`the committed ${MANIFEST_PATH} matches every replay input`, () => {
    expect(checkManifest(manifest, stateVersion, hashesOf(tree))).toEqual([])
  })

  it('covers the seed, config, personas, the engine and replay; not copy, homes or screens', () => {
    const inputs = Object.keys(hashesOf(tree))
    expect(inputs).toContain('content/seed.yaml')
    expect(inputs).toContain('src/domain/fees.ts')
    expect(inputs).toContain('src/sim/scheduler.ts')
    expect(inputs).toContain('src/store/replay.ts')
    expect(inputs).toContain('content/signup.yaml')
    expect(inputs.some((p) => p.includes('copy.en') || p.includes('homes') || p.startsWith('src/app/'))).toBe(false)
  })

  it('a changed engine file fails until stateVersion is bumped or a reason is given', () => {
    const changed = hashesOf(with_('src/domain/fees.ts', `${tree.get('src/domain/fees.ts')}\n// changed\n`))
    expect(checkManifest(manifest, stateVersion, changed)).toEqual([{ kind: 'changed', path: 'src/domain/fees.ts' }])
    expect(nextManifest(manifest, stateVersion, changed)).toEqual({ ok: false, error: 'reason-required' })
    const withReason = nextManifest(manifest, stateVersion, changed, 'comment only')
    expect(withReason.ok && withReason.manifest.reason).toBe('comment only')
    const bumped = nextManifest(manifest, stateVersion + 1, changed)
    expect(bumped.ok && bumped.manifest.stateVersion).toBe(stateVersion + 1)
  })

  it('a bump without a regenerated manifest fails too', () => {
    expect(checkManifest(manifest, stateVersion + 1, hashesOf(tree))).toEqual([
      { kind: 'version', manifest: stateVersion, config: stateVersion + 1 },
    ])
  })

  it('only products, plans and templates of the catalogue count', () => {
    const cat = tree.get('content/catalogue.yaml') ?? ''
    const comment = hashesOf(with_('content/catalogue.yaml', `# a neutral comment\n${cat}`))
    expect(checkManifest(manifest, stateVersion, comment)).toEqual([])
    const chips = hashesOf(with_('content/catalogue.yaml', cat.replace('Taxi share', 'Taxi')))
    expect(checkManifest(manifest, stateVersion, chips)).toEqual([])
    const price = hashesOf(with_('content/catalogue.yaml', cat.replace('price: "3.30"', 'price: "3.40"')))
    expect(checkManifest(manifest, stateVersion, price)).toEqual([
      { kind: 'changed', path: 'content/catalogue.yaml#products,plans,templates' },
    ])
  })

  it('a new sign-up file is a new input', () => {
    const added = hashesOf(with_('content/signup.yaml', 'pool: []\n'))
    expect(checkManifest(manifest, stateVersion, added)).toEqual([{ kind: 'changed', path: 'content/signup.yaml' }])
  })
})
