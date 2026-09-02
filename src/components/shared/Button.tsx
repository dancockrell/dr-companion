import { cn } from '../../lib/cn'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'good'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg' | 'xl'
  icon?: ReactNode
  children?: ReactNode
}

// A button reads as struck metal or worn leather, not a flat colour swatch:
// a faint top highlight and bottom shadow (never a full gradient — that would
// look glossy/plasticky against the calfskin-and-bronze palette elsewhere),
// plus a hairline edge one step lighter than the fill.
const bevel =
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(0,0,0,0.28)]'

const variants: Record<Variant, string> = {
  primary: cn(
    bevel,
    'bg-accent text-surface hover:bg-accent-soft border border-accent-soft/60 shadow-lg shadow-accent/20 font-semibold'
  ),
  secondary: cn(
    bevel,
    'bg-surface-overlay text-ink border border-border hover:border-ink-faint hover:bg-surface-raised'
  ),
  danger: cn(
    bevel,
    'bg-danger/90 text-white border border-black/20 hover:bg-danger font-semibold'
  ),
  ghost: 'bg-transparent text-ink-muted hover:text-ink hover:bg-surface-overlay',
  good: cn(
    bevel,
    'bg-good/90 text-surface border border-black/20 hover:bg-good font-semibold'
  ),
}

const sizes = {
  sm: 'px-3 py-1.5 text-sm rounded-lg gap-1.5',
  md: 'px-4 py-2 text-sm rounded-xl gap-2',
  lg: 'px-5 py-3 text-base rounded-xl gap-2',
  xl: 'px-6 py-4 text-lg rounded-2xl gap-3 w-full justify-center',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      className={cn(
        'inline-flex items-center transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
