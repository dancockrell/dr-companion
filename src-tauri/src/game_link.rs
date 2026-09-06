//! The socket that makes this a client rather than a companion.
//!
//! Lich's `--detachable-client=PORT` opens a `TCPServer` and hands whatever
//! connects to `$_CLIENT_`: it writes game output there and reads player
//! commands back. No handshake, no framing but newlines. So being the frontend
//! is a TCP connection and a line splitter, and the difficulty in this file is
//! entirely about what happens when things go wrong rather than when they go
//! right.
//!
//! # What changes by being here
//!
//! As a companion, this app saw whatever `companion_bridge.lic` chose to
//! summarise. As the frontend it gets **every line the game sends**. The
//! helm-versus-wind-instrument warning, the highlight corpus, the mindstate
//! ladder - all of that was reaching through a straw for text that was on the
//! wire the whole time.
//!
//! See docs/ENGINE.md.
//!
//! # Three rules this file exists to keep
//!
//! **Nothing blocks.** Reading runs on its own thread and pushes to the
//! webview through events. A frontend that stalls because the game went quiet
//! is a frontend nobody can press Stop in.
//!
//! **Nothing is swallowed.** Every line reaches the UI, including ones we do
//! not understand. A client that drops what it cannot parse is a client that
//! silently loses the one message that mattered, and this project has already
//! paid for that lesson twice.
//!
//! **Disconnected is not quiet.** A dead socket and an idle game look
//! identical from a text pane. The link reports its state as a fact so the UI
//! can say which, rather than showing an empty pane that means either.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// One line off the wire, on its way to the pane.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLine {
    /// Monotonic, assigned here. The UI needs a stable key per line and the
    /// text is not one: a MUD repeats itself constantly, and two identical
    /// "Obvious paths: east, south, west." lines are different events.
    pub seq: u64,
    /// Wall-clock receive time for history and export. Sequence remains the
    /// ordering authority because clocks can move and several chunks can
    /// arrive in one millisecond.
    pub received_at_ms: u64,
    pub text: String,
}

fn received_at_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

/// Native recovery budget for the frontend's 20,000-display-line contract.
/// A chunk is at most one wire line; 25,000 therefore covers the full visible
/// history plus framing/tag chunks that may not become display lines. The
/// realistic-corpus measurement in `tools/backlog-test.mjs` keeps this budget
/// honest about serialized recovery payload size.
const BACKLOG_MAX: usize = 25_000;

/// Chunks already emitted, kept so a frontend that mounts late can catch up.
#[derive(Default)]
struct BacklogBuf {
    lines: VecDeque<GameLine>,
    /// Read, then aged out. Counted rather than forgotten: a pane that quietly
    /// begins mid-session is indistinguishable from one that lost nothing.
    dropped: u64,
}

impl BacklogBuf {
    fn push(&mut self, line: GameLine) {
        if self.lines.len() >= BACKLOG_MAX {
            self.lines.pop_front();
            self.dropped += 1;
        }
        self.lines.push_back(line);
    }
}

/// What `game_backlog` hands back.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlog {
    pub lines: Vec<GameLine>,
    pub dropped: u64,
}

/// What the link is doing, as a fact rather than an inference from silence.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkState {
    pub connected: bool,
    pub host: String,
    pub port: u16,
    /// Whether the link is between sockets rather than without one.
    ///
    /// Three states, not two, and this is the one that was missing. A socket
    /// that has dropped and a socket that is being re-dialled look identical
    /// from a text pane - both are silent - and they want opposite things of
    /// the player: wait, versus go and look at Lich. Before this the app only
    /// ever said "not attached", which is true of both and useful for neither.
    pub reconnecting: bool,
    /// Which re-dial this is, 1-based, and 0 when none is under way.
    ///
    /// Carried into the give-up state too, where it is the count that was
    /// spent: "gave up after 6 attempts" is a fact a player can act on, where
    /// "could not connect" is the same sentence as the very first refusal.
    pub attempt: u32,
    /// The bound. Published so the UI can say "3 of 6" rather than counting
    /// upward toward a ceiling only Rust knows about - and so a test can
    /// assert from outside that a bound exists at all, which is the half that
    /// a removed bound would otherwise pass.
    pub max_attempts: u32,
    /// Lines received since connecting. The denominator: a pane that is empty
    /// because nothing arrived reads exactly like one that is empty because
    /// the parse dropped everything.
    pub lines: u64,
    /// Why it is not connected, when it is not. Empty while connected.
    pub note: String,
    /// Whether Lich itself is still there, which is a different question from
    /// whether we still have a socket to it.
    ///
    /// Lich exits when the game server hangs up - observed 27 Aug 2026:
    ///
    /// ```text
    /// info: shutdown requested reason=game_eof source=game_reader
    /// info: exiting...
    /// ```
    ///
    /// `game_eof` is the upstream socket to the game ending, and Lich then
    /// tears down and takes this port with it. From in here that is
    /// indistinguishable from our own socket dropping while Lich runs on, and
    /// the two need opposite actions: press Attach again, versus restart Lich
    /// first. Reporting both as "Connection lost" sends people to retry
    /// something that cannot work.
    ///
    /// Three states, never two:
    ///
    /// - `"alive"`  - the port accepted a connection, so Lich is up and we
    ///   lost only our socket.
    /// - `"gone"`   - the connection was refused, so nothing is listening.
    /// - `"unknown"` - the probe could not answer: it timed out, failed for
    ///   its own reasons, or was never run.
    ///
    /// The third is the point. Folding "could not determine" into "gone"
    /// would tell somebody to restart a Lich that is running perfectly, which
    /// is the mirror image of the bug this field exists to fix.
    pub lich: String,
}

/// Ask the port directly whether Lich is still there.
///
/// A fact obtained from outside, rather than an inference from why our own
/// read ended - which matters, because the read ending tells us about *our
/// socket* and says nothing about whether the process behind it has finished
/// exiting, or was ever the thing that closed.
///
/// # Why a blocking connect, and not `connect_timeout`
///
/// `connect_timeout` was the obvious choice and it cannot do this job on
/// Windows. Measured here 27 Aug 2026: connecting to a *closed* loopback port
/// returns `kind=TimedOut, raw_os=None`, not `ConnectionRefused` - so a probe
/// built on it can never say "gone", only "unknown", and the whole field
/// silently degrades to a constant. The negative case in this module's test is
/// what caught that; a test that only checked the alive path would have passed
/// and shipped an inert feature.
///
/// A plain `connect` does discriminate - `ConnectionRefused`, raw OS 10061 -
/// at the cost of about **2 seconds** on a closed port, against 119µs when
/// something is listening. That cost is why this must not run inline; see
/// `emit_disconnect`.
///
/// This does open a connection to the detachable-client port when Lich is up.
/// That is the same thing the Attach button does a moment later, and it only
/// runs once our own reader has already stopped, so there is no live client
/// session for it to disturb. It is dropped immediately.
fn probe_lich(host: &str, port: u16) -> &'static str {
    match TcpStream::connect((host, port)) {
        Ok(_) => "alive",
        // Refused is the one error that actually means "nothing is listening".
        // Every other kind - timed out, unreachable, permission, a host that
        // will not resolve - is the probe failing to answer, and must not be
        // reported as an answer.
        Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => "gone",
        Err(_) => "unknown",
    }
}

/// Report a disconnect at once, then say what became of Lich when we know.
///
/// Two emits on purpose. The probe costs ~2s to establish "gone" (see
/// `probe_lich`), and making the pane wait that long before it admits the
/// connection dropped would trade a real, immediate fact for a refinement of
/// it. So the first emit carries `lich: "unknown"` - honest, since at that
/// instant nothing has been asked - and a second follows with the answer.
///
/// The probe runs on its own thread because this is called from the reader
/// thread as it winds down, and nothing about shutting down should wait on a
/// socket that is by definition not answering.
///
/// A consumer must therefore expect `lich` to change after a disconnect, and
/// must not treat the first value as final.
fn emit_disconnect(
    app: &AppHandle,
    host: String,
    port: u16,
    lines: u64,
    note: String,
    attempt: u32,
) {
    let mut st = LinkState {
        connected: false,
        host: host.clone(),
        port,
        reconnecting: false,
        attempt,
        max_attempts: RECONNECT_MAX_ATTEMPTS,
        lines,
        note,
        lich: "unknown".into(),
    };
    let _ = app.emit("game:state", st.clone());

    let app2 = app.clone();
    std::thread::spawn(move || {
        let verdict = probe_lich(&host, port);
        // Nothing new to say - do not emit a second identical state and make
        // the UI think something changed.
        if verdict == "unknown" {
            return;
        }
        st.lich = verdict.into();
        let _ = app2.emit("game:state", st);
    });
}

/// How many times a dropped link re-dials before it stops and says so.
///
/// Bounded on purpose, and the bound is the whole feature rather than a
/// safety rail on it. An unbounded retry is a client that can never say
/// anything except "not connected yet", so a Lich that has exited and a Lich
/// that is thirty seconds into a restart produce the same forever-spinner and
/// the player learns to ignore it. Six attempts on the schedule below spans
/// about half a minute, which covers a Lich restart and a network blip and
/// does not cover a Lich that is gone.
pub(crate) const RECONNECT_MAX_ATTEMPTS: u32 = 6;

/// First backoff wait. The socket has just died; nothing is gained by dialling
/// in the same millisecond, and half a second is under the threshold at which
/// a person reads a gap as a stall.
pub(crate) const RECONNECT_BASE: Duration = Duration::from_millis(500);

/// The ceiling on one wait. Doubling from 500ms reaches 16s at attempt six,
/// and a player watching a reconnect should not sit through a wait longer than
/// this without the counter moving.
pub(crate) const RECONNECT_MAX_DELAY: Duration = Duration::from_secs(8);

/// How long to wait before the `attempt`-th re-dial. 1-based.
///
/// Pure, so the schedule is a thing a test can read rather than a thing a test
/// has to time. `base * 2^(attempt-1)`, capped - and the cap is applied with
/// `min` on a saturating shift, because `2^31` of anything overflows and an
/// overflow here would produce a *short* wait, which is the failure that looks
/// like the feature working.
pub(crate) fn backoff_delay(attempt: u32, base: Duration, cap: Duration) -> Duration {
    let shift = attempt.saturating_sub(1).min(32);
    let scaled = base.saturating_mul(1u32.checked_shl(shift).unwrap_or(u32::MAX));
    scaled.min(cap)
}

/// Why a reconnect run stopped without a socket.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum GaveUp {
    /// The bound was reached. Names the count, because "could not connect" is
    /// the same sentence as the first refusal and tells nobody that five more
    /// were tried.
    Exhausted { attempts: u32, last: String },
    /// Something said stop: a deliberate detach, or the app shutting down.
    /// Not a failure and must never be reported as one.
    Cancelled { attempts: u32 },
    /// The dialler answered with something no amount of retrying can fix -
    /// Lich itself has exited. Retrying five more times would spend thirty
    /// seconds proving a thing already known.
    Fatal { attempts: u32, reason: String },
}

impl GaveUp {
    pub(crate) fn attempts(&self) -> u32 {
        match self {
            GaveUp::Exhausted { attempts, .. }
            | GaveUp::Cancelled { attempts }
            | GaveUp::Fatal { attempts, .. } => *attempts,
        }
    }

    /// The sentence the pane shows. Every arm names the attempt count.
    pub(crate) fn note(&self, host: &str, port: u16) -> String {
        match self {
            GaveUp::Exhausted { attempts, last } => {
                format!("Gave up reconnecting to {host}:{port} after {attempts} attempts - {last}")
            }
            GaveUp::Cancelled { attempts } => {
                format!("Stopped reconnecting to {host}:{port} after {attempts} attempts.")
            }
            GaveUp::Fatal { attempts, reason } => {
                format!(
                    "Stopped reconnecting to {host}:{port} after {attempts} attempts - {reason}"
                )
            }
        }
    }
}

/// The reconnect schedule, with everything it touches injected.
///
/// The clock, the dialler and the reporter are all parameters so this can be
/// driven in a unit test that takes no wall-clock time and needs no Tauri app
/// handle - which is what makes "the backoff schedule was actually followed"
/// something a test can *read* rather than something it has to measure and
/// then forgive for being 40ms out.
///
/// `wanted` is asked before every wait and again before every dial. A detach
/// that lands mid-backoff must not produce a socket nobody asked for.
///
/// Returns the connection and the attempt number it arrived on, or the reason
/// the run stopped. `Cancelled` is not a failure; `note` above keeps the three
/// apart so a caller cannot fold them into one.
#[allow(clippy::too_many_arguments)]
pub(crate) fn reconnect_run<T>(
    max_attempts: u32,
    base: Duration,
    cap: Duration,
    wanted: &dyn Fn() -> bool,
    dial: &mut dyn FnMut() -> Result<T, DialOutcome>,
    before_wait: &mut dyn FnMut(u32, Duration),
    sleep: &dyn Fn(Duration),
) -> Result<(T, u32), GaveUp> {
    // A bound of zero would make this a no-op that reports success at nothing,
    // which is the shape of every silent-pass defect in this repository.
    // Refused loudly rather than tolerated.
    assert!(
        max_attempts > 0,
        "a reconnect with no attempts is not a reconnect"
    );
    let mut last = String::new();
    for attempt in 1..=max_attempts {
        if !wanted() {
            return Err(GaveUp::Cancelled {
                attempts: attempt - 1,
            });
        }
        let delay = backoff_delay(attempt, base, cap);
        before_wait(attempt, delay);
        sleep(delay);
        if !wanted() {
            return Err(GaveUp::Cancelled {
                attempts: attempt - 1,
            });
        }
        match dial() {
            Ok(t) => return Ok((t, attempt)),
            Err(DialOutcome::Retry(e)) => last = e,
            Err(DialOutcome::Fatal(reason)) => {
                return Err(GaveUp::Fatal {
                    attempts: attempt,
                    reason,
                })
            }
        }
    }
    Err(GaveUp::Exhausted {
        attempts: max_attempts,
        last,
    })
}

/// What a failed dial means for the run.
pub(crate) enum DialOutcome {
    /// Nothing is listening yet. Worth another attempt.
    Retry(String),
    /// The process behind the port has gone. No number of attempts fixes it.
    Fatal(String),
}

/// One re-dial of the real port, classified.
///
/// `dial_with_retry` is reused rather than re-implemented: it already owns the
/// single-dial semantics, the "Lich exited" branch and the launch-file rules,
/// and a second dialler here would be a fork that drifts from it. The zero
/// wait is deliberate - the *schedule* belongs to `reconnect_run` above, and a
/// dialler with its own internal wait would give the link two backoffs
/// stacked, neither of which the state it publishes would describe.
fn dial_once(host: &str, port: u16) -> Result<TcpStream, DialOutcome> {
    match dial_with_retry(
        host,
        port,
        Duration::ZERO,
        DIAL_INTERVAL,
        &crate::lich::spawned_lich_status,
    ) {
        Ok(s) => Ok(s),
        // `dial_with_retry`'s exited branch is the only one that means "stop".
        // Matched on the sentence it builds rather than on a code because that
        // function returns a String; the two are asserted to agree by
        // `a_lich_that_exited_is_not_retried`, so a reworded message reddens a
        // test instead of silently turning a fatal into six more dials.
        Err(e) if e.contains("exited") => Err(DialOutcome::Fatal(e)),
        Err(e) => Err(DialOutcome::Retry(e)),
    }
}

#[derive(Default)]
pub struct GameLink {
    inner: Mutex<Option<LinkHandle>>,
}

struct LinkHandle {
    /// The write half. Commands go out through this.
    ///
    /// Replaced in place when a reconnect succeeds, rather than the handle
    /// being torn down and rebuilt: `lines`, `backlog` and the sequence
    /// numbering must survive a reconnect or the pane loses its scrollback
    /// every time the network hiccups, and a fresh handle would restart the
    /// sequence at 1 while the frontend still held the old high-water mark.
    out: TcpStream,
    host: String,
    port: u16,
    lines: Arc<AtomicU64>,
    /// Shared with the reader thread, which fills it as it emits.
    backlog: Arc<Mutex<BacklogBuf>>,
    /// Cleared to stop the reader thread. The thread owns its own socket
    /// clone, so dropping this struct alone would leave it reading forever.
    running: Arc<AtomicBool>,
    /// Whether the *player* still wants to be attached, which is a different
    /// question from whether a socket is currently open.
    ///
    /// `running` answers "is a reader thread alive"; a dropped socket and a
    /// pressed Detach both clear it, and the two want opposite things — one
    /// should re-dial and the other must not. Without a second flag the
    /// supervisor cannot tell them apart, and a detach that happens to land
    /// while the reader is winding down would come back reconnected.
    desired: Arc<AtomicBool>,
    /// Which re-dial is under way: 0 when none is. Read by `attached()` so a
    /// refused send says *reconnecting* rather than *not attached*, which is
    /// the difference between "wait" and "go and press a button".
    reconnecting: Arc<AtomicU32>,
}

fn state_of(h: Option<&LinkHandle>, note: &str) -> LinkState {
    match h {
        Some(h) => {
            let connected = h.running.load(Ordering::Relaxed);
            let attempt = h.reconnecting.load(Ordering::Relaxed);
            LinkState {
                connected,
                host: h.host.clone(),
                port: h.port,
                // A reconnect in flight is never also "connected": the
                // supervisor clears the counter before it publishes the
                // connected state, so these two cannot both be true and a
                // consumer does not have to decide which wins.
                reconnecting: !connected && attempt > 0,
                attempt,
                max_attempts: RECONNECT_MAX_ATTEMPTS,
                lines: h.lines.load(Ordering::Relaxed),
                note: note.to_string(),
                // While connected we hold an open socket to it, so no probe is
                // needed or wanted. While not, this path has no idea - the
                // reader thread's own disconnect paths are what probe, and
                // this is reached by polling and by a deliberate detach.
                lich: if connected { "alive" } else { "unknown" }.into(),
            }
        }
        None => LinkState {
            connected: false,
            host: String::new(),
            port: 0,
            reconnecting: false,
            attempt: 0,
            max_attempts: RECONNECT_MAX_ATTEMPTS,
            lines: 0,
            note: note.to_string(),
            // Never attached, so there is no host to ask and nothing to
            // report. "unknown" rather than "gone": we have not looked.
            lich: "unknown".into(),
        },
    }
}

#[tauri::command]
pub fn game_status(link: State<'_, GameLink>) -> LinkState {
    let guard = link.inner.lock().unwrap();
    let note = if guard.is_some() { "" } else { "Not attached." };
    state_of(guard.as_ref(), note)
}

/// How often the retry below re-dials while it waits for Lich's listener.
///
/// Four times a second: fast enough that a player does not sit on a ready
/// socket, slow enough that eighty attempts over twenty seconds cost nothing.
const DIAL_INTERVAL: Duration = Duration::from_millis(250);

/// Connect, retrying until `wait` has elapsed, Lich exits, or it answers.
///
/// Three outcomes, deliberately, and each says which happened (issue #458):
///
/// - **connected** - the only success, and the moment the `.sal` can go;
/// - **the process exited** - reported with its exit code, because "connection
///   refused" would send a player looking at their firewall for a Ruby that
///   died on a syntax error;
/// - **the deadline passed** - reported as a wait that ran out, naming how long
///   it waited, rather than as the last refusal.
///
/// The launch file is shredded on **every** exit from here, not only on the
/// happy path. `sal.rs`'s lifetime note treats the attach as the "provably safe
/// now" moment; a sign-in whose attach fails is a sign-in whose one-shot game
/// key has no further use, and leaving it for the 120-second backstop was the
/// second half of #458.
///
/// `status` is injected so the "Lich exited" branch can be executed in a test
/// without spawning a Ruby that dies on cue.
pub(crate) fn dial_with_retry(
    host: &str,
    port: u16,
    wait: Duration,
    interval: Duration,
    status: &dyn Fn() -> crate::lich::SpawnedLich,
) -> Result<TcpStream, String> {
    let deadline = std::time::Instant::now() + wait;
    // Declared without a value on purpose: every path that reads it has been
    // through the `Err` arm below, so an initialiser here would be a string
    // that could be reported having never come from a dial.
    let mut last: String;
    loop {
        match TcpStream::connect((host, port)) {
            Ok(stream) => {
                // The detachable socket is up, which is the first externally
                // observable moment provably after Lich finished reading the
                // launch file: Lich is done with `@launch_data` by
                // `main.rb:349` and does not open this listener until
                // `main.rb:842-857`. So the one-shot game key can go now. A
                // no-op unless this app started that Lich itself - see
                // `lich::shred_pending_launch_files`.
                crate::lich::shred_pending_launch_files();
                return Ok(stream);
            }
            Err(e) => last = e.to_string(),
        }

        // Asked *after* a failed dial, not before: a Lich that exited having
        // already opened the port is one this app can still attach to, and
        // checking first would refuse it.
        if let crate::lich::SpawnedLich::Exited(code) = status() {
            crate::lich::shred_pending_launch_files();
            return Err(match code {
                Some(code) => format!(
                    "Lich started and then exited with code {code} without opening {host}:{port}."
                ),
                None => format!("Lich started and then exited without opening {host}:{port}."),
            });
        }

        if std::time::Instant::now() + interval > deadline {
            return Err(if wait.is_zero() {
                // A single dial, which is the Attach button. The launch file is
                // deliberately NOT shredded here: a player pressing Attach
                // while Lich is still booting has not proved anything about
                // it, and Lich does not read `@launch_data` until
                // `main.rb:213`. Shredding on that refusal would break the very
                // sign-in it was asked about.
                format!("Could not reach {host}:{port} - {last}")
            } else {
                // A wait that ran its course is different: Lich has had the
                // whole window to read the file and open the port, and has done
                // neither. The one-shot key has no further use.
                crate::lich::shred_pending_launch_files();
                format!(
                    "Lich did not open {host}:{port} within {:.1} seconds - {last}",
                    wait.as_secs_f32()
                )
            });
        }
        std::thread::sleep(interval);
    }
}

/// Attach to a Lich that is already running with `--detachable-client`.
///
/// Deliberately does not start Lich. Launching is `lich.rs`, which has its own
/// reasons to be careful, and a connect that silently spawned a process would
/// be doing two things under one name.
///
/// # `wait_ms`, and why a single dial was wrong
///
/// `None` dials once, which is right for the Attach button: a player pressing
/// it is asking about a Lich they believe is already up, and twenty seconds of
/// spinner to tell them it is not would be worse than an immediate answer.
///
/// `Some(ms)` retries until the deadline, and the sign-in path passes it
/// (issue #458). Signing in *starts* Lich, and `lich_login_launch` returns the
/// moment `spawn` succeeds - which is process creation, not readiness. Lich
/// does not open the detachable listener until `main.rb:842-857`, after Ruby
/// boots, Lich loads and the game connection is made, so a dial in the same
/// tick provably cannot succeed. It failed in about two milliseconds, the
/// player was told the sign-in had failed while their character was in fact
/// logging in, and the `.sal` holding the one-shot game key was left for the
/// 120-second backstop to remove instead of being shredded at attach.
#[tauri::command]
pub fn game_attach(
    app: AppHandle,
    link: State<'_, GameLink>,
    host: Option<String>,
    port: u16,
    wait_ms: Option<u64>,
) -> Result<LinkState, String> {
    let host = host.unwrap_or_else(|| "127.0.0.1".into());

    {
        // Refuse rather than stack. Two readers on one Lich would interleave
        // the game text between them, and each would show half a conversation
        // with no sign the other half existed.
        let guard = link.inner.lock().unwrap();
        if let Some(h) = guard.as_ref() {
            if h.running.load(Ordering::Relaxed) {
                return Err(format!("Already attached to {}:{}.", h.host, h.port));
            }
            // A reconnect in flight is a dial already under way, and this
            // would start a second one beside it: two dials racing for the
            // same port, and whichever lost would leave an orphan reader
            // thread on a socket no handle points at. `running` alone cannot
            // see that - it is false during a reconnect, which is exactly when
            // the Attach button is on screen.
            let attempt = h.reconnecting.load(Ordering::Relaxed);
            if attempt > 0 {
                return Err(format!(
                    "Already reconnecting to {}:{} - attempt {attempt} of {RECONNECT_MAX_ATTEMPTS}. Detach first to stop it.",
                    h.host, h.port
                ));
            }
        }
    }

    let stream = dial_with_retry(
        &host,
        port,
        Duration::from_millis(wait_ms.unwrap_or(0)),
        DIAL_INTERVAL,
        &crate::lich::spawned_lich_status,
    )?;

    // The launch file has already gone: `dial_with_retry` shreds it on the
    // successful connect, and on the two ways the wait can end badly. Three
    // outcomes, one place, so a test can watch the file disappear on each.

    // No Nagle. A MUD sends short lines and a command is a keystroke away from
    // being urgent; forty milliseconds of coalescing is the difference between
    // a client that feels alive and one that feels like a form.
    let _ = stream.set_nodelay(true);

    let read_half = stream
        .try_clone()
        .map_err(|e| format!("Could not split the connection - {e}"))?;

    let lines = Arc::new(AtomicU64::new(0));
    let running = Arc::new(AtomicBool::new(true));
    let backlog: Arc<Mutex<BacklogBuf>> = Arc::new(Mutex::new(BacklogBuf::default()));
    let desired = Arc::new(AtomicBool::new(true));
    let reconnecting = Arc::new(AtomicU32::new(0));

    spawn_reader(Reader {
        app: app.clone(),
        read_half,
        host: host.clone(),
        port,
        lines: Arc::clone(&lines),
        running: Arc::clone(&running),
        backlog: Arc::clone(&backlog),
        desired: Arc::clone(&desired),
        reconnecting: Arc::clone(&reconnecting),
    });

    let handle = LinkHandle {
        out: stream,
        host: host.clone(),
        port,
        lines: Arc::clone(&lines),
        backlog: Arc::clone(&backlog),
        running: Arc::clone(&running),
        desired,
        reconnecting,
    };

    let st = state_of(Some(&handle), "");
    *link.inner.lock().unwrap() = Some(handle);

    // Announced, not just returned.
    //
    // Returning the state tells whoever called; emitting tells everyone. Those
    // are different, and the difference showed up on the first real login:
    // attaching through anything other than the TypeScript wrapper - the
    // script API, a devtools call, a second window - left the pane streaming
    // live game text under a header that still read "not attached", because
    // only the caller's own local copy was updated.
    //
    // Worse, it was unrecoverable from the UI: pressing Attach then hit the
    // "Already attached" guard above, which fails, so the frontend's state was
    // never corrected and the button could not fix what the button appeared to
    // be for. A dev-mode HMR reload reaches the same state honestly, with the
    // Rust side still attached and a freshly-mounted pane that has forgotten.
    //
    // The disconnect paths in the reader thread already emit `game:state` for
    // exactly this reason. Connecting is the same kind of event and was the
    // one that did not say so.
    let _ = app.emit("game:state", st.clone());

    Ok(st)
}

/// Everything one reader thread needs. A struct rather than nine positional
/// arguments because the reader is now started from two places - the first
/// attach and every reconnect - and two call sites getting nine `Arc`s in the
/// same order by eye is a swap waiting to happen.
struct Reader {
    app: AppHandle,
    read_half: TcpStream,
    host: String,
    port: u16,
    lines: Arc<AtomicU64>,
    running: Arc<AtomicBool>,
    backlog: Arc<Mutex<BacklogBuf>>,
    desired: Arc<AtomicBool>,
    reconnecting: Arc<AtomicU32>,
}

/// Start the thread that owns the read half, and hand its ending to
/// `socket_ended`.
///
/// Extracted from `game_attach` so a reconnect can start an identical reader
/// on a fresh socket. Identical is the point: a second, slightly different
/// reader for the reconnect path would be a fork, and the half that drifted
/// would be the half only reachable after a network fault - which is the half
/// nobody exercises.
fn spawn_reader(r: Reader) {
    let Reader {
        app,
        read_half,
        host,
        port,
        lines,
        running,
        backlog,
        desired,
        reconnecting,
    } = r;
    let host_for_thread = host.clone();
    {
        std::thread::spawn(move || {
            let mut reader = BufReader::new(read_half);
            let mut raw: Vec<u8> = Vec::with_capacity(4096);

            loop {
                if !running.load(Ordering::Relaxed) {
                    break;
                }
                raw.clear();

                // Read bytes rather than a String. The game is not guaranteed
                // to be valid UTF-8 - it is a twenty-year-old wire protocol -
                // and `read_line` on a String errors out and kills the reader
                // the first time a stray byte arrives. A client that dies on
                // one bad character is worse than one that shows a replacement
                // character in a creature name.
                //
                // Still split on newlines here, and this is a deliberate
                // choice rather than the obvious one.
                //
                // A frontend claiming the `xml` capability receives tagged
                // output, and tags do not respect line endings: a
                // `<pushStream>` can arrive in one packet and its text in the
                // next. So the *parser* must see a byte stream, not lines,
                // and `src/lib/gameStream.ts` is written that way.
                //
                // What is emitted from here is therefore a **chunk**, not a
                // line, and the newline is only a convenient place to stop
                // reading - it bounds latency without the parser caring where
                // the boundary fell. The chunk carries its own terminator so
                // the parser can tell "the line ended here" from "the packet
                // ended here", which is exactly the distinction a line-first
                // design destroys.
                match reader.read_until(b'\n', &mut raw) {
                    Ok(0) => {
                        // Clean EOF: Lich closed. Not an error, and not
                        // silence either - the UI has to be able to tell.
                        running.store(false, Ordering::Relaxed);
                        // A clean EOF is what both "Lich exited" and "Lich
                        // dropped us" look like from here. Only the port can
                        // tell them apart, and it is asked off this thread.
                        socket_ended(
                            &app,
                            &host_for_thread,
                            port,
                            &lines,
                            "Lich closed the connection.",
                            &running,
                            &backlog,
                            &desired,
                            &reconnecting,
                        );
                        break;
                    }
                    Ok(_) => {
                        // The terminator is KEPT, not trimmed.
                        //
                        // It used to be stripped here, which threw away the
                        // one bit of information the parser cannot recover:
                        // whether the text ended because the line ended or
                        // because the packet did. Strip it and a tag split
                        // across two reads becomes two lines of nonsense.
                        let text = String::from_utf8_lossy(&raw).to_string();

                        let seq = lines.fetch_add(1, Ordering::Relaxed) + 1;

                        // Emitted even when empty. A blank line is how the
                        // game paragraphs its output, and stripping them turns
                        // readable text into a wall.
                        // Retained before it is emitted, not after.
                        //
                        // An event fires once and is gone. Rust begins reading
                        // the moment game_attach returns, so anything arriving
                        // before the pane has subscribed was lost outright -
                        // while the count in game:state kept climbing, so the
                        // header reported lines the pane could not show.
                        let received_at = received_at_ms();

                        // The outbound lane learns roundtime here, and only
                        // here. This thread sees every chunk before anything
                        // else does - before the parser, before the pane -
                        // which is what lets a hold start on the same chunk
                        // that announced it rather than a render later.
                        //
                        // Reading it in Rust also puts it on the same side as
                        // the sender. `python/drtask.py` parses the identical
                        // tag and paces against it, and covered only tasks
                        // built on that library; a frontend copy would cover
                        // only commands the frontend originated. See
                        // command_gate.rs's header.
                        if let Some(until) =
                            crate::command_gate::roundtime_until_ms(&text, received_at)
                        {
                            app.state::<crate::command_gate::CommandGate>()
                                .note_roundtime(until);
                        }

                        let line = GameLine {
                            seq,
                            received_at_ms: received_at,
                            text,
                        };
                        {
                            let mut b = backlog.lock().unwrap();
                            b.push(line.clone());
                        }

                        let _ = app.emit("game:line", line);
                    }
                    Err(e) => {
                        running.store(false, Ordering::Relaxed);
                        socket_ended(
                            &app,
                            &host_for_thread,
                            port,
                            &lines,
                            &format!("Connection lost: {e}"),
                            &running,
                            &backlog,
                            &desired,
                            &reconnecting,
                        );
                        break;
                    }
                }
            }
        });
    }
}

/// What happens when the read half stops: report, or re-dial and report.
///
/// The whole of the reconnect decision is here rather than in the reader,
/// because there is exactly one question to answer and it is not about
/// reading: **did the player ask for this?** A detach sets `desired` false
/// before it shuts the socket, so a reader that wakes with `desired` clear is
/// looking at its own requested end and must report a plain detach; a reader
/// that wakes with `desired` still set has lost a socket the player still
/// wants, and that is the case worth re-dialling.
///
/// Getting that backwards in either direction is the failure: reconnecting
/// after a detach reopens a connection somebody deliberately closed, and not
/// reconnecting after a drop is the behaviour this exists to replace.
#[allow(clippy::too_many_arguments)]
fn socket_ended(
    app: &AppHandle,
    host: &str,
    port: u16,
    lines: &Arc<AtomicU64>,
    note: &str,
    running: &Arc<AtomicBool>,
    backlog: &Arc<Mutex<BacklogBuf>>,
    desired: &Arc<AtomicBool>,
    reconnecting: &Arc<AtomicU32>,
) {
    if !desired.load(Ordering::Relaxed) {
        emit_disconnect(
            app,
            host.to_string(),
            port,
            lines.load(Ordering::Relaxed),
            note.to_string(),
            0,
        );
        return;
    }
    start_reconnect(
        app.clone(),
        host.to_string(),
        port,
        Arc::clone(lines),
        Arc::clone(running),
        Arc::clone(backlog),
        Arc::clone(desired),
        Arc::clone(reconnecting),
        note.to_string(),
    );
}

/// Re-dial on a bounded schedule, publishing every step, and start a fresh
/// reader if one answers.
///
/// Runs on its own thread: it sleeps between attempts, and it is called from a
/// reader thread that is winding down. `reconnect_run` owns the schedule and
/// the give-up rule; everything here is the wiring — a real clock, a real
/// dial, and a `game:state` per attempt so the counter the UI shows is a fact
/// this thread published rather than one the UI counted for itself.
#[allow(clippy::too_many_arguments)]
fn start_reconnect(
    app: AppHandle,
    host: String,
    port: u16,
    lines: Arc<AtomicU64>,
    running: Arc<AtomicBool>,
    backlog: Arc<Mutex<BacklogBuf>>,
    desired: Arc<AtomicBool>,
    reconnecting: Arc<AtomicU32>,
    why: String,
) {
    std::thread::spawn(move || {
        let emit = |connected: bool, attempt: u32, note: String| {
            let _ = app.emit(
                "game:state",
                LinkState {
                    connected,
                    host: host.clone(),
                    port,
                    reconnecting: !connected && attempt > 0,
                    attempt,
                    max_attempts: RECONNECT_MAX_ATTEMPTS,
                    lines: lines.load(Ordering::Relaxed),
                    note,
                    // Not probed here. The re-dial *is* the probe, and its
                    // answer arrives as the attempt succeeding or failing, so
                    // spending two seconds on `probe_lich` between attempts
                    // would slow the reconnect down to refine a field the next
                    // attempt is about to settle anyway.
                    lich: if connected { "alive" } else { "unknown" }.into(),
                },
            );
        };

        let wanted = || desired.load(Ordering::Relaxed);
        let mut dial = || dial_once(&host, port);
        let mut before_wait = |attempt: u32, delay: Duration| {
            reconnecting.store(attempt, Ordering::Relaxed);
            emit(
                false,
                attempt,
                format!(
                    "{why} Reconnecting to {host}:{port} - attempt {attempt} of {RECONNECT_MAX_ATTEMPTS}, in {:.1}s.",
                    delay.as_secs_f32()
                ),
            );
        };

        let outcome = reconnect_run(
            RECONNECT_MAX_ATTEMPTS,
            RECONNECT_BASE,
            RECONNECT_MAX_DELAY,
            &wanted,
            &mut dial,
            &mut before_wait,
            &std::thread::sleep,
        );

        match outcome {
            Ok((stream, attempt)) => {
                let _ = stream.set_nodelay(true);
                let read_half = match stream.try_clone() {
                    Ok(r) => r,
                    Err(e) => {
                        reconnecting.store(0, Ordering::Relaxed);
                        emit_disconnect(
                            &app,
                            host.clone(),
                            port,
                            lines.load(Ordering::Relaxed),
                            format!("Reconnected but could not split the connection - {e}"),
                            attempt,
                        );
                        return;
                    }
                };

                // The write half is swapped into the existing handle rather
                // than a new handle being built. `lines`, `backlog` and the
                // sequence numbering are the pane's scrollback, and a fresh
                // handle would reset the sequence to 1 under a frontend still
                // holding the old high-water mark - which filters the whole
                // new session out of the next backfill.
                {
                    let link = app.state::<GameLink>();
                    let mut guard = link.inner.lock().unwrap();
                    match guard.as_mut() {
                        Some(h) => h.out = stream,
                        // The handle went while this thread was dialling, so
                        // whatever asked for that also no longer wants this
                        // socket. Drop it rather than resurrecting a link
                        // nothing is holding.
                        None => {
                            reconnecting.store(0, Ordering::Relaxed);
                            return;
                        }
                    }
                }

                // Cleared BEFORE the connected state is published, so
                // `reconnecting` and `connected` are never both true and no
                // consumer has to decide which one wins.
                reconnecting.store(0, Ordering::Relaxed);
                running.store(true, Ordering::Relaxed);
                spawn_reader(Reader {
                    app: app.clone(),
                    read_half,
                    host: host.clone(),
                    port,
                    lines: Arc::clone(&lines),
                    running: Arc::clone(&running),
                    backlog: Arc::clone(&backlog),
                    desired: Arc::clone(&desired),
                    reconnecting: Arc::clone(&reconnecting),
                });
                emit(true, attempt, format!("Reconnected on attempt {attempt}."));
                // A separate event, not a flag on the state, because it is an
                // *edge* and the state is a level. The frontend has to throw
                // away the tag parser's accumulated vitals on this edge - a
                // reconnect is a new socket and the old numbers describe a
                // moment that has passed - and a level would fire that reset
                // again on every later `game:state`.
                //
                // Lich replays its own snapshot on a fresh accept
                // (`global_defs.rb:2357-2361`), so some of the state comes
                // back on its own. Not all of it, and not promptly: the
                // replay is four progressBars, a spell, seven indicators and
                // a compass, and it sleeps up to ten seconds first
                // (`global_defs.rb:2307`, on an indicator DragonRealms never
                // sets). Room, occupants, scripts and roundtime are not in it
                // at all. `src/lib/linkReplay.ts` is what asks the bridge for
                // those.
                let _ = app.emit("game:reconnected", attempt);
            }
            Err(gave_up) => {
                reconnecting.store(0, Ordering::Relaxed);
                let attempts = gave_up.attempts();
                if matches!(gave_up, GaveUp::Cancelled { .. }) {
                    // A detach already published its own state. Emitting here
                    // would overwrite "Detached." with a reconnect's account
                    // of being told to stop, which is this thread's business
                    // and not the player's.
                    return;
                }
                emit_disconnect(
                    &app,
                    host.clone(),
                    port,
                    lines.load(Ordering::Relaxed),
                    gave_up.note(&host, port),
                    attempts,
                );
            }
        }
    });
}

/// Everything read since `since`, for a pane that was not listening yet.
///
/// The gap this closes was visible against a live session: `game:state`
/// reported `lines: 245` while the pane rendered its "Nothing yet" empty
/// state, because all 245 `game:line` events had fired before React mounted
/// and subscribed. Every dev-mode HMR reload reaches that state, and so does
/// every window reload in a release build.
///
/// The opening dump is the expensive part to lose. Lich replays the room
/// description, the vitals and the character's state on attach - precisely the
/// text that arrives before a freshly-mounted pane is listening.
///
/// `since` rather than "everything": the caller already holds what it has
/// seen, and asking for the tail makes this safe to call on every remount.
#[tauri::command]
pub fn game_backlog(link: State<'_, GameLink>, since: u64) -> Backlog {
    let guard = link.inner.lock().unwrap();
    match guard.as_ref() {
        Some(h) => {
            let b = h.backlog.lock().unwrap();
            Backlog {
                lines: b.lines.iter().filter(|l| l.seq > since).cloned().collect(),
                dropped: b.dropped,
            }
        }
        // Not attached is not an error. A pane that mounts before any attach
        // asks the same question and deserves the same shape of answer.
        None => Backlog {
            lines: Vec::new(),
            dropped: 0,
        },
    }
}

fn validate_game_command(command: &str) -> Result<(), String> {
    if command.chars().any(char::is_control) {
        return Err("A game command must be one line and contain no control characters.".into());
    }
    Ok(())
}

/// The one thing in this app that writes to the game socket.
///
/// Crate-private on purpose, and its only caller is the command lane's sender
/// thread (`command_gate::start`). Everything outbound reaches the wire
/// through the lane, so ordering, roundtime pacing and Stop are properties of
/// the transport rather than promises each of nine callers has to keep.
///
/// No interpretation here. Aliases, macros and scripting are the frontend's
/// job and Lich has its own ideas about lines beginning with a semicolon; a
/// transport that rewrote what the player typed would make both impossible to
/// reason about. The one invariant enforced here is framing: a request cannot
/// contain a second line or any other control character.
pub(crate) fn write_command(link: &GameLink, command: &str) -> Result<(), String> {
    validate_game_command(command)?;
    let mut guard = link.inner.lock().unwrap();
    let h = guard.as_mut().ok_or("Not attached to a game.")?;
    if !h.running.load(Ordering::Relaxed) {
        return Err(closed_reason(h));
    }

    // Lich reads lines. CRLF because that is what the frontends it knows send,
    // and a lone LF has been the cause of enough one-character bugs on this
    // machine already.
    h.out
        .write_all(format!("{command}\r\n").as_bytes())
        .map_err(|e| format!("Could not send: {e}"))?;
    h.out.flush().map_err(|e| format!("Could not send: {e}"))?;
    Ok(())
}

/// Why a handle that exists still cannot take a command.
///
/// Two reasons, not one, and they ask opposite things of the player: a link
/// that is re-dialling wants them to wait, and a link that has stopped wants
/// them to go and look at Lich. Reporting both as "The connection is closed."
/// is the same sentence for "in a moment" and "not without your help", which
/// is the defect this lane was opened about one layer down.
fn closed_reason(h: &LinkHandle) -> String {
    let attempt = h.reconnecting.load(Ordering::Relaxed);
    if attempt > 0 {
        format!(
            "The connection dropped and is reconnecting - attempt {attempt} of {RECONNECT_MAX_ATTEMPTS}. Nothing can be sent until it is back."
        )
    } else {
        "The connection is closed.".into()
    }
}

/// Whether the socket would take a command right now.
///
/// Asked before queueing so the failures a caller can actually do something
/// about — not attached, reconnecting, connection closed — still come back at
/// the call site with words, instead of arriving later as an event nobody is
/// listening for.
///
/// **This is what stops a command being queued into a dead socket.** The lane's
/// queue outlives every attach and detach on purpose (`command_gate::start`),
/// so without this check a send during a drop would be accepted, sit in the
/// queue looking sent, and either fail silently much later or go out into a
/// session that has moved on. Refusing here costs the player one honest
/// sentence and is the only place that sentence can be said while anybody is
/// still listening for it.
pub(crate) fn attached(link: &GameLink) -> Result<(), String> {
    let guard = link.inner.lock().unwrap();
    let h = guard.as_ref().ok_or("Not attached to a game.")?;
    if !h.running.load(Ordering::Relaxed) {
        return Err(closed_reason(h));
    }
    Ok(())
}

/// Enter the outbound command lane. The one way in.
///
/// `source` says who asked — `player`, `ui-action`, `keybind`, `macro`,
/// `ai-suggestion` or `script` — and there is deliberately no default: see
/// `command_gate::Source::parse` for why guessing breaks one invariant or the
/// other whichever way it guesses.
///
/// Returns when the command is *accepted*, not when it reaches the wire. One
/// held for roundtime leaves a few seconds later, and `game:lane` reports the
/// queue so that is a visible fact rather than a client that appears to have
/// ignored a keypress. `script_api` waits on its ticket instead, because a
/// task walking on to its next step believing it sent something is exactly the
/// failure `pause.rs` was careful not to introduce.
#[tauri::command]
pub fn game_send(
    app: AppHandle,
    link: State<'_, GameLink>,
    gate: State<'_, crate::command_gate::CommandGate>,
    command: String,
    source: String,
) -> Result<(), String> {
    let source = crate::command_gate::Source::parse(&source)?;
    validate_game_command(&command)?;
    attached(&link)?;
    let _ticket = gate.submit(command, source);
    let _ = app.emit("game:lane", gate.status());
    Ok(())
}

#[tauri::command]
pub fn game_detach(app: AppHandle, link: State<'_, GameLink>) -> LinkState {
    let mut guard = link.inner.lock().unwrap();
    if let Some(h) = guard.as_ref() {
        // `desired` first, and before `running`, because the reader thread
        // reads it the moment its socket ends. Clearing `running` alone would
        // wake a reader that still believes the player wants a link, and it
        // would answer a deliberate detach by starting a reconnect. The order
        // is the whole of the guarantee, so it is asserted rather than
        // trusted: `a_detach_does_not_reconnect`.
        h.desired.store(false, Ordering::Relaxed);
        h.running.store(false, Ordering::Relaxed);
        // Shutting the socket wakes the reader out of its blocking read.
        // Without this the thread sits in `read_until` until the game happens
        // to say something, which on a quiet night is a long time.
        let _ = h.out.shutdown(std::net::Shutdown::Both);
    }
    std::thread::sleep(Duration::from_millis(50));
    *guard = None;

    let st = state_of(None, "Detached.");
    // Same reasoning as attach: a detach initiated anywhere other than the
    // TypeScript wrapper - a script, another window - has to reach every
    // listener, or a pane sits showing a live-looking header over a socket
    // that is gone. The reader thread cannot cover this one, because a clean
    // detach is the case where it exits without an error to report.
    let _ = app.emit("game:state", st.clone());
    st
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    // ---------------------------------------------------------------- reconnect

    /// A port for the give-up messages below to name.
    ///
    /// Deliberately NOT 11024. `tools/detachable-port-test.mjs` requires that
    /// number to appear as a value in exactly one Rust file - `lich.rs`'s
    /// `DETACHABLE_PORT`, which claims to be one number in one place - and a
    /// second literal here would make that claim false for the sake of a test
    /// fixture that does not care which port it is.
    const NOTE_PORT: u16 = 4123;

    /// The schedule itself, read rather than timed.
    ///
    /// A test that measured the waits would be asserting the operating
    /// system's scheduler as much as this function, and would have to forgive
    /// it enough slack to also forgive a genuinely wrong exponent.
    #[test]
    fn the_backoff_doubles_and_then_stops_at_the_cap() {
        let base = Duration::from_millis(500);
        let cap = Duration::from_secs(8);
        let got: Vec<Duration> = (1..=6).map(|n| backoff_delay(n, base, cap)).collect();
        assert_eq!(
            got,
            vec![
                Duration::from_millis(500),
                Duration::from_secs(1),
                Duration::from_secs(2),
                Duration::from_secs(4),
                Duration::from_secs(8),
                Duration::from_secs(8),
            ],
            "the published schedule is not what the UI's countdown will show"
        );

        // The cap is what makes this bounded per-wait, so prove it binds
        // rather than merely being present: an attempt far past the doubling
        // range must still return the cap and not an overflowed short wait.
        assert_eq!(backoff_delay(64, base, cap), cap);
        assert_eq!(backoff_delay(u32::MAX, base, cap), cap);
    }

    /// A dialler that fails a set number of times and then answers, counting
    /// every call. The count is the denominator: a run that reports success
    /// having dialled once is a run that never exercised the schedule.
    struct FakeDialer {
        fail_first: u32,
        calls: u32,
        fatal_at: Option<u32>,
    }

    impl FakeDialer {
        fn new(fail_first: u32) -> Self {
            FakeDialer {
                fail_first,
                calls: 0,
                fatal_at: None,
            }
        }
        fn dial(&mut self) -> Result<&'static str, DialOutcome> {
            self.calls += 1;
            // A hard ceiling well above any legitimate bound, so a run whose
            // bound has been *removed* fails loudly here instead of hanging
            // and being killed by the harness with no message.
            assert!(
                self.calls <= 40,
                "the reconnect dialled {} times: the attempt bound is gone",
                self.calls
            );
            if self.fatal_at == Some(self.calls) {
                return Err(DialOutcome::Fatal(
                    "Lich started and then exited with code 1 without opening 127.0.0.1:1.".into(),
                ));
            }
            if self.calls <= self.fail_first {
                Err(DialOutcome::Retry("Could not reach 127.0.0.1:1".into()))
            } else {
                Ok("socket")
            }
        }
    }

    /// What `run_with` hands back: the run's own result, and the delay it
    /// asked for before each attempt. Named so the signature stays readable.
    type RunOutcome = Result<(&'static str, u32), GaveUp>;
    /// Drive `reconnect_run` with no clock, recording what it asked to wait.
    fn run_with(
        dialer: &mut FakeDialer,
        wanted: &dyn Fn() -> bool,
        max_attempts: u32,
    ) -> (RunOutcome, Vec<(u32, Duration)>) {
        let waits: Mutex<Vec<(u32, Duration)>> = Mutex::new(Vec::new());
        let mut before_wait =
            |attempt: u32, delay: Duration| waits.lock().unwrap().push((attempt, delay));
        let out = reconnect_run(
            max_attempts,
            RECONNECT_BASE,
            RECONNECT_MAX_DELAY,
            wanted,
            &mut || dialer.dial(),
            &mut before_wait,
            // The clock is a no-op, so the assertion below is about the
            // schedule this code chose and not about how long a test took.
            &|_d| {},
        );
        let w = waits.lock().unwrap().clone();
        (out, w)
    }

    /// The ordinary case: a socket that comes back part-way through the
    /// schedule is reconnected to, on the attempt the schedule says.
    #[test]
    fn a_link_that_comes_back_is_reconnected_to_on_the_scheduled_attempt() {
        let mut dialer = FakeDialer::new(3);
        let (out, waits) = run_with(&mut dialer, &|| true, RECONNECT_MAX_ATTEMPTS);
        let (sock, attempt) = out.expect("the fourth dial answers");
        assert_eq!(sock, "socket");
        assert_eq!(attempt, 4, "reported the wrong attempt number");
        assert_eq!(dialer.calls, 4, "dialled more times than it reported");
        assert_eq!(
            waits,
            vec![
                (1, Duration::from_millis(500)),
                (2, Duration::from_secs(1)),
                (3, Duration::from_secs(2)),
                (4, Duration::from_secs(4)),
            ],
            "the waits published to the UI are not the schedule that ran"
        );
    }

    /// The positive control this whole file needs: a link that never drops
    /// connects on the first attempt and spends no schedule at all.
    ///
    /// Without it, a `reconnect_run` that had silently become a no-op — or one
    /// whose dialler always answered regardless — would pass the test above
    /// just as well, and the four assertions there would be measuring nothing.
    #[test]
    fn a_stand_in_that_never_drops_connects_on_the_first_attempt() {
        let mut dialer = FakeDialer::new(0);
        let (out, waits) = run_with(&mut dialer, &|| true, RECONNECT_MAX_ATTEMPTS);
        let (_, attempt) = out.expect("nothing was wrong");
        assert_eq!(attempt, 1);
        assert_eq!(dialer.calls, 1);
        assert_eq!(waits.len(), 1, "waited more than the schedule's first step");
    }

    /// The bound. Giving up names the count, because "could not connect" is
    /// what the very first refusal already said.
    ///
    /// This is the case the sabotage removes: with the bound gone, `FakeDialer`
    /// aborts at 40 calls rather than this ever reaching an assertion.
    #[test]
    fn an_exhausted_run_gives_up_naming_the_attempt_count() {
        let mut dialer = FakeDialer::new(u32::MAX);
        let (out, waits) = run_with(&mut dialer, &|| true, RECONNECT_MAX_ATTEMPTS);
        let gave_up = out.expect_err("nothing ever answered");
        assert_eq!(
            gave_up,
            GaveUp::Exhausted {
                attempts: RECONNECT_MAX_ATTEMPTS,
                last: "Could not reach 127.0.0.1:1".into(),
            }
        );
        assert_eq!(dialer.calls, RECONNECT_MAX_ATTEMPTS);
        assert_eq!(waits.len() as u32, RECONNECT_MAX_ATTEMPTS);

        let note = gave_up.note("127.0.0.1", NOTE_PORT);
        assert!(
            note.contains(&format!("after {RECONNECT_MAX_ATTEMPTS} attempts")),
            "the give-up note does not say how many attempts were spent: {note}"
        );
        assert!(
            note.contains(&format!("127.0.0.1:{NOTE_PORT}")),
            "the give-up note does not say what it gave up on: {note}"
        );
    }

    /// A Lich that has exited is not dialled five more times. The fatal arm
    /// stops the run at once and says why.
    #[test]
    fn a_lich_that_exited_is_not_retried() {
        let mut dialer = FakeDialer::new(u32::MAX);
        dialer.fatal_at = Some(1);
        let (out, _) = run_with(&mut dialer, &|| true, RECONNECT_MAX_ATTEMPTS);
        let gave_up = out.expect_err("a dead Lich cannot be reconnected to");
        assert_eq!(gave_up.attempts(), 1);
        assert!(matches!(gave_up, GaveUp::Fatal { .. }));
        assert_eq!(dialer.calls, 1, "kept dialling a process it knew had gone");
        let note = gave_up.note("127.0.0.1", NOTE_PORT);
        assert!(note.contains("exited"), "{note}");
        assert!(note.contains("after 1 attempts"), "{note}");
    }

    /// `dial_once` classifies fatal against the sentence `dial_with_retry`
    /// actually builds, not against one written here from memory.
    ///
    /// The two live in different functions and nothing but this makes them
    /// agree, so a reword of the exit message would otherwise turn every
    /// dead-Lich reconnect into six pointless dials with no test noticing.
    #[test]
    fn the_fatal_classification_matches_the_dialler_it_reads() {
        let _pending = crate::lich::LAUNCH_FILE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let port = a_closed_port();
        let err = dial_with_retry(
            "127.0.0.1",
            port,
            Duration::ZERO,
            Duration::from_millis(50),
            &|| crate::lich::SpawnedLich::Exited(Some(1)),
        )
        .expect_err("a dead Lich cannot be attached to");
        assert!(
            err.contains("exited"),
            "dial_once matches on \"exited\" and dial_with_retry no longer says it: {err}"
        );
        crate::lich::shred_pending_launch_files();
    }

    /// A detach that lands mid-backoff stops the run, and stopping on request
    /// is not a failure.
    #[test]
    fn a_detach_mid_backoff_cancels_rather_than_failing() {
        let mut dialer = FakeDialer::new(u32::MAX);
        let wanted = AtomicBool::new(true);
        let waits: Mutex<Vec<u32>> = Mutex::new(Vec::new());
        let out = reconnect_run(
            RECONNECT_MAX_ATTEMPTS,
            RECONNECT_BASE,
            RECONNECT_MAX_DELAY,
            &|| wanted.load(Ordering::Relaxed),
            &mut || dialer.dial(),
            &mut |attempt, _| {
                waits.lock().unwrap().push(attempt);
                // Detach lands during the second backoff.
                if attempt == 2 {
                    wanted.store(false, Ordering::Relaxed);
                }
            },
            &|_d| {},
        );
        assert_eq!(
            out.expect_err("cancelled"),
            GaveUp::Cancelled { attempts: 1 },
            "a detach was reported as a connection failure"
        );
        assert_eq!(
            dialer.calls, 1,
            "dialled after being told to stop, so a detach would have come back connected"
        );
    }

    /// A bound of zero is a reconnect that reports on work it never did, which
    /// is the shape of every silent-pass defect in this repository. It aborts.
    #[test]
    #[should_panic(expected = "a reconnect with no attempts is not a reconnect")]
    fn a_bound_of_zero_is_refused_rather_than_reporting_a_clean_run() {
        let mut dialer = FakeDialer::new(0);
        let _ = run_with(&mut dialer, &|| true, 0);
    }

    /// The real dialler, against real sockets: two genuine refusals, then a
    /// genuine listener.
    ///
    /// This is the half `FakeDialer` cannot cover - that `dial_once` reaches a
    /// socket at all, that a real refusal is classified `Retry` rather than
    /// `Fatal`, and that the run survives the error strings the operating
    /// system actually produces rather than only the one this file invents.
    ///
    /// # Why the switch is by port and not by a sleeping opener
    ///
    /// The first draft opened a listener 900ms into the run and asserted the
    /// reconnect landed on attempt 2 or later. It landed on attempt 1, and the
    /// reason is written a few hundred lines up this file in `probe_lich`: on
    /// Windows a connect to a *closed* loopback port does not refuse, it sits
    /// for about two seconds and then times out. So attempt 1's dial was still
    /// blocking when the opener bound the port, and it connected - a wall-clock
    /// race that no choice of sleep makes deterministic, because the thing
    /// being raced is a platform timeout this test does not control.
    ///
    /// Switching which *port* is dialled takes the clock out of the question:
    /// the first two dials go to a port that is shut for the whole test and the
    /// third to one that is open for the whole test, so the wrong answer is
    /// genuinely available on attempts 1 and 2 and cannot be reached by luck.
    #[test]
    fn the_real_dialler_survives_real_refusals_and_connects_when_one_answers() {
        let _pending = crate::lich::LAUNCH_FILE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let shut = a_closed_port();
        let open = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let open_port = open.local_addr().expect("addr").port();

        let calls = AtomicU32::new(0);
        let refusals: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let waits: Mutex<Vec<Duration>> = Mutex::new(Vec::new());
        let started = std::time::Instant::now();

        let out = reconnect_run(
            RECONNECT_MAX_ATTEMPTS,
            RECONNECT_BASE,
            RECONNECT_MAX_DELAY,
            &|| true,
            &mut || {
                let n = calls.fetch_add(1, Ordering::Relaxed) + 1;
                let port = if n <= 2 { shut } else { open_port };
                let r = dial_once("127.0.0.1", port);
                if let Err(DialOutcome::Retry(ref e)) = r {
                    refusals.lock().unwrap().push(e.clone());
                }
                r
            },
            &mut |_a, d| waits.lock().unwrap().push(d),
            &std::thread::sleep,
        );

        let (stream, attempt) = out.expect("the third dial reaches a listener that is really open");
        drop(stream);

        assert_eq!(attempt, 3, "the two shut ports were not really dialled");
        let refusals = refusals.lock().unwrap().clone();
        assert_eq!(
            refusals.len(),
            2,
            "a real refusal was not classified as retryable: {refusals:?}"
        );
        for r in &refusals {
            assert!(
                r.contains("Could not reach"),
                "a single dial reported something other than a refusal: {r}"
            );
        }

        // It really slept the schedule rather than spinning through it. The
        // floor is the scheduled total; the dials themselves add more, which is
        // why this is `>=` and not an equality.
        let scheduled: Duration = waits.lock().unwrap().iter().sum();
        assert!(
            started.elapsed() >= scheduled,
            "the run finished in {:?} having scheduled {scheduled:?} of waiting, so it did not sleep",
            started.elapsed()
        );
        crate::lich::shred_pending_launch_files();
    }

    /// A handle in a chosen state, so the lane's refusal can be read without a
    /// Tauri app or a live socket.
    fn handle_in(running: bool, attempt: u32) -> (GameLink, TcpListener) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let out = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        let link = GameLink::default();
        *link.inner.lock().unwrap() = Some(LinkHandle {
            out,
            host: "127.0.0.1".into(),
            port,
            lines: Arc::new(AtomicU64::new(0)),
            backlog: Arc::new(Mutex::new(BacklogBuf::default())),
            running: Arc::new(AtomicBool::new(running)),
            desired: Arc::new(AtomicBool::new(true)),
            reconnecting: Arc::new(AtomicU32::new(attempt)),
        });
        (link, listener)
    }

    /// The lane refuses during a reconnect, and the refusal says *reconnecting*
    /// with the attempt count - not "not attached", which sends a player to
    /// press a button that would make things worse.
    ///
    /// The property, not the mechanism: what matters is that the sentence a
    /// caller receives distinguishes "wait" from "go and look at Lich", so it
    /// is the sentence that is asserted.
    #[test]
    fn a_send_during_a_reconnect_is_refused_naming_the_attempt() {
        let (link, _listener) = handle_in(false, 3);
        let err = attached(&link).expect_err("nothing can be sent into a dead socket");
        assert!(
            err.contains("reconnecting"),
            "the refusal does not say the link is coming back: {err}"
        );
        assert!(
            err.contains("attempt 3 of 6"),
            "the refusal does not say how far along the reconnect is: {err}"
        );
        assert!(
            !err.contains("Not attached"),
            "a reconnecting link reported itself as never attached: {err}"
        );
        // And the write path refuses with the same sentence, so a command that
        // slipped past the queue guard cannot reach a dead socket either.
        let err = write_command(&link, "look").expect_err("the socket is not running");
        assert!(err.contains("attempt 3 of 6"), "{err}");
    }

    /// The other side of the same chooser: a link that is *not* reconnecting
    /// keeps the words it always had. Without this, a refusal that said
    /// "reconnecting" unconditionally would pass the test above.
    #[test]
    fn a_closed_link_that_is_not_reconnecting_keeps_the_old_words() {
        let (link, _listener) = handle_in(false, 0);
        let err = attached(&link).expect_err("the socket is closed");
        assert_eq!(err, "The connection is closed.");

        let empty = GameLink::default();
        assert_eq!(
            attached(&empty).expect_err("never attached"),
            "Not attached to a game."
        );
    }

    /// An attached link takes commands, which is the denominator for the two
    /// refusals above: a guard that refused everything would pass both.
    #[test]
    fn an_attached_link_is_not_refused() {
        let (link, _listener) = handle_in(true, 0);
        attached(&link).expect("a running link takes commands");
    }

    /// The three states the UI reads are mutually exclusive and cover the
    /// field, asserted from `state_of` rather than trusted to the callers.
    #[test]
    fn the_link_reports_exactly_one_of_connected_reconnecting_or_down() {
        for (running, attempt, want) in [
            (true, 0, "connected"),
            (false, 2, "reconnecting"),
            (false, 0, "down"),
            // The case worth pinning: a stale counter must not make a live
            // link read as reconnecting.
            (true, 2, "connected"),
        ] {
            let (link, _listener) = handle_in(running, attempt);
            let guard = link.inner.lock().unwrap();
            let st = state_of(guard.as_ref(), "");
            let got = match (st.connected, st.reconnecting) {
                (true, false) => "connected",
                (false, true) => "reconnecting",
                (false, false) => "down",
                (true, true) => panic!("connected and reconnecting at once"),
            };
            assert_eq!(got, want, "running={running} attempt={attempt}");
            assert_eq!(
                st.max_attempts, RECONNECT_MAX_ATTEMPTS,
                "the bound is not published, so no consumer can show N of M"
            );
        }
    }

    #[test]
    fn command_transport_accepts_one_line_and_rejects_framing_controls() {
        for command in [
            "look",
            "ask guard about ferry",
            ";status",
            "appraise sword;health",
        ] {
            assert!(
                validate_game_command(command).is_ok(),
                "ordinary input survives: {command:?}"
            );
        }
        for command in [
            "look\n;danger",
            "look\rhealth",
            "look\0health",
            "look\thealth",
            "look\u{7f}health",
            "look\u{85}health",
        ] {
            assert!(
                validate_game_command(command).is_err(),
                "control rejected: {command:?}"
            );
        }
    }

    #[test]
    fn recovery_backlog_matches_the_frontend_scrollback_contract() {
        let mut backlog = BacklogBuf::default();
        for seq in 1..=(BACKLOG_MAX as u64 + 137) {
            backlog.push(GameLine {
                seq,
                received_at_ms: 1_700_000_000_000 + seq,
                text: format!("line {seq}\n"),
            });
        }
        assert_eq!(backlog.lines.len(), BACKLOG_MAX);
        assert_eq!(backlog.dropped, 137);
        assert_eq!(backlog.lines.front().map(|line| line.seq), Some(138));
        assert_eq!(
            backlog.lines.front().map(|line| line.received_at_ms),
            Some(1_700_000_000_138)
        );
        assert_eq!(
            backlog.lines.back().map(|line| line.seq),
            Some(BACKLOG_MAX as u64 + 137)
        );
        const {
            assert!(
                BACKLOG_MAX >= 20_000,
                "native recovery must cover the frontend's display budget"
            );
        }
    }

    /// The transport, end to end, against a socket standing in for Lich.
    ///
    /// Worth testing rather than eyeballing because the failure it guards is
    /// silent: a line splitter that drops the last line before EOF, or that
    /// swallows blank lines, produces a pane that looks fine and is missing
    /// things. Neither shows up until somebody misses a message.
    #[test]
    fn splits_lines_and_keeps_the_blank_ones() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            // A blank line between paragraphs, CRLF endings, and no trailing
            // newline on the last line - all three are things the wire does.
            sock.write_all(b"[The Crossing, Firulf Vista]\r\n\r\nObvious paths: east.\r\n")
                .unwrap();
            let mut got = [0u8; 64];
            let n = sock.read(&mut got).unwrap();
            String::from_utf8_lossy(&got[..n]).to_string()
        });

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let mut reader = BufReader::new(client.try_clone().unwrap());

        let mut lines = Vec::new();
        for _ in 0..3 {
            let mut raw = Vec::new();
            reader.read_until(b'\n', &mut raw).unwrap();
            lines.push(
                String::from_utf8_lossy(&raw)
                    .trim_end_matches(['\n', '\r'])
                    .to_string(),
            );
        }

        assert_eq!(lines[0], "[The Crossing, Firulf Vista]");
        assert_eq!(lines[1], "", "a blank line is paragraphing, not noise");
        assert_eq!(lines[2], "Obvious paths: east.");

        client.write_all(b"look\r\n").unwrap();
        client.flush().unwrap();
        assert_eq!(
            server.join().unwrap(),
            "look\r\n",
            "commands go out as typed, CRLF"
        );
    }

    /// Invalid UTF-8 must not kill the reader.
    ///
    /// `read_line` into a String errors on a stray byte and takes the whole
    /// connection down. On a twenty-year-old wire protocol that is a client
    /// that dies one evening for no reason anybody can reproduce.
    #[test]
    fn survives_a_byte_that_is_not_utf8() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            sock.write_all(b"a rusty \xFF dagger\r\nstill here\r\n")
                .unwrap();
            std::thread::sleep(Duration::from_millis(50));
        });

        let client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let mut reader = BufReader::new(client);

        let mut first = Vec::new();
        reader.read_until(b'\n', &mut first).unwrap();
        let text = String::from_utf8_lossy(&first)
            .trim_end_matches(['\n', '\r'])
            .to_string();
        assert!(text.contains("dagger"), "the line survived: {text:?}");

        let mut second = Vec::new();
        reader.read_until(b'\n', &mut second).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&second).trim_end_matches(['\n', '\r']),
            "still here",
            "the reader kept going after the bad byte"
        );
    }

    /// The probe has to be able to say all three things, and be *right* about
    /// which - a two-state probe would send somebody to restart a Lich that
    /// is running fine, which is the failure it exists to prevent.
    ///
    /// Run against a population where the wrong answer is available: a real
    /// listener, a port with nothing on it, and a host that cannot resolve.
    /// A probe tested only against the alive case would confirm that a
    /// chooser with one option chooses it.
    #[test]
    fn probe_tells_alive_from_gone_from_cannot_tell() {
        // Alive: something is actually listening.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert_eq!(
            probe_lich("127.0.0.1", port),
            "alive",
            "a bound port must read as alive"
        );

        // Gone: same port, after the listener is dropped. Same address as the
        // alive case on purpose, so the only thing that changed is the fact
        // being measured.
        drop(listener);
        assert_eq!(
            probe_lich("127.0.0.1", port),
            "gone",
            "a refused connection is the one error that means nothing is there"
        );

        // Cannot tell: resolution fails, which is not evidence of absence.
        // This must NOT come back "gone".
        let verdict = probe_lich("no-such-host.invalid", crate::lich::DETACHABLE_PORT);
        assert_eq!(
            verdict, "unknown",
            "a probe that could not answer must say so, not guess gone"
        );
    }
    // -- #458: the dial that waits for Lich to open its port ----------------

    /// A launch file on disk, registered as pending, so the three cases below
    /// can each watch it disappear.
    ///
    /// The file is real: `sal::shred` overwrites and unlinks, and a fixture
    /// that was never written would make "it is gone" true for the wrong
    /// reason. Each case asserts it exists first, which is that control.
    fn pending_launch_file(tag: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "drc-dial-{tag}-{}-{:?}.sal",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::write(&path, "KEY=not-a-real-key\n").expect("the fixture writes");
        assert!(path.exists(), "control: the fixture is on disk");
        crate::lich::remember_launch_file_for_test(path.clone());
        path
    }

    /// A free loopback port that nothing is listening on.
    ///
    /// Bound and immediately dropped, so the number is known to be closed
    /// *now* rather than assumed to be free - a hardcoded port is how a test
    /// ends up measuring another session's server.
    fn a_closed_port() -> u16 {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);
        port
    }

    /// The case the whole issue is about: Lich opens its listener seconds
    /// after the dial starts, and the attach waits for it.
    ///
    /// A fixture that is already listening cannot fail this - it would pass
    /// against the single-connect code #458 was filed about - so the listener
    /// is deliberately late.
    #[test]
    fn a_listener_that_opens_late_is_still_attached_to() {
        let _pending = crate::lich::LAUNCH_FILE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);

        let sal = pending_launch_file("late");
        let opener = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1500));
            // Retried, and the failure names the port rather than the dial.
            //
            // `a_closed_port` frees this number before the test starts, and the
            // opener claims it back a second and a half later. On a machine
            // running several sessions and a hundred and sixty test suites at
            // once, something else can take an ephemeral port inside that
            // window - which used to surface as `expect("late bind")` panicking
            // in this thread and the *dial* then failing, so the message a
            // reader got was "a listener that opens at 1.5s is attached to",
            // pointing at the code under test rather than at the fixture.
            //
            // Seen once, in a `npm run gate` run where 167 other suites were
            // live; never in six consecutive standalone runs. The retry
            // recovers the common case, where whatever took it is short-lived,
            // and the message below makes the remaining case legible instead of
            // sending somebody to debug `dial_with_retry`.
            let mut last = None;
            for _ in 0..40 {
                match std::net::TcpListener::bind(("127.0.0.1", port)) {
                    Ok(l) => {
                        // Hold it open long enough for the dial to connect.
                        let _ = l.accept();
                        return;
                    }
                    Err(e) => last = Some(e),
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            panic!(
                "could not reclaim 127.0.0.1:{port} for the late listener - \
                 something else on this machine took it: {last:?}"
            );
        });

        let started = std::time::Instant::now();
        let stream = dial_with_retry(
            "127.0.0.1",
            port,
            Duration::from_secs(10),
            Duration::from_millis(100),
            &|| crate::lich::SpawnedLich::NotOurs,
        )
        .expect("a listener that opens at 1.5s is attached to");
        drop(stream);
        opener.join().expect("the opener thread");

        // The denominator: it really did wait rather than connecting to
        // something that was up all along.
        assert!(
            started.elapsed() >= Duration::from_millis(1400),
            "connected in {:?}, so the port was open before the wait",
            started.elapsed()
        );
        assert!(
            !sal.exists(),
            "the launch file survived a successful attach"
        );
    }

    /// Lich exits before opening the port: the error names the exit, and does
    /// not spend the rest of the wait dialling a process that is gone.
    #[test]
    fn a_lich_that_exits_before_listening_is_reported_by_its_exit_code() {
        let _pending = crate::lich::LAUNCH_FILE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let sal = pending_launch_file("exit");
        let port = a_closed_port();

        let started = std::time::Instant::now();
        let err = dial_with_retry(
            "127.0.0.1",
            port,
            Duration::from_secs(20),
            Duration::from_millis(100),
            &|| crate::lich::SpawnedLich::Exited(Some(1)),
        )
        .expect_err("a dead Lich cannot be attached to");

        assert!(err.contains("exited with code 1"), "{err}");
        assert!(
            !err.contains("Could not reach"),
            "reported as a connection refusal rather than as the exit: {err}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "it waited out the full deadline for a process it knew had exited"
        );
        assert!(!sal.exists(), "the launch file survived a failed launch");
    }

    /// Nothing ever listens: the wait is named, rather than the last refusal
    /// being reported as though the dial had only just been tried.
    #[test]
    fn a_port_that_never_opens_times_out_naming_the_wait() {
        let _pending = crate::lich::LAUNCH_FILE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let sal = pending_launch_file("timeout");
        let port = a_closed_port();

        let err = dial_with_retry(
            "127.0.0.1",
            port,
            Duration::from_millis(600),
            Duration::from_millis(100),
            &|| crate::lich::SpawnedLich::NotOurs,
        )
        .expect_err("nothing is listening");

        assert!(err.contains("did not open"), "{err}");
        assert!(err.contains("0.6 seconds"), "the wait is not named: {err}");
        assert!(!sal.exists(), "the launch file survived a timed-out attach");
    }

    /// The Attach button's shape: no wait, one dial, the old message - and the
    /// launch file left alone.
    ///
    /// That last part is the direction that finds things. A player pressing
    /// Attach while Lich is still booting has proved nothing about it, and
    /// Lich does not read the file until `main.rb:213`; shredding on that
    /// refusal would break the sign-in it was asked about.
    #[test]
    fn a_single_dial_is_immediate_and_leaves_the_launch_file_alone() {
        let _pending = crate::lich::LAUNCH_FILE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let sal = pending_launch_file("single");
        let port = a_closed_port();

        let started = std::time::Instant::now();
        let err = dial_with_retry(
            "127.0.0.1",
            port,
            Duration::from_millis(0),
            Duration::from_millis(100),
            &|| crate::lich::SpawnedLich::NotOurs,
        )
        .expect_err("nothing is listening");

        assert!(err.starts_with("Could not reach"), "{err}");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "a no-wait dial took {:?}",
            started.elapsed()
        );
        assert!(
            sal.exists(),
            "a single dial shredded a launch file it had no evidence about"
        );
        // Cleaned up by hand, since nothing else will: this is the one case
        // that deliberately leaves the file behind.
        crate::lich::shred_pending_launch_files();
    }
}
