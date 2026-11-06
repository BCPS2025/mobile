import copy from '../../../content/copy.en.yaml'

/**
 * Checks that run before React renders. Returns false when the app must not render; in that
 * case the replacement content (or a navigation) has already been started.
 */
export function runBootGuards(win: Window = window): boolean {
  if (isFramed(win)) {
    renderPlainMessage(win.document, framedMessage())
    return false
  }
  if (wantsServiceWorkerReset(win.location)) {
    // Same effect as opening reset.html directly: unregister, clear caches, return to the app.
    win.location.replace(new URL('./reset.html', win.location.href).href)
    return false
  }
  return true
}

/** GitHub Pages cannot send frame-ancestors, so a framed copy is refused at boot. */
export function isFramed(win: Window): boolean {
  try {
    return win.top !== win.self
  } catch {
    // Accessing a cross-origin top can throw in some browsers: treat as framed.
    return true
  }
}

/** `#/?sw=reset` (hosted builds only; file:// has no service worker and no reset.html). */
export function wantsServiceWorkerReset(loc: Pick<Location, 'hash' | 'protocol'>): boolean {
  if (loc.protocol !== 'https:' && loc.protocol !== 'http:') return false
  const query = loc.hash.split('?')[1]
  if (!query) return false
  return new URLSearchParams(query).get('sw') === 'reset'
}

function framedMessage(): string {
  const boot = (copy as { boot?: { framed?: unknown } } | null)?.boot
  if (typeof boot?.framed === 'string' && boot.framed.length > 0) return boot.framed
  // Fallback until copy.en.yaml carries boot.framed; same wording.
  return "This page can't be displayed inside another site."
}

function renderPlainMessage(doc: Document, text: string): void {
  const p = doc.createElement('p')
  p.textContent = text
  p.setAttribute('role', 'alert')
  p.style.cssText =
    'margin:0;padding:24px 16px;font:16px/1.5 system-ui,sans-serif;color:#0D1B2A;background:#F8F9FA;text-align:center'
  const root = doc.getElementById('root') ?? doc.body
  root.replaceChildren(p)
}
