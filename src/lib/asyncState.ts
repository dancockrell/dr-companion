export type AsyncResource<T> =
  | { state: 'idle'; value: null; error: null }
  | { state: 'loading'; value: T | null; error: null }
  | { state: 'ready' | 'empty'; value: T; error: null }
  | { state: 'error'; value: T | null; error: string }
  | { state: 'stale'; value: T; error: string }

export type AsyncAction =
  | { state: 'idle'; operationId: null; error: null }
  | { state: 'pending'; operationId: number; error: null }
  | { state: 'succeeded'; operationId: number; error: null }
  | { state: 'failed'; operationId: number; error: string }

export const idleAction = (): AsyncAction => ({ state: 'idle', operationId: null, error: null })
export const pendingAction = (operationId: number): AsyncAction => ({ state: 'pending', operationId, error: null })
export const succeededAction = (operationId: number): AsyncAction => ({ state: 'succeeded', operationId, error: null })
export const failedAction = (operationId: number, error: unknown): AsyncAction => ({
  state: 'failed', operationId, error: error instanceof Error ? error.message : String(error),
})

export const idleResource = <T>(): AsyncResource<T> => ({ state: 'idle', value: null, error: null })
export const loadingResource = <T>(previous?: AsyncResource<T>): AsyncResource<T> => ({ state: 'loading', value: previous?.value ?? null, error: null })
export const fulfilledResource = <T>(value: T, empty: (value: T) => boolean): AsyncResource<T> => ({ state: empty(value) ? 'empty' : 'ready', value, error: null })
export const failedResource = <T>(previous: AsyncResource<T>, error: unknown): AsyncResource<T> => {
  const message = error instanceof Error ? error.message : String(error)
  return previous.value === null ? { state: 'error', value: null, error: message } : { state: 'stale', value: previous.value, error: message }
}

export class LatestOperation<Key = string> {
  private sequence = 0
  private current = new Map<Key, number>()
  begin(key: Key): number { const id = ++this.sequence; this.current.set(key, id); return id }
  isCurrent(key: Key, id: number): boolean { return this.current.get(key) === id }
  finish(key: Key, id: number): boolean { if (!this.isCurrent(key, id)) return false; this.current.delete(key); return true }
}
