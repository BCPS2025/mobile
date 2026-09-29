// Layer rules for src/: domain ← content ← sim ← store ← app.
// A file may import its own layer and any layer to its left, never one to its right.
// Imports are resolved to files (relative paths and the tsconfig aliases), so the direction
// check does not depend on how a specifier is spelled. Pure: no Node APIs, so the meta-test can
// run it over an in-memory tree. The CLI is scripts/check-layers.ts.

export interface Layer {
  name: string
  /** Folders (repo-relative, trailing slash) that belong to the layer. */
  dirs: readonly string[]
}

/** Layers from left to right. content/ (the YAML data) belongs to the content layer. */
export const LAYERS: readonly Layer[] = [
  { name: 'domain', dirs: ['src/domain/'] },
  { name: 'content', dirs: ['src/content/', 'content/'] },
  { name: 'sim', dirs: ['src/sim/'] },
  { name: 'store', dirs: ['src/store/'] },
  { name: 'app', dirs: ['src/app/'] },
]

/** Files under src/ outside every layer. They may be imported by anyone and import nothing from src/. */
export const SHARED_FILES: readonly string[] = ['src/build-constants.ts']

/** Globals the domain layer never reads (time, randomness, the DOM and browser storage). */
const DOMAIN_GLOBALS =
  /(?<![.\w$])(Date|window|document|navigator|localStorage|sessionStorage|indexedDB|performance|crypto|setTimeout|setInterval|requestAnimationFrame|globalThis|self)\b|(?<![.\w$])Math\s*\.\s*random\b/g

const EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx']

export type Rule =
  | 'wrong-direction'
  | 'domain-package'
  | 'domain-global'
  | 'unresolved'
  | 'outside-layers'
  | 'unlayered'

export interface Finding {
  file: string
  line: number
  rule: Rule
  message: string
}

export interface Tree {
  /** Source files to check: repo-relative posix path → text. */
  sources: ReadonlyMap<string, string>
  /** Whether a repo-relative path exists (sources, content files, anything else on disk). */
  exists: (path: string) => boolean
  /** Alias prefix → repo-relative folder, e.g. '@domain/' → 'src/domain/'. */
  aliases: Readonly<Record<string, string>>
}

/** Alias prefixes from tsconfig `compilerOptions.paths` ("@x/*": ["./src/x/*"]). */
export function aliasesFromPaths(paths: Readonly<Record<string, readonly string[]>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0]
    if (!key.endsWith('/*') || !target?.endsWith('/*')) continue
    out[key.slice(0, -1)] = target.slice(0, -1).replace(/^\.\//, '')
  }
  return out
}

export function layerOf(path: string): Layer | null {
  return LAYERS.find((l) => l.dirs.some((d) => path.startsWith(d))) ?? null
}

const rank = (l: Layer) => LAYERS.indexOf(l)

/**
 * Code with comments removed and every string literal replaced by a numbered token ('#n'),
 * so keywords inside strings and comments never count. Template literals become ``.
 * Regular-expression literals are skipped when a `/` follows an operator or opening bracket.
 */
export function scan(text: string): { code: string; strings: string[] } {
  const strings: string[] = []
  let code = ''
  let i = 0
  let prev = '' // last significant character emitted
  while (i < text.length) {
    const c = text[i] as string
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? text.length : end + 2
      code += text.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      let value = ''
      while (j < text.length && text[j] !== c && text[j] !== '\n') {
        if (text[j] === '\\') {
          value += text[j + 1] ?? ''
          j += 2
        } else {
          value += text[j]
          j++
        }
      }
      code += `${c}#${strings.length}${c}`
      strings.push(value)
      prev = c
      i = j + 1
      continue
    }
    if (c === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== '`') j += text[j] === '\\' ? 2 : 1
      code += `\`${text.slice(i + 1, j).replace(/[^\n]/g, '')}\``
      prev = '`'
      i = j + 1
      continue
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      let j = i + 1
      let inClass = false
      while (j < text.length && text[j] !== '\n') {
        const d = text[j]
        if (d === '\\') j++
        else if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) break
        j++
      }
      code += ' '.repeat(j + 1 - i)
      prev = '/'
      i = j + 1
      continue
    }
    code += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return { code, strings }
}

export interface ImportRef {
  spec: string
  line: number
}

/** Static imports, re-exports, side-effect imports and dynamic import() calls. */
export function extractImports(text: string): ImportRef[] {
  const { code, strings } = scan(text)
  const refs: ImportRef[] = []
  const lineAt = (index: number) => code.slice(0, index).split('\n').length
  const patterns = [
    /\b(?:import|export)\s[^'"`;=()]*?\bfrom\s*(['"])#(\d+)\1/g,
    /\bimport\s*(['"])#(\d+)\1/g,
    /\bimport\s*\(\s*(['"])#(\d+)\1\s*\)/g,
  ]
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      const spec = strings[Number(m[2])]
      if (spec !== undefined) refs.push({ spec, line: lineAt((m.index ?? 0) + m[0].length) })
    }
  }
  return refs.sort((a, b) => a.line - b.line)
}

function normalise(path: string): string | null {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(part)
  }
  return out.join('/')
}

export type Resolved = { kind: 'file'; path: string } | { kind: 'package'; name: string } | { kind: 'unresolved' }

export function resolveImport(from: string, spec: string, tree: Tree): Resolved {
  const bare = spec.split('?')[0] ?? spec
  let base: string | null = null
  if (bare.startsWith('./') || bare.startsWith('../')) {
    base = normalise(`${from.slice(0, from.lastIndexOf('/') + 1)}${bare}`)
  } else {
    const alias = Object.keys(tree.aliases).find((a) => bare.startsWith(a))
    if (alias) base = normalise(`${tree.aliases[alias]}${bare.slice(alias.length)}`)
    else {
      const parts = bare.split('/')
      const name = bare.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? bare)
      return { kind: 'package', name }
    }
  }
  if (base === null) return { kind: 'unresolved' }
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`
    if (tree.sources.has(candidate) || tree.exists(candidate)) return { kind: 'file', path: candidate }
  }
  return { kind: 'unresolved' }
}

export function checkLayers(tree: Tree): Finding[] {
  const findings: Finding[] = []
  for (const [file, text] of [...tree.sources].sort(([a], [b]) => a.localeCompare(b))) {
    const from = layerOf(file)
    const shared = SHARED_FILES.includes(file)
    if (!from && !shared) {
      findings.push({
        file,
        line: 1,
        rule: 'unlayered',
        message: 'file is outside every layer (see LAYERS in scripts/layers-core.ts)',
      })
      continue
    }
    for (const ref of extractImports(text)) {
      const r = resolveImport(file, ref.spec, tree)
      const at = { file, line: ref.line }
      if (r.kind === 'unresolved') {
        findings.push({ ...at, rule: 'unresolved', message: `cannot resolve '${ref.spec}'` })
        continue
      }
      if (r.kind === 'package') {
        if (from?.name === 'domain') {
          findings.push({
            ...at,
            rule: 'domain-package',
            message: `the domain layer imports no packages ('${ref.spec}')`,
          })
        }
        continue
      }
      if (SHARED_FILES.includes(r.path)) continue
      const to = layerOf(r.path)
      if (!to || shared) {
        findings.push({
          ...at,
          rule: 'outside-layers',
          message: `'${ref.spec}' resolves to ${r.path}, outside the layers`,
        })
        continue
      }
      if (from && rank(to) > rank(from)) {
        findings.push({
          ...at,
          rule: 'wrong-direction',
          message: `${from.name} must not import ${to.name} ('${ref.spec}' → ${r.path})`,
        })
      }
    }
    if (from?.name === 'domain') {
      const { code } = scan(text)
      for (const m of code.matchAll(DOMAIN_GLOBALS)) {
        const line = code.slice(0, m.index).split('\n').length
        findings.push({
          file,
          line,
          rule: 'domain-global',
          message: `the domain layer never reads ${m[0].replace(/\s+/g, '')}`,
        })
      }
    }
  }
  return findings
}

export const formatLayerFinding = (f: Finding) => `${f.file}:${f.line}  [${f.rule}] ${f.message}`
