// Boot guards and the standalone reset page.
import { describe, expect, it } from 'vitest'
import html from '../../public/reset.html?raw'
import { isFramed, wantsServiceWorkerReset } from '@app/boot/guards'

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  let bin = ''
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b)
  return btoa(bin)
}

describe('boot guards', () => {
  it('detects a framed page, and treats an inaccessible top as framed', () => {
    const self = {} as Window
    expect(isFramed({ top: self, self } as unknown as Window)).toBe(false)
    expect(isFramed({ top: {} as Window, self } as unknown as Window)).toBe(true)
    const throwing = Object.defineProperty({ self }, 'top', {
      get() {
        throw new Error('cross-origin')
      },
    })
    expect(isFramed(throwing as unknown as Window)).toBe(true)
  })

  it('asks for a service-worker reset only on #/?sw=reset over http(s)', () => {
    expect(wantsServiceWorkerReset({ protocol: 'https:', hash: '#/?sw=reset' })).toBe(true)
    expect(wantsServiceWorkerReset({ protocol: 'https:', hash: '#/about?sw=reset' })).toBe(true)
    expect(wantsServiceWorkerReset({ protocol: 'https:', hash: '#/' })).toBe(false)
    expect(wantsServiceWorkerReset({ protocol: 'file:', hash: '#/?sw=reset' })).toBe(false)
  })
})

describe('reset.html', () => {
  it('uses one classic inline script whose hash its CSP allows', async () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    expect(scripts).toHaveLength(1)
    const [, attrs, body] = scripts[0] as RegExpMatchArray
    expect(attrs).not.toMatch(/type\s*=\s*["']?module/i)
    expect(attrs).not.toMatch(/\bsrc\s*=/i)
    const hash = await sha256Base64(body ?? '')
    expect(html).toContain(`'sha256-${hash}'`)
  })

  it('unregisters service workers, clears caches, returns to the app and is noindexed', () => {
    expect(html).toContain('unregister()')
    expect(html).toContain('caches.delete')
    expect(html).toContain('location.replace(base)')
    expect(html).toContain('<meta name="robots" content="noindex,nofollow" />')
  })
})
