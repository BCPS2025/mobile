// Navigation of the phone runtime, over the screens that are live: Back and Home on every screen
// below Home, one hub level, a flow that ends on its own screen, the saved hub after a reload,
// and no dead end. The crawl grows with the screens each milestone makes live.
import { type Page, expect, test } from '@playwright/test'
import {
  SALE,
  anaScansToReview,
  cafeShowsCode,
  expectBalance,
  expectNoSeriousViolations,
  openApp,
  pay,
  slot,
  stageBoth,
} from './helpers'

test.use({ viewport: { width: 390, height: 664 } })

const cases = [
  { who: 'ana', shell: 'c.home', hub: 'c.profile', avatar: 'Profile' },
  { who: 'cafe', shell: 'pos.home', hub: 'biz.settings', avatar: 'Settings' },
]

for (const c of cases) {
  test.describe(`${c.who}: the avatar opens ${c.avatar} ${c.who === 'ana' ? '@webkit' : ''}`, () => {
    test('hub, About and Log out have Back and Home; Back pops one screen; Home returns Home', async ({ page }) => {
      await openApp(page, `#/phone/${c.who}`)
      await expect(page.locator(`[data-screen="${c.shell}"]`)).toBeVisible()
      await expect(page.getByTestId('avatar')).toHaveAccessibleName(c.avatar)
      // Home itself has neither Back nor Home in its header.
      await expect(page.getByTestId('nav-back')).toHaveCount(0)
      await page.getByTestId('avatar').click()
      const hub = page.locator(`[data-screen="${c.hub}"]`)
      await expect(hub).toBeVisible()
      // A screen that opens takes the focus, so a keyboard or screen-reader user starts at its top.
      await expect(hub).toBeFocused()
      await expect(page.getByTestId('nav-back')).toBeVisible()
      await expect(page.getByTestId('nav-home')).toBeVisible()
      await page.getByRole('button', { name: 'About BCPS' }).click()
      await expect(page.locator('[data-screen="shared.about"]')).toBeVisible()
      await expect(page.getByText('€1 ≈ 1.10 BCPS')).toBeVisible()
      await expect(page.getByText('BCPS will never ask you to send money or crypto.')).toBeVisible()
      await expect(page.getByText('Other people only see your name and @username.')).toBeVisible()
      await page.getByTestId('nav-back').click()
      await expect(hub).toBeVisible()
      await page.getByTestId('nav-home').click()
      await expect(page.locator(`[data-screen="${c.shell}"]`)).toBeVisible()
      await expect(page.locator(`[data-screen="${c.shell}"]`)).toBeFocused()
    })

    test('Log out: a confirm step with Cancel and Log out; Welcome remembers the account', async ({ page }) => {
      await openApp(page, `#/phone/${c.who}`)
      await page.getByTestId('avatar').click()
      await page.getByRole('button', { name: 'Log out' }).click()
      const step = page.locator('[data-screen="auth.logout"]')
      await expect(step).toContainText('Log out?')
      await expect(step).toContainText(
        'To come back, choose your account and enter the code from Mail, or use biometrics.',
      )
      await expect(page.getByTestId('nav-back')).toBeVisible()
      await expect(page.getByTestId('nav-home')).toBeVisible()
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.locator(`[data-screen="${c.hub}"]`)).toBeVisible()
      await page.getByRole('button', { name: 'Log out' }).click()
      await page.getByTestId('dock-primary').click()
      await expect(page.locator('[data-screen="auth.welcome"]')).toBeVisible()
      await expect(slot(page, 'single')).toHaveAttribute('data-persona', 'none')
      await expect(page.getByTestId('welcome-account')).toContainText(
        c.who === 'ana' ? 'Ana Novak' : 'Business account · Café Lipa',
      )
    })

    test('the hub is saved: a reload returns to it, and Back from there is Home', async ({ page }) => {
      await openApp(page, `#/phone/${c.who}`)
      await page.getByTestId('avatar').click()
      await expect(page.locator(`[data-screen="${c.hub}"]`)).toBeVisible()
      await page.reload()
      await expect(page.locator(`[data-screen="${c.hub}"]`)).toBeVisible()
      await page.getByTestId('nav-back').click()
      await expect(page.locator(`[data-screen="${c.shell}"]`)).toBeVisible()
    })
  })
}

test('each persona keeps its own stack while accounts switch', async ({ page }) => {
  await openApp(page, '#/phone/ana')
  await page.getByTestId('avatar').click()
  await page.getByRole('button', { name: 'About BCPS' }).click()
  await page.getByTestId('pill').click()
  await page.getByTestId('account-cafe').click()
  await expect(page.locator('[data-screen="pos.home"]')).toBeVisible()
  await page.getByTestId('pill').click()
  await page.getByTestId('account-ana').click()
  await expect(page.locator('[data-screen="shared.about"]')).toBeVisible()
})

test.describe('the café: every live tile, hub row, view, detail and the first step of every flow', () => {
  const hasBackAndHome = async (page: import('@playwright/test').Page) => {
    await expect(page.getByTestId('nav-back')).toBeVisible()
    await expect(page.getByTestId('nav-home')).toBeVisible()
  }

  test('Back and Home are on every screen below Home, and Back pops one screen', async ({ page }) => {
    await openApp(page, '#/phone/cafe')
    const home = page.locator('[data-screen="pos.home"]')
    await expect(home).toBeVisible()

    // Charge: the items, then the code and its Cancel question; Back leaves one step at a time.
    await page.locator('[data-tile="charge"]').click()
    await expect(page.locator('[data-screen="pos.charge"]')).toBeVisible()
    await hasBackAndHome(page)
    await page.getByTestId('item-espresso').click()
    await page.getByRole('button', { name: 'Charge 2.20 BCPS' }).click()
    await expect(page.locator('[data-screen="pos.code"]')).toBeVisible()
    await hasBackAndHome(page)
    await page.getByTestId('nav-back').click()
    await expect(page.locator('[data-screen="pos.code.cancel"]')).toBeVisible()
    await hasBackAndHome(page)
    await page.getByTestId('nav-back').click()
    await expect(page.locator('[data-screen="pos.code"]')).toBeVisible()
    await page.getByTestId('nav-home').click()
    await expect(home).toBeVisible()

    // Sales › All payments › a payment, and back out.
    await page.locator('[data-tile="sales"]').click()
    await expect(page.locator('[data-screen="pos.sales"]')).toBeVisible()
    await hasBackAndHome(page)
    await page.getByTestId('row-allPayments').click()
    const history = page.locator('[data-screen="biz.history"]')
    await expect(history).toBeVisible()
    await hasBackAndHome(page)
    await history.locator('button[data-testid^="tx-BC-"]').first().click()
    await expect(page.locator('[data-screen="shared.tx"]')).toBeVisible()
    await hasBackAndHome(page)
    await page.getByTestId('nav-back').click()
    await expect(history).toBeVisible()
    await page.getByTestId('nav-back').click()
    await expect(page.locator('[data-screen="pos.sales"]')).toBeVisible()
    await page.getByTestId('nav-home').click()

    // Pay › Pay supplier (opens on its review) and back.
    await page.locator('[data-tile="pay"]').click()
    await expect(page.locator('[data-screen="pos.pay"]')).toBeVisible()
    await hasBackAndHome(page)
    await page.getByTestId('row-paySupplier').click()
    await expect(page.locator('[data-screen="biz.send.review"]')).toBeVisible()
    await hasBackAndHome(page)
    await page.getByTestId('nav-back').click()
    await expect(page.locator('[data-screen="pos.pay"]')).toBeVisible()
    await page.getByTestId('nav-home').click()

    // Cash out: its list, then each row and its first screen.
    await page.locator('[data-tile="cashOut"]').click()
    await expect(page.locator('[data-screen="pos.cashOut"]')).toBeVisible()
    await hasBackAndHome(page)
    for (const [row, screen] of [
      ['cashOut', 'shared.cashout.amount'],
      ['topup', 'shared.topup.amount'],
      ['autoConvert', 'biz.autoconvert.onoff'],
      ['payoutHistory', 'biz.payouts'],
    ] as const) {
      await page.getByTestId(`row-${row}`).click()
      await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible()
      await hasBackAndHome(page)
      await page.getByTestId('nav-back').click()
      await expect(page.locator('[data-screen="pos.cashOut"]')).toBeVisible()
    }
    await page.getByTestId('nav-home').click()

    // The bell.
    await page.getByTestId('bell').click()
    await expect(page.locator('[data-screen="shared.notifications"]')).toBeVisible()
    await hasBackAndHome(page)
    await page.getByTestId('nav-back').click()
    await expect(home).toBeVisible()
  })
})

// ---- the crawler: every live tile, hub row, view and detail, and the first step of every flow

const MARKO_TO_ANA = {
  actor: 'marko',
  to: '@ana',
  amount: 1000,
  debit: 1010,
  note: 'Lunch',
} as const

/** Screens the designs draw with Home and a [Done] button but no Back (their [Done] goes back). */
const ENDS_WITH_DONE = new Set(['biz.received'])

interface Crawled {
  /** Screens reached, with the deepest level each was found at (Home is 0). */
  screens: Map<string, number>
}

/** The screen a phone shows now. */
const screenId = async (page: Page) =>
  (await slot(page, 'single').locator('[data-screen]').first().getAttribute('data-screen')) ?? ''

/**
 * Walks the phone from Home: every tile, the avatar and the bell, and on every list the rows, the
 * first payments and the first notification. Each screen below Home has Back and Home; Back
 * returns to the screen it came from; Home leaves in one tap.
 */
async function crawl(page: Page, home: string): Promise<Crawled> {
  const screens = new Map<string, number>()
  const CHILDREN =
    '[data-testid^="row-"], button[data-testid^="tx-BC-"], [data-testid^="notification-"], [data-testid^="pay-item-"], button[data-testid^="status-"]'

  async function children(id: string): Promise<string[]> {
    const phone = slot(page, 'single')
    if (id === home) {
      const tiles = await phone
        .locator('[data-tile]')
        .evaluateAll((els) => els.map((e) => `[data-tile="${e.getAttribute('data-tile')}"]`))
      return [...tiles, '[data-testid="avatar"]', '[data-testid="bell"]']
    }
    const all = await phone
      .locator(`[data-screen="${id}"] :is(${CHILDREN})`)
      .evaluateAll((els) => els.map((e) => `[data-testid="${e.getAttribute('data-testid')}"]`))
    // The first two payments and the first notification are enough to prove the detail.
    const seen = { tx: 0, notification: 0 }
    return all.filter((sel) => {
      if (sel.includes('"tx-BC-')) return ++seen.tx <= 2
      if (sel.includes('"notification-')) return ++seen.notification <= 1
      return true
    })
  }

  /** Back, or [Done] on a screen without Back. */
  async function leave() {
    const back = page.getByTestId('nav-back')
    if ((await back.count()) > 0) await back.click()
    else await slot(page, 'single').getByRole('button', { name: 'Done' }).click()
  }

  async function replay(path: string[]) {
    for (const sel of path) await slot(page, 'single').locator(sel).first().click()
  }

  async function visit(path: string[]): Promise<void> {
    const id = await screenId(page)
    const depth = path.length
    screens.set(id, Math.max(depth, screens.get(id) ?? 0))
    if (depth > 0) {
      await expect(page.getByTestId('nav-home'), `${id}: Home`).toBeEnabled()
      if (ENDS_WITH_DONE.has(id)) {
        // A screen drawn without Back (the designs give it Home and [Done]).
        await expect(page.getByTestId('nav-back'), `${id}: no Back`).toHaveCount(0)
        await expect(slot(page, 'single').getByRole('button', { name: 'Done' }), `${id}: Done`).toBeEnabled()
      } else {
        await expect(page.getByTestId('nav-back'), `${id}: Back`).toBeEnabled()
      }
      // The screen that opened has the focus, or the keypad inside it (an amount step takes the keyboard).
      await expect
        .poll(
          () =>
            slot(page, 'single')
              .locator(`[data-screen="${id}"]`)
              .first()
              .evaluate((el) => el.contains(document.activeElement)),
          { message: `${id}: focus` },
        )
        .toBe(true)
    }
    for (const sel of await children(id)) {
      await slot(page, 'single').locator(sel).first().click()
      await visit([...path, sel])
      await leave()
      expect(await screenId(page), `Back from ${sel} returns to ${id}`).toBe(id)
    }
    if (depth > 0) {
      // Home leaves in one tap, wherever we are; then back to where the walk was.
      await page.getByTestId('nav-home').click()
      expect(await screenId(page), `Home from ${id}`).toBe(home)
      await replay(path)
    }
  }

  expect(await screenId(page)).toBe(home)
  await visit([])
  return { screens }
}

test.describe('the crawler', () => {
  test('Ana @webkit: every tile, row, view, detail and first step has Back and Home; nothing is deeper than five', async ({
    page,
  }) => {
    await openApp(page, '#/phone/ana')
    await pay(page, MARKO_TO_ANA) // one notification to open
    await expectBalance(page, 'ana', '257.50')
    const { screens } = await crawl(page, 'c.home')
    expect([...screens.keys()].sort()).toEqual(
      [
        'auth.logout',
        'c.history',
        'c.home',
        'c.link.amount',
        'c.mycode',
        'c.payItem.review',
        'c.payRequest.hub',
        'c.profile',
        'c.request.from',
        'c.scan',
        'c.send.to',
        'c.split.pick',
        'c.wallet.hub',
        'shared.about',
        'shared.cashout.amount',
        'shared.notifications',
        'shared.topup.amount',
        'shared.tx',
      ].sort(),
    )
    // home › hub › view › detail › detail: at most five on the stack, so at most four deep.
    expect(Math.max(...screens.values())).toBeLessThanOrEqual(4)
  })

  test('the café: every tile, row, view, detail and first step has Back and Home', async ({ page }) => {
    await openApp(page, '#/phone/cafe')
    await pay(page, SALE) // a sale to list, and a notification to open
    await expectBalance(page, 'cafe', '296.89')
    const { screens } = await crawl(page, 'pos.home')
    expect([...screens.keys()].sort()).toEqual(
      [
        'auth.logout',
        'biz.autoconvert.onoff',
        'biz.history',
        'biz.payouts',
        'biz.received',
        'biz.refund.pick',
        'biz.send.review',
        'biz.settings',
        'pos.cashOut',
        'pos.charge',
        'pos.home',
        'pos.pay',
        'pos.sales',
        'shared.about',
        'shared.cashout.amount',
        'shared.notifications',
        'shared.topup.amount',
        'shared.tx',
      ].sort(),
    )
    expect(Math.max(...screens.values())).toBeLessThanOrEqual(4)
  })
})

// ---- accessibility: no serious or critical axe violation on the Homes, one step of each kind, a
// success screen and the stage chrome (motion is off so that a fade never decides a contrast)

test.describe('accessibility (axe)', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the gate finds a serious violation, also inside a phone', async ({ page }) => {
    await page.setContent(
      '<title>BCPS</title><main><h1>BCPS</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main>',
    )
    await expect(expectNoSeriousViolations(page, 'a picture without a description')).rejects.toThrow(/image-alt/)
    await page.setViewportSize({ width: 1280, height: 720 })
    await openApp(page, '#/stage')
    await page.evaluate(() => {
      document
        .querySelector('[data-slot="left"] [data-screen]')
        ?.insertAdjacentHTML('beforeend', '<p style="color:#8a8a8a;background:#909090">Low contrast</p>')
    })
    await expect(expectNoSeriousViolations(page, 'low contrast in a phone')).rejects.toThrow(/color-contrast/)
  })

  test('the landing page, About and Welcome', async ({ page }) => {
    await openApp(page, '#/')
    await expectNoSeriousViolations(page, 'landing page')
    await openApp(page, '#/about')
    await expectNoSeriousViolations(page, 'About')
    await openApp(page, '#/phone')
    await expectNoSeriousViolations(page, 'Welcome')
  })

  test('phone mode: Log in, the code, both Homes, a hub, a list and its detail', async ({ page }) => {
    await openApp(page, '#/phone')
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await page.getByTestId('login-ana').click()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await expectNoSeriousViolations(page, 'Log in · complete')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('button', { name: 'Verify and log in' })).toBeEnabled()
    await expectNoSeriousViolations(page, 'Enter the code · filled')
    await page.getByRole('button', { name: 'Verify and log in' }).click()
    await expect(page.locator('[data-screen="c.home"]')).toBeVisible()
    await expectNoSeriousViolations(page, 'People · Home')
    await page.getByTestId('avatar').click()
    await expectNoSeriousViolations(page, 'Profile (a hub)')
    await page.getByTestId('nav-home').click()
    await page.locator('[data-tile="history"]').click()
    await expectNoSeriousViolations(page, 'History (a list)')
    await page.locator('button[data-testid^="tx-BC-"]').first().click()
    await expectNoSeriousViolations(page, 'Payment detail')
    await page.getByTestId('nav-home').click()
    await page.getByTestId('bell').click()
    await expectNoSeriousViolations(page, 'Notifications · Empty')

    await openApp(page, '#/phone/cafe')
    await expectNoSeriousViolations(page, 'Café · Home')
    await page.locator('[data-tile="sales"]').click()
    await expectNoSeriousViolations(page, 'Sales (a hub, business)')
  })

  test('one step of each kind: pick, amount, note, review, confirm, waiting for a code, and both success screens', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1280, height: 720 })
    await stageBoth(page)
    const ana = slot(page, 'left')
    const cafe = slot(page, 'right')

    // Send: an input step of each sort, the review, the sending state, the success screen.
    await ana.locator('[data-tile="payRequest"]').click()
    await ana.getByTestId('row-send').click()
    await expectNoSeriousViolations(page, 'Send · Choose a person')
    await ana.getByTestId('party-search').fill('@marko')
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expectNoSeriousViolations(page, 'Send · Enter an amount')
    for (const ch of '300') await ana.locator(`[data-key="${ch}"]`).click()
    await expectNoSeriousViolations(page, 'Send · Not enough balance')
    for (let i = 0; i < 3; i++) await ana.locator('[data-key="del"]').click()
    for (const ch of '16.50') await ana.locator(`[data-key="${ch}"]`).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await expectNoSeriousViolations(page, 'Send · Add a note')
    await ana.getByRole('button', { name: 'Cinema', exact: true }).click()
    await ana.getByRole('button', { name: 'Continue' }).click()
    await ana.getByTestId('fee-line').click()
    await expectNoSeriousViolations(page, 'Send · Review · fee explained')
    await ana.getByRole('button', { name: 'Send 16.67 BCPS' }).click()
    await expect(ana.locator('[data-screen="c.send.success"]')).toBeVisible({ timeout: 5000 })
    await expectNoSeriousViolations(page, 'Sent (success, money)')
    await ana.getByRole('button', { name: 'Done' }).click()

    // The café: Charge, the code (waiting for a payment), the Cancel question, Scan, the pay
    // review, PAID on both phones.
    await cafeShowsCode(page)
    await expectNoSeriousViolations(page, 'Charge · Payment code')
    await cafe.getByTestId('nav-back').click()
    await expect(cafe.locator('[data-screen="pos.code.cancel"]')).toBeVisible()
    await expectNoSeriousViolations(page, 'Cancel charge (a confirm step)')
    await cafe.getByRole('button', { name: 'Keep' }).click()
    await anaScansToReview(page)
    await expectNoSeriousViolations(page, 'Scan · Locked, then the pay review')
    await ana.getByRole('button', { name: 'Pay 11.00 BCPS' }).click()
    await expect(cafe.locator('[data-screen="pos.paid"]')).toBeVisible({ timeout: 5000 })
    await expectNoSeriousViolations(page, 'PAID on both phones')
    await ana.getByRole('button', { name: 'Done' }).click()
    await ana.getByTestId('avatar').click()
    await ana.getByRole('button', { name: 'Log out' }).click()
    await expectNoSeriousViolations(page, 'Log out? (a confirm step)')
  })

  test('the stage chrome: the top bar, role labels, tape, menus, Settings, Reset, the shortcut list, a toast', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openApp(page, '#/stage')
    await expectNoSeriousViolations(page, 'stage · Welcome on both phones')
    await stageBoth(page)
    await expectNoSeriousViolations(page, 'stage · both Homes')
    await pay(page, SALE)
    await expect(page.getByTestId('tape-row').first()).toContainText('settled')
    await expectNoSeriousViolations(page, 'stage · tape and session counter')
    await pay(page, { ...SALE, to: '@marko', channel: 'username', items: undefined, amount: 500, debit: 505 })
    await expect(page.getByTestId('toast')).toBeVisible()
    await expectNoSeriousViolations(page, 'stage · gutter toast')
    await page.getByTestId('account-menu-left').click()
    await expectNoSeriousViolations(page, 'stage · account menu')
    await page.keyboard.press('Escape')
    await page.getByTestId('settings').click()
    await expectNoSeriousViolations(page, 'stage · Settings')
    await page.getByTestId('settings-done').click()
    await page.getByTestId('reset').click()
    await expectNoSeriousViolations(page, 'stage · Reset?')
    await page.getByTestId('reset-confirm').click()
    await expect(page.getByTestId('reset-toast')).toBeVisible()
    await expectNoSeriousViolations(page, 'stage · Everything reset')
    await page.keyboard.press('?')
    await expectNoSeriousViolations(page, 'stage · shortcut list')
  })
})
