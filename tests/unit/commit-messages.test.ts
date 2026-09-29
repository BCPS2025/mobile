// Meta-test of scripts/check-commit-messages.ts: the check-banned Markdown rules over commit
// messages, in memory and through the CLI on a scratch repository.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkInputs } from '../../scripts/banned-core'
import { messageInputs, scannedMessage } from '../../scripts/commit-messages-core'

const SCRIPT = fileURLToPath(new URL('../../scripts/check-commit-messages.ts', import.meta.url))
const TRAILER = 'Co-Authored-By: Someone <someone@example.com>'

function rulesOf(message: string): string[] {
  return checkInputs(messageInputs([{ sha: 'a'.repeat(40), message }])).map((f) => f.rule)
}

describe('commit messages, in memory', () => {
  it('passes a neutral message with a trailer', () => {
    expect(rulesOf(`Replay in linear time\n\nThe pending index is kept in order.\n\n${TRAILER}\n`)).toEqual([])
  })

  it('drops trailer lines but keeps line numbers', () => {
    expect(scannedMessage(`Subject\n\n${TRAILER}`)).toBe('Subject\n\n')
  })

  it('fails a D16 word in the subject or the body', () => {
    expect(rulesOf('Scaffold the simulator\n')).toContain('visible-copy')
    expect(rulesOf('Subject\n\nAdds sample data.\n')).toContain('visible-copy')
  })

  it('names the commit in the finding path', () => {
    const findings = checkInputs(messageInputs([{ sha: 'b'.repeat(40), message: 'Mock the clock\n' }]))
    expect(findings[0]?.path).toBe('commit bbbbbbb')
  })
})

describe('commit messages, CLI', () => {
  let dir = ''

  function git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: dir,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'x',
        GIT_AUTHOR_EMAIL: 'owner@bcps.example',
        GIT_COMMITTER_NAME: 'x',
        GIT_COMMITTER_EMAIL: 'owner@bcps.example',
      },
    }).trim()
  }

  function commit(file: string, message: string): void {
    writeFileSync(join(dir, file), file)
    git(['add', file])
    git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message])
  }

  function run(range: string) {
    const r = spawnSync(process.execPath, [SCRIPT, range], { cwd: dir, encoding: 'utf8' })
    return { code: r.status, out: `${r.stdout}${r.stderr}` }
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'commit-messages-'))
    git(['init', '-q', '-b', 'main'])
    commit('a', 'Base')
    git(['tag', 'base'])
    commit('b', `Neutral subject\n\n${TRAILER}`)
    git(['tag', 'clean'])
    commit('c', 'Add the preview script')
  })

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 on a clean range', () => {
    const r = run('base..clean')
    expect(r.code).toBe(0)
    expect(r.out).toContain('1 commit message(s) clean')
  })

  it('exits 1 on a range with a D16 word, naming the commit', () => {
    const r = run('base..HEAD')
    expect(r.code).toBe(1)
    expect(r.out).toContain(`commit ${git(['rev-parse', '--short=7', 'HEAD'])}`)
  })

  it('exits 2 without a range', () => {
    expect(spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' }).status).toBe(2)
  })
})
