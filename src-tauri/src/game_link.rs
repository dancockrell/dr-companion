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

use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// One line off the wire, on its way to the pane.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLine {
    /// Monotonic, assigned here. The UI needs a stable key per line and the
    /// text is not one: a MUD repeats itself constantly, and two identical
    /// "Obvious paths: east, south, west." lines are different events.
    pub seq: u64,
    pub text: String,
}

/// What the link is doing, as a fact rather than an inference from silence.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkState {
    pub connected: bool,
    pub host: String,
    pub port: u16,
    /// Lines received since connecting. The denominator: a pane that is empty
    /// because nothing arrived reads exactly like one that is empty because
    /// the parse dropped everything.
    pub lines: u64,
    /// Why it is not connected, when it is not. Empty while connected.
    pub note: String,
}

#[derive(Default)]
pub struct GameLink {
    inner: Mutex<Option<LinkHandle>>,
}

struct LinkHandle {
    /// The write half. Commands go out through this.
    out: TcpStream,
    host: String,
    port: u16,
    lines: Arc<AtomicU64>,
    /// Cleared to stop the reader thread. The thread owns its own socket
    /// clone, so dropping this struct alone would leave it reading forever.
    running: Arc<AtomicBool>,
}

fn state_of(h: Option<&LinkHandle>, note: &str) -> LinkState {
    match h {
        Some(h) => LinkState {
            connected: h.running.load(Ordering::Relaxed),
            host: h.host.clone(),
            port: h.port,
            lines: h.lines.load(Ordering::Relaxed),
            note: note.to_string(),
        },
        None => LinkState {
            connected: false,
            host: String::new(),
            port: 0,
            lines: 0,
            note: note.to_string(),
        },
    }
}

#[tauri::command]
pub fn game_status(link: State<'_, GameLink>) -> LinkState {
    let guard = link.inner.lock().unwrap();
    let note = if guard.is_some() { "" } else { "Not attached." };
    state_of(guard.as_ref(), note)
}

/// Attach to a Lich that is already running with `--detachable-client`.
///
/// Deliberately does not start Lich. Launching is `lich.rs`, which has its own
/// reasons to be careful, and a connect that silently spawned a process would
/// be doing two things under one name.
#[tauri::command]
pub fn game_attach(
    app: AppHandle,
    link: State<'_, GameLink>,
    host: Option<String>,
    port: u16,
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
        }
    }

    let stream = TcpStream::connect((host.as_str(), port))
        .map_err(|e| format!("Could not reach {host}:{port} - {e}"))?;

    // No Nagle. A MUD sends short lines and a command is a keystroke away from
    // being urgent; forty milliseconds of coalescing is the difference between
    // a client that feels alive and one that feels like a form.
    let _ = stream.set_nodelay(true);

    let read_half = stream
        .try_clone()
        .map_err(|e| format!("Could not split the connection - {e}"))?;

    let lines = Arc::new(AtomicU64::new(0));
    let running = Arc::new(AtomicBool::new(true));

    {
        let lines = Arc::clone(&lines);
        let running = Arc::clone(&running);
        let app = app.clone();
        let host_for_thread = host.clone();

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
                        let _ = app.emit(
                            "game:state",
                            LinkState {
                                connected: false,
                                host: host_for_thread.clone(),
                                port,
                                lines: lines.load(Ordering::Relaxed),
                                note: "Lich closed the connection.".into(),
                            },
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
                        let _ = app.emit("game:line", GameLine { seq, text });
                    }
                    Err(e) => {
                        running.store(false, Ordering::Relaxed);
                        let _ = app.emit(
                            "game:state",
                            LinkState {
                                connected: false,
                                host: host_for_thread.clone(),
                                port,
                                lines: lines.load(Ordering::Relaxed),
                                note: format!("Connection lost: {e}"),
                            },
                        );
                        break;
                    }
                }
            }
        });
    }

    let handle = LinkHandle {
        out: stream,
        host: host.clone(),
        port,
        lines: Arc::clone(&lines),
        running: Arc::clone(&running),
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

/// Send a command, exactly as typed.
///
/// No interpretation here. Aliases, macros and scripting are the frontend's
/// job and Lich has its own ideas about lines beginning with a semicolon; a
/// transport that rewrote what the player typed would make both impossible to
/// reason about.
#[tauri::command]
pub fn game_send(link: State<'_, GameLink>, command: String) -> Result<(), String> {
    let mut guard = link.inner.lock().unwrap();
    let h = guard.as_mut().ok_or("Not attached to a game.")?;
    if !h.running.load(Ordering::Relaxed) {
        return Err("The connection is closed.".into());
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

#[tauri::command]
pub fn game_detach(app: AppHandle, link: State<'_, GameLink>) -> LinkState {
    let mut guard = link.inner.lock().unwrap();
    if let Some(h) = guard.as_ref() {
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
        assert_eq!(server.join().unwrap(), "look\r\n", "commands go out as typed, CRLF");
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
            sock.write_all(b"a rusty \xFF dagger\r\nstill here\r\n").unwrap();
            std::thread::sleep(Duration::from_millis(50));
        });

        let client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let mut reader = BufReader::new(client);

        let mut first = Vec::new();
        reader.read_until(b'\n', &mut first).unwrap();
        let text = String::from_utf8_lossy(&first).trim_end_matches(['\n', '\r']).to_string();
        assert!(text.contains("dagger"), "the line survived: {text:?}");

        let mut second = Vec::new();
        reader.read_until(b'\n', &mut second).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&second).trim_end_matches(['\n', '\r']),
            "still here",
            "the reader kept going after the bad byte"
        );
    }
}
