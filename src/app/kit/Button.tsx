import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Buttons are 52 px (large) or 44 px. Green fill only where tapping moves money (and the
// Start screen's primary button); labels on green are navy.

type Variant = 'money' | 'primary' | 'secondary' | 'ghost' | 'onNavy'

const VARIANTS: Record<Variant, string> = {
  money: 'bg-green-500 text-navy-900 hover:brightness-95 disabled:bg-line-200 disabled:text-grey-600',
  primary: 'bg-navy-900 text-white hover:bg-navy-800 disabled:bg-line-200 disabled:text-grey-600',
  secondary: 'border border-line-300 bg-surface text-navy-900 hover:border-navy-900 disabled:text-grey-500',
  ghost: 'text-navy-900 hover:bg-line-100 disabled:text-grey-500',
  onNavy: 'border border-navy-700 bg-navy-800 text-white hover:border-green-500 disabled:text-muted-navy',
}

const SQUARE: Record<Variant, string> = {
  money: 'bg-navy-900',
  primary: 'bg-green-500',
  secondary: 'bg-green-600',
  ghost: 'bg-green-600',
  onNavy: 'bg-green-500',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'l' | 'm'
  /** Leading ▪ square, as on the reference design's calls to action. */
  square?: boolean
  block?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'l',
  square = false,
  block = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2.5 px-5 font-display text-button transition-[filter,background-color] duration-(--dur-press) ${
        size === 'l' ? 'h-13 min-h-13' : 'h-11 min-h-11'
      } ${block ? 'w-full' : ''} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {square && <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 ${SQUARE[variant]}`} />}
      {children}
    </button>
  )
}
