import { useMemo } from 'react'
import { encode } from 'uqr'

// A real QR code (error correction M) as SVG: navy modules on white, a one-module margin. The
// card around it (white, padded) supplies the rest of the quiet zone.

export function QrSvg({ payload, size = 220, label }: { payload: string; size?: number; label: string }) {
  const { path, n } = useMemo(() => {
    const qr = encode(payload, { ecc: 'M', border: 1 })
    let d = ''
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`
      })
    })
    return { path: d, n: qr.size }
  }, [payload])
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
    </svg>
  )
}
