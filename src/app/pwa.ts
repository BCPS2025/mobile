import { useSyncExternalStore } from 'react'

// Service worker registration (hosted build only) and the "Update ready" state the Start
// screen shows. The one-file backup has no service worker: MODE is 'single' there and the
// branch below is dropped at build time.

let needRefresh = false
let update: ((reload?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()

export function initPwa(): void {
  if (import.meta.env.MODE === 'single' || !import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      update = registerSW({
        onNeedRefresh() {
          needRefresh = true
          for (const l of [...listeners]) l()
        },
      })
    })
    .catch(() => {
      // No service worker (unsupported or blocked): the app still runs, just not offline.
    })
}

export function useUpdateReady(): { ready: boolean; apply: () => void } {
  const ready = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => needRefresh,
    () => needRefresh,
  )
  return { ready, apply: () => void update?.(true) }
}
