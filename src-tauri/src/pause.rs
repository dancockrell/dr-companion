//! Pause, as a gate on the wire rather than a flag in a driver.
//!
//! Pause used to live in `flowDriver.ts`: the driver stopped scheduling its
//! next step. That worked for the seven built-in flows and for nothing else -
//! a hand-written Lich script, or anything else holding a script-API socket,
//! sailed straight past it. The button said "Pause" and meant "pause the flows
//! this app happens to ship".
//!
//! Now that flows are ordinary Python programs talking over the script API,
//! that gap would be the whole feature. So Pause moved to the one place every
//! automated command passes through: `script_api::dispatch`.
//!
//! # Delayed, never dropped
//!
//! A paused `send` blocks until resume. It is not refused and it is not
//! queued.
//!
//! Refusing loses the command while the task believes it was sent - the task
//! walks on to its next step having never done the thing. Queueing is worse:
//! a pause held for a minute releases a minute of commands in one burst at a
//! live character, which is both dangerous in the game and the exact shape
//! that looks like scripted abuse from the server's side.
//!
//! Blocking makes the task wait, which is what "pause" means everywhere else.
//! The task's own roundtime handling picks up correctly on the other side
//! because it re-reads the clock rather than counting.
//!
//! # What pause deliberately does not cover
//!
//! Anything the *player* types. Pause is a control over automation, and a
//! player who pauses a task and then types `stand` themselves means to stand.
//! The gate is in the script-API dispatch path only; `game_link::game_send`
//! called from the frontend is untouched.

use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// Longest a single command will sit waiting on a pause.
///
/// A pause is a person deciding something, not a scheduling primitive, so this
/// is generous. It exists so a forgotten pause cannot strand a script thread
/// forever - after this the command is refused *and says so*, which is
/// recoverable, rather than the thread hanging silently, which is not.
const MAX_WAIT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct Pause {
    paused: Mutex<bool>,
    changed: Condvar,
}

/// What happened to a command that met the gate.
#[derive(Debug, PartialEq, Eq)]
pub enum Gate {
    /// Not paused, or paused and then resumed. Send it.
    Proceed,
    /// Held past `MAX_WAIT`. The caller must tell the script, not drop it
    /// quietly - a command that vanished without a word is indistinguishable
    /// from one the game ignored.
    TimedOut,
}

impl Pause {
    pub fn set(&self, paused: bool) {
        let mut guard = self.paused.lock().unwrap();
        *guard = paused;
        // Wake every waiter, not one: resume releases all held commands, and
        // notify_one would leave the rest asleep until the next toggle.
        self.changed.notify_all();
    }

    pub fn is_paused(&self) -> bool {
        *self.paused.lock().unwrap()
    }

    /// Block while paused. Returns how the wait ended.
    pub fn wait_while_paused(&self) -> Gate {
        self.wait_with_deadline(MAX_WAIT)
    }

    /// The same, with the deadline as a parameter so a test can reach the
    /// timeout branch on purpose instead of waiting five minutes for it.
    /// A branch nobody can execute deliberately is a branch nobody can prove.
    pub fn wait_with_deadline(&self, limit: Duration) -> Gate {
        let started = Instant::now();
        let mut guard = self.paused.lock().unwrap();
        while *guard {
            let remaining = match limit.checked_sub(started.elapsed()) {
                Some(r) if !r.is_zero() => r,
                _ => return Gate::TimedOut,
            };
            let (next, timeout) = self.changed.wait_timeout(guard, remaining).unwrap();
            guard = next;
            // Re-check the flag rather than trusting the wakeup: a condvar may
            // wake spuriously, and `set(true)` twice in a row wakes waiters
            // who must then go back to sleep.
            if timeout.timed_out() && *guard {
                return Gate::TimedOut;
            }
        }
        Gate::Proceed
    }
}

/// Hold or release every script's commands. Returns the resulting state, so
/// the caller never has to assume the toggle took.
#[tauri::command]
pub fn set_paused(pause: tauri::State<'_, Pause>, paused: bool) -> bool {
    pause.set(paused);
    pause.is_paused()
}

/// Whether commands are currently held. Asked rather than remembered, so a
/// window opened later shows the truth instead of its own default.
#[tauri::command]
pub fn is_paused(pause: tauri::State<'_, Pause>) -> bool {
    pause.is_paused()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn an_unpaused_gate_does_not_block() {
        let p = Pause::default();
        let started = Instant::now();
        assert_eq!(p.wait_while_paused(), Gate::Proceed);
        assert!(started.elapsed() < Duration::from_millis(50));
    }

    #[test]
    fn a_paused_command_proceeds_when_resumed_rather_than_being_refused() {
        let p = Arc::new(Pause::default());
        p.set(true);

        let waiter = {
            let p = Arc::clone(&p);
            std::thread::spawn(move || p.wait_while_paused())
        };

        // Still held after a beat - the positive control for this test. Without
        // it, a gate that never blocked at all would pass just as happily.
        std::thread::sleep(Duration::from_millis(150));
        assert!(!waiter.is_finished(), "the gate let a paused command through");

        p.set(false);
        assert_eq!(waiter.join().unwrap(), Gate::Proceed);
    }

    #[test]
    fn a_pause_nobody_lifts_times_out_and_says_so() {
        let p = Pause::default();
        p.set(true);
        assert_eq!(
            p.wait_with_deadline(Duration::from_millis(120)),
            Gate::TimedOut
        );
    }

    #[test]
    fn resume_releases_every_held_command_not_just_one() {
        let p = Arc::new(Pause::default());
        p.set(true);

        // Three waiters rather than one, because the bug this is aimed at only
        // exists in the plural.
        //
        // Measured limit, so nobody reads more into a green run than it holds:
        // swapping `notify_all` for `notify_one` does NOT redden this test on
        // Windows - the remaining waiters wake anyway. So this asserts the
        // property (everything held is released) and does not pin the
        // mechanism. `notify_all` stays because the API only *guarantees* the
        // property with it; a platform waking the others is luck, not contract.
        // The other sabotage - making the gate never block at all - does redden
        // this file, so these tests are not vacuous.
        let waiters: Vec<_> = (0..3)
            .map(|_| {
                let p = Arc::clone(&p);
                std::thread::spawn(move || p.wait_with_deadline(Duration::from_secs(5)))
            })
            .collect();

        std::thread::sleep(Duration::from_millis(100));
        p.set(false);

        for w in waiters {
            assert_eq!(w.join().unwrap(), Gate::Proceed);
        }
    }
}
