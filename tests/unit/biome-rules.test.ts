// The Biome device-access rule: scripts/biome/no-device-access.grit is
// applied to src/** by biome.json and flags camera, microphone, media, permission and location
// APIs. Runs Biome on planted files in a temporary tree with the same override.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const PLUGIN = './scripts/biome/no-device-access.grit'
const config = JSON.parse(readFileSync('biome.json', 'utf8')) as {
  overrides?: { includes?: string[]; plugins?: string[] }[]
}

const dir = mkdtempSync(join(tmpdir(), 'biome-rules-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function lint(files: Record<string, string>): string {
  writeFileSync(
    join(dir, 'biome.json'),
    JSON.stringify({
      formatter: { enabled: false },
      linter: { enabled: true, rules: { preset: 'none' } },
      assist: { enabled: false },
      overrides: [{ includes: ['src/**'], plugins: [resolve(PLUGIN)] }],
    }),
  )
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  try {
    return execFileSync(resolve('node_modules/.bin/biome'), ['lint', '--max-diagnostics=100', ...Object.keys(files)], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    })
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    return `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
}

const count = (out: string) => (out.match(/No device access/g) ?? []).length

describe('Biome device-access rule', () => {
  it('biome.json applies the plugin to src/** only', () => {
    const o = config.overrides?.find((x) => x.plugins?.includes(PLUGIN))
    expect(o?.includes).toEqual(['src/**'])
  })

  it('flags each device API in src/, and nothing in tests/', () => {
    const planted = [
      'export const a = () => navigator.mediaDevices',
      'export const b = (m: { getUserMedia(c: unknown): unknown }) => m.getUserMedia({ video: true })',
      "export const c = () => navigator.permissions.query({ name: 'camera' })",
      'export const d = () => navigator.geolocation',
      'export const e = () => Notification.requestPermission()',
    ]
    for (const [i, code] of planted.entries()) {
      expect(count(lint({ [`src/app/p${i}.ts`]: `${code}\n` })), code).toBeGreaterThan(0)
    }
    expect(count(lint({ 'tests/e2e/stub.ts': 'export const s = () => navigator.mediaDevices\n' }))).toBe(0)
    expect(count(lint({ 'src/app/ok.ts': 'export const ok = () => navigator.language\n' }))).toBe(0)
  })
})
