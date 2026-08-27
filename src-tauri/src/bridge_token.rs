//! The bridge's connection token, read from beside its own script.
//!
//! `companion_bridge.lic` writes a fresh random token on every start and drops
//! any client that has not presented it within a second. This reads it.
//!
//! # Why a token at all, when the port is on loopback
//!
//! Because loopback is not a boundary and the bridge was treating it as one.
//!
//! The **same-origin policy does not restrict WebSockets**: any page on any
//! origin could open `ws://127.0.0.1:7415/companion` with no preflight and no
//! CORS block. The handshake asked for a path and a `Sec-WebSocket-Key`, which
//! is exactly what a browser sends anyway. A web page open in the player's
//! browser while Lich ran could connect and issue intents - including
//! `stop_all`, which is ungated by design because a Stop button has to work in
//! any game state, and which therefore worked unconditionally for an attacker
//! too.
//!
//! The bridge now checks `Origin`, which stops every browser. This is the
//! other half: anything that can open a socket can also omit an `Origin`
//! header, and only a shared secret stops that.
//!
//! # What this boundary is actually worth
//!
//! Stated plainly rather than implied, because a boundary people overestimate
//! is worse than one whose shape they know.
//!
//! The file is written 0600. On Unix that means the user only. **On Windows
//! the mode is largely ignored**, so any process running as this user can read
//! it. The token therefore defends against *other software on the machine* -
//! a web page, a curious script, a program that stumbled onto the port - and
//! not against something that already has the user's privileges. Something
//! running as the player can read the token, and could equally read Lich's
//! saved account file.

use std::path::PathBuf;

use crate::setup::bridge_target_dir;

/// The token, or an empty string.
///
/// Empty rather than an error: no token is a real and ordinary state - an
/// older bridge that predates this, or one that could not write the file and
/// is running on the origin check alone. The caller sends nothing and the
/// bridge decides, which keeps the decision in the one place that has all the
/// facts.
#[tauri::command]
pub fn read_bridge_token() -> String {
    let Some(dir) = bridge_target_dir() else {
        return String::new();
    };
    read_token_from(&dir)
}

fn read_token_from(dir: &PathBuf) -> String {
    let path = dir.join("companion_bridge.token");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return String::new();
    };

    let token = text.trim();

    // Shape-checked before use. A token that is not hex is not one this bridge
    // wrote, and sending whatever happened to be in the file would hand an
    // arbitrary string to whatever is listening on that port - which, on the
    // day somebody else is listening on that port, is the whole problem again.
    if token.len() < 32
        || token.len() > 128
        || !token.chars().all(|c| c.is_ascii_hexdigit())
    {
        return String::new();
    }

    token.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn reads_a_real_token_and_trims_it() {
        let d = temp("drc-token-good");
        let token = "a".repeat(64);
        std::fs::write(d.join("companion_bridge.token"), format!("{token}\r\n")).unwrap();
        assert_eq!(read_token_from(&d), token);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// A missing file is not an error, it is an older bridge.
    #[test]
    fn a_missing_token_is_empty_not_a_panic() {
        let d = temp("drc-token-missing");
        assert_eq!(read_token_from(&d), "");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Anything that is not the shape this bridge writes is refused rather
    /// than forwarded. Sending the contents of an arbitrary file to whatever
    /// is on that port is the failure this whole module exists to prevent.
    #[test]
    fn refuses_anything_that_is_not_a_token() {
        let d = temp("drc-token-junk");
        let f = d.join("companion_bridge.token");

        for junk in [
            "",
            "short",
            "not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-",
            "../../../etc/passwd",
            &"a".repeat(500),
        ] {
            std::fs::write(&f, junk).unwrap();
            assert_eq!(read_token_from(&d), "", "accepted {junk:?}");
        }

        let _ = std::fs::remove_dir_all(&d);
    }
}
