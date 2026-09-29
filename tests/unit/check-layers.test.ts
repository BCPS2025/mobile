// Meta-test of the layer check: the real src/ tree passes, and planted
// wrong-direction imports, domain packages and domain globals fail. Runs the rule engine in
// memory over the real tree and the CLI on a temporary tree.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { type Tree, aliasesFromPaths, checkLayers, extractImports } from '../../scripts/layers-core'
import tsconfigText from '../../tsconfig.json?raw'

const tsconfig = JSON.parse(tsconfigText) as { compilerOptions: { paths: Record<string, string[]> } }
const aliases = aliasesFromPaths(tsconfig.compilerOptions.paths)

const glob = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const realSources = new Map(Object.entries(glob).map(([p, text]) => [p.slice(1), text as string]))
// Every file under src/ and content/ (styles, YAML), for resolving imports that are not TypeScript.
const otherFiles = new Set(Object.keys(import.meta.glob(['/src/**/*', '/content/**/*'])).map((p) => p.slice(1)))

function treeWith(extra: Record<string, string> = {}): Tree {
  const sources = new Map(realSources)
  for (const [p, text] of Object.entries(extra)) sources.set(p, text)
  return { sources, aliases, exists: (p) => sources.has(p) || otherFiles.has(p) }
}

const rulesOf = (extra: Record<string, string>) => checkLayers(treeWith(extra)).map((f) => f.rule)

describe('check-layers rules', () => {
  it('maps the five layer aliases from tsconfig.json', () => {
    expect(aliases).toEqual({
      '@domain/': 'src/domain/',
      '@content/': 'src/content/',
      '@sim/': 'src/sim/',
      '@store/': 'src/store/',
      '@app/': 'src/app/',
    })
  })

  it('passes the real src/ tree', () => {
    expect(realSources.size).toBeGreaterThan(40)
    expect(checkLayers(treeWith())).toEqual([])
  })

  it('fails a domain file importing the store through an alias', () => {
    const f = checkLayers(
      treeWith({ 'src/domain/planted.ts': "export {}\nimport { createLedgerNode } from '@store/node'\n" }),
    )
    expect(f).toEqual([expect.objectContaining({ file: 'src/domain/planted.ts', line: 2, rule: 'wrong-direction' })])
  })

  it('fails wrong-direction imports however they are spelled', () => {
    expect(rulesOf({ 'src/domain/planted.ts': "import { ui } from '../app/copy'\n" })).toEqual(['wrong-direction'])
    expect(rulesOf({ 'src/sim/planted.ts': "import type { Route } from '@app/router'\n" })).toEqual(['wrong-direction'])
    expect(rulesOf({ 'src/store/planted.ts': "export * from '../app/router'\n" })).toEqual(['wrong-direction'])
    expect(rulesOf({ 'src/sim/planted.ts': "export const later = () => import('@store/node')\n" })).toEqual([
      'wrong-direction',
    ])
    expect(rulesOf({ 'src/content/planted.ts': "import {\n  buildSeed,\n} from '../sim/seed'\n" })).toEqual([
      'wrong-direction',
    ])
    expect(rulesOf({ 'src/domain/planted.ts': "import copy from '../../content/copy.en.yaml'\n" })).toEqual([
      'wrong-direction',
    ])
  })

  it('allows imports to the same layer or to the left', () => {
    expect(
      rulesOf({
        'src/app/planted.ts': "import { quoteFor } from '@store/selectors'\nimport { buildSeed } from '@sim/seed'\n",
        'src/sim/planted.ts':
          "import type { Content } from '@content/schema'\nimport { quoteFee } from '../domain/fees'\n",
        'src/store/planted.ts': "import { quoteFee } from '@domain/fees'\nimport { createClock } from '@sim/clock'\n",
      }),
    ).toEqual([])
  })

  it('fails a package import in the domain layer, and allows it elsewhere', () => {
    expect(rulesOf({ 'src/domain/planted.ts': "import { z } from 'zod'\n" })).toEqual(['domain-package'])
    expect(rulesOf({ 'src/content/planted.ts': "import { z } from 'zod'\n" })).toEqual([])
  })

  it('fails Date, Math.random and the DOM in the domain layer, but not in comments or strings', () => {
    expect(rulesOf({ 'src/domain/planted.ts': 'export const now = () => Date.now()\n' })).toEqual(['domain-global'])
    expect(rulesOf({ 'src/domain/planted.ts': 'export const r = Math.random()\n' })).toEqual(['domain-global'])
    expect(rulesOf({ 'src/domain/planted.ts': 'export const w = document.title\n' })).toEqual(['domain-global'])
    expect(
      rulesOf({
        'src/domain/planted.ts':
          "// Never uses Date or Math.random.\n/* window */\nexport const s = 'Date and document'\nexport const o = { a: 1 }.a\n",
      }),
    ).toEqual([])
    expect(rulesOf({ 'src/sim/planted.ts': 'export const now = () => Date.now()\n' })).toEqual([])
  })

  it('fails unresolved aliases and files outside every layer', () => {
    expect(rulesOf({ 'src/sim/planted.ts': "import { x } from '@domain/nope'\n" })).toEqual(['unresolved'])
    expect(rulesOf({ 'src/misc.ts': 'export {}\n' })).toEqual(['unlayered'])
  })

  it('ignores imports inside comments, strings and regular expressions', () => {
    const text = [
      "// import { a } from '@app/copy'",
      'const s = "import { b } from \'@app/copy\'"',
      "const r = /'/g",
      "import { quoteFee } from '../domain/fees'",
    ].join('\n')
    expect(extractImports(text)).toEqual([{ spec: '../domain/fees', line: 4 }])
  })
})

describe('check-layers CLI', () => {
  const script = fileURLToPath(new URL('../../scripts/check-layers.ts', import.meta.url))
  let dir = ''

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  function tree(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), 'check-layers-'))
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    return dir
  }

  function run(cwd: string): { code: number; out: string } {
    try {
      const out = execFileSync(process.execPath, [script], { cwd, encoding: 'utf8', stdio: 'pipe' })
      return { code: 0, out }
    } catch (e) {
      const err = e as { status?: number; stderr?: string }
      return { code: err.status ?? -1, out: err.stderr ?? '' }
    }
  }

  const base = {
    'tsconfig.json': tsconfigText,
    'src/domain/money.ts': 'export const one = 100\n',
    'src/store/node.ts': "import { one } from '@domain/money'\nexport const n = one\n",
  }

  it('exits 0 on a clean tree', () => {
    expect(run(tree(base)).code).toBe(0)
  })

  it('exits 1 on a planted wrong-direction import, naming the file and line', () => {
    const r = run(tree({ ...base, 'src/domain/fees.ts': "export {}\nimport { n } from '../store/node'\n" }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('src/domain/fees.ts:2')
    expect(r.out).toContain('wrong-direction')
  })
})
