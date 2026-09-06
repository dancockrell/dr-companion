//! How a local JSON-line socket is closed when the far end is refused.
//!
//! One function, and it has one owner on purpose. `presentation_bridge.rs` and
//! `script_api.rs` both refuse an unauthenticated client the same way, and a
//! second copy of this would drift from the first.
//!
//! ## The bug it fixes (issue #502)
//!
//! Both servers used to write `auth_failed` and `return`, dropping the socket
//! and both of its clones with no `shutdown`. On Windows, closing a socket
//! that still has unread received data queued makes the stack send an **RST**
//! rather than a FIN, and the client's next read fails with `WSAECONNRESET`
//! (`ConnectionReset`, code 10054) instead of returning a clean zero-byte EOF.
//!
//! That is what made
//! `presentation_bridge::tests::requires_the_real_token_before_anything_else`
//! flaky: its `read_to_end(...).unwrap()` — the assertion that nothing arrives
//! after a refusal — saw a reset instead of EOF, and the panic named
//! `Os { code: 10054, kind: ConnectionReset }`.
//!
//! It is not only a test problem. A refused Godot client or script client sees
//! the same reset, and a reset can discard data already in its receive buffer,
//! so the client can lose the `auth_failed` frame that says *why* it was
//! refused and report a bare connection error instead.
//!
//! ## What a graceful refusal needs
//!
//! Both halves, not just the first:
//!
//! 1. `shutdown(Write)` after the refusal frame, so the client gets a FIN and
//!    its read returns 0 rather than blocking until its own timeout;
//! 2. draining whatever the client already sent, so there is nothing unread
//!    when the socket is finally dropped and the stack has no reason to reset.
//!
//! Step 2 is the one that is easy to leave out and the one an RST actually
//! depends on: a client that pipelines a frame straight after its `auth` line
//! — which a script client legitimately does — leaves bytes queued that the
//! server never read.

use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::Duration;

/// How long to spend reading what a refused client already sent. Long enough
/// for bytes already in flight, short enough that a client that simply holds
/// the socket open does not hold a server thread with it.
const DRAIN_TIMEOUT: Duration = Duration::from_millis(200);

/// Stop reading after this much. A refused client has no business sending
/// megabytes, and draining without a ceiling would be a way to hold a thread.
const DRAIN_CAP: usize = 64 * 1024;

/// Close a refused connection gracefully: flush the refusal, send a FIN, and
/// consume anything the client already sent so the final drop cannot become an
/// RST.
///
/// `write_half` and `read_half` are ordinarily two clones of one `TcpStream`;
/// `shutdown` and the read timeout act on the shared underlying socket either
/// way. Every failure here is ignored on purpose — the client may already have
/// gone, and there is nothing left to report to.
pub(crate) fn close_after_refusal(write_half: &mut TcpStream, read_half: &TcpStream) {
    let _ = write_half.flush();
    let _ = write_half.shutdown(Shutdown::Write);

    let _ = read_half.set_read_timeout(Some(DRAIN_TIMEOUT));
    let mut sink = [0u8; 4096];
    let mut seen = 0usize;
    let mut r = read_half;
    while seen < DRAIN_CAP {
        match r.read(&mut sink) {
            Ok(0) => break,
            Ok(n) => seen += n,
            Err(_) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// The property, stated as the client sees it: after a refusal the client's
    /// `read_to_end` returns **EOF**, not an error — and it does so even when
    /// the client pipelined a frame the server never read, which is the case
    /// that produces an RST without the drain above.
    ///
    /// Sabotage check: delete the body of `close_after_refusal` and this goes
    /// red with `ConnectionReset`.
    #[test]
    fn a_refused_client_reads_eof_not_a_reset() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = std::thread::spawn(move || {
            let stream = listener.incoming().next().unwrap().unwrap();
            let mut out = stream.try_clone().unwrap();
            // The refusal frame, then the graceful close. Note that nothing
            // here ever reads the client's pipelined payload.
            out.write_all(b"{\"type\":\"auth_failed\"}\n").unwrap();
            close_after_refusal(&mut out, &stream);
        });

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        // Small enough to fit in the socket buffers so this write cannot
        // block, large enough to still be queued unread when the server drops
        // the socket. This is the byte queue that turns a close into an RST.
        client.write_all(&vec![b'x'; 8192]).unwrap();
        client.flush().unwrap();

        let mut all = Vec::new();
        client
            .read_to_end(&mut all)
            .expect("a refused client must see EOF, not a connection reset");
        assert!(
            String::from_utf8_lossy(&all).contains("auth_failed"),
            "the refusal text must survive the close, got {:?}",
            String::from_utf8_lossy(&all)
        );

        server.join().unwrap();
    }
}
