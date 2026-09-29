// Small helpers for the end-to-end specs. The hooks they rely on (data-phone, data-testid) are
// part of the UI contract; see CONTRIBUTING.md.
import { expect, type Locator, type Page } from '@playwright/test'
import { checkInputs, formatFinding } from '../../scripts/banned-core'

/** Opens a route of the app, e.g. open(page, '#/about'). Relative to baseURL (/mobile/next/). */
export async function open(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`./${hash}`)
  await page.locator('#root > *').first().waitFor()
}

/** The root of one phone ("ana", "cafe", ...). */
export function phone(page: Page, persona: string): Locator {
  return page.locator(`[data-phone="${persona}"]`)
}

/** The balance element of a persona (first match on the page). */
export function balance(page: Page, personaId: string): Locator {
  return page.locator(`[data-testid="balance-${personaId}"]`).first()
}

const AMOUNT = /\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/

/** The formatted amount shown in a persona's balance, e.g. "236.50". */
export async function readBalance(page: Page, personaId: string): Promise<string> {
  const text = await balance(page, personaId).innerText()
  const match = text.match(AMOUNT)
  if (!match) throw new Error(`No amount in balance-${personaId}: "${text}"`)
  return match[0]
}

/** Waits until a persona's balance shows `amount` (settling is animated). */
export async function expectBalance(page: Page, personaId: string, amount: string): Promise<void> {
  await expect.poll(() => readBalance(page, personaId), { message: `balance-${personaId}` }).toBe(amount)
}

/** Every request to another origin (the app must make none). Call before navigating. */
export function trackForeignRequests(page: Page, baseURL: string): string[] {
  const origin = new URL(baseURL).origin
  const foreign: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (url.startsWith('data:') || url.startsWith('blob:')) return
    if (new URL(url).origin !== origin) foreign.push(url)
  })
  return foreign
}

/** Waits until a service worker controls the page (reload once if needed). */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload()
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  }
}

/** The page carries noindex. */
export async function expectNoindex(page: Page): Promise<void> {
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
}

/**
 * What a visitor reads on the page: the rendered text, the placeholder,
 * aria-label, title and alt attributes, and document.title.
 */
export async function visibleTextOf(page: Page): Promise<string> {
  const text = await page.locator('body').innerText()
  const extra = await page.evaluate(() => {
    const out: string[] = [document.title]
    for (const el of document.querySelectorAll('[placeholder], [aria-label], [title], [alt]')) {
      for (const a of ['placeholder', 'aria-label', 'title', 'alt']) {
        const v = el.getAttribute(a)
        if (v) out.push(v)
      }
    }
    return out
  })
  return [text, ...extra].join('\n')
}

/** Findings of the rendered-text rules on what a visitor reads (empty = clean). */
export async function visibleFindings(page: Page): Promise<string[]> {
  return checkInputs([{ path: page.url(), text: await visibleTextOf(page), kind: 'visible' }]).map(formatFinding)
}

/** A downloaded file's name passes the rendered-text rules (CSV exports, state files). */
export function expectCleanFileName(name: string): void {
  expect(
    checkInputs([{ path: 'download', text: name.replace(/[-_.]/g, ' '), kind: 'visible' }]).map(formatFinding),
  ).toEqual([])
}

/**
 * The visible text of the page passes the banned-terms rules for visible copy, and there is no
 * marker, gate or disclaimer element (decision D16).
 */
export async function expectCleanVisibleCopy(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="simulation-marker"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="gate-continue"]')).toHaveCount(0)
  expect(await visibleFindings(page)).toEqual([])
}
