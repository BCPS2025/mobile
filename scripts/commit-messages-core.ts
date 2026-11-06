// Pure part of scripts/check-commit-messages.ts: commit messages as check-banned Markdown inputs.
import type { Input } from './banned-core'

/** "Key: value <address>" trailer lines (Co-Authored-By, Signed-off-by). */
const TRAILER = /^[A-Za-z][A-Za-z-]*:\s.*<[^>]*@[^>]*>\s*$/

/** A commit message without its trailer lines (line numbers stay put). */
export function scannedMessage(message: string): string {
  return message
    .split('\n')
    .map((line) => (TRAILER.test(line) ? '' : line))
    .join('\n')
}

/** One Markdown input per commit: the message's subject and body. */
export function messageInputs(commits: readonly { sha: string; message: string }[]): Input[] {
  return commits.map((c) => ({
    path: `commit ${c.sha.slice(0, 7)}`,
    text: scannedMessage(c.message),
    kind: 'markdown',
  }))
}
