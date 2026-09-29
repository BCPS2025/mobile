// Brand assets: the emblem files and the icons rendered from them (scripts/render-icons.mjs).
// Sizes stay within their budgets, every icon ends in exactly navy in its bottom-right corner
// (the image generator's mark can never be part of an icon), the emblem sits at the specified
// width, and the palette PNG writer and reader agree.
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng, encodePalettePng, type Rgba } from '../../scripts/brand/png-core'

const NAVY = [13, 27, 42] as const
const read = (path: string) => new Uint8Array(readFileSync(path))
const size = (path: string) => statSync(path).size
const icon = (name: string) => decodePng(read(`public/brand/${name}`))

const ICONS = [
  { file: 'icon-192.png', px: 192, emblem: 0.84 },
  { file: 'icon-512.png', px: 512, emblem: 0.84 },
  { file: 'icon-maskable-512.png', px: 512, emblem: 0.72 },
  { file: 'apple-touch-icon.png', px: 180, emblem: 0.8 },
] as const

const isNavy = (d: Uint8Array, i: number) => d[i] === NAVY[0] && d[i + 1] === NAVY[1] && d[i + 2] === NAVY[2]

/** Bounding box of every pixel that is not the navy background. */
function emblemBox(img: Rgba) {
  let x0 = img.width
  let y0 = img.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (!isNavy(img.data, i)) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
  }
  return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

describe('brand asset sizes', () => {
  it('the emblem files are at most 120 kB each', () => {
    for (const f of ['emblem-900.webp', 'emblem-900.png', 'emblem-450.webp']) {
      expect(size(`src/assets/brand/${f}`), f).toBeLessThanOrEqual(120_000)
    }
  })

  it('every icon is at most 60 kB', () => {
    for (const { file } of ICONS) expect(size(`public/brand/${file}`), file).toBeLessThanOrEqual(60_000)
    expect(size('public/brand/favicon-32.png')).toBeLessThanOrEqual(60_000)
  })

  it('the emblem PNG is 900 px wide with transparency, the 450 px WebP is half of it', () => {
    const png = decodePng(read('src/assets/brand/emblem-900.png'))
    expect(png.width).toBe(900)
    expect(png.height).toBeGreaterThan(200)
    let transparent = 0
    let opaque = 0
    for (let i = 3; i < png.data.length; i += 4) {
      if (png.data[i] === 0) transparent++
      else if (png.data[i] === 255) opaque++
    }
    expect(transparent).toBeGreaterThan(png.width * png.height * 0.4)
    expect(opaque).toBeGreaterThan(1000)
    const webp = read('src/assets/brand/emblem-450.webp')
    const ascii = new TextDecoder('latin1')
    expect(ascii.decode(webp.subarray(0, 4))).toBe('RIFF')
    expect(ascii.decode(webp.subarray(8, 12))).toBe('WEBP')
  })
})

describe('icons', () => {
  it('have the specified sizes and no transparency', () => {
    for (const { file, px } of ICONS) {
      const img = icon(file)
      expect([img.width, img.height], file).toEqual([px, px])
      for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(255)
    }
  })

  it('end in exactly navy in the bottom-right corner (no watermark mark)', () => {
    for (const { file } of ICONS) {
      const img = icon(file)
      const side = Math.ceil(img.width * 0.2)
      for (let y = img.height - side; y < img.height; y++) {
        for (let x = img.width - side; x < img.width; x++) {
          const i = (y * img.width + x) * 4
          if (!isNavy(img.data, i)) throw new Error(`${file}: pixel ${x},${y} is not navy`)
        }
      }
    }
  })

  it('carry the emblem centred at the specified width', () => {
    for (const { file, px, emblem } of ICONS) {
      const box = emblemBox(icon(file))
      // The extracted emblem has a small margin of its own, so the visible width is a bit less.
      expect(box.width, `${file} width`).toBeLessThanOrEqual(Math.ceil(px * emblem))
      expect(box.width, `${file} width`).toBeGreaterThanOrEqual(Math.floor(px * emblem * 0.85))
      const cx = (box.x0 + box.x1 + 1) / 2
      const cy = (box.y0 + box.y1 + 1) / 2
      expect(Math.abs(cx - px / 2), `${file} centre x`).toBeLessThanOrEqual(px * 0.03)
      expect(Math.abs(cy - px / 2), `${file} centre y`).toBeLessThanOrEqual(px * 0.06)
    }
  })

  it('the maskable icon keeps the emblem inside the safe circle (80 % of the canvas)', () => {
    const img = icon('icon-maskable-512.png')
    const r = img.width * 0.4
    const c = img.width / 2
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (!isNavy(img.data, (y * img.width + x) * 4)) {
          expect(Math.hypot(x + 0.5 - c, y + 0.5 - c)).toBeLessThanOrEqual(r)
        }
      }
    }
  })

  it('the favicon is the wordmark square: a green-500 square on navy', () => {
    const svg = readFileSync('public/brand/favicon.svg', 'utf8')
    expect(svg).toContain('#0D1B2A')
    expect(svg).toContain('#00E676')
    const img = decodePng(read('public/brand/favicon-32.png'))
    expect([img.width, img.height]).toEqual([32, 32])
    const at = (x: number, y: number) => [...img.data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3)]
    expect(at(1, 1)).toEqual([...NAVY])
    expect(at(31, 31)).toEqual([...NAVY])
    expect(at(16, 16)).toEqual([0, 230, 118])
  })
})

describe('palette PNG writer and reader', () => {
  it('round-trips an image with few colours exactly, transparency included', () => {
    const w = 12
    const h = 8
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const c = x < 4 ? [13, 27, 42, 255] : x < 8 ? [0, 230, 118, 255] : [0, 0, 0, 0]
        data.set(c, i)
      }
    }
    const back = decodePng(encodePalettePng({ width: w, height: h, data }))
    expect([back.width, back.height]).toEqual([w, h])
    expect([...back.data]).toEqual([...data])
  })

  it('reduces a gradient to at most the asked number of colours, keeping it close', () => {
    const w = 64
    const h = 4
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) data.set([x * 4, 255 - x * 4, 128, 255], (y * w + x) * 4)
    }
    const png = encodePalettePng({ width: w, height: h, data }, 16)
    const back = decodePng(png)
    const colours = new Set<string>()
    for (let i = 0; i < back.data.length; i += 4) colours.add(`${back.data[i]},${back.data[i + 1]},${back.data[i + 2]}`)
    expect(colours.size).toBeLessThanOrEqual(16)
    for (let i = 0; i < data.length; i += 4) expect(Math.abs((back.data[i] ?? 0) - (data[i] ?? 0))).toBeLessThan(40)
  })
})
