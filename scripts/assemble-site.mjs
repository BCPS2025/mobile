// Assembles the GitHub Pages artifact in _site/:
//   _site/          the contents of legacy/ (the current public page, unchanged)
//   _site/next/     the app build (dist/)
// Run after `vite build`: node scripts/assemble-site.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const legacy = join(root, 'legacy')
const dist = join(root, 'dist')
const site = join(root, '_site')

function fail(message) {
  console.error(`assemble-site: ${message}`)
  process.exit(1)
}

if (!existsSync(join(legacy, 'index.html'))) fail('legacy/index.html is missing')
if (!existsSync(join(dist, 'index.html'))) fail('dist/index.html is missing: run `npx vite build` first')
if (existsSync(join(legacy, 'next'))) fail('legacy/next would collide with the app folder')

rmSync(site, { recursive: true, force: true })
mkdirSync(site, { recursive: true })

// Legacy files at the root, byte for byte.
for (const name of readdirSync(legacy)) {
  if (name === '.DS_Store') continue
  cpSync(join(legacy, name), join(site, name), { recursive: true })
}

// The app under next/.
cpSync(dist, join(site, 'next'), { recursive: true, filter: (src) => !src.endsWith('.DS_Store') })

console.log('assemble-site: _site/ (legacy at the root, app under next/)')
