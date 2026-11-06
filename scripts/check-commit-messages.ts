// Commit-message hygiene (public repository): runs the check-banned rules for Markdown (words,
// source references, pattern classes, visible-copy rules) over the messages of a commit range,
// so a range is clean before it is pushed. Trailer lines such as "Co-Authored-By: Name <address>"
// are not scanned. Needs Node 22.18+ / 23.6+ (built-in type stripping).
//
// Usage: node scripts/check-commit-messages.ts <range>      for example main..next
// Not part of the CI gate yet: the unpublished history is rebuilt with neutral messages first
// (deployment step 0.7a); run it on the rebuilt range before the first push.
import { execFileSync } from 'node:child_process'
import { checkInputs, formatFinding } from './banned-core.ts'
import { messageInputs } from './commit-messages-core.ts'

function commitsOf(range: string): { sha: string; message: string }[] {
  const out = execFileSync('git', ['log', '--format=%H%x00%B%x01', range], { encoding: 'utf8', stdio: 'pipe' })
  return out
    .split('\u0001')
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const at = chunk.indexOf('\u0000')
      return { sha: chunk.slice(0, at), message: chunk.slice(at + 1) }
    })
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const range = process.argv[2]
  if (!range) {
    console.error('check-commit-messages: give a range, for example main..next')
    process.exit(2)
  }
  const commits = commitsOf(range)
  const findings = checkInputs(messageInputs(commits))
  if (findings.length > 0) {
    console.error(`check-commit-messages: ${findings.length} finding(s) in ${commits.length} commit(s)`)
    for (const f of findings) console.error(`  ${formatFinding(f)}`)
    process.exit(1)
  }
  console.log(`check-commit-messages: ${commits.length} commit message(s) clean`)
}
