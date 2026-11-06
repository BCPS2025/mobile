import { parseDocument } from 'yaml'

// Line numbers for content problems: a data path ("rows.3.amount") resolved to the line of that
// node in the YAML text. Imports only the yaml package, so plain Node scripts can use it too.

/** 1-based line of the deepest node along `path` that exists (the document start otherwise). */
export function lineOfPath(text: string, path: readonly (string | number)[]): number {
  const doc = parseDocument(text, { schema: 'core' })
  for (let n = path.length; n >= 0; n--) {
    const node = doc.getIn(path.slice(0, n), true) as { range?: [number, number, number] } | undefined
    const offset = node?.range?.[0]
    if (offset !== undefined) {
      let line = 1
      for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
      return line
    }
  }
  return 1
}

export interface LocatedProblem {
  file: string
  path: readonly (string | number)[]
  message: string
}

/** "content/seed.yaml:42  rows.3.amount: message" */
export function formatLocated(p: LocatedProblem, text: string | undefined): string {
  const line = text === undefined ? 1 : lineOfPath(text, p.path)
  return `content/${p.file}:${line}  ${p.path.join('.') || '(root)'}: ${p.message}`
}
