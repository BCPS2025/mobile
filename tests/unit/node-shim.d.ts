// Minimal Node typings for the few Node APIs the unit and end-to-end tests and the content plugin use. The project does not depend on
// @types/node; if it is added later, delete this file.
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: {
      cwd?: string
      encoding: 'utf8'
      stdio?: 'pipe' | 'ignore' | 'inherit' | readonly ('pipe' | 'ignore' | 'inherit')[]
      env?: Record<string, string>
    },
  ): string
  export function spawnSync(
    file: string,
    args: readonly string[],
    options: { cwd?: string; encoding: 'utf8'; env?: Record<string, string> },
  ): { status: number | null; stdout: string; stderr: string }
}

declare module 'node:crypto' {
  export function createHash(algorithm: 'sha256'): {
    update(data: string, encoding: 'utf8'): { digest(encoding: 'hex'): string }
  }
}

declare module 'node:fs' {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined
  export function mkdtempSync(prefix: string): string
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  export function writeFileSync(path: string, data: string): void
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readFileSync(path: string): Uint8Array
}

declare module 'node:os' {
  export function tmpdir(): string
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function join(...paths: string[]): string
  export function resolve(...paths: string[]): string
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
  export function pathToFileURL(path: string): URL
}

declare const process: { readonly execPath: string; readonly env: Readonly<Record<string, string | undefined>> }
