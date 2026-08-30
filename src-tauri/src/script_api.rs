//! A local socket other languages can drive the client through, without
//! reaching into Rust's state or Lich's globals.
//!
//! `docs/ENGINE.md` decided Python is the scripting language this project
//! offers, talking to the engine "through a documented API rather than by
//! being spliced into Lich's globals... it does not reach into `DRStats`."
//! This is that API's transport: newline-delimited JSON on a loopback TCP
//! port, authenticated by a token this app writes beside itself on every
//! start. `python/dr_companion.py` is the client library that speaks it, and
//! `docs/PYTHON_API.md` is the documentation the design calls for.
//!
//! # Out-of-process, decided here
//!
//! ENGINE.md left in-process (PyO3, embedded) versus out-of-process open,
//! leaning out-of-process "because for a scripting language users write in,
//! [crash isolation] matters more than speed." Deciding it now rather than
//! leaving it open for a second design pass: a script that divides by zero,
//! infinite-loops, or imports something that segfaults takes down its own
//! process and nothing else. `game_link.rs` already proved the pattern this
//! wants - a socket and a line reader - so this is the same shape rather than
//! a new one.
//!
//! # What a script gets right now, and what it does not
//!
//! Every chunk `game_link.rs` reads off the wire, forwarded as-is - the exact
//! text this app's own frontend receives before `src/lib/gameStream.ts`
//! parses it into lines, streams and bold spans. That parser is a state
//! machine hardened by several red-team passes on this exact protocol (tag
//! depth limits, entity decoding, a tag that cannot contain a newline or
//! another `<`), and it exists only in TypeScript. Porting it to Rust for
//! this file - untested against the fixtures that found those bugs - risks a
//! second parser that quietly disagrees with the first on some malformed tag,
//! which is a worse defect than a documented gap: two sources of truth is the
//! kind of bug that survives every test because each half looks right alone.
//!
//! So a Python script sees `<pushStream id='thoughts'/>` markup in the text
//! today, same as the raw wire. Stream and bold extraction for scripts is
//! future work - either the parser moves to Rust and both sides read from it,
//! or it stays TypeScript-only and this file gains its own, deliberately -
//! and it is tracked as a gap in `docs/PYTHON_API.md`, not silently
//! implemented twice.
//!
//! # Why a token, on loopback
//!
//! Same reasoning as `bridge_token.rs`, and the same limit to what it is
//! worth: loopback is not a boundary, WebSockets and plain sockets alike are
//! reachable by anything on the machine, and this socket can send commands to
//! a live character. The token stops another program from doing that
//! silently. It does not stop anything already running as this user, which
//! can read the token file exactly as easily as this app writes it.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Listener, Manager};

use crate::game_link::GameLink;

const TOKEN_FILE: &str = "script-api.token";
const PORT_FILE: &str = "script-api.port";

/// How long a fresh connection has to send its `auth` frame. Short, because
/// nothing legitimate waits: the client library sends it as its first write.
const AUTH_TIMEOUT: Duration = Duration::from_secs(2);

type ClientList = Arc<Mutex<Vec<(u64, TcpStream)>>>;

/// 32 random bytes, hex-encoded. Compared only against what this process just
/// wrote to disk, so no shape-validation is needed on the reading side the
/// way `bridge_token.rs` needs it - there, the file might be stale or
/// malformed and is read by a stranger's script before use; here, we write it
/// and compare against our own copy in the same run.
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

/// Re-stamp an emitted event's JSON with which kind of message this is, and
/// hand it to every authenticated client - dropping any that have gone away.
///
/// The payload is re-parsed rather than passed through as a raw string so the
/// `type` field can be injected without string surgery on JSON, which is
/// exactly the kind of thing that looks fine until a value happens to contain
/// the substring being matched against.
fn broadcast(clients: &ClientList, payload: &str, kind: &str) {
    let Ok(Value::Object(mut map)) = serde_json::from_str::<Value>(payload) else {
        return;
    };
    map.insert("type".into(), Value::String(kind.into()));
    let v = Value::Object(map);

    let mut guard = clients.lock().unwrap();
    let mut dead = Vec::new();
    for (id, stream) in guard.iter_mut() {
        if send_json(stream, &v).is_err() {
            dead.push(*id);
        }
    }
    if !dead.is_empty() {
        guard.retain(|(id, _)| !dead.contains(id));
    }
}

/// One connection, from its first byte to its last.
///
/// `on_request` is how this talks to the rest of the app - a closure rather
/// than a direct call into `game_link`, so the handshake and framing here can
/// be tested with a stub that needs no running Tauri app, the same way
/// `game_link.rs`'s own tests stand a bare `TcpListener` in for Lich rather
/// than requiring a real one.
fn handle_client(
    stream: TcpStream,
    clients: ClientList,
    token: &str,
    next_id: &AtomicU64,
    mut on_request: impl FnMut(&Value, &mut TcpStream),
) {
    let mut out = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let _ = stream.set_read_timeout(Some(AUTH_TIMEOUT));
    let mut reader = BufReader::new(stream);

    let _ = send_json(&mut out, &json!({"type": "hello", "version": 1}));

    let mut line = String::new();
    let authed = matches!(
        reader.read_line(&mut line),
        Ok(n) if n > 0
            && serde_json::from_str::<Value>(line.trim())
                .ok()
                .and_then(|v| {
                    let is_auth = v.get("type")?.as_str()? == "auth";
                    let presented = v.get("token")?.as_str()?.to_string();
                    Some(is_auth && presented == token)
                })
                .unwrap_or(false)
    );

    if !authed {
        let _ = send_json(&mut out, &json!({"type": "auth_failed"}));
        return;
    }
    let _ = send_json(&mut out, &json!({"type": "auth_ok"}));

    // The auth deadline was the only reason for a read timeout. A script that
    // sits quietly watching for one condition for an hour is not stuck.
    let _ = reader.get_ref().set_read_timeout(None);

    let id = next_id.fetch_add(1, Ordering::Relaxed);
    clients.lock().unwrap().push((id, out.try_clone().unwrap()));

    let mut buf = String::new();
    loop {
        buf.clear();
        match reader.read_line(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let trimmed = buf.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(v) => on_request(&v, &mut out),
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

/// Answer one parsed request from a script, dispatching into `GameLink`
/// exactly as the frontend's own Tauri commands do.
fn dispatch(v: &Value, app: &AppHandle, out: &mut TcpStream) {
    match v.get("type").and_then(Value::as_str) {
        Some("send") => match v.get("command").and_then(Value::as_str) {
            Some(cmd) => {
                // Pause is enforced here because this is the one line every
                // automated command crosses - a Python flow, a hand-written
                // script, anything holding a script-API socket. Pausing inside
                // the driver instead, which is what the TypeScript flows did,
                // only ever paused the flows this app happened to ship. The
                // command is delayed, never dropped; see pause.rs.
                if crate::pause::Gate::TimedOut
                    == app.state::<crate::pause::Pause>().wait_while_paused()
                {
                    let _ = send_json(
                        out,
                        &json!({
                            "type": "error",
                            "message": "held by Pause too long; this command was not sent"
                        }),
                    );
                    return;
                }
                let link = app.state::<GameLink>();
                if let Err(e) = crate::game_link::game_send(link, cmd.to_string()) {
                    let _ = send_json(out, &json!({"type": "error", "message": e}));
                }
            }
            None => {
                let _ = send_json(
                    out,
                    &json!({"type": "error", "message": "send needs a \"command\" string"}),
                );
            }
        },
        Some("status") => {
            let link = app.state::<GameLink>();
            let st = crate::game_link::game_status(link);
            let _ = send_json(
                out,
                &json!({
                    "type": "state",
                    "connected": st.connected,
                    "host": st.host,
                    "port": st.port,
                    "lines": st.lines,
                    "note": st.note,
                }),
            );
        }
        other => {
            let _ = send_json(
                out,
                &json!({
                    "type": "error",
                    "message": format!("unknown request type {other:?}"),
                }),
            );
        }
    }
}

/// Bind the socket, write the token and port beside the app's other data, and
/// start accepting scripts. Called once from `lib.rs`'s `.setup()`.
///
/// Binds to port 0 - an OS-assigned port - rather than a fixed one. Nothing
/// outside this machine needs to guess it in advance the way the game
/// connection's `--headless=11024` does, because the port is written to a
/// file the client library reads before connecting.
pub fn start(app: AppHandle) -> std::io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let token = generate_token();

    let dir = crate::setup::app_data_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(TOKEN_FILE), &token)?;
    std::fs::write(dir.join(PORT_FILE), port.to_string())?;

    let clients: ClientList = Arc::new(Mutex::new(Vec::new()));
    let next_id = Arc::new(AtomicU64::new(1));

    // Listening to the app's own emitted events rather than reaching into
    // `GameLink`'s internals: a script sees exactly what the frontend sees,
    // read from the one place that already parses the wire, and this file
    // never has to know how the connection to Lich actually works.
    {
        let clients = Arc::clone(&clients);
        app.listen("game:line", move |event| {
            broadcast(&clients, event.payload(), "line");
        });
    }
    {
        let clients = Arc::clone(&clients);
        app.listen("game:state", move |event| {
            broadcast(&clients, event.payload(), "state");
        });
    }

    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let clients = Arc::clone(&clients);
            let next_id = Arc::clone(&next_id);
            let token = token.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                handle_client(stream, clients, &token, &next_id, |v, out| {
                    dispatch(v, &app, out)
                });
            });
        }
    });

    Ok(())
}

/// What a script needs to connect, for a settings panel to show it. The token
/// itself is not part of this - a script reads it from the file directly, and
/// there is no reason for it to also transit the webview.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptApiInfo {
    pub port: Option<u16>,
    pub token_path: String,
}

#[tauri::command]
pub fn script_api_info() -> ScriptApiInfo {
    let dir = crate::setup::app_data_dir();
    let port = std::fs::read_to_string(dir.join(PORT_FILE))
        .ok()
        .and_then(|s| s.trim().parse().ok());
    ScriptApiInfo {
        port,
        token_path: dir.join(TOKEN_FILE).to_string_lossy().into_owned(),
    }
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

    /// The handshake, against a real socket: hello, then refuse without the
    /// right token, then accept with it.
    #[test]
    fn requires_the_real_token_before_anything_else() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let clients: ClientList = Arc::new(Mutex::new(Vec::new()));
        let next_id = Arc::new(AtomicU64::new(1));
        let token = "the-real-token".to_string();

        std::thread::spawn({
            let clients = Arc::clone(&clients);
            let next_id = Arc::clone(&next_id);
            let token = token.clone();
            move || {
                for stream in listener.incoming().flatten() {
                    handle_client(stream, Arc::clone(&clients), &token, &next_id, |_, _| {});
                }
            }
        });

        // Wrong token: hello, then auth_failed, then the socket closes.
        let (_s, mut r) = connect(port);
        assert_eq!(read_json(&mut r)["type"], "hello");
        {
            let mut s2 = r.get_ref().try_clone().unwrap();
            send_json(&mut s2, &json!({"type": "auth", "token": "wrong"})).unwrap();
        }
        assert_eq!(read_json(&mut r)["type"], "auth_failed");
        let mut rest = Vec::new();
        r.read_to_end(&mut rest).unwrap();
        assert!(
            rest.is_empty(),
            "nothing more should arrive after a refused auth"
        );

        // Right token: hello, then auth_ok, and the connection stays open.
        let (mut s, mut r) = connect(port);
        assert_eq!(read_json(&mut r)["type"], "hello");
        send_json(&mut s, &json!({"type": "auth", "token": token})).unwrap();
        assert_eq!(read_json(&mut r)["type"], "auth_ok");
    }

    /// A line broadcast before anyone has authenticated must reach nobody -
    /// there is no client registered yet to leak it to, and this is the
    /// assertion that the registration truly happens only after auth rather
    /// than on connect.
    #[test]
    fn an_unauthenticated_connection_is_never_added_to_the_broadcast_list() {
        let clients: ClientList = Arc::new(Mutex::new(Vec::new()));
        let next_id = Arc::new(AtomicU64::new(1));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let done = Arc::new(std::sync::Barrier::new(2));
        std::thread::spawn({
            let clients = Arc::clone(&clients);
            let next_id = Arc::clone(&next_id);
            let done = Arc::clone(&done);
            move || {
                let (stream, _) = listener.accept().unwrap();
                handle_client(stream, clients, "correct", &next_id, |_, _| {});
                done.wait();
            }
        });

        let (mut s, mut r) = connect(port);
        let _ = read_json(&mut r); // hello
        send_json(&mut s, &json!({"type": "auth", "token": "not-it"})).unwrap();
        done.wait();

        assert_eq!(
            clients.lock().unwrap().len(),
            0,
            "a failed auth must not register a broadcast target"
        );
    }

    /// The actual point of the socket: a game line reaches an authed script,
    /// tagged with what kind of message it is.
    #[test]
    fn an_authed_client_receives_broadcast_lines() {
        let clients: ClientList = Arc::new(Mutex::new(Vec::new()));
        let next_id = Arc::new(AtomicU64::new(1));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        std::thread::spawn({
            let clients = Arc::clone(&clients);
            let next_id = Arc::clone(&next_id);
            move || {
                for stream in listener.incoming().flatten() {
                    handle_client(stream, Arc::clone(&clients), "tok", &next_id, |_, _| {});
                }
            }
        });

        let (mut s, mut r) = connect(port);
        let _ = read_json(&mut r);
        send_json(&mut s, &json!({"type": "auth", "token": "tok"})).unwrap();
        let _ = read_json(&mut r);

        // Give the server a moment to add this connection to the broadcast
        // list - it happens after auth_ok is sent, not before, on its own
        // thread. A real test rather than a fixed sleep: retry until the
        // registration is visible, with a ceiling.
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while clients.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(clients.lock().unwrap().len(), 1);

        broadcast(
            &clients,
            r#"{"seq":1,"text":"a shaggy mutt bounds in\r\n"}"#,
            "line",
        );

        let got = read_json(&mut r);
        assert_eq!(got["type"], "line");
        assert_eq!(got["seq"], 1);
        assert!(got["text"].as_str().unwrap().contains("shaggy mutt"));
    }

    /// A client that vanished must be dropped from the broadcast list rather
    /// than accumulating as a write that fails forever.
    #[test]
    fn a_disconnected_client_is_pruned_on_the_next_broadcast() {
        let clients: ClientList = Arc::new(Mutex::new(Vec::new()));
        let next_id = Arc::new(AtomicU64::new(1));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        std::thread::spawn({
            let clients = Arc::clone(&clients);
            let next_id = Arc::clone(&next_id);
            move || {
                for stream in listener.incoming().flatten() {
                    handle_client(stream, Arc::clone(&clients), "tok", &next_id, |_, _| {});
                }
            }
        });

        {
            let (mut s, mut r) = connect(port);
            let _ = read_json(&mut r);
            send_json(&mut s, &json!({"type": "auth", "token": "tok"})).unwrap();
            let _ = read_json(&mut r);
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            while clients.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(5));
            }
            // `s` and `r` drop here, closing the socket.
        }

        // Two independent paths remove a dead client, and this waits for
        // either rather than assuming one: `handle_client`'s own reader loop
        // notices the peer's clean close (`read_line` returns 0) and prunes
        // itself when it returns, and a `broadcast` whose write fails prunes
        // too. The first is the reliable one - a write to a half-closed
        // socket can succeed silently on Windows until a real RST arrives,
        // which is why this used to assert after a fixed number of broadcast
        // attempts and was flaky under load. Polling `clients` directly with
        // a generous deadline is what is actually being waited for.
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while !clients.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
            broadcast(&clients, r#"{"seq":1,"text":"x"}"#, "line");
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(
            clients.lock().unwrap().len(),
            0,
            "a dead client must not stay registered forever"
        );
    }

    /// A `send` request reaches whatever `dispatch` was stubbed to do, and a
    /// malformed one gets an error rather than being silently dropped.
    #[test]
    fn requests_after_auth_reach_the_handler() {
        let clients: ClientList = Arc::new(Mutex::new(Vec::new()));
        let next_id = Arc::new(AtomicU64::new(1));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));

        std::thread::spawn({
            let clients = Arc::clone(&clients);
            let next_id = Arc::clone(&next_id);
            let seen = Arc::clone(&seen);
            move || {
                for stream in listener.incoming().flatten() {
                    let seen = Arc::clone(&seen);
                    handle_client(
                        stream,
                        Arc::clone(&clients),
                        "tok",
                        &next_id,
                        move |v, _out| {
                            seen.lock().unwrap().push(v.clone());
                        },
                    );
                }
            }
        });

        let (mut s, mut r) = connect(port);
        let _ = read_json(&mut r);
        send_json(&mut s, &json!({"type": "auth", "token": "tok"})).unwrap();
        let _ = read_json(&mut r);

        send_json(&mut s, &json!({"type": "send", "command": "look"})).unwrap();
        s.write_all(b"not json at all\n").unwrap();

        let err = read_json(&mut r);
        assert_eq!(
            err["type"], "error",
            "the malformed line should be answered, not ignored"
        );

        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while seen.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(seen.lock().unwrap()[0]["command"], "look");
    }

    #[test]
    fn tokens_are_distinct_and_the_right_shape() {
        let a = generate_token();
        let b = generate_token();
        assert_ne!(a, b, "two tokens must not collide in a small sample");
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
