// Meta-test of the honesty scan: what a visitor reads includes the
// placeholder, aria-label, title and alt attributes and document.title; masked emails pass and
// readable ones fail; downloaded file names are scanned too.
import { expect, test } from '@playwright/test'
import { expectCleanFileName, visibleFindings } from './helpers'

test.describe('honesty scan meta-test', () => {
  test('attributes and the document title are scanned; masked emails pass, readable ones fail', async ({ page }) => {
    await page.setContent(
      '<title>BCPS</title><button aria-label="Reset">Reset</button><p>Sent to ana.novak@•••••••</p>',
    )
    expect(await visibleFindings(page)).toEqual([])
    await page.setContent('<title>BCPS</title><button aria-label="Demo reset">Reset</button>')
    expect((await visibleFindings(page)).join('\n')).toContain('"Demo"')
    await page.setContent('<title>BCPS Preview</title><p>Hello</p>')
    expect((await visibleFindings(page)).join('\n')).toContain('"Preview"')
    await page.setContent(
      '<img alt="Sample card"><input placeholder="Fake amount"><p>Sent to ana.novak@example.com</p>',
    )
    const findings = (await visibleFindings(page)).join('\n')
    for (const match of ['"Sample"', '"Fake"', 'email']) expect(findings).toContain(match)
    expectCleanFileName('bcps-state-2026-09-25-1215.json')
    expect(() => expectCleanFileName('bcps-demo-state.json')).toThrow()
  })
})
