// Extracts the chain-bridge emblem from the 2048 × 2048 source logo (blue background, silver
// emblem) into transparent images for the app:
//   src/assets/brand/emblem-900.webp, emblem-900.png   Welcome (about 300 CSS px wide, 3×)
//   src/assets/brand/emblem-450.webp                   Log in and Enter the code (about 150 px)
// and, with --preview <folder>, the full-size extraction and emblem-on-navy.png for approval
// (these stay outside the repository).
//
//   node scripts/brand/extract-emblem.mjs "<path to the source logo>" [--preview <folder>]
//
// The source image is never committed. The key: alpha from the weakest colour channel (the blue
// background has low red and green, the emblem is near-neutral silver), the colour re-derived
// from luminance, so no blue fringe stays. The bottom-right 360 × 360 source pixels are always
// cleared, so the image generator's mark in that corner can never enter the crop. Runs in the
// Playwright Chromium that the end-to-end tests already use; nothing is fetched from the network.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { encodePalettePng } from './png-core.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const source = args.find((a) => !a.startsWith('--'))
const previewAt = args.indexOf('--preview')
const preview = previewAt >= 0 ? resolve(args[previewAt + 1] ?? '') : null
if (!source) {
  console.error('usage: node scripts/brand/extract-emblem.mjs <source.png> [--preview <folder>]')
  process.exit(2)
}
const outDir = join(root, 'src/assets/brand')

/** Key thresholds on min(R, G, B), and the corner that is always cleared. */
const KEY = { low: 95, high: 215, corner: 360, pad: 24, bboxAlpha: 0.25 }

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const b64 = readFileSync(source).toString('base64')
  const out = await page.evaluate(
    async ({ b64, KEY }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const W = img.width
      const H = img.height
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, W, H)
      const p = d.data
      let x0 = W
      let y0 = H
      let x1 = -1
      let y1 = -1
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4
          const r = p[i]
          const g = p[i + 1]
          const bl = p[i + 2]
          let a = (Math.min(r, g, bl) - KEY.low) / (KEY.high - KEY.low)
          a = a < 0 ? 0 : a > 1 ? 1 : a
          if (x >= W - KEY.corner && y >= H - KEY.corner) a = 0
          const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bl)
          const v = Math.min(255, Math.round(lum * 1.05 + 10))
          p[i] = v
          p[i + 1] = v
          p[i + 2] = Math.min(255, v + 4)
          p[i + 3] = Math.round(a * 255)
          if (a > KEY.bboxAlpha) {
            if (x < x0) x0 = x
            if (y < y0) y0 = y
            if (x > x1) x1 = x
            if (y > y1) y1 = y
          }
        }
      }
      if (x1 < 0) throw new Error('no emblem found')
      ctx.putImageData(d, 0, 0)
      x0 = Math.max(0, x0 - KEY.pad)
      y0 = Math.max(0, y0 - KEY.pad)
      x1 = Math.min(W - 1, x1 + KEY.pad)
      y1 = Math.min(H - 1, y1 + KEY.pad)
      if (x1 >= W - KEY.corner && y1 >= H - KEY.corner) throw new Error('the crop reaches the cleared corner')
      const cw = x1 - x0 + 1
      const ch = y1 - y0 + 1
      const master = document.createElement('canvas')
      master.width = cw
      master.height = ch
      master.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch)
      const scaled = (w) => {
        const h = Math.round((ch * w) / cw)
        const s = document.createElement('canvas')
        s.width = w
        s.height = h
        const sc = s.getContext('2d')
        sc.imageSmoothingEnabled = true
        sc.imageSmoothingQuality = 'high'
        sc.drawImage(master, 0, 0, w, h)
        return s
      }
      const rgba = (canvas) => {
        const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
        let bin = ''
        for (const v of px.data) bin += String.fromCharCode(v)
        return { width: canvas.width, height: canvas.height, b64: btoa(bin) }
      }
      const s900 = scaled(900)
      const s450 = scaled(450)
      const navy = document.createElement('canvas')
      navy.width = 1600
      navy.height = 900
      const nc = navy.getContext('2d')
      nc.fillStyle = '#0D1B2A'
      nc.fillRect(0, 0, 1600, 900)
      const k = Math.min((1600 * 0.78) / cw, (900 * 0.7) / ch)
      nc.drawImage(master, (1600 - cw * k) / 2, (900 - ch * k) / 2, cw * k, ch * k)
      return {
        box: [x0, y0, cw, ch],
        webp900: s900.toDataURL('image/webp', 0.9),
        webp450: s450.toDataURL('image/webp', 0.9),
        png900: rgba(s900),
        master: master.toDataURL('image/png'),
        onNavy: navy.toDataURL('image/png'),
      }
    },
    { b64, KEY },
  )
  const dataUrl = (u) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'emblem-900.webp'), dataUrl(out.webp900))
  writeFileSync(join(outDir, 'emblem-450.webp'), dataUrl(out.webp450))
  const png = {
    width: out.png900.width,
    height: out.png900.height,
    data: new Uint8Array(Buffer.from(out.png900.b64, 'base64')),
  }
  writeFileSync(join(outDir, 'emblem-900.png'), encodePalettePng(png))
  console.log(`emblem box in the source: x ${out.box[0]}, y ${out.box[1]}, ${out.box[2]} × ${out.box[3]}`)
  console.log(`wrote ${outDir}/emblem-900.webp, emblem-900.png, emblem-450.webp`)
  if (preview) {
    mkdirSync(preview, { recursive: true })
    writeFileSync(join(preview, 'emblem-master.png'), dataUrl(out.master))
    writeFileSync(join(preview, 'emblem-on-navy.png'), dataUrl(out.onNavy))
    console.log(`wrote ${preview}/emblem-master.png, emblem-on-navy.png`)
  }
} finally {
  await browser.close()
}
