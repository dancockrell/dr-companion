/**
 * Display a native-captured game receive time without changing the stored
 * value. Keeping this in one place makes the compact gutter and its full
 * tooltip agree while allowing the browser's locale and 12/24-hour preference
 * to do their job.
 */
export function formatGameTime(receivedAtMs: number, locale?: string): string {
  if (!Number.isFinite(receivedAtMs) || receivedAtMs <= 0) return '--:--'
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(receivedAtMs))
}

export function formatGameDateTime(receivedAtMs: number, locale?: string): string {
  if (!Number.isFinite(receivedAtMs) || receivedAtMs <= 0) return 'Time unavailable'
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(receivedAtMs))
}
