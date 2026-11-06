// Replay fingerprint manifest: `content/replay-fingerprint.json` records the
// stateVersion and a hash of every input that decides what a stored command log replays to. A
// changed input needs a stateVersion bump or a regenerated manifest with a reason line; no git
// base is needed, the manifest itself is the baseline. Pure: no Node APIs, so the meta-test can
// run it over the real tree in memory. The CLI is scripts/check-state-version.ts.

/** Inputs that affect replay. Screens, copy and homes.yaml are not inputs. */
export const REPLAY_INPUTS = {
  files: [
    'content/config.yaml',
    'content/personas.yaml',
    'content/seed.yaml',
    'content/signup.yaml',
    'src/store/log-codec.ts',
    'src/store/replay.ts',
  ],
  dirs: ['src/domain/', 'src/sim/'],
  /** Only these top-level keys of the catalogue decide replay (products, plans, templates). */
  catalogue: { file: 'content/catalogue.yaml', keys: ['products', 'plans', 'templates'] },
} as const

export const MANIFEST_PATH = 'content/replay-fingerprint.json'
const ABSENT = 'absent'

export interface Manifest {
  stateVersion: number
  /** Why the manifest was last regenerated. */
  reason: string
  /** Input path → sha256 (hex) of its text with LF line endings, or "absent". */
  inputs: Record<string, string>
}

export interface Source {
  /** Repo-relative files under a folder (recursive). */
  list(dir: string): string[]
  /** A file's text, or null when it does not exist. */
  read(path: string): string | null
}

const lf = (s: string) => s.replace(/\r\n/g, '\n')

function sortedJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort)
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(x).sort()) out[k] = sort((x as Record<string, unknown>)[k])
      return out
    }
    return x
  }
  return JSON.stringify(sort(v))
}

/** Path → text (null when absent) of every replay input. */
export function collectInputs(src: Source, parseYaml: (text: string) => unknown): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const f of REPLAY_INPUTS.files) out.set(f, src.read(f))
  for (const dir of REPLAY_INPUTS.dirs) {
    for (const f of src
      .list(dir)
      .filter((p) => /\.(ts|tsx)$/.test(p))
      .sort())
      out.set(f, src.read(f))
  }
  const { file, keys } = REPLAY_INPUTS.catalogue
  const text = src.read(file)
  if (text === null) out.set(`${file}#${keys.join(',')}`, null)
  else {
    const doc = (parseYaml(text) ?? {}) as Record<string, unknown>
    out.set(`${file}#${keys.join(',')}`, sortedJson(Object.fromEntries(keys.map((k) => [k, doc[k] ?? null]))))
  }
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

export function hashInputs(
  inputs: ReadonlyMap<string, string | null>,
  sha256: (text: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, text] of inputs) out[path] = text === null ? ABSENT : sha256(lf(text))
  return out
}

export function stateVersionOf(configYaml: string, parseYaml: (text: string) => unknown): number {
  const v = (parseYaml(configYaml) as { stateVersion?: unknown } | null)?.stateVersion
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new Error('config.yaml has no integer stateVersion')
  return v
}

export type Finding =
  | { kind: 'missing-manifest' }
  | { kind: 'version'; manifest: number; config: number }
  | { kind: 'changed' | 'added' | 'removed'; path: string }

/** What differs between the committed manifest and the tree. Empty = in step. */
export function checkManifest(
  manifest: Manifest | null,
  stateVersion: number,
  current: Record<string, string>,
): Finding[] {
  if (!manifest) return [{ kind: 'missing-manifest' }]
  const out: Finding[] = []
  if (manifest.stateVersion !== stateVersion)
    out.push({ kind: 'version', manifest: manifest.stateVersion, config: stateVersion })
  for (const [path, hash] of Object.entries(current)) {
    const was = manifest.inputs[path]
    if (was === undefined) out.push({ kind: 'added', path })
    else if (was !== hash) out.push({ kind: 'changed', path })
  }
  for (const path of Object.keys(manifest.inputs)) if (!(path in current)) out.push({ kind: 'removed', path })
  return out
}

/**
 * The manifest to write for the tree. A changed input without a stateVersion bump needs a reason
 * (for example "refactor, same replay results"); with a bump the reason defaults to the bump.
 */
export function nextManifest(
  prev: Manifest | null,
  stateVersion: number,
  current: Record<string, string>,
  reason?: string,
): { ok: true; manifest: Manifest } | { ok: false; error: 'reason-required' } {
  const changed = checkManifest(prev, stateVersion, current).some((f) => f.kind !== 'version')
  const bumped = !prev || prev.stateVersion !== stateVersion
  const why = reason?.trim()
  if (changed && !bumped && !why) return { ok: false, error: 'reason-required' }
  return {
    ok: true,
    manifest: {
      stateVersion,
      reason: why || (bumped ? `stateVersion ${stateVersion}` : (prev?.reason ?? '')),
      inputs: current,
    },
  }
}

export function parseManifest(text: string | null): Manifest | null {
  if (text === null) return null
  const v = JSON.parse(text) as Partial<Manifest>
  if (typeof v.stateVersion !== 'number' || typeof v.reason !== 'string' || !v.inputs || typeof v.inputs !== 'object') {
    throw new Error(`${MANIFEST_PATH} is malformed`)
  }
  return { stateVersion: v.stateVersion, reason: v.reason, inputs: { ...v.inputs } }
}

export const formatManifest = (m: Manifest): string =>
  `${JSON.stringify({ stateVersion: m.stateVersion, reason: m.reason, inputs: m.inputs }, null, 2)}\n`

export function formatFinding(f: Finding): string {
  switch (f.kind) {
    case 'missing-manifest':
      return `${MANIFEST_PATH} is missing`
    case 'version':
      return `stateVersion is ${f.config} in config.yaml but ${f.manifest} in ${MANIFEST_PATH}`
    default:
      return `${f.path}: ${f.kind} since ${MANIFEST_PATH} was written`
  }
}
