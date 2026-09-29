// Single writer across tabs. With Web Locks: `request('bcps-writer',
// { ifAvailable: true })`; a tab that does not get it renders normally but does not write,
// shows "BCPS is open in another tab." with [Use here], and queues a plain request so it takes
// the lock by itself (and reloads from storage) when the other tab closes or releases it.
// [Use here] steals the lock; the other tab's hold is broken and it becomes the waiting one.
// Without Web Locks: the `storage` event plus the writer epoch; a tab that sees a newer epoch
// stops writing and shows the same overlay until [Use here].
//
// Each time a tab becomes the writer it takes a writer epoch one above the newest stored one;
// the persister never writes over a newer epoch.

export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>
}

export type WriterStatus =
  /** Asking for the lock (first moments after boot). */
  | 'pending'
  /** This tab writes. */
  | 'writer'
  /** Another tab writes: overlay with [Use here]; with Web Locks the lock is queued. */
  | 'waiting'
  /** Released on purpose (a #/pay tab that finished); nothing is queued. */
  | 'released'

/** How this tab became the writer: at boot, by the queued request, or by [Use here]. */
export type Acquired = 'initial' | 'queued' | 'takeover'

export interface WriterLock {
  status(): WriterStatus
  isWriter(): boolean
  /** The writer epoch this tab writes with (0 until it first becomes the writer). */
  epoch(): number
  subscribe(listener: () => void): () => void
  onAcquired(listener: (how: Acquired) => void): () => void
  /** [Use here]. */
  takeOver(): void
  /** Gives the lock up without queueing again (a #/pay tab finishing). */
  release(): void
  /** The persister saw a newer epoch in storage: stop writing and wait. */
  markStale(): void
  dispose(): void
}

export interface WriterLockOptions {
  /** navigator.locks, or null where Web Locks are missing. */
  locks: LockManagerLike | null
  /** The newest stored writer epoch (persistence.storedEpoch). */
  readEpoch: () => number
  /** The token stored with that epoch (persistence.storedWriter); null when none. */
  readWriter?: () => string | null
  /** This tab's token (written with its epoch); ties between equal epochs go to the stored one. */
  token?: string
  /** Subscribes to the `storage` event (fallback mode). */
  onStorage?: (listener: () => void) => () => void
  name?: string
}

export function createWriterLock(o: WriterLockOptions): WriterLock {
  const name = o.name ?? 'bcps-writer'
  let status: WriterStatus = 'pending'
  let epoch = 0
  let disposed = false
  /** The hold this tab has now (one per granted request). */
  let current: Hold | null = null
  /** Aborts the queued request. */
  let queued: AbortController | null = null
  const listeners = new Set<() => void>()
  const acquiredListeners = new Set<(how: Acquired) => void>()

  interface Hold {
    release: () => void
  }

  const set = (next: WriterStatus) => {
    if (next === status) return
    status = next
    for (const l of [...listeners]) l()
  }

  const becomeWriter = (how: Acquired) => {
    epoch = o.readEpoch() + 1
    set('writer')
    for (const l of [...acquiredListeners]) l(how)
  }

  /**
   * Asks for the lock. When granted, this tab holds it until `release` or until another tab
   * steals it; a stolen hold (its promise rejects) makes this tab the waiting one again.
   */
  const ask = (how: Acquired, options: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal }) => {
    const locks = o.locks as LockManagerLike
    let mine: Hold | null = null
    locks
      .request(name, options, (lock) => {
        if (disposed) return undefined
        if (lock === null || lock === undefined) {
          waitQueued() // ifAvailable and taken: wait in the queue
          return undefined
        }
        queued?.abort()
        queued = null
        return new Promise<void>((resolve) => {
          mine = { release: resolve }
          current = mine
          becomeWriter(how)
        })
      })
      .then(
        () => {},
        () => {
          // Aborted before it was granted (our own abort), or stolen while held.
          if (disposed || mine === null || current !== mine) return
          current = null
          waitQueued()
        },
      )
  }

  const waitQueued = () => {
    if (!o.locks || disposed) return
    set('waiting')
    queued?.abort()
    const ac = new AbortController()
    queued = ac
    ask('queued', { signal: ac.signal })
  }

  const releaseCurrent = () => {
    const h = current
    current = null
    h?.release()
  }

  let offStorage: (() => void) | null = null
  if (o.locks) ask('initial', { ifAvailable: true })
  else {
    becomeWriter('initial')
    offStorage =
      o.onStorage?.(() => {
        if (status !== 'writer') return
        const stored = o.readEpoch()
        const writer = o.readWriter?.() ?? null
        const tie = stored === epoch && o.token !== undefined && writer !== null && writer !== o.token
        if (stored > epoch || tie) set('waiting')
      }) ?? null
  }

  return {
    status: () => status,
    isWriter: () => status === 'writer',
    epoch: () => epoch,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    onAcquired(l) {
      acquiredListeners.add(l)
      return () => acquiredListeners.delete(l)
    },
    takeOver() {
      if (disposed || status === 'writer') return
      if (!o.locks) {
        becomeWriter('takeover')
        return
      }
      queued?.abort()
      queued = null
      ask('takeover', { steal: true })
    },
    release() {
      queued?.abort()
      queued = null
      releaseCurrent()
      set('released')
    },
    markStale() {
      if (status !== 'writer') return
      releaseCurrent()
      if (o.locks) waitQueued()
      else set('waiting')
    },
    dispose() {
      disposed = true
      queued?.abort()
      queued = null
      releaseCurrent()
      offStorage?.()
      listeners.clear()
      acquiredListeners.clear()
    },
  }
}
