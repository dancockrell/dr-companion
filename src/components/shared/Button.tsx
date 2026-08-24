import { cn } from '../../lib/cn'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'good'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg' | 'xl'
  icon?: ReactNode
  children?: ReactNode
}

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-surface hover:bg-accent-soft shadow-lg shadow-accent/20 font-semibold',
  secondary:
    'bg-surface-overlay text-ink border border-border hover:border-ink-faint hover:bg-surface-raised',
  danger:
    'bg-danger/90 text-white hover:bg-danger font-semibold',
  ghost:
    'bg-transparent text-ink-muted hover:text-ink hover:bg-surface-overlay',
  good:
    'bg-good/90 text-surface hover:bg-good font-semibold',
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
