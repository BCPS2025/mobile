// A Web Locks stand-in shared by several "tabs": exclusive locks with ifAvailable, steal and
// abort signals, granted in request order (the parts of navigator.locks the writer lock uses).
import type { LockManagerLike } from '@store/writer-lock'

interface Req {
  name: string
  cb: (lock: unknown) => unknown
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

export function fakeLocks(): LockManagerLike & { holder(name: string): boolean; queued(name: string): number } {
  const held = new Map<string, Req>()
  const queue = new Map<string, Req[]>()
  const q = (name: string) => {
    let list = queue.get(name)
    if (!list) {
      list = []
      queue.set(name, list)
    }
    return list
  }

  const grant = (req: Req) => {
    held.set(req.name, req)
    Promise.resolve()
      .then(() => req.cb({ name: req.name }))
      .then(
        (v) => {
          if (held.get(req.name) === req) {
            held.delete(req.name)
            next(req.name)
          }
          req.resolve(v)
        },
        (e) => {
          if (held.get(req.name) === req) {
            held.delete(req.name)
            next(req.name)
          }
          req.reject(e)
        },
      )
  }

  const next = (name: string) => {
    const r = q(name).shift()
    if (r) grant(r)
  }

  return {
    request(name, options, cb) {
      return new Promise((resolve, reject) => {
        const req: Req = { name, cb, resolve, reject }
        if (options.signal?.aborted) return reject(abortError())
        if (options.steal) {
          const old = held.get(name)
          if (old) {
            held.delete(name)
            old.reject(abortError())
          }
          grant(req)
          return
        }
        if (!held.has(name) && q(name).length === 0) {
          grant(req)
          return
        }
        if (options.ifAvailable) {
          Promise.resolve()
            .then(() => cb(null))
            .then(resolve, reject)
          return
        }
        q(name).push(req)
        options.signal?.addEventListener('abort', () => {
          const list = q(name)
          const i = list.indexOf(req)
          if (i >= 0) {
            list.splice(i, 1)
            reject(abortError())
          }
        })
      })
    },
    holder: (name) => held.has(name),
    queued: (name) => q(name).length,
  }
}

/** Lets every pending promise callback run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
