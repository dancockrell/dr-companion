//! Pause, as a gate on the wire rather than a flag in a driver.
//!
//! Pause used to live in `flowDriver.ts`: the driver stopped scheduling its
//! next step. That worked for the seven built-in flows and for nothing else -
//! a hand-written Lich script, or anything else holding a script-API socket,
//! sailed straight past it. The button said "Pause" and meant "pause the flows
//! this app happens to ship".
//!
//! So Pause moved to the one place every automated command passes through.
//! That place used to be `script_api::dispatch`, which was as far out as it
//! could go while the frontend had its own unmediated path to the socket. It
//! is now `command_gate.rs` - the outbound lane every command enters, from a
//! script, a button, a keybinding or the command bar alike - and this file is
//! the two commands the UI toggles it with.
//!
//! # One flag, one owner
//!
//! The flag lives in the lane, because that is the thing that has to consult
//! it on every pick, and a second copy here would be two things answering one
//! question. These commands set and read it; nothing else writes it.
//!
//! # Delayed, never dropped
//!
//! A paused command is held, not refused and not lost. It waits in the lane
//! and goes out when Pause lifts.
//!
//! Refusing loses the command while the task believes it was sent - the task
//! walks on to its next step having never done the thing. The old objection to
//! queueing was that a pause held for a minute then releases a minute of
//! commands in one burst at a live character, which is both dangerous in the
//! game and the exact shape that looks like scripted abuse from the server's
//! side. That objection is answered rather than ignored: the lane paces the
//! release against roundtime and coalesces repeated movement, so what comes
//! out the other side of a long pause is paced play, not a burst. And a script
//! blocks exactly as it did before, because `script_api` waits on its ticket.
//!
//! A pause nobody lifts still ends: after `command_gate::MAX_PAUSE_HOLD_MS`
//! the held command is refused **and says so**, which is recoverable, rather
//! than a thread hanging silently, which is not.
//!
//! # What pause deliberately does not cover
//!
//! Anything the *player* types. Pause is a control over automation, and a
//! player who pauses a task and then types `stand` themselves means to stand.
//! `Source::Player` is the one source the lane never holds.

/// Hold or release every automated command. Returns the resulting state, so
/// the caller never has to assume the toggle took.
#[tauri::command]
pub fn set_paused(gate: tauri::State<'_, crate::command_gate::CommandGate>, paused: bool) -> bool {
    gate.set_paused(paused);
    gate.status().paused
}

/// Whether automation is currently held. Asked rather than remembered, so a
/// window opened later shows the truth instead of its own default.
#[tauri::command]
pub fn is_paused(gate: tauri::State<'_, crate::command_gate::CommandGate>) -> bool {
    gate.status().paused
}
