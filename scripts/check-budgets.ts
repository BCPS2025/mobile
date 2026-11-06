// Build budgets (CI gate). Run after `vite build`:
//   node scripts/check-budgets.ts [--dist dist] [--report reports/budgets.json]
// Needs Node 22.18+ / 23.6+ (built-in type stripping).
//
// Checks the hosted build against scripts/budgets.json: the initial JS (module scripts and
// preloads of index.html, gzip level 9), the total the service worker precaches, and per-asset
// limits (icons, the emblem). Writes the measurements as JSON for the CI artifact, next to the
// bundle report (reports/bundle.html). The initial JS budget was set from measurement in
// milestone A1; raise it only with a reason in the commit, and never above the 150 kB target.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { type Budgets, formatReport, measure } from './budgets-core.ts'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}

const root = process.cwd()
const dist = join(root, arg('dist', 'dist'))
const reportPath = join(root, arg('report', join('reports', 'budgets.json')))
const budgets = JSON.parse(readFileSync(join(root, 'scripts', 'budgets.json'), 'utf8')) as Budgets & {
  $comment?: string
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`check-budgets: ${relative(root, dist)}/index.html is missing: run \`npx vite build\` first`)
  process.exit(2)
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, acc)
    else acc.push(relative(dist, abs).split(sep).join('/'))
  }
  return acc
}

const files = walk(dist).sort()
const swPath = join(dist, 'sw.js')
const report = measure(
  {
    indexHtml: readFileSync(join(dist, 'index.html'), 'utf8'),
    swJs: existsSync(swPath) ? readFileSync(swPath, 'utf8') : null,
    files,
    size: (p) => statSync(join(dist, p)).size,
    gzipSize: (p) => gzipSync(readFileSync(join(dist, p)), { level: 9 }).length,
  },
  budgets,
)

mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(formatReport(report))
if (report.problems.length > 0) {
  console.error(`check-budgets: ${report.problems.length} problem(s)`)
  for (const p of report.problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`check-budgets: within budget (report: ${relative(root, reportPath)})`)
