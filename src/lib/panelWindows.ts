import { useSyncExternalStore } from 'react'
import type { PanelId } from './layout'
import { invokeTauri, isTauri, listenTauri } from './tauri'

export type PanelWindowAction = 'opening' | 'closing'
export interface PanelWindowSnapshot {
  open: readonly PanelId[]
  pending: Readonly<Partial<Record<PanelId, PanelWindowAction>>>
  errors: Readonly<Partial<Record<PanelId, string>>>
  registryError: string | null
}

let snapshot: PanelWindowSnapshot = { open: [], pending: {}, errors: {}, registryError: null }
const listeners = new Set<() => void>()
let started = false

function publish(next: PanelWindowSnapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function refreshPanelWindows(): Promise<void> {
  if (!isTauri()) return
  try {
    const ids = await invokeTauri('panel_windows')
    publish({ ...snapshot, open: Array.isArray(ids) ? ids as PanelId[] : snapshot.open, registryError: null })
  } catch (error) {
    // Unknown is not empty. Retain the last authoritative registry so a
    // transient IPC failure cannot duplicate every still-live panel.
    publish({ ...snapshot, registryError: `Could not confirm popped-out windows: ${message(error)}` })
  }
}

function start() {
  if (started || !isTauri()) return
  started = true
  listenTauri<{ id: PanelId; state: 'open' | 'closing' | 'closed' }>('panel-window:lifecycle', () => {
    void refreshPanelWindows()
  })
  void refreshPanelWindows()
}

export function subscribePanelWindows(listener: () => void) {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPanelWindowsSnapshot() {
  return snapshot
}

export function usePanelWindows() {
  return useSyncExternalStore(subscribePanelWindows, getPanelWindowsSnapshot, getPanelWindowsSnapshot)
}

async function act(id: PanelId, action: PanelWindowAction, command: string, args: Record<string, unknown>) {
  publish({
    ...snapshot,
    pending: { ...snapshot.pending, [id]: action },
    errors: { ...snapshot.errors, [id]: undefined },
  })
  try {
    await invokeTauri(command, args)
    await refreshPanelWindows()
  } catch (error) {
    publish({
      ...snapshot,
      errors: { ...snapshot.errors, [id]: `${action === 'opening' ? 'Could not open' : 'Could not close'} this window: ${message(error)}` },
    })
  } finally {
    publish({ ...snapshot, pending: { ...snapshot.pending, [id]: undefined } })
  }
}

export function openPanelWindow(id: PanelId, title: string) {
  return act(id, 'opening', 'open_panel_window', { id, title })
}

export function closePanelWindow(id: PanelId) {
  return act(id, 'closing', 'close_panel_window', { id })
}
