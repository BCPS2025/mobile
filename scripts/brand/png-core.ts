// PNG reading and writing for the brand scripts and their unit tests, with no dependency beyond
// node:zlib. Writes palette PNGs (colour type 3, with a tRNS chunk when any entry is not opaque)
// from RGBA pixels quantised by median cut; reads 8-bit greyscale, RGB, RGBA and palette PNGs
// without interlacing. Runs under plain Node type stripping: erasable TypeScript only.
import { deflateSync, inflateSync } from 'node:zlib'

export interface Rgba {
  width: number
  height: number
  /** width × height × 4 bytes, row-major, not premultiplied. */
  data: Uint8Array
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

// ---- quantisation (median cut over a 5-bit-per-channel histogram)

interface Bin {
  r: number
  g: number
  b: number
  a: number
  n: number
}

/** A palette of at most `max` RGBA entries and the index of every pixel. */
export function quantise(img: Rgba, max = 256): { palette: Uint8Array; indices: Uint8Array } {
  const { data } = img
  const px = data.length / 4
  const key = (i: number) =>
    (((data[i] as number) >> 3) << 15) |
    (((data[i + 1] as number) >> 3) << 10) |
    (((data[i + 2] as number) >> 3) << 5) |
    ((data[i + 3] as number) >> 3)
  const bins = new Map<number, Bin>()
  for (let p = 0; p < px; p++) {
    const i = p * 4
    // Fully transparent pixels share one bin whatever their colour.
    const k = data[i + 3] === 0 ? -1 : key(i)
    let bin = bins.get(k)
    if (!bin) {
      bin = { r: 0, g: 0, b: 0, a: 0, n: 0 }
      bins.set(k, bin)
    }
    bin.r += data[i] as number
    bin.g += data[i + 1] as number
    bin.b += data[i + 2] as number
    bin.a += data[i + 3] as number
    bin.n++
  }
  const entries = [...bins.entries()].map(([k, b]) => ({
    k,
    r: b.r / b.n,
    g: b.g / b.n,
    b: b.b / b.n,
    a: b.a / b.n,
    n: b.n,
  }))
  type Entry = (typeof entries)[number]
  const channels = ['r', 'g', 'b', 'a'] as const
  interface Box {
    items: Entry[]
    ch: (typeof channels)[number]
    range: number
  }
  const boxOf = (items: Entry[]): Box => {
    const weight = items.reduce((n, e) => n + e.n, 0)
    let best: Box = { items, ch: 'r', range: -1 }
    for (const ch of channels) {
      let lo = 256
      let hi = -1
      for (const e of items) {
        if (e[ch] < lo) lo = e[ch]
        if (e[ch] > hi) hi = e[ch]
      }
      const range = items.length < 2 ? -1 : (hi - lo) * Math.sqrt(weight)
      if (range > best.range) best = { items, ch, range }
    }
    return best
  }
  const boxes: Box[] = [boxOf(entries)]
  while (boxes.length < max) {
    let pick = -1
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i] as Box
      if (b.range > 0 && (pick < 0 || b.range > (boxes[pick] as Box).range)) pick = i
    }
    if (pick < 0) break
    const { items, ch } = boxes[pick] as Box
    items.sort((x, y) => x[ch] - y[ch])
    const total = items.reduce((n, e) => n + e.n, 0)
    let acc = 0
    let cut = 1
    for (let i = 0; i < items.length - 1; i++) {
      acc += (items[i] as Entry).n
      if (acc >= total / 2) {
        cut = i + 1
        break
      }
    }
    boxes.splice(pick, 1, boxOf(items.slice(0, cut)), boxOf(items.slice(cut)))
  }
  const palette = new Uint8Array(boxes.length * 4)
  const indexOf = new Map<number, number>()
  boxes.forEach(({ items: box }, i) => {
    const n = box.reduce((s, e) => s + e.n, 0)
    const avg = (ch: 'r' | 'g' | 'b' | 'a') => Math.round(box.reduce((s, e) => s + e[ch] * e.n, 0) / n)
    const transparent = box.every((e) => e.k === -1)
    palette[i * 4] = transparent ? 0 : avg('r')
    palette[i * 4 + 1] = transparent ? 0 : avg('g')
    palette[i * 4 + 2] = transparent ? 0 : avg('b')
    palette[i * 4 + 3] = transparent ? 0 : avg('a')
    for (const e of box) indexOf.set(e.k, i)
  })
  const indices = new Uint8Array(px)
  for (let p = 0; p < px; p++) {
    const i = p * 4
    indices[p] = indexOf.get(data[i + 3] === 0 ? -1 : key(i)) as number
  }
  return { palette, indices }
}

/** A palette PNG of the image (at most 256 colours). */
export function encodePalettePng(img: Rgba, maxColours = 256): Uint8Array {
  const { palette, indices } = quantise(img, maxColours)
  const n = palette.length / 4
  const plte = new Uint8Array(n * 3)
  const trns = new Uint8Array(n)
  let anyAlpha = false
  for (let i = 0; i < n; i++) {
    plte[i * 3] = palette[i * 4] as number
    plte[i * 3 + 1] = palette[i * 4 + 1] as number
    plte[i * 3 + 2] = palette[i * 4 + 2] as number
    trns[i] = palette[i * 4 + 3] as number
    if (trns[i] !== 255) anyAlpha = true
  }
  const raw = new Uint8Array(img.height * (img.width + 1))
  for (let y = 0; y < img.height; y++) {
    raw[y * (img.width + 1)] = 0
    raw.set(indices.subarray(y * img.width, (y + 1) * img.width), y * (img.width + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, img.width)
  v.setUint32(4, img.height)
  ihdr[8] = 8
  ihdr[9] = 3
  return concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    ...(anyAlpha ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Decodes an 8-bit, non-interlaced PNG (colour types 0, 2, 3, 4 and 6) to RGBA. */
export function decodePng(bytes: Uint8Array): Rgba {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let o = 8
  let width = 0
  let height = 0
  let type = 0
  let plte: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (o < bytes.length) {
    const len = view.getUint32(o)
    const t = String.fromCharCode(...bytes.subarray(o + 4, o + 8))
    const body = bytes.subarray(o + 8, o + 8 + len)
    if (t === 'IHDR') {
      width = view.getUint32(o + 8)
      height = view.getUint32(o + 12)
      if (body[8] !== 8) throw new Error('only 8-bit PNGs')
      type = body[9] as number
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported')
    } else if (t === 'PLTE') plte = body
    else if (t === 'tRNS') trns = body
    else if (t === 'IDAT') idat.push(body)
    else if (t === 'IEND') break
    o += 12 + len
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6]
  if (!channels) throw new Error(`unsupported colour type ${type}`)
  const raw = inflateSync(concat(idat))
  const stride = width * channels
  const cur = new Uint8Array(stride)
  const prev = new Uint8Array(stride)
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)] as number
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (cur[x - channels] as number) : 0
      const b = prev[x] as number
      const c = x >= channels ? (prev[x - channels] as number) : 0
      const v = line[x] as number
      cur[x] =
        (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255
    }
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4
      const s = x * channels
      if (type === 0 || type === 4) {
        const g = cur[s] as number
        data[d] = g
        data[d + 1] = g
        data[d + 2] = g
        data[d + 3] = type === 4 ? (cur[s + 1] as number) : 255
      } else if (type === 3) {
        const idx = cur[s] as number
        data[d] = plte?.[idx * 3] ?? 0
        data[d + 1] = plte?.[idx * 3 + 1] ?? 0
        data[d + 2] = plte?.[idx * 3 + 2] ?? 0
        data[d + 3] = trns?.[idx] ?? 255
      } else {
        data[d] = cur[s] as number
        data[d + 1] = cur[s + 1] as number
        data[d + 2] = cur[s + 2] as number
        data[d + 3] = type === 6 ? (cur[s + 3] as number) : 255
      }
    }
    prev.set(cur)
  }
  return { width, height, data }
}
