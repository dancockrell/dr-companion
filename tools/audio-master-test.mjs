import { effectiveAudioGain, masterMuted, onMasterMuteChange, setMasterMuted } from '../src/lib/audioMaster.ts'
import { readFileSync } from 'node:fs'

let failed = 0
const check = (label, got, want = true) => {
  const ok = Object.is(got, want)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `: got ${got}, want ${want}`}`)
  if (!ok) failed++
}

const changes = []
const unsubscribe = onMasterMuteChange((muted) => changes.push(muted))
setMasterMuted(false)
check('configured gain passes through while unmuted', effectiveAudioGain(0.73), 0.73)
setMasterMuted(true)
check('master mute gates output without changing configured gain', effectiveAudioGain(0.73), 0)
check('mute state is authoritative', masterMuted(), true)
setMasterMuted(false)
check('unmute restores the same configured gain', effectiveAudioGain(0.73), 0.73)
unsubscribe()
setMasterMuted(true)
check('subscribers receive only changes while subscribed', JSON.stringify(changes), JSON.stringify([true, false]))
setMasterMuted(false)

const persistence = readFileSync('src/lib/persistence.ts', 'utf8')
const controls = readFileSync('src/components/game/SoundControls.tsx', 'utf8')
const alerts = readFileSync('src/lib/alertSound.ts', 'utf8')
const ambient = readFileSync('src/lib/ambientSound.ts', 'utf8')
const signals = readFileSync('src/components/shared/GameSignals.tsx', 'utf8')
const transport = readFileSync('src/components/game/MusicTransport.tsx', 'utf8')
check('persisted and live channel gains share one first-run default owner',
  [persistence, alerts, ambient].every((source) => source.includes('DEFAULT_AUDIO_VOLUMES')))
check('mute state is persisted separately from channel gains', persistence.includes('masterMuted?: boolean') && persistence.includes('masterMuted: false'))
check('quick mute writes only the master gate', controls.includes('savePrefs({ masterMuted: next })') && !controls.includes('applyAll({ alerts: 0'))
check('alert output consumes the master gate', alerts.includes('effectiveAudioGain(volumes[channel])') && alerts.includes('masterMuted()'))
check('music output consumes the master gate and refreshes live', ambient.includes('effectiveAudioGain(Math.min') && ambient.includes('onMasterMuteChange(() => music.refreshMasterGain())'))
check('startup restores a remembered playlist with its tracks', signals.includes('setPlaylist(rememberedPlaylist.id, rememberedPlaylist.trackIds)'))
check('startup removes a dead remembered playlist id', signals.includes('savePrefs({ activePlaylistId: null })'))
check('quick music volume changes persist', /setMusicVolume\(next\)[\s\S]*savePrefs\(\{ musicVolume: next \}\)/.test(transport))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
