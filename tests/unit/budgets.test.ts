// Build budgets: the rules of scripts/check-budgets.ts on fixtures, the
// committed budget file, and the per-asset budgets on the committed icons.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  type BuildOutput,
  type Budgets,
  initialScripts,
  measure,
  patternToRegExp,
  precacheUrls,
} from '../../scripts/budgets-core'

const budgets = JSON.parse(readFileSync('scripts/budgets.json', 'utf8')) as Budgets

const INDEX = `<!doctype html><html><head>
  <script type="module" crossorigin src="./assets/index-abc.js"></script>
  <link rel="modulepreload" crossorigin href="./assets/react-def.js">
  <link rel="stylesheet" href="./assets/index-abc.css">
  <link rel="icon" href="./brand/icon-192.png">
</head><body><script>/* inline */</script></body></html>`

const SW =
  'precacheAndRoute([{url:"index.html",revision:"1"},{url:"assets/index-abc.js",revision:null},{url:"assets/react-def.js",revision:null},{url:"index.html",revision:"1"}])'

function build(sizes: Record<string, number>, overrides: Partial<BuildOutput> = {}): BuildOutput {
  return {
    indexHtml: INDEX,
    swJs: SW,
    files: Object.keys(sizes),
    size: (p) => sizes[p] ?? 0,
    gzipSize: (p) => Math.round((sizes[p] ?? 0) / 3),
    ...overrides,
  }
}

const small: Budgets = {
  initialJsGzip: 100,
  precacheBytes: 1000,
  assets: [{ pattern: 'brand/icon-*.png', maxBytes: 50 }],
}

describe('budget rules', () => {
  it('initial JS is the entry module and its preloads, not styles, icons or inline scripts', () => {
    expect(initialScripts(INDEX)).toEqual(['assets/index-abc.js', 'assets/react-def.js'])
  })

  it('precache URLs come from the Workbox manifest, once each', () => {
    expect(precacheUrls(SW)).toEqual(['index.html', 'assets/index-abc.js', 'assets/react-def.js'])
  })

  it('patterns match within one path segment', () => {
    expect(patternToRegExp('brand/icon-*.png').test('brand/icon-192.png')).toBe(true)
    expect(patternToRegExp('brand/icon-*.png').test('brand/x/icon-192.png')).toBe(false)
    expect(patternToRegExp('brand/icon-*.png').test('brand/icon-192.pngx')).toBe(false)
  })

  it('passes a build within budget and reports what it measured', () => {
    const r = measure(
      build({ 'index.html': 90, 'assets/index-abc.js': 150, 'assets/react-def.js': 120, 'brand/icon-192.png': 40 }),
      small,
    )
    expect(r.problems).toEqual([])
    expect(r.initialJs.gzip).toBe(50 + 40)
    expect(r.precache).toEqual({ files: 3, bytes: 360, budget: 1000 })
    expect(r.assets).toEqual([{ path: 'brand/icon-192.png', bytes: 40, budget: 50, pattern: 'brand/icon-*.png' }])
  })

  it('fails over each budget, and on files the page or the worker names but the build lacks', () => {
    const over = measure(
      build({ 'index.html': 900, 'assets/index-abc.js': 300, 'assets/react-def.js': 30, 'brand/icon-512.png': 51 }),
      small,
    )
    expect(over.problems).toHaveLength(3)
    expect(over.problems.join('\n')).toMatch(/initial JS is 110 bytes gzip, over the budget of 100/)
    expect(over.problems.join('\n')).toMatch(/precache is 1230 bytes/)
    expect(over.problems.join('\n')).toMatch(/brand\/icon-512.png is 51 bytes/)
    const missing = measure(build({ 'index.html': 1 }), small)
    expect(missing.problems.join('\n')).toMatch(/loads assets\/index-abc.js, which is not in the build/)
    expect(missing.problems.join('\n')).toMatch(/precaches assets\/react-def.js, which is not in the build/)
    expect(measure(build({ 'index.html': 1 }, { indexHtml: '<html></html>', swJs: null }), small).problems).toEqual([
      'index.html loads no module script',
    ])
  })
})

describe('the committed budgets', () => {
  it('stay within the targets: initial JS at most 150 kB gzip, precache at most 2.5 MB', () => {
    expect(budgets.initialJsGzip).toBeGreaterThan(0)
    expect(budgets.initialJsGzip).toBeLessThanOrEqual(150_000)
    expect(budgets.precacheBytes).toBeLessThanOrEqual(2_500_000)
  })

  it('icons at most 60 kB and the emblem at most 120 kB', () => {
    const max = (pattern: string) => budgets.assets.find((a) => a.pattern === pattern)?.maxBytes
    expect(max('brand/icon-*.png')).toBe(60_000)
    expect(max('brand/apple-touch-icon.png')).toBe(60_000)
    expect(max('assets/emblem-*')).toBe(120_000)
  })

  it('the committed icons are within their budget', () => {
    for (const name of ['icon-192.png', 'icon-512.png']) {
      expect(readFileSync(`public/brand/${name}`).byteLength, name).toBeLessThanOrEqual(60_000)
    }
  })
})
