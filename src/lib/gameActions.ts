import { useEffect, useState } from 'react'
import { sendGame } from './gameLink.ts'
import { validateGameActionCommand } from './gameCommand.ts'

export interface GameActionFailure {
  id: number
  command: string
  label: string
  message: string
}

const EVENT = 'drc-game-action-failure'
const REPEAT_WINDOW_MS = 1500
let nextFailureId = 0
let lastFailure = { key: '', at: 0 }

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error:\s*/i, '').trim() || 'The game connection rejected the command.'
}

function publishFailure(command: string, label: string, error: unknown): GameActionFailure {
  const failure: GameActionFailure = {
    id: ++nextFailureId,
    command,
    label,
    message: errorMessage(error),
  }
  const now = Date.now()
  const key = `${label}\n${failure.message}`
  if (key !== lastFailure.key || now - lastFailure.at >= REPEAT_WINDOW_MS) {
    lastFailure = { key, at: now }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<GameActionFailure>(EVENT, { detail: failure }))
    }
  }
  return failure
}

/**
 * Send one UI-generated game action and publish a shared, accessible failure
 * notice if its game-derived target is unsafe or native transport rejects it.
 * Raw player input uses `sendGame` directly so intentional Genie/Lich command
 * separators remain available there.
 */
export async function sendGameAction(command: string, label = command): Promise<void> {
  try {
    await sendGame(validateGameActionCommand(command))
  } catch (error) {
    publishFailure(command, label, error)
    throw error
  }
}

/** Event-handler convenience: feedback is already published by sendGameAction. */
export function requestGameAction(command: string, label = command): void {
  void sendGameAction(command, label).catch(() => {})
}

export function useGameActionFailure(): GameActionFailure | null {
  const [failure, setFailure] = useState<GameActionFailure | null>(null)
  useEffect(() => {
    let timer: number | null = null
    const onFailure = (event: Event) => {
      setFailure((event as CustomEvent<GameActionFailure>).detail)
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => setFailure(null), 8000)
    }
    window.addEventListener(EVENT, onFailure)
    return () => {
      window.removeEventListener(EVENT, onFailure)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])
  return failure
}
