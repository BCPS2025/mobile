// Content check (CI gate). Run: node scripts/check-content.ts
// Validates every content/*.yaml file with the zod schemas, the cross-file rules and the seed
// arithmetic (the same validator the build runs), and prints each problem as file:line.
// Needs Node 22.18+ / 23.6+ (built-in type stripping); the validator itself is loaded through
// Vite's module runner, which resolves the layer aliases.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runnerImport } from 'vite'
import { parse } from 'yaml'
import { formatLocated, type LocatedProblem } from '../src/content/yaml-lines.ts'

type Result = { ok: true } | { ok: false; problems: LocatedProblem[] }
interface Validator {
  CONTENT_FILES: Record<string, string>
  validateContent(raw: Record<string, unknown>): Result
}

const root = process.cwd()
const { module } = await runnerImport<Validator>('/src/sim/validate-content.ts', {
  root,
  configFile: false,
  logLevel: 'error',
  resolve: { tsconfigPaths: true },
})

const texts: Record<string, string> = {}
const raw: Record<string, unknown> = {}
const yamlErrors: string[] = []
for (const [key, file] of Object.entries(module.CONTENT_FILES)) {
  const text = readFileSync(join(root, 'content', file), 'utf8')
  texts[file] = text
  try {
    raw[key] = parse(text, { schema: 'core', prettyErrors: true, uniqueKeys: true })
  } catch (e) {
    yamlErrors.push(`content/${file}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
if (yamlErrors.length > 0) {
  console.error(`check-content: ${yamlErrors.length} YAML error(s)`)
  for (const e of yamlErrors) console.error(`  ${e}`)
  process.exit(1)
}

const result = module.validateContent(raw)
if (!result.ok) {
  console.error(`check-content: ${result.problems.length} problem(s)`)
  for (const p of result.problems) console.error(`  ${formatLocated(p, texts[p.file])}`)
  process.exit(1)
}
console.log(`check-content: ${Object.keys(texts).length} files valid`)
