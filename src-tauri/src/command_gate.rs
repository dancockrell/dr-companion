//! One lane for every outbound command.
//!
//! Before this file, `game_link::game_send` was a bare socket write and eight
//! unrelated things called it: the command bar, a keybinding, the room and
//! inventory and combat buttons, the AI suggestion gate, a tile-click walk,
//! the exits strip, and every Lich or Python script through
//! `script_api::dispatch`. They shared one socket and nothing arbitrated
//! between them, so a `;go2` loop and a typed `stand` raced, and the loop
//! usually won because it is not waiting for a human.
//!
//! This is the same move `pause.rs` already made and for the same reason. Its
//! header says Pause used to live in the flow driver and therefore "paused the
//! flows this app happened to ship"; roundtime pacing had the identical shape,
//! living in `python/drtask.py` and covering only tasks built on that library.
//! Both belong at the one line every command crosses, and this is that line.
//!
//! # What the lane does, as four rules
//!
//! **Priority.** `player > ui-action > keybind > macro > ai-suggestion >
//! script`. Ties break by submission order. The invariant worth stating on its
//! own: **a player-typed command is never dropped and never waits behind
//! automation.** It jumps the queue, Stop does not touch it, and Pause does
//! not hold it.
//!
//! **Roundtime.** DragonRealms answers a command sent during roundtime with
//! `...wait N seconds` and *discards it*. The reader thread in `game_link.rs`
//! sees `<roundTime value='<epoch>'/>` before anything else does and tells the
//! lane; the lane holds commands until that instant plus `RT_MARGIN_MS`.
//!
//! **Typeahead.** Holding *everything* would be worse than the bug, because
//! DragonRealms accepts a small amount of typeahead and every other client
//! spends it. `TYPEAHEAD_DEPTH` commands may be released into an active
//! roundtime; the rest wait. The allowance resets when a *new* roundtime is
//! reported, because a new roundtime is the game acknowledging the command
//! that caused it.
//!
//! **Coalescing.** A held movement key produces forty `north`s. When a
//! movement command is submitted and an identical movement command **from the
//! same source** is already queued and not yet sent, the new one is dropped
//! and counted. Same source only: a script's `north` must never swallow the
//! player's.
//!
//! # Two halves on purpose
//!
//! `LaneCore` is a pure scheduler. It is handed the current time, it never
//! reads a clock, it never touches a socket, and every test below drives it
//! with an explicit `now` against a `Vec<String>` write log. That log is the
//! denominator: "the socket saw exactly this sequence" is a comparison against
//! a real recording rather than an inference from a green run.
//!
//! `CommandGate` wraps it in a mutex and a condvar and adds the one thread
//! that owns the wire. Nothing else writes to the socket.
//!
//! # What this deliberately does not do
//!
//! It does not rewrite commands. `game_send`'s own header is still true: no
//! interpretation, aliases and macros are the frontend's job, and Lich has its
//! own ideas about lines beginning with a semicolon. The lane decides *when*
//! and *in what order*, never *what*.
//!
//! It does not sit in front of the AI confirmation gate. G11's guards run
//! first and are untouched; a suggestion that reaches here has already been
//! confirmed against its exact text and its state version.

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// How long after a roundtime ends before the lane will send.
///
/// `python/drtask.py`'s `wait_rt` uses 0.2 s for the same job and the same
/// reason: the roundtime the game reports is an absolute second, so a client
/// whose clock is a little fast sends a moment early and eats a `...wait`.
pub const RT_MARGIN_MS: u64 = 200;

/// How many commands may be released *into* an active roundtime.
///
/// One, which is what Genie and Lich users are used to: type the next command
/// during roundtime and the game takes it. Two would sometimes work and
/// sometimes produce a discarded command, which is the worst of both.
pub const TYPEAHEAD_DEPTH: usize = 1;

/// Longest a command will sit held by Pause before it is refused and says so.
///
/// The same 300 s `pause.rs` documents, for the same reason: a pause is a
/// person deciding something, and a forgotten one must not strand a script
/// thread forever. Refused-and-reported is recoverable; silent is not.
pub const MAX_PAUSE_HOLD_MS: u64 = 300_000;

/// A ceiling on the queue, so a runaway producer cannot grow it without bound.
///
/// Reached only by something already misbehaving. The oldest **automation**
/// entry is dropped rather than the newest, and never a player's: a queue that
/// sheds the player's command to make room for a script's would invert the one
/// invariant this file exists to keep.
pub const MAX_QUEUE: usize = 256;

/// Who asked for this command.
///
/// Ordered by the priority they carry. `Player` is first and is the only
/// variant Stop and Pause leave alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    /// Typed into the command bar by a person, right now.
    Player,
    /// A button in the UI: a room item, an inventory row, a combat card, an
    /// exit, a tile click.
    UiAction,
    /// A key the player bound to a command.
    Keybind,
    /// A recorded sequence the player triggered.
    Macro,
    /// A model's proposal, already confirmed through G11's gate.
    AiSuggestion,
    /// Anything holding a script-API socket: a Python task, a Lich script.
    Script,
}

impl Source {
    /// Parse the wire form. Unknown is an error rather than a default.
    ///
    /// There is no safe default here and picking one would hide the mistake.
    /// Defaulting to `player` lets unlabelled automation jump the queue;
    /// defaulting to `script` puts a real player behind a walk loop. So the
    /// caller says, and `tools/command-lane-test.mjs` checks that every caller
    /// in the tree does.
    pub fn parse(s: &str) -> Result<Self, String> {
        Ok(match s {
            "player" => Source::Player,
            "ui-action" => Source::UiAction,
            "keybind" => Source::Keybind,
            "macro" => Source::Macro,
            "ai-suggestion" => Source::AiSuggestion,
            "script" => Source::Script,
            other => {
                return Err(format!(
                    "unknown command source {other:?}; expected one of player, ui-action, keybind, macro, ai-suggestion, script"
                ))
            }
        })
    }

    pub fn label(self) -> &'static str {
        match self {
            Source::Player => "player",
            Source::UiAction => "ui-action",
            Source::Keybind => "keybind",
            Source::Macro => "macro",
            Source::AiSuggestion => "ai-suggestion",
            Source::Script => "script",
        }
    }

    /// Everything except a person typing. Stop flushes these; Pause holds
    /// them.
    pub fn is_automation(self) -> bool {
        self != Source::Player
    }
}

/// What became of one submitted command. Every entry ends in exactly one of
/// these, and the caller is always told which.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Written to the socket.
    Sent,
    /// An identical movement command from the same source was already queued.
    Coalesced,
    /// Stop flushed the queue before this went out.
    Stopped,
    /// The queue was full and this was the oldest automation entry in it.
    Overflowed,
    /// Held by Pause past `MAX_PAUSE_HOLD_MS`.
    PauseTimedOut,
    /// The socket refused it.
    Failed(String),
}

impl Outcome {
    /// The message a caller reports, or `None` when nothing went wrong.
    pub fn error(&self) -> Option<String> {
        match self {
            Outcome::Sent | Outcome::Coalesced => None,
            Outcome::Stopped => Some("Stop flushed this command before it was sent.".into()),
            Outcome::Overflowed => {
                Some("The command queue is full; this command was not sent.".into())
            }
            Outcome::PauseTimedOut => {
                Some("held by Pause too long; this command was not sent".into())
            }
            Outcome::Failed(e) => Some(e.clone()),
        }
    }
}

/// A resolvable result a submitter can wait on.
///
/// `script_api` waits: a task that walks on to its next step believing it sent
/// something it did not is the failure `pause.rs` refused to introduce, and
/// queueing rather than blocking would reintroduce it. The frontend does not
/// wait — its command goes out on the next tick and the pane shows it.
#[derive(Default)]
struct Signal {
    outcome: Mutex<Option<Outcome>>,
    changed: Condvar,
}

impl Signal {
    fn resolve(&self, o: Outcome) {
        let mut guard = self.outcome.lock().unwrap();
        if guard.is_none() {
            *guard = Some(o);
        }
        self.changed.notify_all();
    }
}

/// A handle on one submitted command.
pub struct Ticket(Arc<Signal>);

impl Ticket {
    /// Block until the command is resolved, or `limit` passes.
    ///
    /// `None` means it is still queued, which is a third state on purpose: a
    /// caller that folded it into "failed" would report a command as lost
    /// while it was about to be sent.
    pub fn wait(&self, limit: Duration) -> Option<Outcome> {
        let mut guard = self.0.outcome.lock().unwrap();
        let started = std::time::Instant::now();
        while guard.is_none() {
            let remaining = match limit.checked_sub(started.elapsed()) {
                Some(r) if !r.is_zero() => r,
                _ => return None,
            };
            let (next, timeout) = self.0.changed.wait_timeout(guard, remaining).unwrap();
            guard = next;
            if timeout.timed_out() && guard.is_none() {
                return None;
            }
        }
        guard.clone()
    }
}

/// One command on its way out.
struct Entry {
    seq: u64,
    text: String,
    source: Source,
    submitted_at_ms: u64,
    signal: Arc<Signal>,
}

/// What the lane is doing, for the footer and for anything else that asks.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneStatus {
    /// Commands waiting. The number a player wants to see when the client
    /// feels unresponsive.
    pub queued: usize,
    /// Epoch ms the current roundtime hold ends, or 0 when the wire is free.
    /// A hold is a fact the UI can show, not something to infer from silence.
    pub holding_until_ms: u64,
    /// The last command actually written to the socket, and when.
    pub last_sent: String,
    pub last_sent_at_ms: u64,
    /// Totals since the app started. Counted rather than forgotten: a lane
    /// that quietly dropped forty movement commands reads exactly like one
    /// that never received them.
    pub sent: u64,
    pub coalesced: u64,
    pub flushed: u64,
    pub overflowed: u64,
    /// Whether automation is currently held by Pause.
    pub paused: bool,
}

/// The scheduler, with no clock and no socket.
#[derive(Default)]
struct LaneCore {
    queued: VecDeque<Entry>,
    /// Epoch ms the roundtime ends. Absolute, not a duration — that is how the
    /// game reports it (`<roundTime value='<epoch>'/>`), and a duration would
    /// mean deciding when the clock started.
    rt_until_ms: u64,
    typeahead_used: usize,
    paused: bool,
    next_seq: u64,
    sent: u64,
    coalesced: u64,
    flushed: u64,
    overflowed: u64,
    last_sent: String,
    last_sent_at_ms: u64,
}

/// The compass, plus the two non-compass ways out of a room.
///
/// Deliberately a fixed set rather than "anything short". `go` and `climb`
/// take an argument and two `climb wall`s in a row are sometimes meant; these
/// twelve are the ones a held key produces.
const MOVEMENTS: &[&str] = &[
    "n",
    "north",
    "s",
    "south",
    "e",
    "east",
    "w",
    "west",
    "ne",
    "northeast",
    "nw",
    "northwest",
    "se",
    "southeast",
    "sw",
    "southwest",
    "u",
    "up",
    "d",
    "down",
    "out",
    "in",
];

fn is_movement(text: &str) -> bool {
    let t = text.trim().to_ascii_lowercase();
    MOVEMENTS.contains(&t.as_str())
}

fn normalized(text: &str) -> String {
    text.trim().to_ascii_lowercase()
}

impl LaneCore {
    /// Whether the wire will accept a command at `now`.
    fn wire_free(&self, now: u64) -> bool {
        if now >= self.rt_until_ms.saturating_add(RT_MARGIN_MS) {
            return true;
        }
        self.typeahead_used < TYPEAHEAD_DEPTH
    }

    /// Whether Pause is holding this entry.
    fn pause_held(&self, e: &Entry) -> bool {
        self.paused && e.source.is_automation()
    }

    /// The index of the entry that would go next, ignoring the wire.
    ///
    /// Priority first, then submission order. A pause-held entry is skipped
    /// rather than blocking the queue behind it, which is what makes "Pause
    /// holds scripts and not the player" true even when the script's command
    /// arrived first.
    fn head(&self) -> Option<usize> {
        let mut best: Option<usize> = None;
        for (i, e) in self.queued.iter().enumerate() {
            if self.pause_held(e) {
                continue;
            }
            match best {
                None => best = Some(i),
                Some(b) => {
                    let cur = &self.queued[b];
                    if (e.source, e.seq) < (cur.source, cur.seq) {
                        best = Some(i);
                    }
                }
            }
        }
        best
    }

    fn submit(&mut self, text: String, source: Source, now: u64) -> (Arc<Signal>, Option<Entry>) {
        let signal = Arc::new(Signal::default());

        if is_movement(&text) {
            let dup = self
                .queued
                .iter()
                .any(|e| e.source == source && normalized(&e.text) == normalized(&text));
            if dup {
                self.coalesced += 1;
                signal.resolve(Outcome::Coalesced);
                return (signal, None);
            }
        }

        self.next_seq += 1;
        self.queued.push_back(Entry {
            seq: self.next_seq,
            text,
            source,
            submitted_at_ms: now,
            signal: Arc::clone(&signal),
        });

        // Shed only when over the ceiling, and shed the oldest automation
        // rather than the newest anything. A player's command is never the one
        // that goes.
        let mut evicted = None;
        if self.queued.len() > MAX_QUEUE {
            if let Some(i) = self.queued.iter().position(|e| e.source.is_automation()) {
                let e = self.queued.remove(i);
                self.overflowed += 1;
                if let Some(e) = e {
                    e.signal.resolve(Outcome::Overflowed);
                    evicted = Some(e);
                }
            }
        }
        (signal, evicted)
    }

    /// Take the entry that is due at `now`, if any.
    fn take_due(&mut self, now: u64) -> Option<Entry> {
        if !self.wire_free(now) {
            return None;
        }
        let i = self.head()?;
        let e = self.queued.remove(i)?;
        if now < self.rt_until_ms.saturating_add(RT_MARGIN_MS) {
            self.typeahead_used += 1;
        }
        Some(e)
    }

    /// Record that an entry reached the socket.
    fn note_sent(&mut self, e: &Entry, now: u64) {
        self.sent += 1;
        self.last_sent = e.text.clone();
        self.last_sent_at_ms = now;
    }

    /// A new roundtime. Only ever moves forward: an older value arriving late
    /// must not shorten a hold that is already running.
    fn note_roundtime(&mut self, until_ms: u64) {
        if until_ms > self.rt_until_ms {
            self.rt_until_ms = until_ms;
            // The game produced this roundtime by accepting a command, so the
            // typeahead spent on the previous one is spent.
            self.typeahead_used = 0;
        }
    }

    /// Drop every automation entry. Player commands stay.
    fn flush_automation(&mut self) -> Vec<Entry> {
        let mut dropped = Vec::new();
        let mut kept = VecDeque::with_capacity(self.queued.len());
        while let Some(e) = self.queued.pop_front() {
            if e.source.is_automation() {
                self.flushed += 1;
                e.signal.resolve(Outcome::Stopped);
                dropped.push(e);
            } else {
                kept.push_back(e);
            }
        }
        self.queued = kept;
        dropped
    }

    /// Refuse anything Pause has held past the cap, and say so.
    fn expire_pause_held(&mut self, now: u64) -> Vec<Entry> {
        if !self.paused {
            return Vec::new();
        }
        let mut dropped = Vec::new();
        let mut kept = VecDeque::with_capacity(self.queued.len());
        while let Some(e) = self.queued.pop_front() {
            let held = e.source.is_automation()
                && now.saturating_sub(e.submitted_at_ms) >= MAX_PAUSE_HOLD_MS;
            if held {
                e.signal.resolve(Outcome::PauseTimedOut);
                dropped.push(e);
            } else {
                kept.push_back(e);
            }
        }
        self.queued = kept;
        dropped
    }

    /// The next instant at which something could become sendable, or `None`
    /// when nothing is waiting on the clock.
    fn next_wake_ms(&self, now: u64) -> Option<u64> {
        let head = self.head()?;
        let _ = head;
        if self.wire_free(now) {
            return Some(now);
        }
        Some(self.rt_until_ms.saturating_add(RT_MARGIN_MS))
    }

    fn status(&self, now: u64) -> LaneStatus {
        LaneStatus {
            queued: self.queued.len(),
            holding_until_ms: if now < self.rt_until_ms.saturating_add(RT_MARGIN_MS) {
                self.rt_until_ms.saturating_add(RT_MARGIN_MS)
            } else {
                0
            },
            last_sent: self.last_sent.clone(),
            last_sent_at_ms: self.last_sent_at_ms,
            sent: self.sent,
            coalesced: self.coalesced,
            flushed: self.flushed,
            overflowed: self.overflowed,
            paused: self.paused,
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

/// The lane, as managed state.
#[derive(Default)]
pub struct CommandGate {
    core: Mutex<LaneCore>,
    changed: Condvar,
}

impl CommandGate {
    /// Enter the lane. Returns a ticket the caller may wait on.
    pub fn submit(&self, text: String, source: Source) -> Ticket {
        let mut core = self.core.lock().unwrap();
        let (signal, _evicted) = core.submit(text, source, now_ms());
        drop(core);
        self.changed.notify_all();
        Ticket(signal)
    }

    /// Tell the lane the game reported a roundtime ending at `until_ms`.
    pub fn note_roundtime(&self, until_ms: u64) {
        self.core.lock().unwrap().note_roundtime(until_ms);
        self.changed.notify_all();
    }

    /// Hold or release automation. The flag lives here so the head-selection
    /// predicate can see it; `pause.rs` remains the thing the UI toggles and
    /// forwards to this.
    pub fn set_paused(&self, paused: bool) {
        self.core.lock().unwrap().paused = paused;
        self.changed.notify_all();
    }

    /// Stop: drop every automation entry, keep the player's. Returns how many
    /// went, so the caller can say rather than assume.
    pub fn flush_automation(&self) -> usize {
        let dropped = self.core.lock().unwrap().flush_automation();
        self.changed.notify_all();
        dropped.len()
    }

    pub fn status(&self) -> LaneStatus {
        self.core.lock().unwrap().status(now_ms())
    }

    /// Block until a command is due, then hand it over already dequeued.
    ///
    /// The only caller is the sender thread. Waiting here rather than
    /// polling means an idle client costs nothing and a roundtime expiring
    /// wakes the wire within a millisecond of the margin.
    fn next_due(&self) -> Entry {
        let mut core = self.core.lock().unwrap();
        loop {
            let now = now_ms();
            for e in core.expire_pause_held(now) {
                drop(e);
            }
            if let Some(e) = core.take_due(now) {
                core.note_sent(&e, now);
                return e;
            }
            let wait = match core.next_wake_ms(now) {
                // Something is queued and the wire is held: wake when the hold
                // ends. The +1 keeps a rounding error from spinning.
                Some(at) => Duration::from_millis(at.saturating_sub(now).max(1)),
                // Nothing queued, or everything pause-held. A pause-held queue
                // still needs a wake to reach its own timeout.
                None if core.paused => Duration::from_millis(500),
                None => Duration::from_secs(3600),
            };
            let (next, _) = self.changed.wait_timeout(core, wait).unwrap();
            core = next;
        }
    }
}

/// Read a roundtime out of one chunk of game output.
///
/// Returns the absolute epoch millisecond the hold ends, or `None`.
///
/// Two forms, and which one is authoritative matters:
///
/// - `<roundTime value='1757100000'/>` and `<castTime value='…'/>` are the
///   Simutronics state tags. The value is an **absolute epoch second**, not a
///   duration — checked against Lich's own `xmlparser.rb` by `python/drtask.py`,
///   whose `_ROUNDTIME` regexp this reimplements rather than duplicates
///   (that one is Python, on the other side of a socket, and cannot be called
///   from here).
/// - `Roundtime: 5 sec.` and `...wait 3 seconds.` are **text**, and text is
///   what appears when the frontend has not claimed the `xml` capability or
///   when the game refuses a command outright. A duration from now.
///
/// The largest of everything found wins. A chunk carrying both a hard
/// roundtime and a cast time is held for the longer of the two, because both
/// are real.
pub fn roundtime_until_ms(chunk: &str, now_ms: u64) -> Option<u64> {
    let mut best: Option<u64> = None;
    let mut take = |v: u64| {
        best = Some(best.map_or(v, |b| b.max(v)));
    };

    for tag in ["<roundTime", "<castTime"] {
        let mut rest = chunk;
        while let Some(at) = rest.find(tag) {
            rest = &rest[at + tag.len()..];
            let end = rest.find('>').unwrap_or(rest.len());
            if let Some(v) = attr_number(&rest[..end], "value") {
                // Absolute epoch seconds. A value that is obviously not one -
                // a duration somebody wrote into the tag - would put the hold
                // in 1970, which reads as "no hold" rather than as an error,
                // so it is refused instead of being guessed at.
                if v > 1_000_000_000 {
                    take(v.saturating_mul(1000));
                }
            }
        }
    }

    for (marker, offset) in [("Roundtime:", 10usize), ("Roundtime ", 10), ("...wait ", 8)] {
        let mut rest = chunk;
        while let Some(at) = rest.find(marker) {
            rest = &rest[at + offset..];
            if let Some(secs) = leading_number(rest) {
                take(now_ms.saturating_add(secs.saturating_mul(1000)));
            }
        }
    }

    best
}

/// `value='12'` or `value="12"` out of a tag body.
fn attr_number(body: &str, name: &str) -> Option<u64> {
    let at = body.find(name)?;
    let after = &body[at + name.len()..];
    let after = after.trim_start();
    let after = after.strip_prefix('=')?.trim_start();
    let after = after.strip_prefix(['\'', '"'])?;
    leading_number(after)
}

fn leading_number(s: &str) -> Option<u64> {
    let s = s.trim_start();
    let digits: String = s.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

/// Start the one thread that owns the wire.
///
/// Called once from `lib.rs`'s `.setup()`. It outlives every attach and
/// detach on purpose: a lane that came and went with the socket would lose
/// whatever was queued across a reconnect, and the queue is exactly what a
/// player wants back after one.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        let entry = {
            let gate = app.state::<CommandGate>();
            gate.next_due()
        };
        let outcome = {
            let link = app.state::<crate::game_link::GameLink>();
            match crate::game_link::write_command(&link, &entry.text) {
                Ok(()) => Outcome::Sent,
                Err(e) => Outcome::Failed(e),
            }
        };
        entry.signal.resolve(outcome);
        let status = app.state::<CommandGate>().status();
        let _ = app.emit("game:lane", status);
    });
}

/// What the lane is doing right now. Asked rather than remembered, so a window
/// opened late shows the truth instead of its own default — the same reasoning
/// as `pause::is_paused`.
#[tauri::command]
pub fn game_lane_status(gate: tauri::State<'_, CommandGate>) -> LaneStatus {
    gate.status()
}

/// Stop's outbound half: drop every queued automation command.
///
/// Returns the count so the caller can report it. Stop already kills two task
/// processes and rejects unconfirmed suggestions; without this, commands those
/// producers had already handed over would still go out after the button was
/// pressed.
#[tauri::command]
pub fn game_lane_flush(gate: tauri::State<'_, CommandGate>) -> usize {
    gate.flush_automation()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Drive the pure scheduler with an explicit clock and record every write.
    ///
    /// The write log is the denominator for every test in this file: "the
    /// socket saw exactly this" is a comparison against a recording, not an
    /// inference from nothing having failed.
    struct Rig {
        core: LaneCore,
        log: Vec<String>,
    }

    impl Rig {
        fn new() -> Self {
            Rig {
                core: LaneCore::default(),
                log: Vec::new(),
            }
        }
        fn submit(&mut self, text: &str, source: Source, now: u64) -> Arc<Signal> {
            self.core.submit(text.into(), source, now).0
        }
        /// Send everything that is due at `now`, in the order the lane picks.
        fn pump(&mut self, now: u64) {
            while let Some(e) = self.core.take_due(now) {
                self.core.note_sent(&e, now);
                self.log.push(e.text.clone());
                e.signal.resolve(Outcome::Sent);
            }
        }
    }

    fn outcome(s: &Arc<Signal>) -> Option<Outcome> {
        s.outcome.lock().unwrap().clone()
    }

    const T0: u64 = 1_757_000_000_000;

    #[test]
    fn a_queued_command_waits_for_roundtime_and_no_longer() {
        let mut r = Rig::new();
        r.core.note_roundtime(T0 + 3_000);

        // The first command spends the typeahead allowance: DragonRealms takes
        // one command during roundtime and every other client spends it.
        r.submit("attack", Source::Script, T0);
        r.pump(T0);
        assert_eq!(r.log, ["attack"], "typeahead lets exactly one through");

        // The second must wait. Checked one millisecond either side of the
        // deadline, because "waits" and "waits until the right moment" are
        // different claims and only the second one is useful.
        r.submit("attack again", Source::Script, T0);
        for probe in [T0, T0 + 1_500, T0 + 3_000, T0 + 3_000 + RT_MARGIN_MS - 1] {
            r.pump(probe);
            assert_eq!(
                r.log.len(),
                1,
                "still held at {}ms into a 3s roundtime",
                probe - T0
            );
        }
        r.pump(T0 + 3_000 + RT_MARGIN_MS);
        assert_eq!(
            r.log,
            ["attack", "attack again"],
            "and goes the instant the hold ends"
        );
    }

    #[test]
    fn a_player_command_submitted_during_a_hold_goes_first_when_it_lifts() {
        let mut r = Rig::new();
        r.core.note_roundtime(T0 + 3_000);
        // Spend the typeahead so nothing is confused about which rule is
        // being tested: from here the wire is genuinely held.
        r.submit("burn the allowance", Source::Script, T0);
        r.pump(T0);

        r.submit("hunt", Source::Script, T0 + 100);
        r.submit("kill orc", Source::AiSuggestion, T0 + 200);
        // Typed last, and it is the one a person is waiting on.
        r.submit("stand", Source::Player, T0 + 900);

        r.pump(T0 + 3_000 + RT_MARGIN_MS);
        assert_eq!(
            r.log,
            ["burn the allowance", "stand", "kill orc", "hunt"],
            "the player jumps a queue they joined last"
        );
    }

    #[test]
    fn mixed_sources_leave_in_priority_order_then_submission_order() {
        let mut r = Rig::new();
        // Submitted in reverse priority, and two of one source so the tie
        // break is exercised rather than assumed.
        r.submit("script one", Source::Script, T0 + 1);
        r.submit("script two", Source::Script, T0 + 2);
        r.submit("suggested", Source::AiSuggestion, T0 + 3);
        r.submit("macro", Source::Macro, T0 + 4);
        r.submit("bound key", Source::Keybind, T0 + 5);
        r.submit("clicked", Source::UiAction, T0 + 6);
        r.submit("typed", Source::Player, T0 + 7);

        r.pump(T0 + 10);
        assert_eq!(
            r.log,
            [
                "typed",
                "clicked",
                "bound key",
                "macro",
                "suggested",
                "script one",
                "script two",
            ]
        );
    }

    #[test]
    fn forty_norths_from_a_held_key_send_one() {
        let mut r = Rig::new();
        // Held, so they queue rather than draining one at a time - a lane that
        // sent each before the next arrived would coalesce nothing and this
        // test would be measuring the pump, not the rule.
        r.core.note_roundtime(T0 + 5_000);
        r.submit("north", Source::Keybind, T0); // spends the typeahead
        r.pump(T0);

        let mut signals = Vec::new();
        for i in 0..40 {
            signals.push(r.submit("north", Source::Keybind, T0 + i));
        }
        assert_eq!(
            r.core.queued.len(),
            1,
            "40 submitted, 1 queued, {} coalesced",
            r.core.coalesced
        );
        assert_eq!(r.core.coalesced, 39);
        assert!(
            signals[1..]
                .iter()
                .all(|s| outcome(s) == Some(Outcome::Coalesced)),
            "every dropped one is told it was dropped rather than left waiting"
        );

        r.pump(T0 + 5_000 + RT_MARGIN_MS);
        assert_eq!(r.log, ["north", "north"], "one held-key press per hold");
    }

    #[test]
    fn coalescing_is_per_source_and_movement_only() {
        let mut r = Rig::new();
        r.core.note_roundtime(T0 + 5_000);
        r.submit("look", Source::Player, T0); // typeahead
        r.pump(T0);

        r.submit("north", Source::Script, T0);
        r.submit("north", Source::Player, T0);
        assert_eq!(
            r.core.coalesced, 0,
            "a script's north must never swallow the player's"
        );

        r.submit("appraise sword", Source::Player, T0);
        r.submit("appraise sword", Source::Player, T0);
        assert_eq!(
            r.core.coalesced, 0,
            "two identical non-movement commands are two things somebody meant"
        );
        assert_eq!(r.core.queued.len(), 4);
    }

    #[test]
    fn stop_flushes_automation_and_leaves_the_player_alone() {
        let mut r = Rig::new();
        r.core.note_roundtime(T0 + 5_000);
        r.submit("look", Source::Player, T0); // typeahead
        r.pump(T0);

        let script = r.submit("hunt", Source::Script, T0);
        let suggested = r.submit("kill orc", Source::AiSuggestion, T0);
        let clicked = r.submit("go east", Source::UiAction, T0);
        let typed = r.submit("stand", Source::Player, T0);

        assert_eq!(r.core.flush_automation().len(), 3);
        assert_eq!(outcome(&script), Some(Outcome::Stopped));
        assert_eq!(outcome(&suggested), Some(Outcome::Stopped));
        assert_eq!(outcome(&clicked), Some(Outcome::Stopped));
        assert_eq!(outcome(&typed), None, "the player's command is untouched");

        r.pump(T0 + 5_000 + RT_MARGIN_MS);
        assert_eq!(r.log, ["look", "stand"], "Stop reached everything but them");
    }

    #[test]
    fn pause_holds_scripts_and_not_the_player() {
        let mut r = Rig::new();
        r.core.paused = true;
        r.submit("hunt", Source::Script, T0);
        r.submit("kill orc", Source::AiSuggestion, T0);
        r.submit("stand", Source::Player, T0);

        r.pump(T0);
        assert_eq!(r.log, ["stand"], "paused automation, unpaused player");

        // And they are held, not lost.
        r.core.paused = false;
        r.pump(T0 + 1);
        assert_eq!(r.log, ["stand", "kill orc", "hunt"]);
    }

    #[test]
    fn a_pause_nobody_lifts_refuses_the_command_and_says_so() {
        let mut r = Rig::new();
        r.core.paused = true;
        let held = r.submit("hunt", Source::Script, T0);

        assert!(r
            .core
            .expire_pause_held(T0 + MAX_PAUSE_HOLD_MS - 1)
            .is_empty());
        assert_eq!(outcome(&held), None, "not yet, and not silently dropped");

        assert_eq!(r.core.expire_pause_held(T0 + MAX_PAUSE_HOLD_MS).len(), 1);
        assert_eq!(outcome(&held), Some(Outcome::PauseTimedOut));
    }

    #[test]
    fn a_late_roundtime_cannot_shorten_a_hold_already_running() {
        let mut r = Rig::new();
        r.core.note_roundtime(T0 + 5_000);
        r.core.note_roundtime(T0 + 1_000);
        r.submit("a", Source::Script, T0); // typeahead
        r.submit("b", Source::Script, T0);
        r.pump(T0 + 1_000 + RT_MARGIN_MS);
        assert_eq!(r.log, ["a"], "the longer hold stands");
        r.pump(T0 + 5_000 + RT_MARGIN_MS);
        assert_eq!(r.log, ["a", "b"]);
    }

    #[test]
    fn a_new_roundtime_restores_the_typeahead_allowance() {
        let mut r = Rig::new();
        r.core.note_roundtime(T0 + 3_000);
        r.submit("a", Source::Script, T0);
        r.submit("b", Source::Script, T0);
        r.pump(T0);
        assert_eq!(r.log, ["a"]);

        // The game accepted `a` and answered with a fresh roundtime; `b` may
        // now spend the new window's allowance.
        r.core.note_roundtime(T0 + 6_000);
        r.pump(T0 + 10);
        assert_eq!(r.log, ["a", "b"]);
    }

    #[test]
    fn the_queue_sheds_automation_rather_than_the_player() {
        let mut r = Rig::new();
        r.core.note_roundtime(T0 + 60_000);
        r.submit("look", Source::Player, T0); // typeahead
        r.pump(T0);

        let typed = r.submit("stand", Source::Player, T0);
        let first_script = r.submit("script 0", Source::Script, T0);
        for i in 1..MAX_QUEUE + 8 {
            r.submit(&format!("script {i}"), Source::Script, T0 + i as u64);
        }
        assert_eq!(r.core.queued.len(), MAX_QUEUE);
        assert_eq!(outcome(&typed), None, "the player is never the one shed");
        assert_eq!(
            outcome(&first_script),
            Some(Outcome::Overflowed),
            "the oldest automation goes, and is told"
        );
        assert!(r.core.overflowed >= 8);
    }

    #[test]
    fn a_source_is_named_or_refused_never_guessed() {
        for (text, expected) in [
            ("player", Source::Player),
            ("ui-action", Source::UiAction),
            ("keybind", Source::Keybind),
            ("macro", Source::Macro),
            ("ai-suggestion", Source::AiSuggestion),
            ("script", Source::Script),
        ] {
            assert_eq!(Source::parse(text), Ok(expected));
            assert_eq!(expected.label(), text, "the wire form round-trips");
        }
        // No default. An unlabelled command is a bug in the caller, and
        // guessing either way breaks one of the two invariants this lane has.
        for bad in ["", "Player", "user", "ui action", "SCRIPT"] {
            assert!(Source::parse(bad).is_err(), "refused: {bad:?}");
        }
        assert!(Source::Player < Source::UiAction);
        assert!(Source::UiAction < Source::Keybind);
        assert!(Source::Keybind < Source::Macro);
        assert!(Source::Macro < Source::AiSuggestion);
        assert!(Source::AiSuggestion < Source::Script);
        assert!(!Source::Player.is_automation());
        for s in [
            Source::UiAction,
            Source::Keybind,
            Source::Macro,
            Source::AiSuggestion,
            Source::Script,
        ] {
            assert!(s.is_automation(), "{s:?} is held by Pause and Stop");
        }
    }

    /// The parser, against a population where the wrong answer is available.
    ///
    /// A chunk with no roundtime in it must come back `None`, or the lane
    /// holds the wire on ordinary room description and the client appears
    /// dead. That negative case is the one worth having.
    #[test]
    fn roundtime_is_read_from_the_tag_and_from_the_text() {
        // The authoritative form: an absolute epoch second.
        assert_eq!(
            roundtime_until_ms("<roundTime value='1757000003'/>", T0),
            Some(1_757_000_003_000)
        );
        assert_eq!(
            roundtime_until_ms("<castTime value=\"1757000009\"/>", T0),
            Some(1_757_000_009_000)
        );
        // Both present: the longer wins, because both are real.
        assert_eq!(
            roundtime_until_ms(
                "<roundTime value='1757000003'/><castTime value='1757000009'/>",
                T0
            ),
            Some(1_757_000_009_000)
        );
        // The text forms, which are durations from now.
        assert_eq!(
            roundtime_until_ms("Roundtime: 5 sec.", T0),
            Some(T0 + 5_000)
        );
        assert_eq!(
            roundtime_until_ms("[Roundtime: 12 sec.]", T0),
            Some(T0 + 12_000)
        );
        assert_eq!(
            roundtime_until_ms("...wait 3 seconds.", T0),
            Some(T0 + 3_000)
        );
        // A value that is not an epoch second is refused rather than read as a
        // hold that ended in 1970, which is what "no hold" looks like.
        assert_eq!(roundtime_until_ms("<roundTime value='5'/>", T0), None);
        // The population where the wrong answer is available.
        for quiet in [
            "[The Crossing, Firulf Vista]\r\n",
            "Obvious paths: east, south.\r\n",
            "<progressBar id='health' value='100' text='health 100/100'/>",
            "You see nothing unusual about the roundtime of your swing.",
            "",
        ] {
            assert_eq!(
                roundtime_until_ms(quiet, T0),
                None,
                "no hold from ordinary output: {quiet:?}"
            );
        }
    }

    /// A ticket resolves once and reports the third state honestly.
    #[test]
    fn a_ticket_says_queued_rather_than_failed_while_it_waits() {
        let s = Arc::new(Signal::default());
        let t = Ticket(Arc::clone(&s));
        assert_eq!(
            t.wait(Duration::from_millis(60)),
            None,
            "still queued is not the same as failed"
        );
        s.resolve(Outcome::Sent);
        assert_eq!(t.wait(Duration::from_millis(60)), Some(Outcome::Sent));
        // Resolved once: a later write must not rewrite history.
        s.resolve(Outcome::Stopped);
        assert_eq!(t.wait(Duration::from_millis(60)), Some(Outcome::Sent));
    }

    #[test]
    fn every_outcome_but_success_carries_something_to_report() {
        assert_eq!(Outcome::Sent.error(), None);
        assert_eq!(Outcome::Coalesced.error(), None);
        for o in [
            Outcome::Stopped,
            Outcome::Overflowed,
            Outcome::PauseTimedOut,
            Outcome::Failed("socket closed".into()),
        ] {
            assert!(
                o.error().is_some_and(|m| !m.trim().is_empty()),
                "a command that did not go must say why: {o:?}"
            );
        }
    }
}
