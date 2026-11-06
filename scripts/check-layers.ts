// Layer check (CI gate). Run: node scripts/check-layers.ts
// Needs Node 22.18+ / 23.6+ (built-in type stripping). Rules in scripts/layers-core.ts:
// domain ← content ← sim ← store ← app, imports resolved to files through relative paths and the
// tsconfig.json aliases; the domain layer imports no packages and never reads Date, Math.random
// or the DOM.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { aliasesFromPaths, checkLayers, formatLayerFinding } from './layers-core.ts'

const root = process.cwd()
const toPosix = (p: string) => p.split(sep).join('/')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, acc)
    else if (/\.(ts|tsx|mts|cts)$/.test(name)) acc.push(toPosix(relative(root, abs)))
  }
  return acc
}

const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')) as {
  compilerOptions?: { paths?: Record<string, string[]> }
}
const aliases = aliasesFromPaths(tsconfig.compilerOptions?.paths ?? {})
const sources = new Map(walk(join(root, 'src')).map((p) => [p, readFileSync(join(root, p), 'utf8')] as const))

const findings = checkLayers({
  sources,
  aliases,
  exists: (p) => existsSync(join(root, p)) && statSync(join(root, p)).isFile(),
})

if (findings.length > 0) {
  for (const f of findings) console.error(formatLayerFinding(f))
  console.error(`\ncheck-layers: ${findings.length} finding(s) in ${sources.size} files`)
  process.exit(1)
}
console.log(`check-layers: ${sources.size} files clean`)
