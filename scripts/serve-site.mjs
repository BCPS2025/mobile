// Tiny static server for the assembled _site/, mounted under /mobile/ like GitHub Pages serves
// the repository. Used by Playwright (playwright.config.ts) and for local checks.
//   node scripts/serve-site.mjs [--port 4173] [--root _site] [--prefix /mobile/]
// Only binds 127.0.0.1. Stop it with Ctrl+C.
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const port = Number(arg('port', '4173'))
const root = resolve(arg('root', '_site'))
let prefix = arg('prefix', '/mobile/')
if (!prefix.startsWith('/')) prefix = `/${prefix}`
if (!prefix.endsWith('/')) prefix = `${prefix}/`

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...headers })
  res.end(body)
}

function statOrNull(path) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed')
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return send(res, 400, 'Bad request')
  }
  if (`${pathname}/` === prefix) return send(res, 301, '', { Location: prefix + url.search })
  if (!pathname.startsWith(prefix)) return send(res, 404, 'Not found')

  const rel = normalize(pathname.slice(prefix.length)).replace(/^([/\\])+/, '')
  let file = join(root, rel)
  if (file !== root && !file.startsWith(root + sep)) return send(res, 404, 'Not found')

  let stat = statOrNull(file)
  if (stat?.isDirectory()) {
    // Like GitHub Pages: a folder without its trailing slash redirects, a folder serves index.html.
    if (!pathname.endsWith('/')) return send(res, 301, '', { Location: `${pathname}/${url.search}` })
    file = join(file, 'index.html')
    stat = statOrNull(file)
  }
  if (!stat?.isFile()) return send(res, 404, 'Not found')

  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`serve-site: http://127.0.0.1:${port}${prefix} -> ${root}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.closeAllConnections()
    server.close(() => process.exit(0))
  })
}
