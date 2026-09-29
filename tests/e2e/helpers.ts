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

// ---- the phone runtime

/** Every e2e run uses the manual clock and a fixed start date: 25 September 2026, 12:15 in Ljubljana. */
export const APP_QUERY = '?clock=manual&epoch=2026-09-25'

/** Opens a route with the manual clock (`#/stage`, `#/phone`, …). */
export async function openApp(page: Page, hash = '#/', query = APP_QUERY): Promise<void> {
  await page.goto(`./${query}${hash}`)
  await page.locator('#root > *').first().waitFor()
  // The stage and phone mode load on demand: wait until the page itself stands.
  if (/^#\/(stage|phone|pay)/.test(hash)) {
    await page.locator('[data-testid="stage"], [data-testid="phone-mode"]').first().waitFor()
  }
}

/** A phone by slot: "left" and "right" on the stage, "single" in phone mode. */
export function slot(page: Page, which: 'left' | 'right' | 'single'): Locator {
  return page.locator(`[data-slot="${which}"]`)
}

/** Logs the account a phone remembers in through the biometrics button of Welcome. */
export async function biometricLogin(page: Page, which: 'left' | 'right' | 'single'): Promise<void> {
  await slot(page, which).getByRole('button', { name: 'Log in with biometrics' }).click()
  await expect(slot(page, which)).not.toHaveAttribute('data-persona', 'none')
}

interface PayBody {
  actor: string
  to: string
  /** Hundredths. */
  amount: number
  /** What the sender is debited, hundredths (the review step's figure). */
  debit: number
  channel?: 'username' | 'qr'
  note?: string
  items?: { sku: string; name: string; qty: number; price: number }[]
}

let cmdCounter = 0

/** A payment as the test hook of the manual clock sends it (the same command a review step sends). */
export async function pay(page: Page, body: PayBody): Promise<void> {
  const cmdId = `${(++cmdCounter + 0xe2e0000).toString(16).padStart(16, '0')}:review`
  const result = await page.evaluate(
    (b) => {
      const hook = (window as unknown as { __bcps: { dispatch(c: unknown): { ok: boolean } } }).__bcps
      return hook.dispatch({
        type: 'pay',
        actor: b.actor,
        cmdId: b.cmdId,
        to: b.to,
        amount: b.amount,
        channel: b.channel ?? 'username',
        ...(b.note ? { note: b.note } : {}),
        ...(b.items ? { items: b.items } : {}),
        expect: { senderDebit: b.debit },
      }).ok
    },
    { ...body, cmdId },
  )
  expect(result).toBe(true)
}

/** Ana pays the café 11.00 by QR for two flat whites and two croissants (fee 0.11 is the café's). */
export const SALE: PayBody = {
  actor: 'ana',
  to: '@cafelipa',
  amount: 1100,
  debit: 1100,
  channel: 'qr',
  items: [
    { sku: 'flat-white', name: 'Flat white', qty: 2, price: 330 },
    { sku: 'croissant', name: 'Croissant', qty: 2, price: 220 },
  ],
}

/** Ana sends Marko 16.50 with the note "Cinema" (total 16.67 with her 0.17 fee). */
export const SEND: PayBody = { actor: 'ana', to: '@marko', amount: 1650, debit: 1667, note: 'Cinema' }

/** Whether two boxes overlap. */
export function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}
