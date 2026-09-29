import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { content } from '@content/load'
import type { ContentProblem, RawContent } from '@content/schema'
import { lineOfPath } from '@content/yaml-lines'
import { validateContent } from '@sim/validate-content'
import catalogue from '../../content/catalogue.yaml'
import config from '../../content/config.yaml'
import copy from '../../content/copy.en.yaml'
import homes from '../../content/homes.yaml'
import personas from '../../content/personas.yaml'
import seed from '../../content/seed.yaml'
import seedText from '../../content/seed.yaml?raw'

// Build-time content validation: schemas, cross-file rules, seed arithmetic.

const raw: RawContent = { config, personas, catalogue, seed, homes, copy }
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
type Obj = Record<string, unknown>

function problemsOf(edit: (r: Record<keyof RawContent, Obj>) => void): ContentProblem[] {
  const r = clone(raw) as Record<keyof RawContent, Obj>
  edit(r)
  const result = validateContent(r)
  return result.ok ? [] : result.problems
}
const messages = (ps: ContentProblem[]) => ps.map((p) => `${p.file} ${p.path.join('.')}: ${p.message}`)

const rows = (r: Record<keyof RawContent, Obj>) => r.seed.rows as Obj[]
const rowIndex = (key: string) => (seed as { rows: { key: string }[] }).rows.findIndex((row) => row.key === key)

describe('the committed content', () => {
  it('passes every check, and the client module is exactly the validated content', () => {
    const r = validateContent(raw)
    expect(r.ok && []).toEqual([])
    expect(r.ok && JSON.parse(JSON.stringify(r.content))).toEqual(JSON.parse(JSON.stringify(content)))
  })

  it('the client never imports zod or the schemas at run time (types only)', () => {
    const files = import.meta.glob(
      [
        '/src/**/*.{ts,tsx}',
        '!/src/content/{schema,copy-schema,check,vite-plugin-content}.ts',
        '!/src/sim/validate-content.ts',
      ],
      {
        query: '?raw',
        import: 'default',
        eager: true,
      },
    ) as Record<string, string>
    expect(Object.keys(files).length).toBeGreaterThan(30)
    const banned = /from\s+'(zod|@content\/(schema|copy-schema|check)|\.\/(schema|copy-schema|check))'/g
    const runtimeImports = (source: string) => {
      const text = `\n${source}`
      return [...text.matchAll(banned)].filter((m) => {
        const start = text.lastIndexOf('\nimport', m.index ?? 0)
        return !/^\nimport\s+type\b/.test(text.slice(start))
      }).length
    }
    for (const [path, text] of Object.entries(files)) expect(`${path}: ${runtimeImports(text)}`).toBe(`${path}: 0`)
  })

  it('scripts/check-content.ts exits 0 on the committed tree', () => {
    const script = fileURLToPath(new URL('../../scripts/check-content.ts', import.meta.url))
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: 'pipe' })
    expect(out).toContain('files valid')
  })
})

describe('schema problems carry a path that resolves to a line', () => {
  it('a grouped amount fails in seed.yaml at the row line', () => {
    const i = rowIndex('cafe-thu-brunch')
    const ps = problemsOf((r) => {
      ;(rows(r)[i] as Obj).amount = '1,026.40'
    })
    expect(ps).toHaveLength(1)
    expect(ps[0]).toMatchObject({ file: 'seed.yaml', path: ['rows', i, 'amount'] })
    const line = lineOfPath(seedText, ps[0]?.path ?? [])
    expect(seedText.split('\n')[line - 1]).toContain('from: ana, to: cafe, amount: "26.40"')
  })

  it('an unknown tile, a duplicate tile, a missing hub and an incomplete complete home fail', () => {
    const unknown = problemsOf((r) => {
      ;((r.homes.consumer as Obj).tiles as Obj[])[0] = { tile: 'lottery', icon: 'star', opens: 'flow' }
    })
    expect(unknown.some((p) => p.file === 'homes.yaml')).toBe(true)
    const dup = problemsOf((r) => {
      const tiles = (r.homes.pos as Obj).tiles as Obj[]
      tiles[3] = { ...tiles[0] }
    })
    expect(messages(dup).join('\n')).toMatch(/duplicate tile charge/)
    const noHub = problemsOf((r) => {
      delete ((r.homes.consumer as Obj).hubs as Obj).wallet
    })
    expect(messages(noHub).join('\n')).toMatch(/wallet is missing/)
    const incomplete = problemsOf((r) => {
      r.homes.complete = true
      ;((r.homes.studio as Obj).tiles as Obj[]).pop()
      delete ((r.homes.studio as Obj).hubs as Obj).money
    })
    expect(messages(incomplete).join('\n')).toMatch(/studio: a complete home has exactly 4 tiles/)
  })

  it('complete: true checks every home against D28: tile order, avatar and every hub row', () => {
    // The committed homes are the D28 homes: complete passes.
    expect(messages(problemsOf((r) => (r.homes.complete = true)))).toEqual([])
    const reordered = problemsOf((r) => {
      r.homes.complete = true
      ;((r.homes.consumer as Obj).tiles as Obj[]).reverse()
    })
    expect(messages(reordered).join('\n')).toMatch(/consumer: tiles must be scan, payRequest, wallet, history/)
    const missingRow = problemsOf((r) => {
      r.homes.complete = true
      ;((r.homes.consumer as Obj).hubs as Obj).wallet = [{ row: 'topup', icon: 'plus' }]
    })
    expect(messages(missingRow).join('\n')).toMatch(/consumer: hubs.wallet is missing row:cashOut, row:myCode/)
    const swapped = problemsOf((r) => {
      r.homes.complete = true
      r.homes.pos = clone(r.homes.consumer)
    })
    expect(messages(swapped).join('\n')).toMatch(/pos: tiles must be charge, sales, pay, cashOut/)
    expect(messages(swapped).join('\n')).toMatch(/pos: the avatar opens settings, not profile/)
    // Without the flag, a home in progress may list fewer rows.
    expect(
      problemsOf((r) => {
        ;((r.homes.consumer as Obj).hubs as Obj).wallet = [{ row: 'topup', icon: 'plus' }]
      }),
    ).toEqual([])
  })

  it('a persona id that is an Object.prototype name fails', () => {
    const ps = problemsOf((r) => {
      ;((r.personas.personas as Obj[])[1] as Obj).id = 'constructor'
    })
    expect(messages(ps).join('\n')).toMatch(/must not be an Object.prototype name/)
  })

  it('an unknown persona in a seed row is caught by the cross-file rules', () => {
    const ps = problemsOf((r) => {
      ;(rows(r)[0] as Obj).to = 'nobody'
    })
    expect(messages(ps).join('\n')).toMatch(/unknown account nobody/)
  })
})

describe('cross-file rules', () => {
  it('handles are unique across personas and the off-stage directory', () => {
    const ps = problemsOf((r) => {
      ;(r.personas.offstage as Obj[])[0] = { handle: '@ana', displayName: 'Ana N.' }
    })
    expect(messages(ps).join('\n')).toMatch(/handle @ana is already used/)
  })

  it('login emails use reserved domains; codes are unique', () => {
    const ps = problemsOf((r) => {
      const list = r.personas.personas as Obj[]
      ;(list[0] as Obj).login = { email: 'ana@gmail.com', code: '731058' }
    })
    const text = messages(ps).join('\n')
    expect(text).toMatch(/reserved domains/)
    expect(text).toMatch(/code 731058 is also/)
  })

  it('seed parties, items, mixes, unread refs and ownership resolve', () => {
    const ps = problemsOf((r) => {
      ;(rows(r)[rowIndex('ana-pizza')] as Obj).party = '@stranger'
      ;(rows(r)[rowIndex('cafe-tue-espresso')] as Obj).items = [{ sku: 'bagel', qty: 1 }]
      ;(r.seed.unread as Obj).ana = ['request:r_missing']
      ;(r.seed.ownership as Obj).marko = ['gem-pack-500']
    })
    const text = messages(ps).join('\n')
    expect(text).toMatch(/unknown off-stage person @stranger/)
    expect(text).toMatch(/cafe has no product bagel/)
    expect(text).toMatch(/request:r_missing does not refer to anything seeded/)
    expect(text).toMatch(/gem-pack-500 is not a one-off product/)
  })

  it('escrow presets add up to 10000; merchants are businesses', () => {
    const ps = problemsOf((r) => {
      const presets = ((r.catalogue.templates as Obj).escrow as Obj).presets as Obj[]
      ;(presets[0] as Obj).milestones = [{ shareBps: 3000, condition: 'shipping-document' }]
      ;(r.config.merchants as Obj).ana = (r.config.merchants as Obj).cafe
    })
    const text = messages(ps).join('\n')
    expect(text).toMatch(/shares add up to 3000/)
    expect(text).toMatch(/ana is not a business persona/)
  })

  it('background patterns keep every slot above its fees (1 % of the slot gross)', () => {
    const ps = problemsOf((r) => {
      ;(((r.config.background as Obj).cafe as Obj).days as Obj)['1'] = { count: 26, gross: '0.03' }
    })
    expect(messages(ps).join('\n')).toMatch(/slot 1 does not cover its fees/)
  })

  it('the fee policies are exactly decision D29', () => {
    const ps = problemsOf((r) => {
      const fees = r.config.fees as Obj
      fees.transfer = { kind: 'flat', flatEurCents: 5, payer: 'sender', cardCompareMinEurCents: null }
      fees['off-ramp'] = { kind: 'percent', rateBps: 100, payer: 'sender' }
      fees.merchant = { kind: 'percent', rateBps: 100, payer: 'sender', cardCompareMinEurCents: 500 }
    })
    const text = messages(ps).join('\n')
    expect(text).toMatch(
      /config.yaml fees.transfer: fee policy transfer is "flat 5 sender null", decision D29 is "percent 100 sender null"/,
    )
    expect(text).toMatch(/fees.off-ramp: .*"percent 100 sender null", decision D29 is "percent 150 sender null"/)
    expect(text).toMatch(/fees.merchant: .*decision D29 is "percent 100 recipient 500"/)
  })

  it.each([
    ['fee', 'feeInfo', 'In-network payments cost a flat ≈ €0.05.'],
    ['fee', 'feeInfo', 'Every payment has a flat fee.'],
    ['fee', 'chip', 'Fee 0.06 BCPS'],
    ['txDetail', 'net', 'Net {net} · fee €0.05'],
  ])('copy with withdrawn fee wording fails: %s.%s "%s"', (section, key, text) => {
    const ps = problemsOf((r) => {
      ;(r.copy[section] as Obj)[key] = text
    })
    expect(ps.some((p) => p.file === 'copy.en.yaml' && p.path.join('.') === `${section}.${key}`)).toBe(true)
  })

  it('a literal fee figure in a catalogue name fails; the D29 percentages pass', () => {
    const ps = problemsOf((r) => {
      const cafe = (r.catalogue.products as Obj).cafe as Obj[]
      ;(cafe[0] as Obj).name = 'Flat white · fee 0.06'
    })
    expect(messages(ps).join('\n')).toMatch(/catalogue.yaml products.cafe.0.name: a literal fee or money figure/)
    const text = (content.copy.fee as Record<string, string>).chipShort ?? ''
    expect(text).toBe('Fee 1% · {fee} (≈ €{eur}) · {payer}')
  })
})

describe('seed arithmetic', () => {
  it('a fee that is not the policy fee names the row', () => {
    const i = rowIndex('taxi-share')
    const ps = problemsOf((r) => {
      ;(rows(r)[i] as Obj).fee = '0.07'
    })
    expect(ps[0]).toMatchObject({ file: 'seed.yaml', path: ['rows', i] })
    expect(ps[0]?.message).toMatch(/fee 0.07 is not the policy fee/)
  })

  it('a changed row changes a start balance, which fails against the table', () => {
    const ps = problemsOf((r) => {
      const row = rows(r)[rowIndex('ana-topup-card')] as Obj
      row.amount = '121.00'
      row.eur = '110.00'
    })
    expect(messages(ps).join('\n')).toMatch(/ana starts at 258.50, expected 247.50/)
  })

  it('a summary whose gross is not Σ mix × price fails', () => {
    const ps = problemsOf((r) => {
      ;((rows(r)[rowIndex('studio-sat')] as Obj).summary as Obj).gross = '150.80'
    })
    expect(messages(ps).join('\n')).toMatch(/gross is not Σ mix × price/)
  })

  it('a row that would take a balance below zero in chronological order fails', () => {
    const ps = problemsOf((r) => {
      ;(rows(r)[rowIndex('cafe-cashout-wed')] as Obj).at = { day: -6, time: '06:00' }
    })
    expect(messages(ps).join('\n')).toMatch(/cafe goes below zero/)
  })
})
