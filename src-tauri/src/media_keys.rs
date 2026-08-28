//! Global media-key injection, for controlling whatever else is playing -
//! Spotify, a browser tab, VLC, a desktop radio app - without needing that
//! app's own API. This is literally what a keyboard's media keys send; every
//! player above already listens for it system-wide, so nothing app-specific
//! is required and nothing has to be running in the foreground.
//!
//! # Why this and not real audio capture
//!
//! The ask this serves - "take music from other games or Spotify and control
//! it in game" - has two halves. Piping that audio *through* this app (real
//! per-process WASAPI loopback capture and mixing) is a whole audio-engine
//! project on its own, not a few Tauri commands, and is not attempted here.
//! What's built is the other half, which is genuinely achievable: driving
//! play/pause/next/previous/volume on whatever external source currently has
//! the system's media-key focus. Spotify, browsers and most media players
//! already answer to this, so the panel can control them without asking them
//! for anything.

#[cfg(target_os = "windows")]
mod win {
    // user32.dll's keybd_event - deprecated in favor of SendInput, but still
    // the simplest correct call for a handful of virtual-key taps, and this
    // app only ships for Windows (see Cargo.toml's authors/description).
    extern "system" {
        fn keybd_event(bvk: u8, bscan: u8, dwflags: u32, dwextrainfo: usize);
    }

    const KEYEVENTF_KEYUP: u32 = 0x0002;

    /// Press and release one virtual key, system-wide - the same event a
    /// physical media key on a keyboard would generate.
    pub fn tap(vk: u8) {
        unsafe {
            keybd_event(vk, 0, 0, 0);
            keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
        }
    }
}

// Standard Windows virtual-key codes for media/volume keys - stable across
// Windows versions, documented in winuser.h.
const VK_MEDIA_NEXT_TRACK: u8 = 0xB0;
const VK_MEDIA_PREV_TRACK: u8 = 0xB1;
const VK_MEDIA_STOP: u8 = 0xB2;
const VK_MEDIA_PLAY_PAUSE: u8 = 0xB3;
const VK_VOLUME_MUTE: u8 = 0xAD;
const VK_VOLUME_DOWN: u8 = 0xAE;
const VK_VOLUME_UP: u8 = 0xAF;

/// action name -> virtual-key code. Separated from `send_media_key` so a
/// test can exercise the real lookup without also tapping a real key on
/// whatever machine runs the test.
fn vk_for(action: &str) -> Result<u8, String> {
    match action {
        "play_pause" => Ok(VK_MEDIA_PLAY_PAUSE),
        "next" => Ok(VK_MEDIA_NEXT_TRACK),
        "previous" => Ok(VK_MEDIA_PREV_TRACK),
        "stop" => Ok(VK_MEDIA_STOP),
        "volume_up" => Ok(VK_VOLUME_UP),
        "volume_down" => Ok(VK_VOLUME_DOWN),
        "mute" => Ok(VK_VOLUME_MUTE),
        other => Err(format!("unknown media action: {other}")),
    }
}

/// One of: play_pause, next, previous, stop, volume_up, volume_down, mute.
/// Refuses an unknown action rather than silently doing nothing - same
/// "refuse, don't guess" as ambientSound.ts's station lookup.
#[tauri::command]
pub fn send_media_key(action: String) -> Result<(), String> {
    let vk = vk_for(&action)?;

    #[cfg(target_os = "windows")]
    {
        win::tap(vk);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = vk;
        Err("media key injection is only implemented on Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Refuses rather than silently doing nothing - the real match arm,
    /// exercised through `vk_for` rather than `send_media_key` so this
    /// never taps a real key on whatever machine runs the test.
    #[test]
    fn unknown_action_is_refused_not_ignored() {
        let err = vk_for("play").unwrap_err();
        assert!(err.contains("play"), "error should name the bad action: {err}");
    }

    #[test]
    fn every_documented_action_resolves_to_a_distinct_vk() {
        // Same action strings externalMedia.ts's MediaAction type and
        // SoundControls.tsx's ExternalMediaControls send - keeping this in
        // sync by hand is exactly the kind of drift rule 1 warns about, so
        // this exists specifically to catch one side changing without the
        // other. Sabotage-checked: deleting a match arm above makes this
        // fail with the real "unknown media action" error, not a tautology.
        let actions = [
            "play_pause",
            "next",
            "previous",
            "stop",
            "volume_up",
            "volume_down",
            "mute",
        ];
        let vks: Vec<u8> = actions
            .iter()
            .map(|a| vk_for(a).unwrap_or_else(|e| panic!("{e}")))
            .collect();

        let mut sorted = vks.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), vks.len(), "two actions map to the same key: {vks:?}");
    }
}
