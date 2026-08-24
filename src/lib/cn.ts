import { clsx, type ClassValue } from 'clsx'

/** Tiny className helper */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}
