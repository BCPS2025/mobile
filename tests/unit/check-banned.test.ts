// Meta-test of the banned-terms check: the rules must pass clean copy and the approved sentences,
// and must fail planted problems. Runs the rule engine in memory and the CLI on a temporary tree.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { maskEmail } from '@app/format'
import { checkInputs, isTextFile, type Input, type InputKind } from '../../scripts/banned-core'
import { content } from './helpers'

const SAVE_INVEST =
  'BCPS plans to let users access savings and investment products through licensed partners. ' +
  'BCPS does not pay interest on balances. Not an offer or advice.'

const CLEAN_COPY = `app:
  title: BCPS
start:
  overline: BLOCKCHAIN PAYMENT SYSTEM
  headline: See a payment settle in seconds.
rate:
  chip: "€1 ≈ 1.10 BCPS · BCPS is not pegged (i)"
  info: BCPS is not pegged to the euro. Its value is designed to be supported by a reserve fund.
planned:
  saveInvest: Save & invest via licensed partners
  saveInvestBody: "${SAVE_INVEST}"
studio:
  revenue: Today's revenue
`

const copy = (text: string): Input => ({ path: 'content/copy.en.yaml', text, kind: 'content' })
const md = (text: string): Input => ({ path: 'README.md', text, kind: 'markdown' })
const src = (text: string): Input => ({ path: 'src/app/x.ts', text, kind: 'source' })
const visible = (text: string): Input => ({ path: 'visible.txt', text, kind: 'visible' })

const rulesOf = (inputs: Input[]) => checkInputs(inputs).map((f) => f.rule)

describe('check-banned rules', () => {
  it('passes a clean tree', () => {
    const inputs: Input[] = [
      copy(CLEAN_COPY),
      { path: 'content/config.yaml', text: '# Integers only.\nrate: { bcps: 11, eur: 10 }\n', kind: 'content' },
      { path: 'content/seed.yaml', text: 'rows:\n  - memo: 41 payments\n', kind: 'content' },
      md('# BCPS\n\nFees round half-up to the cent.\n'),
      src('export const x = "Settled · seconds to finality"\n'),
    ]
    expect(checkInputs(inputs)).toEqual([])
  })

  it('passes the two approved Save & invest sentences in every scanned input kind', () => {
    expect(checkInputs([copy(`body: "${SAVE_INVEST}"\n`), md(SAVE_INVEST), visible(SAVE_INVEST)])).toEqual([])
    // A leading "After launch, " and a folded YAML line still match the approved sentence.
    const folded = `body: >\n  After launch, BCPS plans to let users access savings and\n  investment products through licensed partners.\n`
    expect(checkInputs([copy(folded)])).toEqual([])
  })

  it('fails a planted "APY"', () => {
    expect(rulesOf([copy('rate: 4% APY\n')])).toContain('word')
  })

  it('fails "yield" and "ICO" (case-sensitive), not "ico"', () => {
    expect(rulesOf([md('Stable yield.')])).toContain('word')
    expect(rulesOf([md('No ICO.')])).toContain('word')
    expect(rulesOf([md('An icon.')])).toEqual([])
  })

  it('fails an email address, in content, markdown and source files', () => {
    expect(rulesOf([copy('help: write to someone@gmail.com\n')])).toContain('email')
    expect(rulesOf([md('Contact: someone@gmail.com')])).toContain('email')
    expect(rulesOf([src('const a = "someone@gmail.com"')])).toContain('email')
  })

  it('exempts reserved email domains only (D19)', () => {
    const personas = (email: string): Input => ({
      path: 'content/personas.yaml',
      text: `personas:\n  - login: { email: ${email}, code: "482916" }\n`,
      kind: 'content',
    })
    for (const ok of ['ana.novak@example.com', 'hello@cafelipa.example', 'x@example.org', 'y@example.net']) {
      expect(rulesOf([personas(ok)])).toEqual([])
    }
    for (const bad of ['someone@gmail.com', 'x@bcps.si', 'a@example.co', 'b@example.com.evil.si']) {
      expect(rulesOf([personas(bad)])).toContain('email')
    }
  })

  it('YAML comments get the visible-copy rule (public-repo hygiene)', () => {
    const config = (text: string): Input => ({ path: 'content/config.yaml', text, kind: 'content' })
    expect(rulesOf([config('# simulated rate\nrate: { bcps: 11, eur: 10 }\n')])).toEqual(['visible-copy'])
    expect(rulesOf([config('rate: { bcps: 11, eur: 10 } # an illustrative figure\n')])).toEqual(['visible-copy'])
    // A "#" inside a quoted value is not a comment; keys and values of config are not visible.
    expect(rulesOf([config('a: "#demo tag"\nb: demo\n')])).toEqual([])
    expect(rulesOf([config('# Reference rate, held fixed.\nrate: { bcps: 11, eur: 10 }\n')])).toEqual([])
    // A quote inside a plain scalar opens nothing: the comment after it is still scanned.
    expect(rulesOf([config("note: rock 'n roll # simulated rate\n")])).toEqual(['visible-copy'])
    expect(rulesOf([config("era: the '90s # demo values\n")])).toEqual(['visible-copy'])
    expect(rulesOf([config("note: rock 'n roll # a fixed rate\n")])).toEqual([])
  })

  it('package.json: the name, description and script names get the visible-copy rule', () => {
    const pkg = (o: object): Input => ({ path: 'package.json', text: JSON.stringify(o, null, 2), kind: 'package' })
    expect(rulesOf([pkg({ name: 'bcps-preview' })])).toEqual(['visible-copy'])
    expect(rulesOf([pkg({ name: 'bcps', scripts: { preview: 'vite preview' } })])).toEqual(['visible-copy'])
    expect(rulesOf([pkg({ name: 'bcps', description: 'A demo app' })])).toEqual(['visible-copy'])
    // Script bodies are commands, not names.
    expect(rulesOf([pkg({ name: 'bcps', scripts: { serve: 'vite preview' } })])).toEqual([])
    expect(checkInputs([pkg({ name: 'bcps', scripts: { serve: 'x', preview: 'y' } })])[0]?.line).toBe(5)
  })

  it('fails "interest" or "investment" in any other sentence', () => {
    expect(rulesOf([copy('x: Earn interest on your balance.\n')])).toContain('word')
    expect(rulesOf([copy('x: A smart investment.\n')])).toContain('word')
    // The approved sentence does not shield the same word elsewhere in the same file.
    expect(rulesOf([copy(`a: "${SAVE_INVEST}"\nb: No interest fees.\n`)])).toEqual(['word'])
    // A near-miss of the approved sentence is not allowlisted.
    expect(rulesOf([copy('a: BCPS will pay interest on balances.\n')])).toContain('word')
  })

  it('fails source references in content and markdown', () => {
    expect(rulesOf([md(`As the ${'found'}er said.`)])).toContain('source-reference')
    expect(rulesOf([md(`See ${'me'}mo § 4.`)])).toContain('source-reference')
    // Generic words stay allowed.
    expect(rulesOf([md('Fees round half-up. Today’s revenue.'), copy('rows:\n  - memo: Coffee\n')])).toEqual([])
  })

  it('fails pattern classes (phone, magnitudes, months in copy)', () => {
    expect(rulesOf([src('const p = "+386 40 123 456"')])).toContain('phone')
    expect(rulesOf([md('A €5M plan.')])).toContain('magnitude')
    expect(rulesOf([md('Up to ~3% cheaper.')])).toContain('magnitude')
    expect(rulesOf([md('Now 20,000 users.')])).toContain('magnitude')
    expect(rulesOf([copy('x: Live in 6 months.\n')])).toContain('months')
  })

  it('applies word rules to src/** never (pattern classes only)', () => {
    expect(rulesOf([src('const interest = 1 // yield')])).toEqual([])
  })

  it('fails the D16 visible-copy words', () => {
    for (const bad of [
      'BCPS Simulator',
      'simulators',
      'Simulation',
      'simulated time',
      'Simulate a sale',
      'Demo',
      'Sample data',
      'illustrative pricing',
      'Interactive product preview',
      'Design target',
      'test data',
    ]) {
      expect(rulesOf([copy(`x: "${bad}"\n`)]), bad).toContain('visible-copy')
      expect(rulesOf([visible(bad)]), bad).toContain('visible-copy')
    }
  })

  it('keeps the visible-copy rule off YAML keys and the values of files that are not shown', () => {
    const config = 'mode:\n  simulated: off\nlabel: demo-convention\n'
    expect(checkInputs([{ path: 'content/config.yaml', text: config, kind: 'content' }])).toEqual([])
    const catalogue = 'products:\n  cafe:\n    - { sku: flat-white, name: Flat white }\n'
    expect(checkInputs([{ path: 'content/catalogue.yaml', text: catalogue, kind: 'content' }])).toEqual([])
    const planted = catalogue.replace('name: Flat white', 'name: Demo flat white')
    expect(rulesOf([{ path: 'content/catalogue.yaml', text: planted, kind: 'content' }])).toEqual(['visible-copy'])
    expect(rulesOf([copy('simulated: Time moves on\n')])).toEqual([])
  })

  it('reports the line of each finding', () => {
    const [f] = checkInputs([copy('a: fine\nb: fine\nc: 5% APY\n')])
    expect(f?.line).toBe(3)
  })
})

describe('check-banned additions', () => {
  const NEW_WORDS = [
    'Samples',
    'Placeholders',
    'Prototypes',
    'prototyping',
    'Fakes',
    'faked',
    'Mocks',
    'mocking',
    'Sandboxes',
    'dummies',
    'pretending',
    'Fictional',
    'fictitious',
    'sample',
    'Prototype',
    'mock',
    'mocked',
    'mockup',
    'mock-up',
    'mockups',
    'fake',
    'Dummy',
    'placeholder',
    'sandbox',
    'not real',
    'Not  real',
    'pretend',
  ]
  const state = (fields: { label?: string; note?: string; reason?: string }): Input => ({
    path: 'content/states/busy-day.json',
    kind: 'state',
    text: JSON.stringify({
      format: 'bcps-state',
      label: fields.label ?? 'Busy day',
      log: [
        {
          at: { day: 0, time: '12:16:00.000' },
          actor: 'ana',
          cmdId: '0000000000000001:review',
          cmd: {
            type: 'pay',
            to: '@cafelipa',
            amount: '1.10',
            channel: 'qr',
            note: fields.note ?? 'Lunch',
            expect: { senderDebit: '1.10' },
          },
          ...(fields.reason ? { reason: fields.reason } : {}),
        },
      ],
    }),
  })

  it('each new word fails in copy, in rendered text and in a state-file note', () => {
    for (const w of [...NEW_WORDS, 'test', 'Tests']) {
      expect(rulesOf([copy(`x: "A ${w} store"\n`)]), w).toContain('visible-copy')
      expect(rulesOf([visible(`A ${w} store`)]), w).toContain('visible-copy')
      expect(rulesOf([state({ note: `${w} note` })]), w).toContain('visible-copy')
    }
  })

  it('state files: the label, notes and reasons are visible; ids, handles and keys are not', () => {
    expect(rulesOf([state({})])).toEqual([])
    expect(rulesOf([state({ label: 'Demo day' })])).toEqual(['visible-copy'])
    expect(rulesOf([state({ reason: 'Goods damaged in a test' })])).toEqual(['visible-copy'])
    const ids: Input = { ...state({}), text: state({}).text.replace('0000000000000001:review', 'sample:review') }
    expect(rulesOf([ids])).toEqual([])
    expect(rulesOf([{ ...state({}), text: '{' }])).toEqual(['unreadable'])
  })

  it('"test" and "tests" pass in Markdown, YAML comments, package scripts and ADR titles', () => {
    expect(
      checkInputs([
        {
          path: 'CONTRIBUTING.md',
          text: 'Run the tests before a pull request. One test per rule.\n',
          kind: 'markdown',
        },
      ]),
    ).toEqual([])
    expect(
      checkInputs([{ path: 'content/config.yaml', text: '# covered by the unit tests\nrate: 1\n', kind: 'content' }]),
    ).toEqual([])
    const pkg: Input = {
      path: 'package.json',
      kind: 'package',
      text: JSON.stringify({ name: 'bcps', scripts: { 'test:unit': 'vitest run', 'test:e2e': 'playwright test' } }),
    }
    expect(checkInputs([pkg])).toEqual([])
    expect(
      checkInputs([{ path: 'docs/adr/0007-test-layout.md', text: '# ADR-0007: Test layout\n', kind: 'markdown' }]),
    ).toEqual([])
  })

  it('the new words fail in Markdown, YAML comments, package.json and ADR titles (hygiene)', () => {
    expect(rulesOf([md('The people are fictional.')])).toEqual(['visible-copy'])
    expect(rulesOf([{ path: 'content/config.yaml', text: '# simulated rate\nrate: 1\n', kind: 'content' }])).toEqual([
      'visible-copy',
    ])
    expect(rulesOf([{ path: 'content/seed.yaml', text: '# sample rows\nrows: []\n', kind: 'content' }])).toEqual([
      'visible-copy',
    ])
    const pkg = (o: object): Input => ({ path: 'package.json', text: JSON.stringify(o), kind: 'package' })
    expect(rulesOf([pkg({ name: 'bcps-preview' })])).toEqual(['visible-copy'])
    expect(rulesOf([pkg({ name: 'bcps', scripts: { 'make-fake-states': 'x' } })])).toEqual(['visible-copy'])
    const adr = (path: string, title: string): Input => ({ path, text: `# ${title}\n\nBody.\n`, kind: 'markdown' })
    expect(rulesOf([adr('docs/adr/0004-free-click-app.md', 'ADR-0004: Free-click app')])).toEqual([])
    expect(rulesOf([adr('docs/adr/0004-prototype-scope.md', 'ADR-0004: Scope')])).toEqual(['visible-copy'])
    expect(rulesOf([adr('docs/adr/0004-scope.md', 'ADR-0004: Mock-up scope')])).toEqual(['visible-copy'])
  })

  it('sys:offstage passes; the old sys:sample id fails in seed.yaml values', () => {
    const seed = (id: string): Input => ({
      path: 'content/seed.yaml',
      text: `rows:\n  - { from: "${id}", to: cafe }\n`,
      kind: 'content',
    })
    expect(rulesOf([seed('sys:offstage')])).toEqual([])
    expect(rulesOf([seed('sys:sample')])).toEqual(['visible-copy'])
  })

  it('a planted "Fictional store" in catalogue.yaml fails', () => {
    const catalogue = 'products:\n  cafe:\n    - { sku: flat-white, name: Fictional store }\n'
    expect(rulesOf([{ path: 'content/catalogue.yaml', text: catalogue, kind: 'content' }])).toEqual(['visible-copy'])
  })

  it('the built manifest: a name "BCPS Demo" fails, "BCPS" passes', () => {
    const manifest = (o: object): Input => ({
      path: 'dist/manifest.webmanifest',
      text: JSON.stringify(o),
      kind: 'manifest',
    })
    expect(
      rulesOf([manifest({ name: 'BCPS', short_name: 'BCPS', description: 'Pay and get paid in seconds.' })]),
    ).toEqual([])
    expect(rulesOf([manifest({ name: 'BCPS Demo', short_name: 'BCPS' })])).toEqual(['visible-copy'])
    expect(rulesOf([manifest({ name: 'BCPS', description: 'A sandbox wallet' })])).toEqual(['visible-copy'])
    // Other fields (colours, paths) are not text.
    expect(rulesOf([manifest({ name: 'BCPS', start_url: './test/' })])).toEqual([])
  })

  it('index.html: the title and meta description; public/reset.html: text and visible attributes', () => {
    const head = (title: string, description = 'Pay and get paid in seconds.'): Input => ({
      path: 'index.html',
      kind: 'html-head',
      text: `<html><head><title>${title}</title><meta name="description" content="${description}" /></head><body><script src="/test.js"></script></body></html>`,
    })
    expect(rulesOf([head('BCPS')])).toEqual([])
    expect(rulesOf([head('BCPS Preview')])).toEqual(['visible-copy'])
    expect(rulesOf([head('BCPS', 'A test build')])).toEqual(['visible-copy'])
    const page = (body: string): Input => ({
      path: 'public/reset.html',
      kind: 'html',
      text: `<html><head><title>Reset BCPS</title></head><body>${body}</body></html>`,
    })
    expect(
      rulesOf([
        page('<!-- tests/unit checks the hash --><p>Removing the offline copy…</p><script>/* demo */</script>'),
      ]),
    ).toEqual([])
    expect(rulesOf([page('<p>Resetting the demo…</p>')])).toEqual(['visible-copy'])
    expect(rulesOf([page('<button aria-label="Demo reset">Reset</button>')])).toEqual(['visible-copy'])
    expect(rulesOf([page('<img alt="Sample card" src="a.png">')])).toEqual(['visible-copy'])
    expect(rulesOf([page('<input placeholder="Test amount">')])).toEqual(['visible-copy'])
  })

  it('emails: reserved domains pass in content, any readable address fails on screen (D24)', () => {
    const personas = (email: string): Input => ({
      path: 'content/personas.yaml',
      text: `personas:\n  - login: { email: ${email} }\n`,
      kind: 'content',
    })
    for (const ok of ['ana.novak@example.com', 'hello@cafelipa.example']) expect(rulesOf([personas(ok)])).toEqual([])
    for (const bad of ['someone@gmail.com', 'x@bcps.si', 'a@example.co'])
      expect(rulesOf([personas(bad)])).toContain('email')
    const kinds: InputKind[] = ['visible', 'html']
    for (const kind of kinds) {
      const text = kind === 'html' ? '<p>Sent to ana.novak@example.com</p>' : 'Sent to ana.novak@example.com'
      expect(rulesOf([{ path: 'x', text, kind }])).toContain('email')
    }
    expect(rulesOf([visible('Sent to hello@cafelipa.example')])).toContain('email')
    expect(rulesOf([visible('Sent to ana.novak@•••••••')])).toEqual([])
    expect(rulesOf([visible('Sent to ana.n•••@•••••••')])).toEqual([])
    // The mask must hide the domain: a hidden local part with a readable domain fails.
    for (const bad of ['Code sent to a•••@example.com', 'Code sent to ana…@gmail.com', 'Sent to @bcps.si'])
      expect(rulesOf([visible(bad)]), bad).toContain('email')
    expect(
      rulesOf([{ path: 'public/reset.html', text: '<p>Code sent to a•••@example.com</p>', kind: 'html' }]),
    ).toContain('email')
    // Handles are not addresses.
    expect(rulesOf([visible('Pay @cafelipa. Done.')])).toEqual([])
  })

  it('emails: the reserved-domain exemption covers the masked login emails only', () => {
    // Shown verbatim, so no exemption: copy, seed notes, state-file fields.
    expect(rulesOf([copy('sent: "Code sent to ana.novak@example.com"\n')])).toContain('email')
    const seed: Input = {
      path: 'content/seed.yaml',
      text: 'rows:\n  - note: Invoice to billing@kovinanova.example\n',
      kind: 'content',
    }
    expect(rulesOf([seed])).toContain('email')
    const stateFile: Input = {
      path: 'content/states/busy-day.json',
      kind: 'state',
      text: JSON.stringify({ label: 'Busy day', log: [{ cmd: { note: 'Receipt to ana.novak@example.com' } }] }),
    }
    expect(rulesOf([stateFile])).toContain('email')
    // In personas.yaml only the login email values: a reserved address elsewhere there fails.
    const personas: Input = {
      path: 'content/personas.yaml',
      text: 'personas:\n  - login: { email: ana.novak@example.com }\n    displayName: ana@example.com\n',
      kind: 'content',
    }
    expect(checkInputs([personas]).map((f) => [f.rule, f.line])).toEqual([['email', 3]])
    // Markdown and code are never rendered: reserved domains pass there.
    expect(rulesOf([md('Logins use ana.novak@example.com.')])).toEqual([])
    expect(rulesOf([src('const e = "ana.novak@example.com"')])).toEqual([])
  })

  it('every login email, masked as the screens show it, passes the rendered-text rules', () => {
    const emails = content.personas.personas.flatMap((p) => (p.login ? [p.login.email] : []))
    expect(emails.length).toBeGreaterThan(0)
    for (const email of emails) {
      expect(rulesOf([visible(email)]), email).toContain('email')
      const shown = maskEmail(email)
      expect(shown.endsWith('@•••••••')).toBe(true)
      expect(shown.startsWith(email.slice(0, email.indexOf('@')))).toBe(true)
      expect(rulesOf([visible(`Sent to ${shown}`)]), shown).toEqual([])
    }
  })
})

describe('check-banned CLI', () => {
  const script = fileURLToPath(new URL('../../scripts/check-banned.ts', import.meta.url))
  let dir = ''

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  function tree(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), 'check-banned-'))
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    return dir
  }

  function run(cwd: string, args: string[] = []): { code: number; out: string } {
    try {
      const out = execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' })
      return { code: 0, out }
    } catch (e) {
      const err = e as { status?: number; stderr?: string }
      return { code: err.status ?? -1, out: err.stderr ?? '' }
    }
  }

  const base = {
    'content/copy.en.yaml': CLEAN_COPY,
    'src/main.ts': 'export {}\n',
    'README.md': '# BCPS\n',
    'docs/adr/0001-stack.md': '# Stack\n',
  }

  it('exits 0 on a clean tree', () => {
    expect(run(tree(base)).code).toBe(0)
  })

  it('exits 1 on a planted APY in an ADR, naming the file and line', () => {
    const r = run(tree({ ...base, 'docs/adr/0001-stack.md': '# Stack\n\nSee APY.\n' }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('docs/adr/0001-stack.md:3')
  })

  it('exits 1 on an email address under src/', () => {
    expect(run(tree({ ...base, 'src/x.ts': 'const a = "someone@gmail.com"\n' })).code).toBe(1)
  })

  it('skips binary assets under src/ and still scans text files there', () => {
    // Bytes that read as an email address and are not valid UTF-8, like the inside of an image.
    const bytes = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0xff,
      0xfe,
      ...new TextEncoder().encode(' someone@gmail.com '),
    ])
    const cwd = tree({ ...base })
    mkdirSync(join(cwd, 'src/assets/brand'), { recursive: true })
    for (const name of ['emblem-900.png', 'emblem-900.webp', 'icon.ico']) {
      writeFileSync(join(cwd, 'src/assets/brand', name), bytes)
    }
    expect(run(cwd).code).toBe(0)
    writeFileSync(join(cwd, 'src/assets/brand/notes.ts'), 'const a = "someone@gmail.com"\n')
    expect(run(cwd).code).toBe(1)
  })

  it('classifies files by extension: text kinds are scanned, images and other binaries are not', () => {
    for (const p of [
      'src/app/App.tsx',
      'src/a.ts',
      'src/app/tokens.css',
      'src/x.json',
      'src/x.yaml',
      'src/x.md',
      'src/a.html',
      'src/assets/logo.svg',
      'src/A.TS',
    ]) {
      expect(isTextFile(p), p).toBe(true)
    }
    for (const p of [
      'src/assets/brand/emblem-900.png',
      'src/assets/brand/emblem-900.webp',
      'src/x.jpg',
      'src/x.woff2',
      'src/noext',
      'src/dir.d/noext',
    ]) {
      expect(isTextFile(p), p).toBe(false)
    }
  })

  it('scans collected visible text passed with --visible', () => {
    const cwd = tree({ ...base, 'visible.txt': 'Settled · simulated\n' })
    expect(run(cwd, ['--visible', 'visible.txt']).code).toBe(1)
  })

  it('scans a built manifest passed with --manifest, and fails when it is missing', () => {
    const cwd = tree({ ...base, 'dist/manifest.webmanifest': '{"name":"BCPS Demo","short_name":"BCPS"}' })
    const r = run(cwd, ['--manifest', 'dist/manifest.webmanifest'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('dist/manifest.webmanifest')
    expect(run(cwd, ['--manifest', 'dist/nothing.webmanifest']).code).toBe(2)
  })

  it('scans content/states/*.json, index.html and public/*.html', () => {
    expect(run(tree({ ...base, 'content/states/a.json': '{"label":"Sample day","log":[]}' })).code).toBe(1)
    rmSync(dir, { recursive: true, force: true })
    expect(run(tree({ ...base, 'index.html': '<title>BCPS Demo</title>' })).code).toBe(1)
    rmSync(dir, { recursive: true, force: true })
    expect(run(tree({ ...base, 'public/reset.html': '<p>Reset the sandbox</p>' })).code).toBe(1)
    rmSync(dir, { recursive: true, force: true })
    expect(
      run(
        tree({
          ...base,
          'content/states/a.json': '{"label":"Busy day","log":[]}',
          'index.html': '<title>BCPS</title>',
        }),
      ).code,
    ).toBe(0)
  })

  it('fails an ADR whose file name uses a banned word', () => {
    expect(run(tree({ ...base, 'docs/adr/0004-demo-mode.md': '# ADR-0004: Mode\n' })).code).toBe(1)
  })
})

describe('internal plan citations', () => {
  it('fail in Markdown, content and src/**; ADR numbers and decision ids pass', () => {
    expect(rulesOf([md('See plan v3 §2.6.')])).toEqual(['source-reference'])
    expect(rulesOf([copy('# Limits per plan v3.2 §4.7\nx: y\n')])).toEqual(['source-reference'])
    expect(rulesOf([src('// Persistence (plan v3 §2.6).')])).toEqual(['source-reference'])
    expect(rulesOf([md('See ADR-0003 and decision D29.'), src('// Fees per D29 (ADR-0002).')])).toEqual([])
  })
})
