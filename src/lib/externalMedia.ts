/**
 * Control over whatever else is currently playing - Spotify, a browser tab,
 * VLC, a desktop radio app - via the same global media keys a keyboard
 * would send. See src-tauri/src/media_keys.rs for why this, and not real
 * per-app audio capture, is what's built: capturing another process's audio
 * is a separate, much bigger project.
 *
 * Native-only, like everything else in tauri.ts - unavailable in the browser
 * demo, where there is no OS to send a key to.
 */
import { invokeTauri, isTauri } from './tauri'

export type MediaAction =
  | 'play_pause'
  | 'next'
  | 'previous'
  | 'stop'
  | 'volume_up'
  | 'volume_down'
  | 'mute'

/** Whether external-source transport control can do anything here - false
 * in the browser demo, true inside the native app on any OS (the Rust side
 * itself refuses off Windows; this only reports whether it's worth trying). */
export function externalMediaAvailable(): boolean {
  return isTauri()
}

export async function sendMediaKey(action: MediaAction): Promise<void> {
  await invokeTauri('send_media_key', { action })
}
