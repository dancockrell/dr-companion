//! Pause, as a gate on the wire rather than a flag in a driver.
//!
//! Pause used to live in `flowDriver.ts`: the driver stopped scheduling its
//! next step. That worked for the seven built-in flows and for nothing else -
//! a hand-written Lich script, or anything else holding a script-API socket,
//! sailed straight past it. The button said "Pause" and meant "pause the flows
//! this app happens to ship".
//!
//! So Pause moved to the widest thing this process owns: `command_gate.rs`,
//! the outbound lane every command *this process sends* enters, from a script,
//! a button, a keybinding or the command bar alike. This file is the two
//! commands the UI toggles it with.
//!
//! # The lane is not every automated command, and saying so cost a zone
//!
//! This header used to say the lane was "the one place every automated command
//! passes through". It was 95% true, and the 5% was the part that moves the
//! character across a map. `map_walk` - a tile click, and since #447 a click in
//! the 3D viewer - is a *bridge intent*: `companion_bridge.lic` handles it by
//! starting Lich's `go2` as its own script, and every movement command that
//! route sends comes from inside the Lich process. None of it enters this lane,
//! so `paused` is never consulted for any of it. Pause held every typed,
//! keybound, macro, AI and script command and did not hold the one thing that
//! walks a character through a town. Issue #462.
//!
//! A claim that is 95% true is what stops the next reviewer looking at the
//! other 5%, so the accurate statement is: **this lane holds every automated
//! command that leaves this process, and the bridge holds the automation that
//! runs inside Lich.** The bridge has its own Pause latch beside its Stop latch
//! (`Intents.@pause_requested`, bridge 0.13.0), set by the `pause` intent and
//! cleared by `resume`, and it refuses `map_walk`, `run_macro` and
//! `start_script` while it is up as well as suspending a route already under
//! way. `tools/pause-reaches-travel-test.mjs` derives the set of movers from
//! the bridge's own dispatch table and fails when one of them is not held.
//!
//! # One flag, one owner - and one mirror that must be able to disagree
//!
//! The flag lives in the lane, because that is the thing that has to consult
//! it on every pick, and a second copy here would be two things answering one
//! question. These commands set and read it; nothing else writes it.
//!
//! The bridge's latch is not a second copy of it. It is a different process's
//! answer to the same question, and it can honestly differ - an older bridge
//! has no latch at all, and a disconnected one has said nothing. The UI reads
//! the pair as three states rather than two (`src/lib/pauseStatus.ts`):
//! running, paused with the bridge confirming, and paused with nothing having
//! confirmed. Folding the third into either of the first two is the lie this
//! whole comment is a correction of.
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
