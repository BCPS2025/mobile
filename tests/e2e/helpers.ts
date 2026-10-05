// Small helpers for the end-to-end specs. The hooks they rely on (data-phone, data-testid) are
// part of the UI contract; see CONTRIBUTING.md.
import AxeBuilder from '@axe-core/playwright'
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
    await page.locator('[data-testid="stage"], [data-testid="phone-mode"], [data-testid="pay-page"]').first().waitFor()
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

// ---- journeys shared by several specs

/** The stage with Ana on the left and the café on the right, both logged in through biometrics. */
export async function stageBoth(page: Page, hash = '#/stage'): Promise<void> {
  await openApp(page, hash)
  await biometricLogin(page, 'left')
  await biometricLogin(page, 'right')
  await expect(slot(page, 'right').locator('[data-screen="pos.home"]')).toBeVisible()
}

/** The café (right phone) charges Flat white ×2 and Croissant ×2 and shows the payment code. */
export async function cafeShowsCode(page: Page): Promise<void> {
  const cafe = slot(page, 'right')
  await cafe.locator('[data-tile="charge"]').click()
  await expect(cafe.locator('[data-screen="pos.charge"]')).toBeVisible()
  for (const sku of ['flat-white', 'flat-white', 'croissant', 'croissant'])
    await cafe.getByTestId(`item-${sku}`).click()
  await cafe.getByRole('button', { name: 'Charge 11.00 BCPS' }).click()
  await expect(cafe.locator('[data-screen="pos.code"]')).toBeVisible()
}

/** Ana (left phone) scans the café's code and stops on the review. */
export async function anaScansToReview(page: Page): Promise<void> {
  const ana = slot(page, 'left')
  await ana.locator('[data-tile="scan"]').click()
  await expect(ana.getByTestId('scan-status')).toContainText('Locked · Café Lipa')
  await ana.getByRole('button', { name: 'Continue' }).click()
  await expect(ana.locator('[data-screen="c.payCode.review"]')).toBeVisible()
}

/** Ana pays the café's code from the review; both phones end on their PAID screens. */
export async function anaPaysCode(page: Page): Promise<void> {
  await slot(page, 'left').getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
  await expect(slot(page, 'left').locator('[data-screen="c.payCode.success"]')).toBeVisible({ timeout: 5000 })
  await expect(slot(page, 'right').locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
}

/** The id of the screen a phone shows (its `data-screen`). */
export async function screenOf(phoneLocator: Locator): Promise<string> {
  return (await phoneLocator.locator('[data-screen]').first().getAttribute('data-screen')) ?? ''
}

// ---- what must never be on a page (decisions D16, D34)

const FORBIDDEN_CONTROL_WORDS =
  /\b(clock|start from|save state|open a state file|state file|presenter tools|create account|sign up|register)\b/i

/**
 * No control offers the dropped features (the Clock, Start from…, state files, presenter tools,
 * Create account), no form, no field for an email, a password or a code, no autofill hint, no file
 * picker and no download link exist on the page.
 */
export async function expectNoForbiddenControls(page: Page): Promise<void> {
  const found = await page.evaluate((source) => {
    const words = new RegExp(source, 'i')
    const controls: string[] = []
    for (const el of document.querySelectorAll(
      'button, a[href], [role="button"], [role="switch"], [role="menuitem"], [role="tab"], [role="link"], [aria-label]',
    )) {
      const text = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`.replace(/\s+/g, ' ').trim()
      if (words.test(text)) controls.push(text.slice(0, 80))
    }
    return {
      controls,
      forms: document.querySelectorAll('form').length,
      fields: document.querySelectorAll('input[type="email"], input[type="password"], input[type="file"]').length,
      autofill: document.querySelectorAll(
        '[autocomplete="email"], [autocomplete="one-time-code"], [autocomplete="username"], [autocomplete="current-password"], [autocomplete="new-password"]',
      ).length,
      downloads: document.querySelectorAll('a[download]').length,
    }
  }, FORBIDDEN_CONTROL_WORDS.source)
  expect(found).toEqual({ controls: [], forms: 0, fields: 0, autofill: 0, downloads: 0 })
}

/** The `data-screen` of every element that shows the word PLANNED ('page' outside a phone). */
export async function plannedScreens(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!/PLANNED/i.test(node.textContent ?? '')) continue
      out.push(node.parentElement?.closest('[data-screen]')?.getAttribute('data-screen') ?? 'page')
    }
    return out
  })
}

// ---- accessibility

/**
 * No serious or critical accessibility violation (axe) on what the page shows now, or inside
 * `within` (a CSS selector). Moderate and minor findings are not part of the gate.
 */
export async function expectNoSeriousViolations(page: Page, where: string, within?: string): Promise<void> {
  let axe = new AxeBuilder({ page })
  if (within) axe = axe.include(within)
  const { violations } = await axe.analyze()
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id} (${v.impact}) ${v.help}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 4)
          .join(' | ')}`,
    )
  expect(serious, `axe on ${where}`).toEqual([])
}

/** The stage with Ana on the left and Marko on the right (through the account menu), both on Home. */
export async function anaAndMarko(page: Page, hash = '#/stage'): Promise<void> {
  await openApp(page, hash)
  await biometricLogin(page, 'left')
  await page.getByTestId('account-menu-right').click()
  await page.getByTestId('account-marko').click()
  await expect(slot(page, 'right')).toHaveAttribute('data-persona', 'marko')
  await expect(slot(page, 'right').locator('[data-screen="c.home"]')).toBeVisible()
}

/** Types an amount on the keypad of a phone ("16.50"). */
export async function typeAmount(phoneLocator: Locator, amount: string): Promise<void> {
  for (const ch of amount) await phoneLocator.locator(`[data-key="${ch}"]`).click()
}
