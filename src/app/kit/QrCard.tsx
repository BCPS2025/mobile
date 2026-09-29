import { useMemo } from 'react'
import { encode } from 'uqr'

// A real QR code (error correction H, 4-module quiet zone) as SVG: navy modules on white
// with a green square in the centre (well inside what level H can recover).

export function QrSvg({ payload, size = 220, label }: { payload: string; size?: number; label: string }) {
  const { path, n, centre } = useMemo(() => {
    const qr = encode(payload, { ecc: 'H', border: 4 })
    const n = qr.size
    let d = ''
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`
      })
    })
    // Centre square: about 14 % of the symbol (without the quiet zone), odd module count.
    const inner = n - 8
    let c = Math.max(3, Math.round(inner * 0.14))
    if (c % 2 === 0) c += 1
    return { path: d, n, centre: c }
  }, [payload])
  const start = (n - centre) / 2
  return (
    <svg
      role="img"
      aria-label={label}
      data-payload={payload}
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="block"
    >
      <rect width={n} height={n} fill="#FFFFFF" />
      <path d={path} fill="#0D1B2A" />
      <rect x={start - 1} y={start - 1} width={centre + 2} height={centre + 2} fill="#FFFFFF" />
      <rect x={start} y={start} width={centre} height={centre} fill="#00E676" />
    </svg>
  )
}
