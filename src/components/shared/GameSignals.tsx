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
import { gameState, subscribeGame } from '../../lib/gameLink.ts'
import { useSyncExternalStore } from 'react'
import { useRawGameLines } from '../../lib/useGameLines.ts'
import { paint } from '../../lib/highlights.ts'
import { useHighlights } from '../../lib/useHighlights.ts'
import { useOffClasses } from '../../lib/offClasses.ts'
import { playAlert, setAlertsVolume, setDangerVolume, setSpeechVolume } from '../../lib/alertSound.ts'
import {
  setZone,
  setMusicStarted,
  onMusicStarted,
  setMusicVolume,
  setRadioStation,
  setCustomStream,
  setPlaylist,
  initMediaSession,
  setCrossfadeStyle,
} from '../../lib/ambientSound.ts'
import { loadPrefs, savePrefs } from '../../lib/persistence.ts'
import { getPlaylist } from '../../lib/playlists.ts'
import { setMasterMuted } from '../../lib/audioMaster.ts'
import { useAppStore } from '../../store/useAppStore.ts'

export function GameSignals() {
  // Kept for API parity with the effect this was copied from - not read
  // directly, but the line subscription below already depends on the same
  // underlying connection this establishes a view onto.
  useSyncExternalStore(subscribeGame, gameState, gameState)
  /**
   * The **raw** buffer, not the displayed one - issue #484.
   *
   * `useGameLines()` is the display view: `currentGameLines()` drops a gagged
   * line from the array outright and hands back the *substituted* text for a
   * line a substitute matched. Reading it here meant a gag on a noisy combat
   * line - the natural thing to gag, and the natural line to have bound an
   * alert to - also silenced that line's chime, with nothing on screen
   * connecting the two, and no late arrival either, because `soundedUpTo` had
   * already advanced past it. A substitute that rewrote the words a highlight
   * matched did the same with no gag involved.
   *
   * A gag hides text from the eye, never from the ear or the alert broker.
   * `lineRules.ts`'s header is the argument for it: the raw buffer keeps every
   * line the game sent, and a gag is a display preference, not a delete.
   */
  const lines = useRawGameLines()
  const { highlights, note: hlNote } = useHighlights()
  const offClasses = useOffClasses()

  /** Restored once, on mount - see GamePane.tsx's original comment: these
   * modules have no opinion about storage, so something has to hand them
   * the remembered levels on startup. */
  useEffect(() => {
    initMediaSession()
    const prefs = loadPrefs()
    setMasterMuted(prefs.masterMuted ?? false)
    setAlertsVolume(prefs.alertsVolume ?? 0)
    setDangerVolume(prefs.dangerVolume ?? 0)
    setSpeechVolume(prefs.speechVolume ?? 0)
    setMusicVolume(prefs.musicVolume ?? 0)
    // Before anything below can start a source. A machine that has never run
    // this app answers false, and zone music then waits for the Play button
    // instead of starting itself off the mock bridge's invented zone - issue
    // #383, Defect 5 on the clean-VM first run.
    setMusicStarted(prefs.musicStarted ?? false)
    setCrossfadeStyle(prefs.crossfadeStyle ?? 'standard')
    const rememberedPlaylist = prefs.activePlaylistId
      ? getPlaylist(prefs.activePlaylistId)
      : undefined
    if (rememberedPlaylist) {
      setPlaylist(rememberedPlaylist.id, rememberedPlaylist.trackIds)
    } else if (prefs.customStreamUrl) {
      setCustomStream(prefs.customStreamUrl)
    } else if (prefs.radioStation) {
      setRadioStation(prefs.radioStation)
    }
    if (prefs.activePlaylistId && !rememberedPlaylist) {
      savePrefs({ activePlaylistId: null })
    }
  }, [])

  /** The one place that stores "yes, I want music" - ambientSound.ts owns no
   * storage, and every button that can start music routes through its single
   * `markMusicStarted`, so this subscription is the whole persistence path
   * rather than a `savePrefs` call repeated at five call sites. */
  useEffect(() => onMusicStarted(() => savePrefs({ musicStarted: true })), [])

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

  // This effect must stay before the playback effect. React runs effects in
  // declaration order after a commit; when a config first loads or reloads,
  // mark the current buffer as history before playback can inspect it.
  useEffect(() => {
    if (highlights.length && lines.length) {
      soundedUpTo.current = Math.max(soundedUpTo.current, lines[lines.length - 1].seq)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights])

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

  // Silences an otherwise-unused-variable warning on `hlNote` - not
  // rendered here (there is no header row to show it in any more), kept
  // only because `useHighlights()` returns it alongside `highlights` and
  // discarding half a hook's return with a rename felt more confusing than
  // this being explicit that it is genuinely unused now.
  void hlNote

  return null
}
