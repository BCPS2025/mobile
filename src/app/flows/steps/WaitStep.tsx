import type { ReactNode } from 'react'

/**
 * A step that waits for something outside the persona (the café's payment code). It renders from a
 * selector, never from an event, so it is right whenever the account is opened. The live region
 * announces a change of state once.
 */
export function WaitStep({ children, onNavy = false }: { children: ReactNode; onNavy?: boolean }) {
  return (
    <div
      aria-live="polite"
      className={`flex min-h-0 flex-1 flex-col items-center px-5 pt-4 text-center ${onNavy ? 'text-white' : 'text-navy-900'}`}
    >
      {children}
    </div>
  )
}
