// Renders the app icons (the BCPS wordmark on navy) to public/brand/icon-192.png and icon-512.png.
// Run once after a wordmark change: node scripts/render-icons.mjs
// Uses the Playwright Chromium already installed for the e2e tests; the font is the self-hosted
// Space Grotesk 700 from node_modules, so nothing is fetched from the network.
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public/brand')
const font = readFileSync(
  join(root, 'node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2'),
).toString('base64')

// Colours from src/app/tokens.css: navy-900 background, white letters, green-500 square.
const html = (size) => `<!doctype html><html><head><style>
@font-face { font-family: 'Space Grotesk'; font-weight: 700; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; width: ${size}px; height: ${size}px; background: #0D1B2A; }
body { display: flex; align-items: center; justify-content: center; }
.mark { display: inline-flex; align-items: baseline; color: #FFFFFF; font: 700 ${Math.round(size * 0.25)}px/1 'Space Grotesk';
  letter-spacing: -0.01em; transform: translateY(0.04em); }
.dot { display: inline-block; width: 0.28em; height: 0.28em; margin-left: 0.18em; background: #00E676; }
</style></head><body><span class="mark">BCPS<span class="dot"></span></span></body></html>`

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(html(size))
    await page.evaluate(() => document.fonts.ready)
    const ok = await page.evaluate(() => document.fonts.check("700 16px 'Space Grotesk'"))
    if (!ok) throw new Error('Space Grotesk did not load')
    const file = join(outDir, `icon-${size}.png`)
    await page.screenshot({ path: file, omitBackground: false })
    await page.close()
    console.log(`wrote ${file}`)
  }
} finally {
  await browser.close()
}
