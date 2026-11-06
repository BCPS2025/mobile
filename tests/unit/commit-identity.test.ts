// Meta-test of scripts/check-commit-identity.sh: it runs the script against scratch repositories
// shaped like the CI checkout (a clone, so origin/main exists) for push, first or forced push of
// main, another branch and pull_request events.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../../scripts/check-commit-identity.sh', import.meta.url))
const GOOD = 'owner@bcps.example'
const OTHER = 'someone@work.example'
const ALLOWED = `${GOOD},noreply@github.com`
const ZERO = '0'.repeat(40)

let dir = ''

/** git with a clean environment: no global or system config, fixed identities. */
function git(cwd: string, args: string[], email = GOOD): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: dir,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'x',
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: 'x',
      GIT_COMMITTER_EMAIL: email,
    },
  }).trim()
}

function commit(cwd: string, file: string, email = GOOD): string {
  writeFileSync(join(cwd, file), file)
  git(cwd, ['add', file])
  git(cwd, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', file], email)
  return git(cwd, ['rev-parse', 'HEAD'])
}

function run(cwd: string, env: Record<string, string>, args: string[] = []) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: dir,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      ALLOWED_COMMIT_EMAILS: ALLOWED,
      ...env,
    },
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

/** An origin with main = base (allowed) + one commit by `lastEmail`, and a CI-style clone. */
function repos(lastEmail: string) {
  const origin = mkdtempSync(join(dir, 'origin-'))
  git(origin, ['init', '-q', '-b', 'main'])
  const base = commit(origin, 'a.txt')
  const head = commit(origin, 'b.txt', lastEmail)
  const ci = mkdtempSync(join(dir, 'ci-'))
  git(dir, ['clone', '-q', origin, ci])
  return { origin, ci, base, head }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bcps-identity-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('check-commit-identity', () => {
  it('push: checks PUSH_BEFORE..PUSH_AFTER', () => {
    const bad = repos(OTHER)
    const push = { GITHUB_EVENT_NAME: 'push', PUSH_REF: 'refs/heads/main' }
    const r = run(bad.ci, { ...push, PUSH_BEFORE: bad.base, PUSH_AFTER: bad.head })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/2 problem\(s\) in 1 commit\(s\)/)
    expect(r.out).not.toContain(OTHER) // the address never reaches the public log
    const good = repos(GOOD)
    expect(run(good.ci, { ...push, PUSH_BEFORE: good.base, PUSH_AFTER: good.head }).code).toBe(0)
  })

  it('first or forced push of main: checks the whole history, never zero commits', () => {
    const bad = repos(OTHER)
    for (const before of [ZERO, '1'.repeat(40)]) {
      const r = run(bad.ci, {
        GITHUB_EVENT_NAME: 'push',
        PUSH_REF: 'refs/heads/main',
        PUSH_BEFORE: before,
        PUSH_AFTER: bad.head,
      })
      expect(r.code, before).toBe(1)
      expect(r.out).toMatch(/whole history/)
    }
    // GITHUB_REF serves when PUSH_REF is not set.
    const viaGithubRef = run(bad.ci, {
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      PUSH_BEFORE: ZERO,
      PUSH_AFTER: bad.head,
    })
    expect(viaGithubRef.code).toBe(1)
    const good = repos(GOOD)
    const ok = run(good.ci, {
      GITHUB_EVENT_NAME: 'push',
      PUSH_REF: 'refs/heads/main',
      PUSH_BEFORE: ZERO,
      PUSH_AFTER: good.head,
    })
    expect(ok.code).toBe(0)
    expect(ok.out).toMatch(/2 commit\(s\) checked/)
  })

  it('first push of another branch: checks the commits not on origin/main', () => {
    const { ci, head } = repos(GOOD)
    git(ci, ['checkout', '-q', '-b', 'topic'])
    const topic = commit(ci, 'c.txt', OTHER)
    const r = run(ci, { GITHUB_EVENT_NAME: 'push', PUSH_REF: 'refs/heads/topic', PUSH_BEFORE: ZERO, PUSH_AFTER: topic })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/in 1 commit\(s\)/)
    expect(head).not.toBe(topic)
  })

  it('pull_request: checks the pull request commits', () => {
    const bad = repos(OTHER)
    expect(run(bad.ci, { GITHUB_EVENT_NAME: 'pull_request', PR_BASE_SHA: bad.base, PR_HEAD_SHA: bad.head }).code).toBe(
      1,
    )
    const good = repos(GOOD)
    expect(
      run(good.ci, { GITHUB_EVENT_NAME: 'pull_request', PR_BASE_SHA: good.base, PR_HEAD_SHA: good.head }).code,
    ).toBe(0)
  })

  it('an empty allowlist fails closed; other events check nothing', () => {
    const { ci } = repos(GOOD)
    expect(run(ci, { ALLOWED_COMMIT_EMAILS: ' , ' }).code).toBe(1)
    expect(run(ci, { GITHUB_EVENT_NAME: 'workflow_dispatch' }).code).toBe(0)
  })
})
