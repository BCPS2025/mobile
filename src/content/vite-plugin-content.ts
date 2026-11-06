import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Plugin, runnerImport } from 'vite'
import { parse } from 'yaml'
import { CONTENT_FILES, type ContentResult, type RawContent } from './schema'
import { formatLocated } from './yaml-lines'

// Content at build time.
// - `virtual:bcps-content` is every content file, validated (zod schemas, cross-file rules, seed
//   arithmetic) and emitted as plain JSON: the client bundle never contains zod or YAML parsing.
//   The validator runs through Vite's module runner (it imports the domain and sim layers by
//   their aliases), named by the `validator` option so the dependency is declared in the config.
// - Any `*.yaml` import is still read as plain data (YAML 1.2 core schema: times stay strings,
//   duplicate keys fail); the tests use that to plant faults in raw files.

export const CONTENT_MODULE = 'virtual:bcps-content'
const RESOLVED = `\0${CONTENT_MODULE}`

export interface ContentPluginOptions {
  /** Module that exports validateContent(raw): ContentResult (e.g. '/src/sim/validate-content.ts'). */
  validator: string
}

export function parseYaml(text: string, file: string): unknown {
  try {
    return parse(text, { schema: 'core', prettyErrors: true, uniqueKeys: true })
  } catch (e) {
    throw new Error(`YAML error in content/${file}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function contentPlugin(opts: ContentPluginOptions): Plugin {
  let root = '.'
  return {
    name: 'bcps-content',
    enforce: 'pre',
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      return id === CONTENT_MODULE ? RESOLVED : null
    },
    async load(id) {
      if (id !== RESOLVED) return null
      const texts: Record<string, string> = {}
      const raw = {} as RawContent
      for (const [key, file] of Object.entries(CONTENT_FILES) as [keyof RawContent, string][]) {
        const path = join(root, 'content', file)
        this.addWatchFile(path)
        texts[file] = readFileSync(path, 'utf8')
        raw[key] = parseYaml(texts[file] ?? '', file)
      }
      const { module } = await runnerImport<{ validateContent(raw: RawContent): ContentResult }>(opts.validator, {
        root,
        configFile: false,
        logLevel: 'error',
        resolve: { tsconfigPaths: true },
      })
      const result = module.validateContent(raw)
      if (!result.ok) {
        const lines = result.problems.map((p) => `  ${formatLocated(p, texts[p.file])}`)
        this.error(`content check failed (${result.problems.length}):\n${lines.join('\n')}`)
      }
      return { code: `export default ${JSON.stringify(result.content)};`, map: null }
    },
    transform(code, id) {
      const [file = id, query = ''] = id.split('?')
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) return null
      if (/(^|&)(raw|url)\b/.test(query)) return null
      let data: unknown
      try {
        data = parseYaml(code, file)
      } catch (e) {
        this.error(e instanceof Error ? e.message : String(e))
      }
      return { code: `export default ${JSON.stringify(data)};`, map: null }
    },
  }
}
