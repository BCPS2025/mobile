// The CI workflow: separate jobs, one gate that deploy needs, deploy on main only (pushes and
// manual runs), the built-in GITHUB_TOKEN only, least permissions per job, and every job's commands
// available locally through scripts/ci-local.sh.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface Step {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}
interface Job {
  needs?: string | string[]
  if?: string
  permissions?: Record<string, string>
  container?: { image: string }
  strategy?: { matrix: { include: Record<string, string>[] } }
  steps: Step[]
}

const text = readFileSync('.github/workflows/pages.yml', 'utf8')
const wf = parse(text) as {
  on: Record<string, unknown>
  permissions: Record<string, string>
  jobs: Record<string, Job>
}
const local = readFileSync('scripts/ci-local.sh', 'utf8')
const needs = (j: Job) => (Array.isArray(j.needs) ? j.needs : j.needs ? [j.needs] : [])
const TESTED = ['static', 'unit', 'build', 'e2e', 'visual']

describe('pages.yml', () => {
  it('has the CI jobs', () => {
    expect(Object.keys(wf.jobs).sort()).toEqual([
      'build',
      'deploy',
      'e2e',
      'gate',
      'release',
      'static',
      'unit',
      'visual',
    ])
    expect(needs(wf.jobs.e2e as Job)).toEqual(['build'])
    expect(needs(wf.jobs.visual as Job)).toEqual(['build'])
    for (const j of ['static', 'unit', 'build']) expect(needs(wf.jobs[j] as Job), j).toEqual([])
  })

  it('gate needs every tested job, always runs and fails unless all succeeded', () => {
    const gate = wf.jobs.gate as Job
    expect(needs(gate).sort()).toEqual([...TESTED].sort())
    expect(gate.if).toBe('always()')
    const step = gate.steps[0] as Step
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not a template
    expect(step.env?.RESULTS).toBe("${{ join(needs.*.result, ' ') }}")
    expect(step.run).toMatch(/!= "success"/)
  })

  it('deploy needs gate and runs only on main, for pushes and manual runs; release only for tags', () => {
    const deploy = wf.jobs.deploy as Job
    expect(needs(deploy)).toEqual(['gate'])
    expect(deploy.if).toBe(
      "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')",
    )
    expect(wf.on).toHaveProperty('workflow_dispatch')
    expect(deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' })
    const release = wf.jobs.release as Job
    expect(needs(release)).toEqual(['gate'])
    expect(release.if).toMatch(/^startsWith\(github\.ref, 'refs\/tags\/v'\)/)
    expect(release.permissions).toEqual({ contents: 'write' })
  })

  it('uses only the built-in token: no secrets, read-only by default, no persisted credentials', () => {
    expect(text).not.toMatch(/secrets\./)
    expect(wf.permissions).toEqual({ contents: 'read' })
    for (const [name, job] of Object.entries(wf.jobs)) {
      if (!['deploy', 'release'].includes(name)) expect(job.permissions, name).toBeUndefined()
      for (const s of job.steps) {
        if (s.uses?.startsWith('actions/checkout')) expect(s.with?.['persist-credentials'], name).toBe(false)
      }
    }
    expect(text.match(/github\.token/g)).toHaveLength(1) // the release upload
  })

  it('e2e: Chromium in three shards and WebKit in one; visual in the pinned Playwright image', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies: Record<string, string> }
    const version = pkg.devDependencies['@playwright/test']
    expect((wf.jobs.visual as Job).container?.image).toBe(`mcr.microsoft.com/playwright:v${version}-noble`)
    expect(local).toContain(`mcr.microsoft.com/playwright:v${version}-noble`)
    expect((wf.jobs.e2e as Job).strategy?.matrix.include).toEqual([
      { browser: 'chromium', shard: '1/3' },
      { browser: 'chromium', shard: '2/3' },
      { browser: 'chromium', shard: '3/3' },
      { browser: 'webkit', shard: '1/1' },
    ])
  })

  it('every command of the tested jobs runs locally through scripts/ci-local.sh', () => {
    const skip = [/^npm ci$/, /^bash scripts\/check-commit-identity\.sh$/, /^npx playwright install/]
    for (const job of TESTED) {
      expect(local, job).toContain(`job_${job}()`)
      for (const s of (wf.jobs[job] as Job).steps) {
        const run = s.run?.trim()
        if (!run || skip.some((re) => re.test(run))) continue
        // Matrix values become the loop variables of the local run.
        const cmd = run
          .replace(/\$\{\{ matrix\.browser \}\}/g, 'chromium')
          .replace(/ --shard=\$\{\{ matrix\.shard \}\}/g, ' --shard="$shard"')
        expect(local, `${job}: ${run}`).toContain(cmd)
      }
    }
    expect(local).toContain('scripts/check-commit-identity.sh')
  })
})
