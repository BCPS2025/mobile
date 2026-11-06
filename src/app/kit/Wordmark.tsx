// "BCPS" followed by a small signal-green square, as in the reference design.
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-display font-bold tracking-[-0.01em] ${className}`}>
      BCPS
      <span
        aria-hidden="true"
        className="ml-[0.18em] inline-block bg-green-500"
        style={{ width: '0.28em', height: '0.28em' }}
      />
    </span>
  )
}
