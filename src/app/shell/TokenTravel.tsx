import { useEffect, useState } from 'react'
import { stageKeyOf } from '@store/sessions'
import { ui } from '../copy'
import { useApp } from '../state/AppContext'
import { useReducedMotion } from '../state/motion'

// Token travel between the two visible phones when money moves: a small green square leaves the
// payer's phone, crosses in 700 ms (from 100 ms), the receiver lights at 850 ms, and the balances
// settle at 1,400 ms. When the other side is not on a phone, the token goes to (or comes from) an
// edge marker that names the counterparty ("Pekarna Zrno", an off-stage handle). Cosmetics only:
// nothing here commits money, and a replay never emits. Reduced motion: no travel, the receiver
// just lights.

const TRAVEL_DELAY_MS = 100
const TRAVEL_MS = 700
const LIGHT_AT_MS = 850
const LIGHT_MS = 550
const MARKER_MS = 1400

interface Marker {
  id: number
  name: string
  x: number
  y: number
  side: 'left' | 'right'
}

const phoneEl = (key: string) => document.querySelector<HTMLElement>(`[data-testid="stage-phone-${key}"]`)

function light(el: HTMLElement | null) {
  if (!el) return
  el.classList.remove('anim-lit')
  void el.offsetWidth // restart the animation when two payments follow each other
  el.classList.add('anim-lit')
  window.setTimeout(() => el.classList.remove('anim-lit'), LIGHT_MS)
}

function fly(from: { x: number; y: number }, to: { x: number; y: number }) {
  const token = document.createElement('span')
  token.setAttribute('aria-hidden', 'true')
  token.setAttribute('data-testid', 'token')
  token.style.cssText =
    'position:fixed;left:0;top:0;width:14px;height:14px;background:#00e676;z-index:45;pointer-events:none;margin:-7px 0 0 -7px'
  document.body.appendChild(token)
  if (typeof token.animate !== 'function') {
    token.remove()
    return
  }
  const move = token.animate(
    [
      { transform: `translate(${from.x}px, ${from.y}px)`, opacity: 1 },
      { transform: `translate(${to.x}px, ${to.y}px)`, opacity: 1 },
    ],
    { duration: TRAVEL_MS, delay: TRAVEL_DELAY_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' },
  )
  move.onfinish = () => token.remove()
  move.oncancel = () => token.remove()
}

export function TokenTravel() {
  const app = useApp()
  const reduced = useReducedMotion()
  const [markers, setMarkers] = useState<Marker[]>([])

  useEffect(() => {
    let seq = 0
    const timers = new Set<number>()
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id)
        fn()
      }, ms)
      timers.add(id)
    }
    const nameOf = (id: string, party?: string, kind?: string): string | null => {
      if (id === 'sys:offstage') return party ?? null
      // Money in from a top-up and out to a bank has no phone: the edge marker names where it comes from or goes to.
      if (id === 'sys:issuance')
        return kind === 'on-ramp' ? ui.stage.edgeTopUp : kind === 'off-ramp' ? ui.stage.edgeBank : null
      return app.persona(id)?.displayName ?? null
    }
    const off = app.bus.on('money-moved', (e) => {
      const ui = app.runtime.ui.get()
      const fromKey = stageKeyOf(ui, e.from)
      const toKey = stageKeyOf(ui, e.to)
      if (!fromKey && !toKey) return
      const a = fromKey ? phoneEl(fromKey) : null
      const b = toKey ? phoneEl(toKey) : null
      const rect = (el: HTMLElement | null) => el?.getBoundingClientRect() ?? null
      const ra = rect(a)
      const rb = rect(b)
      const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height * 0.72 })
      // Both phones: one crossing. One phone: to or from the outer edge, with a marker.
      if (ra && rb) {
        if (!reduced) fly(centre(ra), centre(rb))
        later(() => light(b), LIGHT_AT_MS)
        return
      }
      const here = ra ?? rb
      const key = fromKey ?? toKey
      const other = ra ? nameOf(e.to, e.party, e.kind) : nameOf(e.from, e.party, e.kind)
      if (!here || !key) return
      if (other === null) {
        if (rb) later(() => light(b), LIGHT_AT_MS)
        return
      }
      const side = key === 'left' ? 'left' : 'right'
      const edge = { x: side === 'left' ? here.left - 40 : here.right + 40, y: here.top + here.height * 0.72 }
      seq += 1
      const marker: Marker = { id: seq, name: other, x: edge.x, y: edge.y, side }
      setMarkers((m) => [...m, marker].slice(-3))
      later(() => setMarkers((m) => m.filter((x) => x.id !== marker.id)), MARKER_MS)
      if (!reduced) ra ? fly(centre(ra), edge) : fly(edge, centre(rb as DOMRect))
      if (rb) later(() => light(b), LIGHT_AT_MS)
    })
    return () => {
      off()
      for (const id of timers) window.clearTimeout(id)
    }
  }, [app, reduced])

  return (
    <>
      {markers.map((m) => (
        <span
          key={m.id}
          data-testid="edge-marker"
          style={{ left: m.x, top: m.y, transform: `translate(${m.side === 'left' ? '-100%' : '0'}, -50%)` }}
          className="on-navy anim-fade pointer-events-none fixed z-40 border border-navy-700 bg-navy-800 px-2.5 py-1 font-body text-body-s whitespace-nowrap text-white"
        >
          {m.name}
        </span>
      ))}
    </>
  )
}
