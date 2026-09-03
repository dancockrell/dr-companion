//! The local presentation bridge to the Godot 3D world viewer.
//!
//! Same shape as `script_api.rs` on purpose - newline-delimited JSON over an
//! authenticated loopback TCP socket, a token file written fresh on every
//! start, a listener thread per connection - because that pattern is already
//! red-teamed in this codebase (see `script_api.rs`'s own module doc) and a
//! second, differently-shaped local socket would just be a second thing to
//! audit for the same class of bug. `docs/THREE_D_REBUILD_HANDOFF.md`
//! specifies "JSON over authenticated loopback WebSocket" for this bridge;
//! this ships newline-delimited JSON over plain TCP instead, which is the
//! document's own escape hatch exercised deliberately - "a later optimized
//! transport is acceptable only if it preserves the same semantic messages
//! and test fixtures," and Godot's `StreamPeerTCP` speaks this transport with
//! no external plugin, the same way `python/dr_companion.py` already does on
//! the script-API side. The message *shapes* below (`WorldSnapshot`,
//! `PresentationEvent`, `PresentationIntent`, ...) are exactly the ones that
//! document specifies; only the wire framing differs from its literal words.
//!
//! # Where authoritative state actually lives
//!
//! This file does not parse game text and does not decide whether a room
//! exit exists. `script_api.rs`'s own module doc already turned that question
//! down once for a narrower case ("porting \[the parser\] to Rust... risks a
//! second parser that quietly disagrees with the first") and the same
//! argument applies here with higher stakes: this bridge's whole job is
//! refusing a fabricated exit, so a second, drifted copy of "what counts as a
//! real exit" would be the one bug this file exists to prevent.
//!
//! So the frontend - which already parses room state via
//! `src/lib/gameStream.ts` and already knows the current room's real exits -
//! is the one source of truth. It calls `publish_world_snapshot` whenever the
//! authoritative room changes; this file holds the latest snapshot it was
//! given and validates every incoming `PresentationIntent` against *that*,
//! never against anything it derived itself. A `walk` intent that passes
//! validation is not executed here either - it is forwarded to the frontend
//! as a `presentation:intent` event, so the existing command pipeline
//! (`requestGameAction`, movement parsing, autowalk) is what actually sends
//! the game command. This file's authority is "is this exit currently in the
//! last snapshot I was handed," never "should this command be sent."
//!
//! # Why a token, on loopback
//!
//! Identical reasoning to `bridge_token.rs` and `script_api.rs`: loopback is
//! not a boundary, and this socket can turn into a game command through the
//! same forwarding path a legitimate Godot click uses. The token stops
//! another program on the machine from opening it silently; it does not (and
//! per the threat model in `bridge_token.rs`, cannot) stop something already
//! running as this user.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

const TOKEN_FILE: &str = "presentation-bridge.token";
const PORT_FILE: &str = "presentation-bridge.port";
const PROTOCOL: u32 = 1;

/// Same deadline as `script_api.rs`'s `AUTH_TIMEOUT` - nothing legitimate
/// waits, the client sends `auth` as its first write.
const AUTH_TIMEOUT: Duration = Duration::from_secs(2);
/// Same bound as `script_api.rs`'s `MAX_LINE_BYTES`, same reasoning: caps
/// memory growth from a peer that never sends `\n`. A `WorldSnapshot` for one
/// zone can be over a megabyte (the compiled Crossing manifest is ~1.5MB),
/// so this is far larger than the script API's request/response frames.
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Message shapes - mirrors docs/THREE_D_REBUILD_HANDOFF.md section 4 exactly.
// A field here that doc doesn't have is a bug, not an extension; see that
// file before adding one.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Exit {
    #[serde(rename = "move")]
    pub move_command: String,
    pub direction: String,
    pub target_room_id: Value,
    pub target_cell_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCell {
    pub id: String,
    pub title: String,
    pub position: Vec3,
    pub exits: Vec<Exit>,
}

/// Deliberately loose (`serde_json::Value`) rather than a fully-typed struct
/// for the fields Godot only ever displays and never branches on - the
/// frontend's room/entity/item shapes are still evolving on the TypeScript
/// side, and re-deriving a matching Rust struct for every field here would
/// be exactly the kind of second copy this module's own doc comment argues
/// against for room topology. `id`, position, and the fields this file's own
/// validation logic reads are the only ones pulled out as real fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomSnapshot(pub Value);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitySnapshot(pub Value);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroundItemSnapshot(pub Value);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSnapshot {
    pub protocol: u32,
    pub sequence: u64,
    pub world_id: String,
    pub current_room_id: String,
    pub cells: Vec<WorldCell>,
    pub active_room: RoomSnapshot,
    pub entities: Vec<EntitySnapshot>,
    pub ground_items: Vec<GroundItemSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationEvent {
    pub protocol: u32,
    pub sequence: u64,
    pub room_id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_entity_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_entity_id: Option<String>,
    pub authoritative_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PresentationIntent {
    Walk {
        #[serde(rename = "fromRoomId")]
        from_room_id: String,
        #[serde(rename = "exitMove")]
        exit_move: String,
    },
    InspectEntity {
        #[serde(rename = "entityId")]
        entity_id: String,
    },
    InspectGroundItem {
        #[serde(rename = "itemId")]
        item_id: String,
    },
    FocusRoom {
        #[serde(rename = "roomId")]
        room_id: String,
    },
}

// ---------------------------------------------------------------------------
// Server state and transport - see script_api.rs for the identical pattern
// this mirrors line-for-line where the two overlap.
// ---------------------------------------------------------------------------

type ClientList = Arc<Mutex<Vec<(u64, TcpStream)>>>;

#[derive(Default)]
pub struct PresentationBridgeState {
    latest_snapshot: Mutex<Option<WorldSnapshot>>,
    /// Shared with `start`'s listener thread so a snapshot published *after*
    /// a client has already connected still reaches it. A snapshot handed to
    /// only new connections would leave every already-open Godot window
    /// frozen on whatever room was current when it happened to connect -
    /// exactly the state the "reconnect" story specifically exists to avoid,
    /// just reached by a different path (no reconnect needed, only a stale
    /// broadcast).
    clients: ClientList,
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn bounded_read_line(reader: &mut impl BufRead, buf: &mut String) -> std::io::Result<usize> {
    buf.clear();
    let mut total = 0usize;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(total); // EOF
        }
        if let Some(pos) = available.iter().position(|&b| b == b'\n') {
            let taken = pos + 1;
            total += taken;
            buf.push_str(&String::from_utf8_lossy(&available[..taken]));
            reader.consume(taken);
            return Ok(total);
        }
        total += available.len();
        let taken = available.len();
        buf.push_str(&String::from_utf8_lossy(available));
        reader.consume(taken);
        if total > MAX_LINE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "line exceeded the maximum length without a newline",
            ));
        }
    }
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("the OS should be able to supply randomness");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn send_json(stream: &mut TcpStream, v: &Value) -> std::io::Result<()> {
    let mut line = serde_json::to_string(v).unwrap_or_else(|_| "{}".into());
    line.push('\n');
    stream.write_all(line.as_bytes())
}

fn broadcast_value(clients: &ClientList, v: &Value) {
    let mut guard = clients.lock().unwrap();
    let mut dead = Vec::new();
    for (id, stream) in guard.iter_mut() {
        if send_json(stream, v).is_err() {
            dead.push(*id);
        }
    }
    if !dead.is_empty() {
        guard.retain(|(id, _)| !dead.contains(id));
    }
}

/// Validates a `walk` intent against `snapshot` - the one real check this
/// whole module exists to run. Every other intent kind is read-only and
/// cannot mutate game state, so it is forwarded once the room/entity/item id
/// it names is confirmed to exist in the snapshot, with no further gate.
fn validate_walk<'a>(
    snapshot: &'a WorldSnapshot,
    from_room_id: &str,
    exit_move: &str,
) -> Result<&'a Exit, &'static str> {
    if from_room_id != snapshot.current_room_id {
        return Err("intent's fromRoomId does not match the current room");
    }
    let cell = snapshot
        .cells
        .iter()
        .find(|c| c.id == snapshot.current_room_id)
        .ok_or("current room is not present in the snapshot's own cell list")?;
    cell.exits
        .iter()
        .find(|e| e.move_command == exit_move)
        .ok_or("not a true exit of the current room")
}

fn handle_intent(v: &Value, state: &PresentationBridgeState, app: &AppHandle, out: &mut TcpStream) {
    let intent: PresentationIntent = match serde_json::from_value(v.clone()) {
        Ok(i) => i,
        Err(e) => {
            let _ = send_json(
                out,
                &json!({"type": "intent_rejected", "reason": format!("malformed intent: {e}")}),
            );
            return;
        }
    };

    match intent {
        PresentationIntent::Walk {
            from_room_id,
            exit_move,
        } => {
            let guard = state.latest_snapshot.lock().unwrap();
            let Some(snapshot) = guard.as_ref() else {
                let _ = send_json(
                    out,
                    &json!({"type": "intent_rejected", "reason": "no snapshot has been published yet"}),
                );
                return;
            };
            match validate_walk(snapshot, &from_room_id, &exit_move) {
                Ok(_exit) => {
                    let _ = send_json(out, &json!({"type": "intent_accepted"}));
                    // Forwarded to the frontend, which owns the actual command
                    // pipeline - this file never calls game_send itself. See
                    // the module doc's "where authoritative state actually
                    // lives" section.
                    let _ = app.emit(
                        "presentation:intent",
                        json!({"kind": "walk", "fromRoomId": from_room_id, "exitMove": exit_move}),
                    );
                }
                Err(reason) => {
                    let _ = send_json(out, &json!({"type": "intent_rejected", "reason": reason}));
                }
            }
        }
        PresentationIntent::InspectEntity { entity_id } => {
            let _ = app.emit(
                "presentation:intent",
                json!({"kind": "inspect-entity", "entityId": entity_id}),
            );
            let _ = send_json(out, &json!({"type": "intent_accepted"}));
        }
        PresentationIntent::InspectGroundItem { item_id } => {
            let _ = app.emit(
                "presentation:intent",
                json!({"kind": "inspect-ground-item", "itemId": item_id}),
            );
            let _ = send_json(out, &json!({"type": "intent_accepted"}));
        }
        PresentationIntent::FocusRoom { room_id } => {
            // Read-only and never leaves this process - Godot already has
            // every cell's position once it has a snapshot, so this needs no
            // round trip through the frontend at all.
            let _ = app.emit(
                "presentation:intent",
                json!({"kind": "focus-room", "roomId": room_id}),
            );
            let _ = send_json(out, &json!({"type": "intent_accepted"}));
        }
    }
}

/// The handshake and framing only - dispatching a parsed request is
/// `on_intent`'s job, a closure rather than a direct `state`/`AppHandle`
/// dependency, the same shape `script_api.rs::handle_client`'s own
/// `on_request` already uses and for the same reason: this file's own test
/// module (below) can then exercise the real auth handshake against a real
/// socket without needing a real `tauri::AppHandle`, which `setup.rs`'s own
/// module doc already documents as a real, non-trivial problem to construct
/// standalone (`mock_app()`'s `STATUS_ENTRYPOINT_NOT_FOUND` failure, past
/// the point `cargo test` says everything is fine).
fn handle_client(
    stream: TcpStream,
    clients: ClientList,
    state: Arc<PresentationBridgeState>,
    token: &str,
    next_id: &AtomicU64,
    mut on_intent: impl FnMut(&Value, &mut TcpStream),
) {
    let mut out = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let _ = stream.set_read_timeout(Some(AUTH_TIMEOUT));
    let mut reader = BufReader::new(stream);

    let _ = send_json(&mut out, &json!({"type": "hello", "protocol": PROTOCOL}));

    let mut line = String::new();
    let authed = matches!(
        bounded_read_line(&mut reader, &mut line),
        Ok(n) if n > 0
            && serde_json::from_str::<Value>(line.trim())
                .ok()
                .and_then(|v| {
                    let is_auth = v.get("type")?.as_str()? == "auth";
                    let presented = v.get("token")?.as_str()?.to_string();
                    Some(is_auth && constant_time_eq(&presented, token))
                })
                .unwrap_or(false)
    );

    if !authed {
        let _ = send_json(&mut out, &json!({"type": "auth_failed"}));
        return;
    }
    let _ = send_json(&mut out, &json!({"type": "auth_ok"}));

    // Send whatever snapshot already exists immediately on auth, so a Godot
    // client that connects after the frontend has already published one (the
    // ordinary case - the frontend publishes on room state, not on a timer)
    // does not sit with nothing until the next room change. This is also
    // exactly the reconnect path: a fresh connection always gets a fresh
    // snapshot, never a diff against whatever it had before.
    if let Some(snapshot) = state.latest_snapshot.lock().unwrap().as_ref() {
        if let Ok(v) = serde_json::to_value(snapshot) {
            let mut framed = v;
            if let Value::Object(ref mut map) = framed {
                map.insert("type".into(), Value::String("snapshot".into()));
            }
            let _ = send_json(&mut out, &framed);
        }
    }

    let _ = reader.get_ref().set_read_timeout(None);

    let id = next_id.fetch_add(1, Ordering::Relaxed);
    clients.lock().unwrap().push((id, out.try_clone().unwrap()));

    let mut buf = String::new();
    loop {
        match bounded_read_line(&mut reader, &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let trimmed = buf.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(v) => on_intent(&v, &mut out),
                    Err(_) => {
                        let _ = send_json(
                            &mut out,
                            &json!({"type": "error", "message": "not valid JSON"}),
                        );
                    }
                }
            }
        }
    }

    clients.lock().unwrap().retain(|(cid, _)| *cid != id);
}

pub fn start(app: AppHandle) -> std::io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let token = generate_token();

    let dir = crate::setup::app_data_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(TOKEN_FILE), &token)?;
    std::fs::write(dir.join(PORT_FILE), port.to_string())?;

    let next_id = Arc::new(AtomicU64::new(1));
    let state = Arc::new(PresentationBridgeState::default());
    app.manage(Arc::clone(&state));

    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let clients = Arc::clone(&state.clients);
            let next_id = Arc::clone(&next_id);
            let state = Arc::clone(&state);
            let token = token.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                let state_for_client = Arc::clone(&state);
                handle_client(
                    stream,
                    clients,
                    state_for_client,
                    &token,
                    &next_id,
                    |v, out| handle_intent(v, &state, &app, out),
                );
            });
        }
    });

    Ok(())
}

/// Called by the frontend whenever the authoritative room state changes -
/// on attach, on every confirmed room transition, and on demand for a
/// reconnect. Stores the snapshot and pushes it to every connected Godot
/// client immediately; a client that connects between publishes gets the
/// last one on auth instead (see `handle_client`).
#[tauri::command]
pub fn publish_world_snapshot(
    state: tauri::State<'_, Arc<PresentationBridgeState>>,
    snapshot: WorldSnapshot,
) -> Result<(), String> {
    // This file's authority boundary is the mirror image of `validate_walk`'s:
    // it never edits a snapshot the frontend handed it, so nothing here can
    // silently drift what "the current room" means from what the parser
    // actually reported.
    let mut value = serde_json::to_value(&snapshot).map_err(|e| e.to_string())?;
    if let Value::Object(ref mut map) = value {
        map.insert("type".into(), Value::String("snapshot".into()));
    }
    *state.latest_snapshot.lock().unwrap() = Some(snapshot);
    broadcast_value(&state.clients, &value);
    Ok(())
}

/// Called by the frontend for every confirmed game event a battle/room needs
/// to present - the ordered stream `EventPlayer` (Godot side) consumes.
/// Never called speculatively: only after the game's own text confirms an
/// outcome, per the "Godot must never decide... whether an attack hit"
/// contract this whole bridge exists to hold.
#[tauri::command]
pub fn publish_presentation_event(
    state: tauri::State<'_, Arc<PresentationBridgeState>>,
    event: PresentationEvent,
) -> Result<(), String> {
    let mut value = serde_json::to_value(&event).map_err(|e| e.to_string())?;
    if let Value::Object(ref mut map) = value {
        map.insert("type".into(), Value::String("event".into()));
    }
    broadcast_value(&state.clients, &value);
    Ok(())
}

/// What the frontend needs to know the bridge is even running - the token
/// itself never transits the webview, same reasoning as
/// `script_api::script_api_info`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationBridgeInfo {
    pub port: Option<u16>,
}

#[tauri::command]
pub fn presentation_bridge_info() -> PresentationBridgeInfo {
    let dir = crate::setup::app_data_dir();
    let port = std::fs::read_to_string(dir.join(PORT_FILE))
        .ok()
        .and_then(|s| s.trim().parse().ok());
    PresentationBridgeInfo { port }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn connect(port: u16) -> (TcpStream, BufReader<TcpStream>) {
        let s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let r = BufReader::new(s.try_clone().unwrap());
        (s, r)
    }

    fn read_json(r: &mut BufReader<TcpStream>) -> Value {
        let mut line = String::new();
        r.read_line(&mut line).unwrap();
        serde_json::from_str(line.trim()).unwrap()
    }

    /// The handshake itself, against a real socket - the "stale/invalid
    /// session tokens" contract test docs/CLAUDE_3D_VIEWER_BRIEF.md
    /// requires. `handle_client` takes a no-op `on_intent` here: this test
    /// is entirely about the auth boundary, which runs and returns before
    /// `on_intent` is ever reached on the wrong-token path, and reaches it
    /// with nothing worth asserting on the right-token path (that's what
    /// `an_authed_client_receives_its_current_snapshot` below is for).
    #[test]
    fn requires_the_real_token_before_anything_else() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let clients: ClientList = Arc::new(Mutex::new(Vec::new()));
        let state = Arc::new(PresentationBridgeState::default());
        let next_id = Arc::new(AtomicU64::new(1));
        let token = "the-real-token".to_string();

        std::thread::spawn({
            let clients = Arc::clone(&clients);
            let state = Arc::clone(&state);
            let next_id = Arc::clone(&next_id);
            let token = token.clone();
            move || {
                for stream in listener.incoming().flatten() {
                    handle_client(
                        stream,
                        Arc::clone(&clients),
                        Arc::clone(&state),
                        &token,
                        &next_id,
                        |_, _| {},
                    );
                }
            }
        });

        // Wrong/stale token: hello, then auth_failed, then the socket closes
        // with nothing further - never reaches the point of registering as
        // a client or receiving a snapshot.
        let (_s, mut r) = connect(port);
        assert_eq!(read_json(&mut r)["type"], "hello");
        {
            let mut s2 = r.get_ref().try_clone().unwrap();
            send_json(
                &mut s2,
                &json!({"type": "auth", "token": "stale-or-forged"}),
            )
            .unwrap();
        }
        assert_eq!(read_json(&mut r)["type"], "auth_failed");
        let mut rest = Vec::new();
        r.read_to_end(&mut rest).unwrap();
        assert!(
            rest.is_empty(),
            "nothing more should arrive after a refused auth"
        );

        // The real token: hello, then auth_ok.
        let (mut s, mut r) = connect(port);
        assert_eq!(read_json(&mut r)["type"], "hello");
        send_json(&mut s, &json!({"type": "auth", "token": token})).unwrap();
        assert_eq!(read_json(&mut r)["type"], "auth_ok");
    }

    /// A connection that never authenticates at all (no `auth` frame sent
    /// before the read timeout) is refused the same way a wrong token is -
    /// silence is not a free pass.
    #[test]
    fn a_connection_that_never_authenticates_is_refused_not_left_open() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let clients: ClientList = Arc::new(Mutex::new(Vec::new()));
        let state = Arc::new(PresentationBridgeState::default());
        let next_id = Arc::new(AtomicU64::new(1));

        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                handle_client(
                    stream,
                    Arc::clone(&clients),
                    Arc::clone(&state),
                    "correct",
                    &next_id,
                    |_, _| {},
                );
            }
        });

        let (_s, mut r) = connect(port);
        assert_eq!(read_json(&mut r)["type"], "hello");
        // Send nothing - the AUTH_TIMEOUT read deadline should fire and
        // close the connection with auth_failed, not hang forever.
        assert_eq!(read_json(&mut r)["type"], "auth_failed");
    }

    fn cell(id: &str, exits: Vec<(&str, &str)>) -> WorldCell {
        WorldCell {
            id: id.to_string(),
            title: format!("Room {id}"),
            position: Vec3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            exits: exits
                .into_iter()
                .map(|(mv, target)| Exit {
                    move_command: mv.to_string(),
                    direction: mv.to_string(),
                    target_room_id: Value::String(target.to_string()),
                    target_cell_id: Some(target.to_string()),
                })
                .collect(),
        }
    }

    fn snapshot(current_room_id: &str, cells: Vec<WorldCell>) -> WorldSnapshot {
        WorldSnapshot {
            protocol: PROTOCOL,
            sequence: 1,
            world_id: "test-world".into(),
            current_room_id: current_room_id.into(),
            cells,
            active_room: RoomSnapshot(json!({})),
            entities: vec![],
            ground_items: vec![],
        }
    }

    /// The one real check this whole module exists to run, per the module
    /// doc: a `walk` intent naming an exit the current room actually has.
    #[test]
    fn accepts_a_real_exit_of_the_current_room() {
        let snap = snapshot("1-14", vec![cell("1-14", vec![("north", "1-13")])]);
        assert!(validate_walk(&snap, "1-14", "north").is_ok());
    }

    /// The exact attack this bridge exists to stop: a click claiming an exit
    /// the current room does not have.
    #[test]
    fn refuses_a_fabricated_exit() {
        let snap = snapshot("1-14", vec![cell("1-14", vec![("north", "1-13")])]);
        assert!(validate_walk(&snap, "1-14", "go imaginary secret door").is_err());
    }

    /// A real exit *somewhere else in the snapshot* is not a real exit of
    /// the room the intent claims to be leaving from - the same class of
    /// bug as trusting a click's own claim about its origin.
    #[test]
    fn refuses_a_real_exit_of_a_different_room() {
        let snap = snapshot(
            "1-14",
            vec![
                cell("1-14", vec![("north", "1-13")]),
                cell("1-13", vec![("south", "1-14")]),
            ],
        );
        assert!(validate_walk(&snap, "1-14", "south").is_err());
    }

    /// An intent whose `fromRoomId` does not match the snapshot's current
    /// room is refused before its exit is even looked up - a stale click
    /// from a room the player already left.
    #[test]
    fn refuses_when_from_room_does_not_match_current_room() {
        let snap = snapshot("1-14", vec![cell("1-14", vec![("north", "1-13")])]);
        assert!(validate_walk(&snap, "1-13", "north").is_err());
    }

    /// A snapshot that does not carry its own current room among its cells
    /// (a malformed or truncated snapshot) refuses rather than panicking or
    /// silently treating every exit as legal.
    #[test]
    fn refuses_when_current_room_is_missing_from_the_snapshots_own_cells() {
        let snap = snapshot("1-99", vec![cell("1-14", vec![("north", "1-13")])]);
        assert!(validate_walk(&snap, "1-99", "north").is_err());
    }

    #[test]
    fn constant_time_eq_matches_equal_strings() {
        assert!(constant_time_eq("abc123", "abc123"));
    }

    #[test]
    fn constant_time_eq_rejects_different_strings() {
        assert!(!constant_time_eq("abc123", "abc124"));
        assert!(!constant_time_eq("short", "muchlonger"));
    }

    /// A PresentationIntent round-trips through the exact wire shape
    /// docs/THREE_D_REBUILD_HANDOFF.md specifies - `kind: 'walk'` with
    /// `fromRoomId`/`exitMove`, not this crate's own naming convention.
    #[test]
    fn walk_intent_deserializes_from_the_documented_wire_shape() {
        let raw = json!({"kind": "walk", "fromRoomId": "1-14", "exitMove": "north"});
        let intent: PresentationIntent = serde_json::from_value(raw).expect("should parse");
        match intent {
            PresentationIntent::Walk {
                from_room_id,
                exit_move,
            } => {
                assert_eq!(from_room_id, "1-14");
                assert_eq!(exit_move, "north");
            }
            _ => panic!("expected a Walk intent"),
        }
    }

    #[test]
    fn focus_room_intent_deserializes_from_the_documented_wire_shape() {
        let raw = json!({"kind": "focus-room", "roomId": "1-14"});
        let intent: PresentationIntent = serde_json::from_value(raw).expect("should parse");
        assert!(matches!(intent, PresentationIntent::FocusRoom { room_id } if room_id == "1-14"));
    }

    /// A WorldSnapshot serializes with the documented field names
    /// (camelCase, `worldId`/`currentRoomId`/...), not Rust's own
    /// snake_case - this is the exact contract Godot's `world_manifest_loader.gd`
    /// and `bridge_client.gd` are written against.
    #[test]
    fn world_snapshot_serializes_with_the_documented_field_names() {
        let snap = snapshot("1-14", vec![cell("1-14", vec![("north", "1-13")])]);
        let v = serde_json::to_value(&snap).unwrap();
        assert!(v.get("worldId").is_some(), "missing worldId: {v}");
        assert!(
            v.get("currentRoomId").is_some(),
            "missing currentRoomId: {v}"
        );
        assert!(v.get("groundItems").is_some(), "missing groundItems: {v}");
        assert!(v.get("world_id").is_none(), "leaked snake_case field: {v}");
    }
}
