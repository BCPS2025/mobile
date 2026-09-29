// State-version check (CI gate). Run: node scripts/check-state-version.ts
//   --update [--reason "..."]   regenerate content/replay-fingerprint.json (a changed input
//                               without a stateVersion bump needs a reason)
// Needs Node 22.18+ / 23.6+ (built-in type stripping). Rules in scripts/state-version-core.ts.
// Shipped starting states (content/states/*.json) must carry the current stateVersion; their
// fingerprints are checked by replaying them in the unit tests.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { parse } from 'yaml'
import {
  MANIFEST_PATH,
  checkManifest,
  collectInputs,
  formatFinding,
  formatManifest,
  hashInputs,
  nextManifest,
  parseManifest,
  stateVersionOf,
} from './state-version-core.ts'

const root = process.cwd()
const toPosix = (p: string) => p.split(sep).join('/')
const read = (p: string): string | null => {
  const abs = join(root, p)
  return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, 'utf8') : null
}
function list(dir: string, acc: string[] = []): string[] {
  const abs = join(root, dir)
  if (!existsSync(abs)) return acc
  for (const name of readdirSync(abs)) {
    const rel = `${dir}${name}`
    if (statSync(join(root, rel)).isDirectory()) list(`${rel}/`, acc)
    else acc.push(toPosix(relative(root, join(root, rel))))
  }
  return acc
}
const parseYaml = (text: string) => parse(text, { schema: 'core' })
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

const stateVersion = stateVersionOf(read('content/config.yaml') ?? '', parseYaml)
const current = hashInputs(collectInputs({ list, read }, parseYaml), sha256)
const manifest = parseManifest(read(MANIFEST_PATH))

const args = process.argv.slice(2)
if (args[0] === '--update') {
  const i = args.indexOf('--reason')
  const reason = i >= 0 ? args[i + 1] : undefined
  const next = nextManifest(manifest, stateVersion, current, reason)
  if (!next.ok) {
    console.error(
      'check-state-version: inputs changed without a stateVersion bump; pass --reason "why replay results stay the same"',
    )
    process.exit(1)
  }
  writeFileSync(join(root, MANIFEST_PATH), formatManifest(next.manifest))
  console.log(
    `check-state-version: wrote ${MANIFEST_PATH} (stateVersion ${stateVersion}, ${Object.keys(current).length} inputs)`,
  )
  process.exit(0)
}

const problems = checkManifest(manifest, stateVersion, current).map(formatFinding)
for (const name of list('content/states/').filter((p) => p.endsWith('.json'))) {
  try {
    const v = (JSON.parse(read(name) ?? '') as { stateVersion?: unknown }).stateVersion
    if (v !== stateVersion) problems.push(`${name}: stateVersion ${String(v)}, expected ${stateVersion}`)
  } catch {
    problems.push(`${name}: not valid JSON`)
  }
}
if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`)
  console.error(
    `\ncheck-state-version: ${problems.length} problem(s). Bump stateVersion in content/config.yaml if stored logs replay differently,\n` +
      'then run: node scripts/check-state-version.ts --update (or --update --reason "..." when replay results stay the same)',
  )
  process.exit(1)
}
console.log(`check-state-version: ${Object.keys(current).length} inputs match stateVersion ${stateVersion}`)
