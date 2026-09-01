/** Subscribe to both halves of a shared localStorage contract.
 * Custom events cover writes in this document; StorageEvent covers another
 * webview because browsers deliberately do not echo it to the writer. */
export function subscribeStorageKey(
  storageKey: string,
  changedEvent: string,
  notify: () => void,
  target: Window = window
) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) notify()
  }
  target.addEventListener('storage', onStorage)
  target.addEventListener(changedEvent, notify)
  return () => {
    target.removeEventListener('storage', onStorage)
    target.removeEventListener(changedEvent, notify)
  }
}
