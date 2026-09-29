// Banned-terms check (CI gate). Run: node scripts/check-banned.ts [--visible <file>]...
// Needs Node 22.18+ / 23.6+ (built-in type stripping). Never scans JS bundles.
//
// Scans:
//   content/*.yaml                       word, source-reference and pattern rules, plus the
//                                        visible-copy rule on shown string values
//   *.md tracked by git (incl. docs/,     word, source-reference, pattern and visible-copy rules
//   legacy/)
//   src/**                               pattern classes only (emails, phone numbers, magnitudes)
//   package.json                         visible-copy rule on the name, description, script names
//   content/states/*.json                every rule on the visible fields (label, note, reason)
//   index.html                           every rule on <title> and the meta description
//   public/*.html                        every rule on the text and visible attributes
//   --visible <file>                     text collected from rendered pages (every rule)
//   --manifest <file>                    a built manifest.webmanifest (every rule on the names)
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { checkInputs, formatFinding, type Input } from './banned-core.ts'

const root = process.cwd()
const toPosix = (p: string) => p.split(sep).join('/')

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-single',
  '_site',
  'test-results',
  'playwright-report',
  '.worktrees',
])

function walk(dir: string, keep: (rel: string) => boolean, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(abs, keep, acc)
    } else {
      const rel = toPosix(relative(root, abs))
      if (keep(rel)) acc.push(rel)
    }
  }
  return acc
}

/** Markdown files known to git (tracked, plus new files not ignored); a tree walk without git. */
function markdownFiles(): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return [...new Set(out.split('\0').filter(Boolean))].filter((p) => {
      try {
        return statSync(join(root, p)).isFile()
      } catch {
        return false // deleted in the working tree
      }
    })
  } catch {
    return walk(root, (rel) => rel.endsWith('.md'))
  }
}

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

const inputs: Input[] = []
for (const name of readdirSync(join(root, 'content')).sort()) {
  if (name.endsWith('.yaml') || name.endsWith('.yml')) {
    const path = `content/${name}`
    inputs.push({ path, text: read(path), kind: 'content' })
  }
}
for (const path of markdownFiles().sort()) inputs.push({ path, text: read(path), kind: 'markdown' })
for (const path of walk(join(root, 'src'), () => true).sort()) inputs.push({ path, text: read(path), kind: 'source' })
if (existsSync(join(root, 'package.json')))
  inputs.push({ path: 'package.json', text: read('package.json'), kind: 'package' })
if (existsSync(join(root, 'content', 'states'))) {
  for (const name of readdirSync(join(root, 'content', 'states')).sort()) {
    if (name.endsWith('.json'))
      inputs.push({ path: `content/states/${name}`, text: read(`content/states/${name}`), kind: 'state' })
  }
}
if (existsSync(join(root, 'index.html')))
  inputs.push({ path: 'index.html', text: read('index.html'), kind: 'html-head' })
if (existsSync(join(root, 'public'))) {
  for (const name of readdirSync(join(root, 'public')).sort()) {
    if (name.endsWith('.html')) inputs.push({ path: `public/${name}`, text: read(`public/${name}`), kind: 'html' })
  }
}

const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--visible' && args[i + 1]) {
    const path = args[++i] as string
    inputs.push({ path, text: readFileSync(path, 'utf8'), kind: 'visible' })
  } else if (args[i] === '--manifest' && args[i + 1]) {
    const path = args[++i] as string
    if (!existsSync(path)) {
      console.error(`check-banned: ${path} does not exist (build first)`)
      process.exit(2)
    }
    inputs.push({ path, text: readFileSync(path, 'utf8'), kind: 'manifest' })
  } else {
    console.error(`check-banned: unknown argument ${args[i]}`)
    process.exit(2)
  }
}

const findings = checkInputs(inputs)
if (findings.length > 0) {
  console.error(`check-banned: ${findings.length} finding(s)`)
  for (const f of findings) console.error(`  ${formatFinding(f)}`)
  console.error('Reword the text (see the wording rules), or use an approved phrase exactly.')
  process.exit(1)
}
console.log(`check-banned: ${inputs.length} files clean`)
