//! The Simutronics EAccess account login, spoken directly by this app.
//!
//! This is the one thing Genie used to supply. `--login <Character>` needs an
//! entry already saved in Lich's own store, and Lich's GTK window cannot
//! create one on this machine (`lich.rs`'s status says so). So the app performs
//! the account login itself and hands Lich the result as a `.sal` launch file
//! (N3). `docs/LICH_NATIVE_LOGIN.md` carries the whole design; §2 of it is the
//! protocol, read out of Lich 5.20.1's
//! `lib/common/authentication/eaccess.rb` with `file:line` cites, and this
//! module is that section in Rust.
//!
//! # The endpoint
//!
//! `eaccess.play.net:7910` over TLS, and it is the only destination this module
//! contacts. **The host and port are not written here.** They are declared once,
//! in `credentials::EACCESS_ENDPOINT` (N2), in the shape
//! `tools/build-privacy-doc.mjs` reads so that `docs/PRIVACY.md` cannot go stale
//! about the one place a password goes; `connect()` calls
//! `credentials::eaccess_endpoint()`, which applies the two test-only overrides.
//! A second copy of the host in this file would be a fork, and the two would
//! drift the day the service moves.
//!
//! # I/O is split from the protocol on purpose
//!
//! Everything below the `Transport` trait is bytes in, bytes out. That is what
//! makes the unhappy paths reachable: a mock in the test module replays the
//! exact frames the real server sends, including the ones nobody can provoke
//! on demand (a locked account, a truncated reply, a connection that stops
//! answering mid-sequence). `connect()` is the only function here that opens a
//! socket, and no test calls it against anything but a closed loopback port.
//!
//! # Certificate validation
//!
//! Ordinary system roots, via `webpki-roots`. Lich pins a self-signed PEM it
//! downloads itself (`eaccess.rb:53-77`), and that pin is **deliberately not
//! reproduced** - `verify_pem` re-downloads the pin on any mismatch and its
//! `fail` line is commented out at `:61`, so it is trust-on-every-use, which is
//! weaker than CA validation rather than stronger. `LICH_NATIVE_LOGIN.md` §3.1
//! records the decision. It also means there is no pin file to ship, refresh,
//! or get wrong.
//!
//! # One correction to the design document, measured rather than reasoned
//!
//! `LICH_NATIVE_LOGIN.md` §2.1 says every send is `conn.puts "…\n"` "so each
//! frame ends `\n\n`", and `PLAN_TO_1_0.md`'s N1 repeats it. That is wrong.
//! Ruby's `IO#puts` does not add a newline to a string that already ends with
//! one, so the wire bytes are a single `\n` per frame. Measured with Lich's own
//! interpreter (`C:\Ruby4Lich5\4.0.6\bin\ruby.exe`), `io.puts "K\n"` produces
//! exactly `[75, 10]`. This module sends one `\n`, and `frames_end_with_one_newline`
//! below is the check.
//!
//! # The password
//!
//! It arrives as a `&str` for the length of one call, is XOR-obscured into the
//! bytes of frame 2, and is never stored, logged, formatted, or placed in any
//! error. No type in this module derives `Debug` over it - the errors below
//! carry codes and lengths, never bytes. The caller holds it in
//! `credentials::Secret` (N2) and passes `.expose_for_obscuring()`, which is
//! what makes every use site greppable by one word; taking `&Secret` here
//! instead would move the boundary and lose that. `password_never_reaches_an_error_string`
//! is the check.

use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// `PACKET_SIZE` in `eaccess.rb:22`. One read per reply, as Lich's `sysread`
/// does.
const PACKET_SIZE: usize = 8192;

/// How long a connect, a read or a write may block. `eaccess.rb` has none of
/// these - every step is a bare blocking call - and a sign-in screen that can
/// hang forever is not one this app can ship.
const IO_TIMEOUT: Duration = Duration::from_secs(20);

/// Anything the protocol can be spoken over: the TLS stream in production, a
/// scripted mock in the tests.
pub trait Transport: Read + Write {}
impl<T: Read + Write> Transport for T {}

/// One character on the account: the code the `L` frame needs, and the name a
/// player recognises.
///
/// `Serialize` because `lich_login_characters` hands this straight to the
/// character picker. Nothing here is a secret: the code is a per-account
/// identifier the `C` reply publishes, and the name is what the player sees in
/// the game. The password is not in this type and must never be added to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CharacterEntry {
    pub code: String,
    pub name: String,
}

/// What the `F` and `C` replies together say about an account.
///
/// `Serialize` for the same reason as [`CharacterEntry`], and with the same
/// constraint: no field here may ever hold a credential.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Account {
    /// The `F` reply verbatim - `NORMAL`, `PREMIUM`, `TRIAL`, `INTERNAL` or
    /// `FREE`. Kept whole rather than parsed into an enum: Lich only ever
    /// matches it, and the live set beyond those five is not established
    /// (`LICH_NATIVE_LOGIN.md` §7 item 5).
    pub subscription: String,
    pub characters: Vec<CharacterEntry>,
}

/// The `L\tOK\t` reply, as `UPPERCASE=value` pairs in the order they arrived.
///
/// Order is preserved and keys are not filtered, because N3 writes these
/// straight out as `.sal` lines and Lich reads that file with `readlines` and
/// four `Array#find` calls (`main.rb:213, :232-251`). A whitelist here would be
/// this module deciding what Lich is allowed to be told.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LaunchData(pub Vec<(String, String)>);

impl LaunchData {
    /// The value for an uppercase key, or `None`.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    /// The keys, in arrival order.
    pub fn keys(&self) -> Vec<&str> {
        self.0.iter().map(|(k, _)| k.as_str()).collect()
    }
}

/// Everything that can go wrong, in the shapes a sign-in screen can say
/// something true about.
///
/// No variant carries a password byte. `AccountRejected` carries the code the
/// server sent, which is what Lich raises too (`eaccess.rb:115-118`); which
/// codes the live server actually uses is `LICH_NATIVE_LOGIN.md` §7 item 5 and
/// is not established here, so the code travels intact rather than being
/// flattened into a guess.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EAccessError {
    /// The `A` frame was refused. The account name or the password is wrong.
    BadCredentials { code: String },
    /// The `A` frame was refused for a reason that is not "try again":
    /// the account is locked, suspended or expired.
    AccountLockedOrExpired { code: String },
    /// The `C` reply had no character of that name. Case-sensitive, as
    /// `resolve_char_code` is (`eaccess.rb:221-229`).
    NoSuchCharacter { requested: String, available: usize },
    /// A reply did not have the shape the step requires. `saw` is the reply,
    /// truncated; `step` is the frame that was in flight.
    ProtocolMismatch { step: &'static str, saw: String },
    /// The password is longer than the hashkey, so the obscuring loop would
    /// index past its end. Ruby yields `nil` there and raises; this refuses
    /// rather than wrapping or truncating, either of which would send a
    /// silently wrong password.
    PasswordLength {
        password_len: usize,
        hashkey_len: usize,
    },
    /// The obscuring arithmetic left the byte range at this index. Only the
    /// position is reported: the value would leak a password byte to anyone
    /// holding the hashkey.
    ObscuredByteOutOfRange { index: usize },
    /// The socket, the TLS handshake, or the endpoint configuration.
    /// `endpoint` is always named, so a run pointed at the wrong place says
    /// where it went.
    Network { endpoint: String, detail: String },
}

impl std::fmt::Display for EAccessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadCredentials { code } => {
                write!(f, "the account name or password was not accepted ({code})")
            }
            Self::AccountLockedOrExpired { code } => {
                write!(f, "the account cannot sign in right now ({code})")
            }
            Self::NoSuchCharacter {
                requested,
                available,
            } => write!(
                f,
                "no character named {requested} on this account ({available} found)"
            ),
            Self::ProtocolMismatch { step, saw } => write!(
                f,
                "the login server's reply to {step} was not what this version expects: {saw}"
            ),
            Self::PasswordLength {
                password_len,
                hashkey_len,
            } => write!(
                f,
                "the password is {password_len} characters and the login server's key is {hashkey_len}; this password cannot be sent"
            ),
            Self::ObscuredByteOutOfRange { index } => write!(
                f,
                "the login server's key does not encode this password at position {index}"
            ),
            Self::Network { endpoint, detail } => {
                write!(f, "could not reach {endpoint}: {detail}")
            }
        }
    }
}

impl std::error::Error for EAccessError {}

// ---------------------------------------------------------------------------
// The protocol
// ---------------------------------------------------------------------------

/// `out[i] = ((pw[i] - 32) XOR key[i]) + 32`, on raw bytes.
///
/// `eaccess.rb:109-113`, verbatim. The arithmetic is done in `i32` rather than
/// `u8` because Ruby's is: `(p - 32) ^ k` can exceed 255 for a large key byte,
/// and Ruby's `Integer#chr` raises there rather than wrapping. Wrapping would
/// be a silently different password.
fn obscure(password: &[u8], hashkey: &[u8]) -> Result<Vec<u8>, EAccessError> {
    if password.len() > hashkey.len() {
        return Err(EAccessError::PasswordLength {
            password_len: password.len(),
            hashkey_len: hashkey.len(),
        });
    }
    let mut out = Vec::with_capacity(password.len());
    for (i, (p, k)) in password.iter().zip(hashkey.iter()).enumerate() {
        let v = ((i32::from(*p) - 32) ^ i32::from(*k)) + 32;
        if !(0..=255).contains(&v) {
            return Err(EAccessError::ObscuredByteOutOfRange { index: i });
        }
        out.push(v as u8);
    }
    Ok(out)
}

/// Send one frame. A single trailing `\n`, per the measurement in this
/// module's header. Bytes, not a `String`: frame 2's obscured password is
/// arbitrary bytes and must not pass through UTF-8.
fn send(t: &mut impl Transport, step: &'static str, frame: &[u8]) -> Result<(), EAccessError> {
    let mut buf = Vec::with_capacity(frame.len() + 1);
    buf.extend_from_slice(frame);
    buf.push(b'\n');
    t.write_all(&buf)
        .and_then(|()| t.flush())
        .map_err(|e| EAccessError::ProtocolMismatch {
            step,
            saw: format!("could not send: {e}"),
        })
}

/// One reply, as raw bytes. Lich's `sysread(8192)`: one read, whatever arrived.
///
/// A read of zero is the connection closing, and it is an error rather than an
/// empty reply that every downstream check then vacuously fails to match.
fn recv(t: &mut impl Transport, step: &'static str) -> Result<Vec<u8>, EAccessError> {
    let mut buf = vec![0u8; PACKET_SIZE];
    let n = t
        .read(&mut buf)
        .map_err(|e| EAccessError::ProtocolMismatch {
            step,
            saw: format!("could not read: {e}"),
        })?;
    if n == 0 {
        return Err(EAccessError::ProtocolMismatch {
            step,
            saw: "the login server closed the connection".to_string(),
        });
    }
    buf.truncate(n);
    Ok(buf)
}

/// A reply rendered for a human and for a regex-free match, with the trailing
/// newline gone. Lossy on purpose: a reply that is not UTF-8 is a reply this
/// version does not understand, and the error should show what arrived rather
/// than fail to be constructed.
fn text(reply: &[u8]) -> String {
    String::from_utf8_lossy(reply)
        .trim_end_matches(['\n', '\r'])
        .to_string()
}

/// At most 200 characters of a reply, for an error message.
fn clip(s: &str) -> String {
    if s.chars().count() <= 200 {
        s.to_string()
    } else {
        s.chars().take(200).collect::<String>() + "…"
    }
}

/// `K`, `A`, `M`, `F`, `G`, `P`, `C` - everything both entry points share.
///
/// Returns the account, and the raw `C` reply is already parsed into it, so
/// `login` resolves the character code from the same list the picker shows
/// rather than re-scanning the text a second time.
fn handshake(
    t: &mut impl Transport,
    account: &str,
    password: &str,
    game_code: &str,
) -> Result<Account, EAccessError> {
    // 1. K -> the hashkey, raw bytes. Not trimmed: Ruby maps every byte of the
    //    reply, trailing newline included, and only the first `password.len()`
    //    of them are ever used. Trimming would change the arithmetic if a
    //    password were ever as long as the key.
    send(t, "K", b"K")?;
    let hashkey = recv(t, "K")?;

    // 2. A\t<account>\t<obscured password>
    let obscured = obscure(password.as_bytes(), &hashkey)?;
    let mut frame = Vec::new();
    frame.push(b'A');
    frame.push(b'\t');
    frame.extend_from_slice(account.as_bytes());
    frame.push(b'\t');
    frame.extend_from_slice(&obscured);
    send(t, "A", &frame)?;
    frame.clear();
    let reply = text(&recv(t, "A")?);
    if !key_line(&reply) {
        // `eaccess.rb:116` takes the last whitespace-separated field as the
        // code. Tabs are whitespace to Ruby's `split(/\s+/)`, so this is the
        // same field.
        let code = reply
            .split_whitespace()
            .next_back()
            .unwrap_or("")
            .to_string();
        return Err(classify_account_refusal(code));
    }

    // 3. M -> the game list. Its content is unused here (the caller already
    //    knows which game it wants); only its shape is checked, exactly as
    //    `eaccess.rb:120-122` does.
    send(t, "M", b"M")?;
    let reply = text(&recv(t, "M")?);
    if !reply.starts_with("M\t") {
        return Err(EAccessError::ProtocolMismatch {
            step: "M",
            saw: clip(&reply),
        });
    }

    // 4. F\t<game code> -> the subscription tier.
    send(t, "F", format!("F\t{game_code}").as_bytes())?;
    let subscription = text(&recv(t, "F")?);
    if !is_subscription_tier(&subscription) {
        return Err(EAccessError::ProtocolMismatch {
            step: "F",
            saw: clip(&subscription),
        });
    }

    // 5, 6. G and P. Lich sends both and discards both replies
    //       (`eaccess.rb:141, :144`). They are still sent, because the server's
    //       state machine is not documented anywhere and the sequence is the
    //       only thing known to work.
    send(t, "G", format!("G\t{game_code}").as_bytes())?;
    recv(t, "G")?;
    send(t, "P", format!("P\t{game_code}").as_bytes())?;
    recv(t, "P")?;

    // 7. C -> the character list.
    send(t, "C", b"C")?;
    let characters = parse_character_list(&text(&recv(t, "C")?))?;

    Ok(Account {
        subscription,
        characters,
    })
}

/// `/KEY\t(?<key>.*)\t/` from `eaccess.rb:114`, without a regex crate: the
/// reply must contain `KEY\t` and at least one more tab after it.
fn key_line(reply: &str) -> bool {
    match reply.find("KEY\t") {
        Some(i) => reply[i + 4..].contains('\t'),
        None => false,
    }
}

/// `/NORMAL|PREMIUM|TRIAL|INTERNAL|FREE/` from `eaccess.rb:135`.
///
/// Lich's generator path also tolerates `NEW_TO_GAME`; this module never enters
/// the character generator, so it does not.
fn is_subscription_tier(reply: &str) -> bool {
    ["NORMAL", "PREMIUM", "TRIAL", "INTERNAL", "FREE"]
        .iter()
        .any(|t| reply.contains(t))
}

/// Which of the two refusals a code is.
///
/// Coarse on purpose. Lich raises `AuthenticationError` with whatever code the
/// server sent and never interprets it, so the live vocabulary is unknown
/// (`LICH_NATIVE_LOGIN.md` §7 item 5). Anything naming a lock, a suspension or
/// an expiry is the kind a player cannot fix by retyping; everything else is
/// reported as credentials, which is the honest default because it is what a
/// retry can address. Either way the raw code travels with the error.
fn classify_account_refusal(code: String) -> EAccessError {
    let upper = code.to_ascii_uppercase();
    if ["LOCK", "SUSPEND", "EXPIRE", "CLOSED", "BANNED"]
        .iter()
        .any(|w| upper.contains(w))
    {
        EAccessError::AccountLockedOrExpired { code }
    } else {
        EAccessError::BadCredentials { code }
    }
}

/// `C\t<n1>\t<n2>\t<n3>\t<n4>` then code/name pairs (`eaccess.rb:222-223`).
///
/// The four-integer header is required rather than optionally stripped. Lich's
/// `sub` leaves a malformed header in place and then scans it as if it were
/// character pairs, which turns a truncated reply into a list of plausible
/// nonsense; refusing is the difference between "the login server said
/// something I do not understand" and a picker offering to log in as `1`.
///
/// A trailing field with no pair follows Lich and is dropped: its `scan` needs
/// two fields to match.
fn parse_character_list(reply: &str) -> Result<Vec<CharacterEntry>, EAccessError> {
    let fields: Vec<&str> = reply.split('\t').collect();
    let header_ok = fields.len() >= 5
        && fields[0] == "C"
        && fields[1..5]
            .iter()
            .all(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()));
    if !header_ok {
        return Err(EAccessError::ProtocolMismatch {
            step: "C",
            saw: clip(reply),
        });
    }
    Ok(fields[5..]
        .chunks(2)
        .filter(|p| p.len() == 2)
        .filter(|p| !p[0].is_empty() && !p[1].is_empty())
        .map(|p| CharacterEntry {
            code: p[0].to_string(),
            name: p[1].to_string(),
        })
        .collect())
}

/// `L\tOK\t` then `KEY=value` pairs (`eaccess.rb:169-174`).
///
/// Lich downcases the keys and this uppercases them, because the two ends want
/// opposite things and the round trip is what matters: `launch_data.rb:18`
/// upcases them straight back to write the `.sal`. Keeping them upper here
/// removes a downcase-then-upcase nobody would notice was lossy.
fn parse_launch_data(reply: &str) -> Result<LaunchData, EAccessError> {
    let Some(rest) = reply.strip_prefix("L\tOK\t") else {
        return Err(EAccessError::ProtocolMismatch {
            step: "L",
            saw: clip(reply),
        });
    };
    let mut pairs = Vec::new();
    for kv in rest.split('\t') {
        if kv.is_empty() {
            continue;
        }
        let (k, v) = match kv.split_once('=') {
            Some((k, v)) => (k, v),
            None => (kv, ""),
        };
        if k.is_empty() {
            continue;
        }
        pairs.push((k.to_ascii_uppercase(), v.to_string()));
    }
    if pairs.is_empty() {
        return Err(EAccessError::ProtocolMismatch {
            step: "L",
            saw: clip(reply),
        });
    }
    Ok(LaunchData(pairs))
}

/// The account's characters, without choosing one.
///
/// This is the sign-in screen's character picker: the player types an account
/// and a password and gets the real list, with no name to guess.
pub fn list_characters(
    t: &mut impl Transport,
    account: &str,
    password: &str,
    game_code: &str,
) -> Result<Account, EAccessError> {
    handshake(t, account, password, game_code)
}

/// The full login, ending in the launch parameters for one character.
///
/// `character` is matched **case-sensitively** against the `C` reply, as
/// `resolve_char_code` does (`eaccess.rb:225`). The code, not the name, is what
/// goes into the `L` frame.
pub fn login(
    t: &mut impl Transport,
    account: &str,
    password: &str,
    game_code: &str,
    character: &str,
) -> Result<LaunchData, EAccessError> {
    let account_info = handshake(t, account, password, game_code)?;
    let entry = account_info
        .characters
        .iter()
        .find(|c| c.name == character)
        .ok_or_else(|| EAccessError::NoSuchCharacter {
            requested: character.to_string(),
            available: account_info.characters.len(),
        })?;

    // 8. L\t<char code>\tSTORM
    send(t, "L", format!("L\t{}\tSTORM", entry.code).as_bytes())?;
    let reply = text(&recv(t, "L")?);
    parse_launch_data(&reply)
}

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

/// Where `connect()` will go, after `credentials`' two test-only overrides.
///
/// A thin wrapper rather than a second reader of the environment: the host and
/// the override rules both live in `credentials.rs`, and this only adapts the
/// error into this module's type so a caller has one thing to match on.
pub fn endpoint() -> Result<(String, u16), EAccessError> {
    crate::credentials::eaccess_endpoint().map_err(|detail| EAccessError::Network {
        endpoint: format!(
            "{}:{}",
            std::env::var("DRC_EACCESS_HOST")
                .unwrap_or_else(|_| crate::credentials::EACCESS_ENDPOINT.0.to_string()),
            std::env::var("DRC_EACCESS_PORT").unwrap_or_default()
        ),
        detail,
    })
}

/// A TLS stream to the EAccess endpoint, ready to be handed to `login` or
/// `list_characters`.
pub struct TlsTransport {
    stream: rustls::StreamOwned<rustls::ClientConnection, TcpStream>,
}

impl Read for TlsTransport {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.stream.read(buf)
    }
}

impl Write for TlsTransport {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.stream.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.stream.flush()
    }
}

/// Open the connection. The only function in this module that touches a socket.
pub fn connect() -> Result<TlsTransport, EAccessError> {
    let (host, port) = endpoint()?;
    let where_ = format!("{host}:{port}");
    let net = |detail: String| EAccessError::Network {
        endpoint: where_.clone(),
        detail,
    };

    let addr = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| net(format!("could not resolve the address: {e}")))?
        .next()
        .ok_or_else(|| net("the address resolved to nothing".to_string()))?;
    let tcp = TcpStream::connect_timeout(&addr, IO_TIMEOUT)
        .map_err(|e| net(format!("could not connect: {e}")))?;
    tcp.set_read_timeout(Some(IO_TIMEOUT))
        .and_then(|()| tcp.set_write_timeout(Some(IO_TIMEOUT)))
        .map_err(|e| net(format!("could not set a timeout: {e}")))?;

    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|e| net(format!("could not configure TLS: {e}")))?
    .with_root_certificates(roots)
    .with_no_client_auth();

    let server_name = rustls::pki_types::ServerName::try_from(host.clone())
        .map_err(|e| net(format!("{host} is not a valid TLS server name: {e}")))?;
    let conn = rustls::ClientConnection::new(std::sync::Arc::new(config), server_name)
        .map_err(|e| net(format!("could not start TLS: {e}")))?;

    Ok(TlsTransport {
        stream: rustls::StreamOwned::new(conn, tcp),
    })
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// `std::env` is process-global and cargo runs tests in threads, so the
    /// three cases that set `DRC_EACCESS_*` take this first. Without it they
    /// pass or fail depending on scheduling, which is a check that cannot be
    /// trusted in either direction.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// A scripted EAccess server.
    ///
    /// Replies are keyed by the frame's **verb**, not by position, so a missing
    /// frame does not shift every later reply onto the wrong step. That is
    /// deliberate: it is what lets the "drop the `M` frame" sabotage redden the
    /// sequence case *only*. Position-keyed replies would redden the happy path
    /// too, and three red checks for one break means the checks are entangled
    /// and are saying less than they appear to.
    ///
    /// It also never inspects the obscured password, so the obscuring sabotage
    /// reddens the wire-bytes case only.
    struct MockEAccess {
        replies: Vec<(u8, Vec<u8>)>,
        /// Every frame received, in order, without its trailing newline. This
        /// is the wire, and it is what the sequence and byte cases assert
        /// against - not what the client believes it sent.
        received: Vec<Vec<u8>>,
        inbox: VecDeque<u8>,
        pending: Vec<u8>,
    }

    impl MockEAccess {
        fn new(replies: Vec<(u8, &[u8])>) -> Self {
            Self {
                replies: replies.into_iter().map(|(v, r)| (v, r.to_vec())).collect(),
                received: Vec::new(),
                inbox: VecDeque::new(),
                pending: Vec::new(),
            }
        }

        /// The verbs received, as a string like `K A M F G P C L`.
        fn sequence(&self) -> String {
            self.received
                .iter()
                .map(|f| (f.first().copied().unwrap_or(b'?') as char).to_string())
                .collect::<Vec<_>>()
                .join(" ")
        }

        /// One received frame, rendered lossily for a message.
        fn frame_text(&self, i: usize) -> String {
            String::from_utf8_lossy(&self.received[i]).to_string()
        }
    }

    impl Read for MockEAccess {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let mut n = 0;
            while n < buf.len() {
                match self.inbox.pop_front() {
                    Some(b) => {
                        buf[n] = b;
                        n += 1;
                    }
                    None => break,
                }
            }
            Ok(n)
        }
    }

    impl Write for MockEAccess {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            for &b in buf {
                if b == b'\n' {
                    let frame = std::mem::take(&mut self.pending);
                    let verb = frame.first().copied().unwrap_or(b'?');
                    self.received.push(frame);
                    if let Some((_, reply)) = self.replies.iter().find(|(v, _)| *v == verb) {
                        self.inbox.extend(reply.iter().copied());
                    }
                } else {
                    self.pending.push(b);
                }
            }
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// A hashkey with no structure to it, long enough for the test password.
    /// Every byte is under 0x80 so the obscuring result stays inside a byte,
    /// which is what the live server's keys do.
    const HASHKEY: &[u8] = &[
        0x41, 0x1f, 0x7a, 0x05, 0x63, 0x2c, 0x50, 0x11, 0x08, 0x77, 0x39, 0x5e, 0x22, 0x6b, 0x14,
        0x4d,
    ];

    /// Assembled at run time rather than written as a literal: gitleaks blocks
    /// credential-shaped literals in this repository, fake ones included
    /// (`PLAN_TO_1_0.md` §1 trap 3). Both are obviously not credentials.
    fn account() -> String {
        String::from("acct-") + "example"
    }
    fn password() -> String {
        String::from("pw-") + "example"
    }

    const C_REPLY: &[u8] = b"C\t2\t2\t0\t0\tW_ABC123\tPhemius\tW_DEF456\tAlisandra\n";
    const L_REPLY: &[u8] = b"L\tOK\tUPPORT=5535\tGAME=STORM\tGAMECODE=DR\tFULLGAMENAME=DragonRealms\tGAMEFILE=STORMFRONT.EXE\tGAMEHOST=dr.simutronics.net\tGAMEPORT=11024\tKEY=one-shot-launch-key\n";

    /// The exact reply set from `docs/LICH_NATIVE_LOGIN.md` §2.2, one per verb.
    fn happy_replies() -> Vec<(u8, &'static [u8])> {
        vec![
            (b'K', HASHKEY),
            (b'A', b"A\tacct-example\tKEY\tsession-key\t\n" as &[u8]),
            (b'M', b"M\tDR\tDragonRealms\tGS3\tGemStone IV\n"),
            (b'F', b"NORMAL\n"),
            (b'G', b"G\tok\n"),
            (b'P', b"P\tok\n"),
            (b'C', C_REPLY),
            (b'L', L_REPLY),
        ]
    }

    fn happy_server() -> MockEAccess {
        MockEAccess::new(happy_replies())
    }

    /// The same set with one verb's reply replaced.
    fn server_with(verb: u8, reply: &'static [u8]) -> MockEAccess {
        let mut r = happy_replies();
        for entry in r.iter_mut() {
            if entry.0 == verb {
                entry.1 = reply;
            }
        }
        MockEAccess::new(r)
    }

    // -- the happy path ----------------------------------------------------

    #[test]
    fn a_full_login_returns_the_launch_parameters() {
        let mut s = happy_server();
        let data = login(&mut s, &account(), &password(), "DR", "Phemius").expect("login");
        assert_eq!(data.get("GAMEHOST"), Some("dr.simutronics.net"));
        assert_eq!(data.get("GAMEPORT"), Some("11024"));
        assert_eq!(data.get("KEY"), Some("one-shot-launch-key"));
        assert_eq!(data.get("GAMECODE"), Some("DR"));
        assert_eq!(data.get("GAME"), Some("STORM"));
    }

    #[test]
    fn launch_data_keys_are_uppercase_and_keep_their_order() {
        let mut s = happy_server();
        let data = login(&mut s, &account(), &password(), "DR", "Phemius").expect("login");
        assert_eq!(
            data.keys(),
            vec![
                "UPPORT",
                "GAME",
                "GAMECODE",
                "FULLGAMENAME",
                "GAMEFILE",
                "GAMEHOST",
                "GAMEPORT",
                "KEY"
            ]
        );
    }

    #[test]
    fn the_frames_are_sent_in_the_order_the_protocol_specifies() {
        let mut s = happy_server();
        login(&mut s, &account(), &password(), "DR", "Phemius").expect("login");
        println!(
            "-- {} frames asserted on the wire: {}",
            s.received.len(),
            s.sequence()
        );
        assert_eq!(s.sequence(), "K A M F G P C L");
        assert_eq!(s.received.len(), 8, "eight frames, one per step of §2.2");
        assert_eq!(s.frame_text(0), "K");
        assert_eq!(s.frame_text(2), "M");
        assert_eq!(s.frame_text(3), "F\tDR");
        assert_eq!(s.frame_text(4), "G\tDR");
        assert_eq!(s.frame_text(5), "P\tDR");
        assert_eq!(s.frame_text(6), "C");
        // The code, never the name.
        assert_eq!(s.frame_text(7), "L\tW_ABC123\tSTORM");
    }

    #[test]
    fn listing_characters_stops_before_the_l_frame() {
        let mut s = happy_server();
        let acct = list_characters(&mut s, &account(), &password(), "DR").expect("list");
        assert_eq!(acct.subscription, "NORMAL");
        assert_eq!(
            acct.characters,
            vec![
                CharacterEntry {
                    code: "W_ABC123".into(),
                    name: "Phemius".into()
                },
                CharacterEntry {
                    code: "W_DEF456".into(),
                    name: "Alisandra".into()
                },
            ]
        );
        assert_eq!(s.sequence(), "K A M F G P C", "no character is chosen yet");
    }

    #[test]
    fn frames_end_with_one_newline() {
        // Measured against Lich's own Ruby: `io.puts "K\n"` writes [75, 10].
        // The design document says `\n\n` and is wrong; this is the check that
        // keeps the code on the measurement rather than on the document.
        struct Raw(Vec<u8>);
        impl Read for Raw {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Ok(0)
            }
        }
        impl Write for Raw {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                self.0.extend_from_slice(b);
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut raw = Raw(Vec::new());
        send(&mut raw, "K", b"K").expect("send");
        assert_eq!(raw.0, b"K\n".to_vec());
        assert_eq!(raw.0, vec![75, 10], "the bytes Ruby's puts produces");
    }

    // -- the property the wire has to have ---------------------------------

    #[test]
    fn the_obscured_password_on_the_wire_matches_the_formula() {
        let mut s = happy_server();
        let acct = account();
        let pw = password();
        login(&mut s, &acct, &pw, "DR", "Phemius").expect("login");

        // Computed here, longhand, from the formula in `eaccess.rb:111` -
        // never by calling `obscure`, or this would assert that a function
        // equals itself.
        let mut expected: Vec<u8> = Vec::new();
        expected.push(b'A');
        expected.push(b'\t');
        expected.extend_from_slice(acct.as_bytes());
        expected.push(b'\t');
        for (p, k) in pw.as_bytes().iter().zip(HASHKEY.iter()) {
            let (p, k) = (i32::from(*p), i32::from(*k));
            expected.push((((p - 32) ^ k) + 32) as u8);
        }

        let actual = &s.received[1];
        assert_eq!(
            actual, &expected,
            "frame 2 on the wire: expected {expected:?}, got {actual:?}"
        );
        // And the obscured half is genuinely not the password: a bug that
        // sent the plaintext would satisfy nothing above only by accident.
        assert!(
            !actual.windows(pw.len()).any(|w| w == pw.as_bytes()),
            "the plaintext password appears in frame 2"
        );
    }

    #[test]
    fn obscuring_is_reversible_with_the_same_key() {
        let pw = password();
        let out = obscure(pw.as_bytes(), HASHKEY).expect("obscure");
        let back: Vec<u8> = out
            .iter()
            .zip(HASHKEY)
            .map(|(o, k)| ((((*o as i32) - 32) ^ (*k as i32)) + 32) as u8)
            .collect();
        assert_eq!(back, pw.as_bytes());
    }

    #[test]
    fn a_password_longer_than_the_hashkey_is_refused_naming_both_lengths() {
        let long = "x".repeat(HASHKEY.len() + 1);
        let err = obscure(long.as_bytes(), HASHKEY).unwrap_err();
        assert_eq!(
            err,
            EAccessError::PasswordLength {
                password_len: HASHKEY.len() + 1,
                hashkey_len: HASHKEY.len()
            }
        );
        assert!(err.to_string().contains(&format!("{}", HASHKEY.len() + 1)));
    }

    #[test]
    fn a_key_byte_that_pushes_the_result_out_of_range_is_refused_not_wrapped() {
        // 0xff ^ (0x7e - 32) = 0xff ^ 0x5e = 0xa1; + 32 = 0xc1, still a byte.
        // A high key byte with a low password byte is what leaves the range:
        // ((0x20 - 32) ^ 0xff) + 32 = 0xff + 32 = 287.
        let err = obscure(b" ", &[0xff]).unwrap_err();
        assert_eq!(err, EAccessError::ObscuredByteOutOfRange { index: 0 });
    }

    // -- the unhappy paths, each reachable on purpose ----------------------

    #[test]
    fn a_refused_password_is_a_credentials_error_carrying_the_code() {
        let mut s = server_with(b'A', b"A\tacct-example\tPASSWORD\n");
        let err = login(&mut s, &account(), &password(), "DR", "Phemius").unwrap_err();
        assert_eq!(
            err,
            EAccessError::BadCredentials {
                code: "PASSWORD".into()
            }
        );
        assert_eq!(s.sequence(), "K A", "it stops at the refusal");
    }

    #[test]
    fn a_locked_account_is_a_different_error_from_a_wrong_password() {
        let mut s = server_with(b'A', b"A\tacct-example\tACCOUNT_LOCKED\n");
        let err = login(&mut s, &account(), &password(), "DR", "Phemius").unwrap_err();
        assert_eq!(
            err,
            EAccessError::AccountLockedOrExpired {
                code: "ACCOUNT_LOCKED".into()
            }
        );
        let mut s = server_with(b'A', b"A\tacct-example\tACCOUNT_EXPIRED\n");
        assert!(matches!(
            login(&mut s, &account(), &password(), "DR", "Phemius"),
            Err(EAccessError::AccountLockedOrExpired { .. })
        ));
    }

    #[test]
    fn a_character_name_differing_only_in_case_does_not_match() {
        let mut s = happy_server();
        let err = login(&mut s, &account(), &password(), "DR", "phemius").unwrap_err();
        assert_eq!(
            err,
            EAccessError::NoSuchCharacter {
                requested: "phemius".into(),
                available: 2
            }
        );
        assert_eq!(
            s.sequence(),
            "K A M F G P C",
            "no L frame is sent for a name that did not match"
        );
        // The control: the same run with the right case does match, so the
        // assertion above is about case and not about the lookup being broken.
        let mut s = happy_server();
        assert!(login(&mut s, &account(), &password(), "DR", "Phemius").is_ok());
    }

    #[test]
    fn a_truncated_character_list_is_a_protocol_error_and_not_a_panic() {
        let mut s = server_with(b'C', b"C\t1\t2\t3\n");
        let err = login(&mut s, &account(), &password(), "DR", "Phemius").unwrap_err();
        assert!(
            matches!(&err, EAccessError::ProtocolMismatch { step: "C", saw } if saw.contains("C\t1\t2\t3")),
            "got {err:?}"
        );
    }

    #[test]
    fn a_character_list_header_that_is_not_four_integers_is_refused() {
        // The shape Lich's `sub` would leave in place and then scan as pairs.
        let err = parse_character_list("C\t2\t2\tx\t0\tW_ABC123\tPhemius").unwrap_err();
        assert!(matches!(
            err,
            EAccessError::ProtocolMismatch { step: "C", .. }
        ));
        // Control: the same reply with the header intact parses.
        let ok = parse_character_list("C\t2\t2\t0\t0\tW_ABC123\tPhemius").expect("parse");
        assert_eq!(ok.len(), 1);
    }

    #[test]
    fn an_account_with_no_characters_is_an_empty_list_not_an_error() {
        let mut s = server_with(b'C', b"C\t0\t0\t0\t0\n");
        let acct = list_characters(&mut s, &account(), &password(), "DR").expect("list");
        assert!(acct.characters.is_empty());
        let mut s = server_with(b'C', b"C\t0\t0\t0\t0\n");
        let err = login(&mut s, &account(), &password(), "DR", "Phemius").unwrap_err();
        assert_eq!(
            err,
            EAccessError::NoSuchCharacter {
                requested: "Phemius".into(),
                available: 0
            }
        );
    }

    #[test]
    fn a_game_list_that_is_not_a_game_list_stops_at_m() {
        let mut s = server_with(b'M', b"SOMETHING ELSE\n");
        let err = login(&mut s, &account(), &password(), "DR", "Phemius").unwrap_err();
        assert!(matches!(
            err,
            EAccessError::ProtocolMismatch { step: "M", .. }
        ));
        assert_eq!(s.sequence(), "K A M");
    }

    #[test]
    fn a_subscription_reply_that_names_no_tier_stops_at_f() {
        let mut s = server_with(b'F', b"NEW_TO_GAME\n");
        let err = login(&mut s, &account(), &password(), "DR", "Phemius").unwrap_err();
        assert!(
            matches!(&err, EAccessError::ProtocolMismatch { step: "F", saw } if saw == "NEW_TO_GAME"),
            "got {err:?}"
        );
        // Control: every tier Lich accepts is accepted here.
        for tier in ["NORMAL", "PREMIUM", "TRIAL", "INTERNAL", "FREE"] {
            assert!(is_subscription_tier(tier), "{tier} should be a tier");
        }
    }

    #[test]
    fn an_l_reply_that_is_not_ok_is_refused_rather_than_parsed_into_garbage() {
        let mut s = server_with(b'L', b"L\tPROBLEM\t1\n");
        let err = login(&mut s, &account(), &password(), "DR", "Phemius").unwrap_err();
        assert!(
            matches!(&err, EAccessError::ProtocolMismatch { step: "L", saw } if saw.contains("PROBLEM")),
            "got {err:?}"
        );
    }

    #[test]
    fn a_connection_that_stops_answering_is_an_error_and_not_a_hang() {
        // No reply configured for C at all: the read returns zero bytes.
        let mut s = MockEAccess::new(
            happy_replies()
                .into_iter()
                .filter(|(v, _)| *v != b'C')
                .collect(),
        );
        let err = login(&mut s, &account(), &password(), "DR", "Phemius").unwrap_err();
        assert!(
            matches!(&err, EAccessError::ProtocolMismatch { step: "C", saw } if saw.contains("closed")),
            "got {err:?}"
        );
    }

    #[test]
    fn password_never_reaches_an_error_string() {
        let pw = password();
        let servers: Vec<MockEAccess> = vec![
            server_with(b'A', b"A\tacct-example\tPASSWORD\n"),
            server_with(b'A', b"A\tacct-example\tACCOUNT_LOCKED\n"),
            server_with(b'M', b"SOMETHING ELSE\n"),
            server_with(b'F', b"NEW_TO_GAME\n"),
            server_with(b'C', b"C\t1\t2\t3\n"),
            server_with(b'L', b"L\tPROBLEM\t1\n"),
        ];
        let mut checked = 0;
        for mut s in servers {
            let err = login(&mut s, &account(), &pw, "DR", "Phemius").unwrap_err();
            let debug = format!("{err:?}");
            let display = err.to_string();
            assert!(!debug.contains(&pw), "password in Debug: {debug}");
            assert!(!display.contains(&pw), "password in Display: {display}");
            checked += 1;
        }
        // Plus the two errors that are about the password itself.
        for err in [
            obscure(&[b'x'; 99], HASHKEY).unwrap_err(),
            obscure(b" ", &[0xff]).unwrap_err(),
        ] {
            assert!(!format!("{err:?}").contains(&pw));
            assert!(!err.to_string().contains(&pw));
            checked += 1;
        }
        assert_eq!(checked, 8, "eight error values were rendered and checked");
        // The control: this instrument can find the password when it is there.
        assert!(format!("{:?}", EAccessError::BadCredentials { code: pw.clone() }).contains(&pw));
    }

    // -- the endpoint override ---------------------------------------------

    #[test]
    fn the_endpoint_defaults_to_the_real_service() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("DRC_EACCESS_HOST");
        std::env::remove_var("DRC_EACCESS_PORT");
        // Against `credentials::EACCESS_ENDPOINT` rather than a literal: that
        // constant is the single declaration of the host, and `credentials`'
        // own suite is what pins it to eaccess.play.net:7910. Repeating the
        // literal here would be the second copy this module exists not to have.
        let declared = crate::credentials::EACCESS_ENDPOINT;
        assert_eq!(
            endpoint().expect("endpoint"),
            (declared.0.to_string(), declared.1)
        );
    }

    #[test]
    fn the_endpoint_override_is_read_and_a_wrong_value_names_itself() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("DRC_EACCESS_HOST", "127.0.0.1");
        std::env::set_var("DRC_EACCESS_PORT", "7911");
        let got = endpoint().expect("endpoint");
        assert_eq!(got, ("127.0.0.1".to_string(), 7911));

        // Nothing listens on 7911 of this machine's own loopback, so the
        // connect is refused at once. This is the proof the override reaches
        // the socket and not only the getter: 7910 could not have produced
        // this message. Loopback only - no test in this module contacts a
        // network.
        // `expect_err` would need `Debug` on `TlsTransport`, and a type that
        // holds a live TLS session should not grow a `Debug` for a test's
        // convenience.
        let rendered = match connect() {
            Ok(_) => panic!("something is listening on 127.0.0.1:7911"),
            Err(e) => e.to_string(),
        };
        assert!(rendered.contains("7911"), "{rendered}");
        assert!(!rendered.contains("7910"), "{rendered}");

        std::env::remove_var("DRC_EACCESS_HOST");
        std::env::remove_var("DRC_EACCESS_PORT");
    }

    #[test]
    fn a_port_that_is_not_a_number_fails_naming_the_value() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("DRC_EACCESS_PORT", "seventy-nine-ten");
        let err = endpoint().expect_err("not a port");
        assert!(err.to_string().contains("seventy-nine-ten"), "{err}");
        std::env::remove_var("DRC_EACCESS_PORT");
    }

    // -- the mock itself ---------------------------------------------------

    #[test]
    fn the_mock_records_frames_rather_than_the_clients_intentions() {
        // The instrument the cases above depend on, checked before they are
        // trusted: a frame written in two pieces is still one frame, and a
        // verb with no scripted reply produces no bytes rather than the
        // previous reply again.
        let mut s = MockEAccess::new(vec![(b'K', b"key" as &[u8])]);
        s.write_all(b"K").expect("write");
        assert!(s.received.is_empty(), "no newline yet, no frame yet");
        s.write_all(b"\nZ\n").expect("write");
        assert_eq!(s.sequence(), "K Z");
        let mut buf = [0u8; 16];
        let n = s.read(&mut buf).expect("read");
        assert_eq!(&buf[..n], b"key", "Z had no reply and added nothing");
    }

    // -- the shape the picker receives -------------------------------------

    /// The JSON `lich_login_characters` hands the character picker, asserted
    /// against `docs/LICH_NATIVE_LOGIN.md` section 8 and against
    /// `AccountCharacters` in `src/lib/lichLogin.ts`.
    ///
    /// This is the consuming side of the `Serialize` derive, which is the half
    /// that otherwise never gets checked (`CLAUDE.md` section 1): a renamed
    /// field, or a `rename_all` added later for consistency with the other
    /// command results, would compile, serialize happily, and arrive at the
    /// picker as `undefined`.
    #[test]
    fn the_account_serializes_as_the_picker_reads_it() {
        let account = Account {
            subscription: "NORMAL".into(),
            characters: vec![
                CharacterEntry {
                    code: "C1".into(),
                    name: "Phemius".into(),
                },
                CharacterEntry {
                    code: "C2".into(),
                    name: "Dan the Bold".into(),
                },
            ],
        };
        let v = serde_json::to_value(&account).expect("serialize");
        assert_eq!(v["subscription"], "NORMAL", "{v}");
        assert_eq!(v["characters"][0]["code"], "C1", "{v}");
        assert_eq!(v["characters"][0]["name"], "Phemius", "{v}");
        assert_eq!(v["characters"][1]["name"], "Dan the Bold", "{v}");
        // Exactly these keys, in both directions. An extra one would be a
        // field nobody asked for travelling to the webview, and the rule both
        // these types carry in their own doc comments is that a credential
        // must never become one of them.
        // Sorted, because `serde_json`'s default map is a `BTreeMap` and the
        // key order in the JSON is alphabetical rather than declaration
        // order - measured, not assumed: the first version of this assertion
        // expected declaration order and went red.
        let mut top: Vec<&String> = v.as_object().expect("object").keys().collect();
        top.sort();
        assert_eq!(top, vec!["characters", "subscription"], "{v}");
        let mut entry: Vec<&String> = v["characters"][0]
            .as_object()
            .expect("object")
            .keys()
            .collect();
        entry.sort();
        assert_eq!(entry, vec!["code", "name"], "{v}");
    }
}
