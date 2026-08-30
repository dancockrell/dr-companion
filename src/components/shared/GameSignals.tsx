/**
 * The parts of the game connection that have no box of their own to live in.
 *
 * Split out of `GamePane.tsx` when that pane's scrolling text log was
 * removed from the screen (Dan's call: "get rid of that dead box trying to
 * be a game window, it has no value" - it read as empty and idle for anyone
 * not using this app as their primary client, which nothing else here
 * needed to be true to keep working). Three things GamePane's render effects
 * did were never actually about *displaying* the game text - they read the
 * same underlying signal, but the reading, not the showing, was the point:
 *
 *   - restoring persisted alert/danger/speech/music volumes and the
 *     remembered radio station or custom stream on startup
 *   - driving zone-based ambient music off the bridge's own map-zone report
 *     (not off the raw line stream at all - see ambientSound.ts's header)
 *   - playing an alert sound the moment a highlighted pattern arrives in the
 *     raw game text (arenawatch-style "you are stunned" cues, for instance)
 *
 * Removing GamePane's JSX would have silently taken all three down with it,
 * since they were effects inside that component rather than a system of
 * their own - the kind of hidden dependency this app has been bitten by
 * before (see GamePane's own header on why the alert-sound effect exists in
 * the shape it does; the same effect is reproduced verbatim below). This
 * component renders nothing and costs nothing to keep mounted regardless of
 * whether anything is attached; it exists purely to make sure removing a
 * visible box was a layout change, not a feature deletion.
 */
import { useEffect, useRef } from 'react'
import { gameState, subscribeGame } from '../../lib/gameLink'
import { useSyncExternalStore } from 'react'
import { useGameLines } from '../../lib/useGameLines'
import { paint } from '../../lib/highlights'
import { useHighlights } from '../../lib/useHighlights'
import { useOffClasses } from '../../lib/offClasses'
import { playAlert, setAlertsVolume, setDangerVolume, setSpeechVolume } from '../../lib/alertSound'
import {
  setZone,
  setMusicVolume,
  setRadioStation,
  setCustomStream,
  initMediaSession,
  setCrossfadeStyle,
} from '../../lib/ambientSound'
import { loadPrefs } from '../../lib/persistence'
import { useAppStore } from '../../store/useAppStore'

export function GameSignals() {
  // Kept for API parity with the effect this was copied from - not read
  // directly, but the `useGameLines()` subscription below already depends
  // on the same underlying connection this establishes a view onto.
  useSyncExternalStore(subscribeGame, gameState, gameState)
  const lines = useGameLines()
  const { highlights, note: hlNote } = useHighlights()
  const offClasses = useOffClasses()

  /** Restored once, on mount - see GamePane.tsx's original comment: these
   * modules have no opinion about storage, so something has to hand them
   * the remembered levels on startup. */
  useEffect(() => {
    initMediaSession()
    const prefs = loadPrefs()
    setAlertsVolume(prefs.alertsVolume ?? 0)
    setDangerVolume(prefs.dangerVolume ?? 0)
    setSpeechVolume(prefs.speechVolume ?? 0)
    setMusicVolume(prefs.musicVolume ?? 0)
    setCrossfadeStyle(prefs.crossfadeStyle ?? 'standard')
    if (prefs.customStreamUrl) {
      setCustomStream(prefs.customStreamUrl)
    } else if (prefs.radioStation) {
      setRadioStation(prefs.radioStation)
    }
  }, [])

  /** Zone music, driven by the bridge's own map-zone report - not by the
   * raw game-text connection GamePane used to own. */
  const mapZone = useAppStore((s) => s.mapZone)
  useEffect(() => {
    setZone(mapZone?.ok ? (mapZone.zone ?? null) : null)
  }, [mapZone])

  /** Alerts fire on arrival, not on render - see GamePane.tsx's original
   * comment on why `soundedUpTo` is a ref and why `[lines]` is the correct
   * (and previously three-times-wrong) dependency. Reproduced verbatim. */
  const soundedUpTo = useRef(0)
  useEffect(() => {
    if (!highlights.length || !lines.length) return
    const newest = lines[lines.length - 1].seq
    if (newest <= soundedUpTo.current) return

    const fresh = lines.filter((l) => l.seq > soundedUpTo.current)
    soundedUpTo.current = newest

    for (const l of fresh) {
      const p = paint(l.text, highlights, offClasses)
      const played = new Set<string>()
      for (const h of p.matched) {
        if (!h.sound || played.has(h.sound)) continue
        played.add(h.sound)
        playAlert(h.sound, h.cls)
      }
    }
  }, [lines, highlights, offClasses])

  // Anything already in the buffer when the config loads is history, not
  // news - deliberately keyed on the config alone, same as the original.
  useEffect(() => {
    if (highlights.length && lines.length) {
      soundedUpTo.current = Math.max(soundedUpTo.current, lines[lines.length - 1].seq)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights])

  // Silences an otherwise-unused-variable warning on `hlNote` - not
  // rendered here (there is no header row to show it in any more), kept
  // only because `useHighlights()` returns it alongside `highlights` and
  // discarding half a hook's return with a rename felt more confusing than
  // this being explicit that it is genuinely unused now.
  void hlNote

  return null
}
