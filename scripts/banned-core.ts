// Rule engine of the banned-terms check (scripts/check-banned.ts). Pure: no file system, so the
// unit meta-test (tests/unit/check-banned.test.ts) runs it on in-memory fixtures.
// Runs under plain Node type stripping: erasable TypeScript only, `import type` for types.
import { Parser, isPair, isScalar, parseDocument, visit } from 'yaml'

/**
 * - content: a content/*.yaml file (word, source-reference and pattern rules; the visible-copy
 *   rule on string values of the files in VISIBLE_YAML);
 * - markdown: a tracked *.md file (word, source-reference, pattern and visible-copy rules);
 * - source: a file under src/ (pattern classes only: emails, phone numbers, magnitudes);
 * - visible: text collected from the rendered pages (every rule);
 * - package: package.json (the visible-copy rule on the name, description and script names);
 * - state: a content/states/*.json file (every rule on the visible fields: label, note, reason);
 * - manifest: the built manifest.webmanifest (every rule on name, short_name, description);
 * - html-head: index.html (every rule on the <title> and the meta description);
 * - html: a static page such as public/reset.html (every rule on its text and the placeholder,
 *   aria-label, title and alt attributes; markup and comments are not text).
 * YAML comments in content files, package.json and ADR titles (docs/adr: the file name and the
 * first heading) get the visible-copy rule too (public-repo hygiene). The words "test" and
 * "tests" are banned only where a visitor reads them, not in Markdown, comments, package
 * script names or ADR titles (CONTRIBUTING must be able to say "tests").
 */
export type InputKind =
  | 'content'
  | 'markdown'
  | 'source'
  | 'visible'
  | 'package'
  | 'state'
  | 'manifest'
  | 'html-head'
  | 'html'

export interface Input {
  path: string
  text: string
  kind: InputKind
}

export interface Finding {
  path: string
  line: number
  rule: string
  match: string
}

interface Rule {
  name: string
  re: RegExp
}

/** Word rule: whole words, case-insensitive, spaces inside a phrase match any whitespace. */
const word = (name: string, term: string, flags = 'gi'): Rule => ({
  name,
  re: new RegExp(`\\b${escapeRe(term).replace(/ /g, '\\s+')}\\b`, flags),
})

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Joins fragments, so this file does not itself spell out the terms it bans. */
const j = (...parts: string[]) => parts.join('')

/** Guardrail words (claims and wording). "ICO" is case-sensitive. */
const WORD_RULES: Rule[] = [
  word('word', 'pre-seed'),
  word('word', 'use of funds'),
  word('word', 'allocation'),
  word('word', 'ICO', 'g'),
  word('word', 'presale'),
  word('word', 'yield'),
  word('word', 'APY'),
  word('word', 'returns'),
  word('word', 'interest'),
  word('word', 'earn'),
  word('word', j('invest', 'or')),
  word('word', j('invest', 'ors')),
  word('word', 'investment'),
  word('word', 'anonymous'),
  word('word', 'untraceable'),
  word('word', 'guaranteed'),
  word('word', 'secured'),
  word('word', 'insured'),
  word('word', 'stablecoin'),
  word('word', 'pegged'),
  word('word', 'MiCA-compliant'),
  word('word', 'licensed'),
  word('word', 'bank letter'),
  word('word', 'banking-grade'),
]

/** Pointers to private reference material; never published. */
const SOURCE_RULES: Rule[] = [
  word('source-reference', j('one', '-', 'pager')),
  word('source-reference', j('one', '-', 'pagers')),
  word('source-reference', j('found', 'er')),
  word('source-reference', j('found', 'ers')),
  word('source-reference', j('fund', 'ing round')),
  word('source-reference', j('seed', ' round')),
  word('source-reference', j('revenue proj', 'ection')),
  word('source-reference', j('revenue proj', 'ections')),
  word('source-reference', j('revenue ta', 'ble')),
  { name: 'source-reference', re: new RegExp(`\\b${j('me', 'mo')}\\s*§`, 'gi') },
]

/** Citations of the internal, unpublished plan (the word "plan", then a version); also applied to src/**. */
const PLAN_RULE: Rule = { name: 'source-reference', re: /\bplan\s+v\d/gi }

/** Pattern classes, also applied to src/**. */
const EMAIL: Rule = { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g }
/**
 * In rendered text the mask must hide the domain (D24, "ana.novak@•••••••"): any readable domain
 * after an @ fails, whatever stands before it ("a•••@example.com", "ana…@gmail.com").
 */
const RENDERED_EMAIL: Rule = { name: 'email', re: /[A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g }
const PATTERN_RULES: Rule[] = [
  EMAIL,
  { name: 'phone', re: /\+\d{2,3}[\s\d()]{6,}/g },
  { name: 'magnitude', re: /[€$]\s?\d+(\.\d+)?\s?[KMBT]\b/g },
  { name: 'magnitude', re: /~\d+%/g },
  { name: 'magnitude', re: /\b\d{2,3},000\s+users\b/gi },
]

/** Durations in months are never written in copy. */
const MONTHS_RULE: Rule = { name: 'months', re: /\b\d+\s?months?\b/gi }

/**
 * Visible-copy rules (decision D16), with plural and inflected forms.
 * Applied to visible text, to string values of the YAML files in VISIBLE_YAML, and to *.md.
 */
const VISIBLE_RULES: Rule[] = [
  { name: 'visible-copy', re: /\bsimulat\w*/gi },
  { name: 'visible-copy', re: /\bdemos?\b/gi },
  { name: 'visible-copy', re: /\bsamples?\b/gi },
  { name: 'visible-copy', re: /\billustrative\b/gi },
  { name: 'visible-copy', re: /\bpreviews?\b/gi },
  { name: 'visible-copy', re: /\bdesign\s+targets?\b/gi },
  { name: 'visible-copy', re: /\btest\s+data\b/gi },
  { name: 'visible-copy', re: /\bfictional\b/gi },
  { name: 'visible-copy', re: /\bfictitious\b/gi },
  { name: 'visible-copy', re: /\bprototyp\w*/gi },
  { name: 'visible-copy', re: /\bmock(?:s|ed|ing|up|ups)?\b/gi },
  { name: 'visible-copy', re: /\bfak(?:e|es|ed)\b/gi },
  { name: 'visible-copy', re: /\bdumm(?:y|ies)\b/gi },
  { name: 'visible-copy', re: /\bplaceholders?\b/gi },
  { name: 'visible-copy', re: /\bsandbox(?:es|ed)?\b/gi },
  { name: 'visible-copy', re: /\bnot\s+real\b/gi },
  { name: 'visible-copy', re: /\bpretend(?:s|ed|ing)?\b/gi },
]

/** "test" and "tests": banned where a visitor reads them (screens, visible content, the manifest). */
const TEST_RULE: Rule = { name: 'visible-copy', re: /\btests?\b/gi }
const SCREEN_RULES: Rule[] = [...VISIBLE_RULES, TEST_RULE]

/**
 * Content files whose string values are shown on screen, with the mapping keys whose values are
 * shown (null = every string value).
 */
export const VISIBLE_YAML: Readonly<Record<string, readonly string[] | null>> = {
  'content/copy.en.yaml': null,
  'content/seed.yaml': null,
  'content/personas.yaml': null,
  'content/catalogue.yaml': null,
  'content/homes.yaml': null,
  'content/notifications.yaml': null,
  'content/signup.yaml': null,
}

/** The file where durations in months are banned. */
const COPY_FILE = 'content/copy.en.yaml'

/**
 * Approved exact phrases, each tied to a claim or decision. The matched span is blanked before
 * the word rules run, so the same word anywhere else still fails. Case-sensitive; any run of
 * whitespace (for example a folded YAML line) matches a space.
 */
export const ALLOWLIST: readonly string[] = [
  'via licensed partners',
  // Covers "BCPS is not pegged (i)" and "BCPS is not pegged to the euro."
  'BCPS is not pegged',
  'not a peg',
  'Save & invest',
  // Decision D4, Save & invest text (also covers a leading "After launch, ").
  'BCPS plans to let users access savings and investment products through licensed partners.',
  'BCPS does not pay interest on balances.',
]

const ALLOW_RES = ALLOWLIST.map((p) => new RegExp(escapeRe(p).replace(/ /g, '\\s+'), 'g'))

/** Replaces allowlisted spans with spaces (same length, so line numbers stay put). */
export function blankAllowlisted(text: string): string {
  let out = text
  for (const re of ALLOW_RES) out = out.replace(re, (m) => m.replace(/[^\n]/g, ' '))
  return out
}

function lineAt(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/**
 * Reserved domains (RFC 2606): example.com, example.org, example.net and anything ending in
 * .example (decision D19). The login emails in personas.yaml may use them, because the UI masks
 * their domain (D24, "ana.novak@•••••••"); Markdown and code (never rendered) may too. Every other
 * shown string (copy, seed notes, state-file fields) and rendered text get no exemption.
 */
export function isReservedEmail(address: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase()
  return ['example.com', 'example.org', 'example.net'].includes(domain) || domain.endsWith('.example')
}

/** Input kinds that are rendered text: an email address there must be masked (D24). */
const RENDERED: ReadonlySet<InputKind> = new Set<InputKind>(['visible', 'html', 'html-head', 'manifest'])
/** Input kinds that are never shown: reserved-domain addresses are fine there. */
const NOT_SHOWN: ReadonlySet<InputKind> = new Set<InputKind>(['markdown', 'source', 'package'])
/** The masked login emails: values of `email` keys in this file. */
const MASKED_EMAILS_FILE = 'content/personas.yaml'

/** Where a reserved-domain address may stand in an input: [start, end) offsets, or everywhere. */
function reservedEmailSpans(input: Input): 'anywhere' | [number, number][] {
  if (NOT_SHOWN.has(input.kind)) return 'anywhere'
  if (input.kind !== 'content' || input.path !== MASKED_EMAILS_FILE) return []
  return yamlStringValues(input.text, ['email']).map((v) => [v.offset, v.offset + v.value.length + 2])
}

function scan(input: Input, text: string, rules: Rule[], out: Finding[], offsetBase = 0, fullText = text): void {
  let spans: 'anywhere' | [number, number][] | null = null
  const reservedOk = (at: number, address: string): boolean => {
    if (!isReservedEmail(address)) return false
    spans ??= reservedEmailSpans(input)
    return spans === 'anywhere' || spans.some(([a, b]) => at >= a && at < b)
  }
  for (const r of rules) {
    const rule = r === EMAIL && RENDERED.has(input.kind) ? RENDERED_EMAIL : r
    rule.re.lastIndex = 0
    for (const m of text.matchAll(rule.re)) {
      if (rule.name === 'email' && !RENDERED.has(input.kind) && reservedOk(offsetBase + (m.index ?? 0), m[0])) continue
      out.push({
        path: input.path,
        line: lineAt(fullText, offsetBase + (m.index ?? 0)),
        rule: rule.name,
        match: m[0].replace(/\s+/g, ' ').trim(),
      })
    }
  }
}

/**
 * String values (never keys, never comments) of a YAML document, with their offsets. With
 * `onlyKeys`, only values of mappings under those keys (and list items below them).
 */
function yamlStringValues(text: string, onlyKeys: readonly string[] | null): { value: string; offset: number }[] {
  const values: { value: string; offset: number }[] = []
  const doc = parseDocument(text, { schema: 'core' })
  visit(doc, {
    Scalar(key, node, path) {
      if (key === 'key') return
      if (!isScalar(node) || typeof node.value !== 'string') return
      if (onlyKeys) {
        const under = path.some((p) => isPair(p) && isScalar(p.key) && onlyKeys.includes(String(p.key.value)))
        if (!under) return
      }
      values.push({ value: node.value, offset: node.range?.[0] ?? 0 })
    },
  })
  return values
}

/**
 * Comments of a YAML file, with their offsets (after the "#"), taken from the yaml package's own
 * concrete syntax tree, so quotes inside plain scalars ("rock 'n roll", "the '90s") never hide a
 * comment that follows them.
 */
export function yamlComments(text: string): { value: string; offset: number }[] {
  const out: { value: string; offset: number }[] = []
  const seen = new Set<unknown>()
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) {
      for (const x of v) walk(x)
      return
    }
    const t = v as { type?: unknown; offset?: unknown; source?: unknown }
    if (t.type === 'comment' && typeof t.offset === 'number' && typeof t.source === 'string') {
      out.push({ value: t.source.slice(1), offset: t.offset + 1 })
      return
    }
    for (const x of Object.values(v)) walk(x)
  }
  for (const token of new Parser().parse(text)) walk(token)
  return out.sort((a, b) => a.offset - b.offset)
}

/** Name, description and script names of package.json, with their offsets. */
function packageFields(text: string): { value: string; offset: number }[] {
  let pkg: { name?: unknown; description?: unknown; scripts?: unknown }
  try {
    pkg = JSON.parse(text)
  } catch {
    return [{ value: 'package.json is not valid JSON', offset: 0 }]
  }
  const raw: string[] = []
  if (typeof pkg.name === 'string') raw.push(pkg.name)
  if (typeof pkg.description === 'string') raw.push(pkg.description)
  if (pkg.scripts && typeof pkg.scripts === 'object') raw.push(...Object.keys(pkg.scripts))
  // Separators become spaces so "bcps-preview" or "test:preview" match as words.
  return raw.map((r) => ({ value: r.replace(/[-_:]/g, ' '), offset: Math.max(0, text.indexOf(`"${r}"`)) }))
}

/** A value found inside a structured input, with its offset in the input text. */
interface Located {
  value: string
  offset: number
}

const locate = (text: string, value: string, from = 0): number => Math.max(0, text.indexOf(value, from))

/** Visible fields of a state file: its label and every `note` and `reason` string in the log. */
function stateFields(text: string): Located[] | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const out: Located[] = []
  const walk = (v: unknown, key: string | null, top: boolean) => {
    if (typeof v === 'string') {
      if ((top && key === 'label') || key === 'note' || key === 'reason') {
        out.push({ value: v, offset: locate(text, JSON.stringify(v)) })
      }
      return
    }
    if (Array.isArray(v)) for (const x of v) walk(x, key, false)
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, k, top && key === null)
    }
  }
  walk(json, null, true)
  return out
}

/** name, short_name and description of a web app manifest. */
function manifestFields(text: string): Located[] | null {
  let m: Record<string, unknown>
  try {
    m = JSON.parse(text)
  } catch {
    return null
  }
  return ['name', 'short_name', 'description'].flatMap((k) =>
    typeof m[k] === 'string' ? [{ value: m[k] as string, offset: locate(text, JSON.stringify(m[k])) }] : [],
  )
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** <title> and the meta description of an HTML page. */
function htmlHead(text: string): Located[] {
  const out: Located[] = []
  for (const m of text.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)) {
    out.push({ value: decodeEntities(m[1] ?? ''), offset: m.index ?? 0 })
  }
  for (const m of text.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/\bname\s*=\s*["']description["']/i.test(m[0])) continue
    const c = /\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[0])
    if (c) out.push({ value: decodeEntities(c[2] ?? c[3] ?? ''), offset: m.index ?? 0 })
  }
  return out
}

/** Text of an HTML page as a visitor reads it: text nodes plus the visible attributes. */
function htmlText(text: string): Located[] {
  const out: Located[] = [...htmlHead(text)]
  // Comments, scripts and styles are not text; blank them so offsets stay put.
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  const body = text
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, blank)
    .replace(/<title\b[\s\S]*?<\/title>/gi, blank)
  for (const m of body.matchAll(/>([^<]+)</g)) {
    const v = decodeEntities(m[1] ?? '')
    if (v.trim()) out.push({ value: v, offset: (m.index ?? 0) + 1 })
  }
  for (const m of body.matchAll(/\s(placeholder|aria-label|title|alt)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    out.push({ value: decodeEntities(m[3] ?? m[4] ?? ''), offset: m.index ?? 0 })
  }
  return out
}

/** The file name of an ADR, as words (its heading is part of the Markdown scan). */
function adrFileName(path: string): string {
  return path
    .slice(path.lastIndexOf('/') + 1)
    .replace(/\.md$/, '')
    .replace(/[-_]/g, ' ')
}

const isAdr = (path: string) => /(^|\/)docs\/adr\/[^/]+\.md$/.test(path)

/** Runs every rule that applies to each input and returns the findings (empty = pass). */
export function checkInputs(inputs: readonly Input[]): Finding[] {
  const out: Finding[] = []
  for (const input of inputs) {
    const text = input.text
    if (input.kind === 'source') {
      scan(input, text, [...PATTERN_RULES, PLAN_RULE], out)
      continue
    }
    if (input.kind === 'package') {
      for (const { value, offset } of packageFields(text)) scan(input, value, VISIBLE_RULES, out, offset, text)
      continue
    }
    const structured =
      input.kind === 'state' || input.kind === 'manifest' || input.kind === 'html-head' || input.kind === 'html'
    const fields =
      input.kind === 'state'
        ? stateFields(text)
        : input.kind === 'manifest'
          ? manifestFields(text)
          : input.kind === 'html-head'
            ? htmlHead(text)
            : input.kind === 'html'
              ? htmlText(text)
              : null
    if (structured && !fields) {
      // A file that cannot be read cannot be shown to be clean.
      out.push({ path: input.path, line: 1, rule: 'unreadable', match: 'not valid JSON' })
      continue
    }
    if (fields) {
      // Only what a visitor reads is scanned, with every rule.
      for (const { value, offset } of fields) {
        const v = blankAllowlisted(value)
        scan(input, v, WORD_RULES, out, offset, text)
        scan(input, value, PATTERN_RULES, out, offset, text)
        scan(input, value, SOURCE_RULES, out, offset, text)
        scan(input, v, SCREEN_RULES, out, offset, text)
      }
      continue
    }
    const cleaned = blankAllowlisted(text)
    scan(input, cleaned, WORD_RULES, out)
    scan(input, text, PATTERN_RULES, out)
    scan(input, text, [...SOURCE_RULES, PLAN_RULE], out)
    if (input.kind === 'visible') scan(input, cleaned, SCREEN_RULES, out)
    if (input.kind === 'markdown') scan(input, cleaned, VISIBLE_RULES, out)
    if (input.kind === 'markdown' && isAdr(input.path)) {
      scan({ ...input, path: `${input.path} (file name)` }, adrFileName(input.path), VISIBLE_RULES, out, 0, text)
    }
    if (input.kind === 'content' && input.path === COPY_FILE) scan(input, text, [MONTHS_RULE], out)
    if (input.kind === 'content') {
      for (const { value, offset } of yamlComments(text)) {
        scan(input, blankAllowlisted(value), VISIBLE_RULES, out, offset, text)
      }
    }
    if (input.kind === 'content' && Object.hasOwn(VISIBLE_YAML, input.path)) {
      for (const { value, offset } of yamlStringValues(text, VISIBLE_YAML[input.path] ?? null)) {
        scan(input, blankAllowlisted(value), SCREEN_RULES, out, offset, text)
      }
    }
  }
  return out
}

export function formatFinding(f: Finding): string {
  return `${f.path}:${f.line}  ${f.rule}  "${f.match}"`
}

/** Extensions of the files under src/ that are text; images and other binary assets are skipped. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.css', '.json', '.yaml', '.md', '.html', '.svg'])

/** Whether a file is read as text by the source scan (a binary asset read as text gives false hits). */
export function isTextFile(path: string): boolean {
  const dot = path.lastIndexOf('.')
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return dot > slash && TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase())
}
