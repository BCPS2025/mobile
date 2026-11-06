// Renders the app icons into public/brand/ from the emblem in src/assets/brand/:
//   icon-192.png, icon-512.png       emblem on navy, emblem width 84 % of the canvas
//   icon-maskable-512.png            emblem width 72 %, inside the safe circle of a maskable icon
//   apple-touch-icon.png             180 px, opaque
//   favicon.svg, favicon-32.png      the wordmark square (green on navy); the emblem is illegible
//                                    at 16 to 32 px
// Run after an emblem or wordmark change: node scripts/render-icons.mjs
// Uses the Playwright Chromium already installed for the end-to-end tests; nothing is fetched
// from the network. The PNGs are palette-quantised (opaque, at most 256 colours) so that each
// stays well under its size budget, and the bottom-right corner of every icon is checked to be
// exactly navy (the image generator's mark can never appear there).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { decodePng, encodePalettePng } from './brand/png-core.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public/brand')
const emblemPng = readFileSync(join(root, 'src/assets/brand/emblem-900.png')).toString('base64')

// Colours from src/app/tokens.css: navy-900 background, green-500 square.
const NAVY = [13, 27, 42]
const NAVY_HEX = '#0D1B2A'
const GREEN_HEX = '#00E676'
const MAX_BYTES = 60_000

const ICONS = [
  { file: 'icon-192.png', size: 192, emblemWidth: 0.84 },
  { file: 'icon-512.png', size: 512, emblemWidth: 0.84 },
  { file: 'icon-maskable-512.png', size: 512, emblemWidth: 0.72 },
  { file: 'apple-touch-icon.png', size: 180, emblemWidth: 0.8 },
]

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>BCPS</title><rect width="32" height="32" fill="${NAVY_HEX}"/><rect x="9" y="9" width="14" height="14" fill="${GREEN_HEX}"/></svg>\n`

function toRgba(dataUrl) {
  return decodePng(new Uint8Array(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')))
}

/** Palette PNG of an image, with fewer colours until it fits the size budget. */
function encodeWithinBudget(rgba, name) {
  for (const colours of [256, 192, 128, 96, 64]) {
    const png = encodePalettePng(rgba, colours)
    if (png.length <= MAX_BYTES) return png
  }
  throw new Error(`${name} does not fit ${MAX_BYTES} bytes`)
}

/** The bottom-right 12 % square must be exactly navy. */
function assertNavyCorner(png, name) {
  const { width, height, data } = decodePng(png)
  const side = Math.ceil(width * 0.12)
  for (let y = height - side; y < height; y++) {
    for (let x = width - side; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i] !== NAVY[0] || data[i + 1] !== NAVY[1] || data[i + 2] !== NAVY[2] || data[i + 3] !== 255) {
        throw new Error(`${name}: pixel ${x},${y} is not navy`)
      }
    }
  }
}

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 })
  await page.setContent('<!doctype html><body style="margin:0"></body>')
  for (const icon of ICONS) {
    const dataUrl = await page.evaluate(
      async ({ emblemPng, icon, navy }) => {
        const img = new Image()
        img.src = `data:image/png;base64,${emblemPng}`
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = icon.size
        canvas.height = icon.size
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = navy
        ctx.fillRect(0, 0, icon.size, icon.size)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        const w = icon.size * icon.emblemWidth
        const h = (img.height * w) / img.width
        ctx.drawImage(img, (icon.size - w) / 2, (icon.size - h) / 2, w, h)
        return canvas.toDataURL('image/png')
      },
      { emblemPng, icon, navy: NAVY_HEX },
    )
    const png = encodeWithinBudget(toRgba(dataUrl), icon.file)
    assertNavyCorner(png, icon.file)
    writeFileSync(join(outDir, icon.file), png)
    console.log(`wrote public/brand/${icon.file} (${png.length} bytes)`)
  }

  writeFileSync(join(outDir, 'favicon.svg'), FAVICON_SVG)
  console.log('wrote public/brand/favicon.svg')
  const favicon = await page.evaluate(
    async ({ svg }) => {
      const img = new Image()
      img.src = `data:image/svg+xml;base64,${btoa(svg)}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 32
      canvas.getContext('2d').drawImage(img, 0, 0, 32, 32)
      return canvas.toDataURL('image/png')
    },
    { svg: FAVICON_SVG },
  )
  const faviconPng = encodePalettePng(toRgba(favicon))
  writeFileSync(join(outDir, 'favicon-32.png'), faviconPng)
  console.log(`wrote public/brand/favicon-32.png (${faviconPng.length} bytes)`)
} finally {
  await browser.close()
}
