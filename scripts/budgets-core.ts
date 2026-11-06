// Rule engine of the build budgets (scripts/check-budgets.ts). Pure: the
// caller reads the build output, so the unit test (tests/unit/budgets.test.ts) runs it on
// in-memory fixtures. Runs under plain Node type stripping: erasable TypeScript only.

export interface AssetBudget {
  /** Path inside the build output; `*` matches within one path segment. */
  pattern: string
  maxBytes: number
}

export interface Budgets {
  /** Gzip bytes of the JavaScript the entry page loads before anything else (entry + preloads). */
  initialJsGzip: number
  /** Bytes of every file the service worker precaches. */
  precacheBytes: number
  assets: AssetBudget[]
}

export interface BuildOutput {
  /** dist/index.html */
  indexHtml: string
  /** dist/sw.js, or null for a build without a service worker. */
  swJs: string | null
  /** Every file of the build, as paths relative to the output folder with "/" separators. */
  files: readonly string[]
  size(path: string): number
  gzipSize(path: string): number
}

export interface Report {
  initialJs: { files: string[]; gzip: number; budget: number }
  precache: { files: number; bytes: number; budget: number }
  assets: { path: string; bytes: number; budget: number; pattern: string }[]
  problems: string[]
}

const clean = (p: string) => p.replace(/^\.\//, '').replace(/^\//, '')

/** The scripts the entry page loads at once: module scripts and module preloads. */
export function initialScripts(indexHtml: string): string[] {
  const out: string[] = []
  for (const m of indexHtml.matchAll(/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>/gi)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[0])
    if (src?.[1]) out.push(clean(src[1]))
  }
  for (const m of indexHtml.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']modulepreload["']/i.test(m[0])) continue
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])
    if (href?.[1]) out.push(clean(href[1]))
  }
  return [...new Set(out)]
}

/** URLs in the Workbox precache manifest of a generated service worker. */
export function precacheUrls(swJs: string): string[] {
  return [...new Set([...swJs.matchAll(/\burl\s*:\s*"([^"]+)"/g)].map((m) => clean(m[1] as string)))]
}

export function patternToRegExp(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${esc}$`)
}

export function measure(out: BuildOutput, budgets: Budgets): Report {
  const problems: string[] = []
  const known = new Set(out.files)

  const scripts = initialScripts(out.indexHtml)
  if (scripts.length === 0) problems.push('index.html loads no module script')
  let gzip = 0
  for (const s of scripts) {
    if (!known.has(s)) {
      problems.push(`index.html loads ${s}, which is not in the build`)
      continue
    }
    gzip += out.gzipSize(s)
  }
  if (gzip > budgets.initialJsGzip) {
    problems.push(`initial JS is ${gzip} bytes gzip, over the budget of ${budgets.initialJsGzip}`)
  }

  let precacheBytes = 0
  let precacheFiles = 0
  if (out.swJs !== null) {
    for (const url of precacheUrls(out.swJs)) {
      if (!known.has(url)) {
        problems.push(`the service worker precaches ${url}, which is not in the build`)
        continue
      }
      precacheFiles++
      precacheBytes += out.size(url)
    }
    if (precacheFiles === 0) problems.push('the service worker precaches nothing')
    if (precacheBytes > budgets.precacheBytes) {
      problems.push(`precache is ${precacheBytes} bytes, over the budget of ${budgets.precacheBytes}`)
    }
  }

  const assets: Report['assets'] = []
  for (const b of budgets.assets) {
    const re = patternToRegExp(b.pattern)
    for (const path of out.files) {
      if (!re.test(path)) continue
      const bytes = out.size(path)
      assets.push({ path, bytes, budget: b.maxBytes, pattern: b.pattern })
      if (bytes > b.maxBytes)
        problems.push(`${path} is ${bytes} bytes, over the budget of ${b.maxBytes} (${b.pattern})`)
    }
  }

  return {
    initialJs: { files: scripts, gzip, budget: budgets.initialJsGzip },
    precache: { files: precacheFiles, bytes: precacheBytes, budget: budgets.precacheBytes },
    assets,
    problems,
  }
}

export function formatReport(r: Report): string {
  const kb = (n: number) => `${(n / 1000).toFixed(2)} kB`
  const lines = [
    `initial JS  ${kb(r.initialJs.gzip)} gzip of ${kb(r.initialJs.budget)}  (${r.initialJs.files.join(', ')})`,
    `precache    ${kb(r.precache.bytes)} in ${r.precache.files} files of ${kb(r.precache.budget)}`,
    ...r.assets.map((a) => `asset       ${a.path}  ${kb(a.bytes)} of ${kb(a.budget)}`),
  ]
  return lines.join('\n')
}
