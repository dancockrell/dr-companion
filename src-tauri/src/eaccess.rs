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
//! # The transport, and why it is not rustls
//!
//! This module used to open the socket with `rustls` and `webpki-roots`, on the
//! argument that ordinary CA validation is stronger than the self-signed pin
//! Lich carries. The argument was about the wrong thing, and the code could
//! never have completed a handshake at all. Measured against the live server on
//! 9 Sep 2026, sending no login line and no credentials:
//!
//! ```text
//! openssl s_client -connect eaccess.play.net:7910 -tls1_2 -cipher <one suite>
//!
//!   AES128-GCM-SHA256              ACCEPT   (TLS_RSA_WITH_AES_128_GCM_SHA256)
//!   AES256-GCM-SHA384              REFUSE   connection closed, no alert
//!   AES128-SHA / AES256-SHA        REFUSE   connection closed, no alert
//!   ECDHE-RSA-AES128-GCM-SHA256    REFUSE   connection closed, no alert
//!   ECDHE-RSA-AES256-GCM-SHA384    REFUSE   connection closed, no alert
//!   ECDHE-RSA-AES128-SHA           REFUSE   connection closed, no alert
//!   DHE-RSA-AES128-GCM-SHA256      REFUSE   connection closed, no alert
//!   -tls1_3                        REFUSE   connection closed, no alert
//! ```
//!
//! One suite, and it is static-RSA key exchange: no forward secrecy, TLS 1.2
//! only. rustls has never implemented static RSA key exchange, so a rustls
//! ClientHello and that server share no cipher suite and the server hangs up
//! mid-handshake. Because `rustls::StreamOwned` handshakes lazily on the first
//! write, the failure surfaced at the first frame as
//! `could not send: unexpected end of file`, which reads like a disagreement
//! about `K` and is nothing of the kind.
//!
//! So the socket is `native-tls`, which on Windows is schannel. Driven the same
//! way it completes the handshake and returns the 32-byte `K` hashkey.
//!
//! # Certificate validation
//!
//! Pinned, and stricter than what Lich does.
//!
//! That server presents a self-signed certificate - `C=US, ST=Missouri,
//! O=Simutronics Corp.`, RSA 4096, valid to 3017 - with **no CN and no
//! subjectAltName**, so there is nothing for a hostname check to match and no
//! chain for a public CA to anchor. Measured, with the connector configured
//! four ways:
//!
//! ```text
//!   pinned certificate as the only root, hostname check off   HANDSHAKE OK
//!   pinned certificate as the only root, hostname check on    FAILED, no CN to match
//!   system roots only, no pin                                 FAILED, untrusted root
//!   a different self-signed certificate as the only root      FAILED, untrusted root
//! ```
//!
//! The last two are the controls: the pin is doing the work, and it is keyed on
//! *this* certificate rather than on any certificate.
//!
//! [`connect`] therefore turns the built-in roots **off**, adds
//! `certs/eaccess-play-net.pem` as the only trust anchor, turns the hostname
//! check off because there is no name in the certificate to check, and then
//! compares the DER the server actually presented against the pinned bytes. Two
//! independent checks, the second ours rather than the platform's, so a backend
//! that quietly ignored the root restriction is still caught.
//!
//! `danger_accept_invalid_certs` is not used and must not be. Verification is
//! not disabled here, it is *replaced* by an exact match - which, for a
//! certificate carrying no name and no issuer worth the word, is the only check
//! with any content in it.
//!
//! This is Lich's trust decision (`eaccess.rb:65-77` builds an empty
//! `X509::Store`, adds only `simu.pem`, sets `VERIFY_PEER`) without Lich's
//! weakness: `verify_pem` at `:53-62` **re-downloads the pin on a mismatch**
//! and its `fail` line is commented out at `:61`, so a substituted certificate
//! is adopted rather than refused. Here a mismatch is
//! [`EAccessError::CertificateChanged`], which is terminal and says what has to
//! happen next.
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
    /// The `A` frame was refused with the one token Lich documents as meaning
    /// the password itself is wrong (`PASSWORD`, `authenticator.rb:21`). This
    /// is the **only** variant that lets `lich::protocol_failure` delete a
    /// stored password, so nothing may be classified here on a guess.
    BadCredentials { code: String },
    /// The `A` frame was refused for a reason that is not "try again":
    /// the account is locked, suspended or expired.
    AccountLockedOrExpired { code: String },
    /// The `A` frame was refused with a token that is neither of the above:
    /// `REJECT`, `NORECORD`, `INVALID`, `NEW`, an empty third field, or
    /// anything the live server sends that is not written down anywhere.
    ///
    /// A third state on purpose (issue #488). The old classifier had two, so
    /// "not one of five lock words" fell through to `BadCredentials` — and once
    /// #459 made `BadCredentials` the trigger for erasing the Windows
    /// Credential Manager entry, the fallback for an *unrecognised* token was a
    /// destructive action. "The server said no and this version cannot tell
    /// why" is a real answer, and it is the one that keeps the password.
    AccountRefused { code: String },
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
    /// The TLS handshake completed and the certificate on the other end is not
    /// the pinned one.
    ///
    /// Separate from [`Self::Network`] because the two want opposite things
    /// from the player: an unreachable service is worth retrying and this is
    /// not. It is either a new certificate at Simutronics, which needs a new
    /// pin shipped in this app, or something interposed on the connection,
    /// which needs looking at rather than retrying.
    ///
    /// `presented` is the SHA-256 of what arrived. It is public data - every
    /// client on the internet is handed the same certificate - and it is the
    /// one thing a bug report needs, because it says which of those two
    /// happened without anyone having to reproduce it.
    CertificateChanged { endpoint: String, presented: String },
}

impl EAccessError {
    /// The stable machine code for this failure.
    ///
    /// A `match` over the enum rather than a name derived from `Debug`: the
    /// compiler refuses an unhandled variant, so a variant added later cannot
    /// silently reach the webview with no code and become `unknown` - which is
    /// exactly what issue #457 was, one level up.
    ///
    /// The strings are the snake_case forms of the variant names above, and
    /// `tools/sign-in-test.mjs` parses this file's `enum` block and asserts
    /// that every variant it finds is one the webview can classify.
    pub fn code(&self) -> crate::login_error::LoginCode {
        use crate::login_error::LoginCode;
        match self {
            Self::BadCredentials { .. } => LoginCode::BadCredentials,
            Self::AccountLockedOrExpired { .. } => LoginCode::AccountLockedOrExpired,
            Self::AccountRefused { .. } => LoginCode::AccountRefused,
            Self::NoSuchCharacter { .. } => LoginCode::NoSuchCharacter,
            Self::ProtocolMismatch { .. } => LoginCode::ProtocolMismatch,
            Self::PasswordLength { .. } => LoginCode::PasswordLength,
            Self::ObscuredByteOutOfRange { .. } => LoginCode::ObscuredByteOutOfRange,
            Self::Network { .. } => LoginCode::Network,
            Self::CertificateChanged { .. } => LoginCode::CertificateChanged,
        }
    }

    /// The raw `A`-reply token this refusal carries, if it is one.
    ///
    /// Issue #507: the three refusal variants are the three answers
    /// [`Self::from_refusal_code`] can give, and every one of them was handed
    /// the server's token to get there. Carrying it into
    /// [`crate::login_error::LoginFailure`] is what lets the webview pick a
    /// sentence per cause instead of one sentence for four of them.
    ///
    /// A `match` with no wildcard, so a variant added later has to answer this
    /// question rather than defaulting to "no token" and quietly rejoining the
    /// generic sentence.
    ///
    /// An empty code is `None` rather than `Some("")`: it means the reply had
    /// no field to read, and a table lookup on the empty string would be a
    /// lookup for a token that was never sent.
    pub fn refusal_token(&self) -> Option<&str> {
        match self {
            Self::BadCredentials { code }
            | Self::AccountLockedOrExpired { code }
            | Self::AccountRefused { code } => {
                if code.is_empty() {
                    None
                } else {
                    Some(code.as_str())
                }
            }
            Self::NoSuchCharacter { .. }
            | Self::ProtocolMismatch { .. }
            | Self::PasswordLength { .. }
            | Self::ObscuredByteOutOfRange { .. }
            | Self::Network { .. }
            | Self::CertificateChanged { .. } => None,
        }
    }
}

impl From<EAccessError> for crate::login_error::LoginFailure {
    fn from(e: EAccessError) -> Self {
        let token = e.refusal_token().map(str::to_string);
        crate::login_error::LoginFailure::new(e.code(), e.to_string()).with_token(token.as_deref())
    }
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
            Self::AccountRefused { code } => write!(
                f,
                "the login service refused the account for a reason this version does not \
                 recognise ({})",
                if code.is_empty() { "no code" } else { code }
            ),
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
            // Player-usable on purpose: it says what is wrong, that retrying is
            // not the answer, and what would fix it. The fingerprint comes last
            // so the sentence reads without it.
            Self::CertificateChanged {
                endpoint,
                presented,
            } => write!(
                f,
                "the login service's certificate changed, so this version of the app will not sign in to {endpoint} until it ships a new one (the certificate offered was {presented})"
            ),
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
        return Err(EAccessError::from_refusal_code(code));
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

/// The one token that means "the password you sent is wrong".
///
/// `authenticator.rb:23`'s `FATAL_ERROR_CODES` is the only place in Lich that
/// writes the `A`-reply vocabulary down, and its comment above it
/// (`authenticator.rb:20-22`) glosses each token:
///
/// | token | Lich's gloss | this app |
/// |---|---|---|
/// | `PASSWORD` | wrong password | [`EAccessError::BadCredentials`] |
/// | `REJECT` | bad credentials | [`EAccessError::AccountRefused`] |
/// | `NORECORD` | account not found | [`EAccessError::AccountRefused`] |
/// | `INVALID` | invalid request | [`EAccessError::AccountRefused`] |
/// | `CHARACTER_NOT_FOUND` | character not in account | [`EAccessError::AccountRefused`] |
/// | `GENERATOR_NOT_AVAILABLE` | not entitled to the generator | [`EAccessError::AccountRefused`] |
///
/// `REJECT` is the near miss and it is deliberately not here. Lich glosses it
/// "bad credentials", which is the *pair* — the account name or the password —
/// so a mistyped account name produces it just as readily as a stale stored
/// secret, and deleting a good password over a typo in the other field is the
/// destructive answer to an ambiguous one. `PASSWORD` is the only token that
/// names the password alone.
///
/// Two tokens Lich lists never reach this function: `CHARACTER_NOT_FOUND` and
/// `GENERATOR_NOT_AVAILABLE` are raised later in `eaccess.rb` (`:226`, `:165`),
/// after the `A` step, and this module has [`EAccessError::NoSuchCharacter`]
/// and never enters the generator. They are in the table because a server may
/// still send one at `A`, and the row says what would happen if it did.
const WRONG_PASSWORD_TOKEN: &str = "PASSWORD";

/// Words that mean the account itself cannot sign in, whatever was typed.
///
/// Not from Lich — Lich never interprets the code — but from the shapes a
/// play.net refusal is likely to take, matched as substrings so `LOCKED`,
/// `ACCOUNT_LOCKED` and `LOCK` all land together.
const LOCKED_WORDS: [&str; 5] = ["LOCK", "SUSPEND", "EXPIRE", "CLOSED", "BANNED"];

impl EAccessError {
    /// Which refusal an `A`-reply code is. **The one place this is decided.**
    ///
    /// Three states rather than two, and the third is the point (issue #488).
    /// The old version had `BadCredentials` as the fallback for anything that
    /// was not one of five lock words, which read as honest — "it is what a
    /// retry can address" — right up until #459 made `BadCredentials` the
    /// trigger for deleting the saved password. From that commit the fallback
    /// for a token nobody has ever seen was to destroy a credential, and the
    /// list of tokens it destroyed one for included `NEW`, which
    /// `login_error.rs` ships as its example of a *locked* account.
    ///
    /// So: `PASSWORD` and nothing else is "the password is wrong". Anything
    /// naming a lock is the lock. Everything else — including the empty string
    /// a truncated reply produces — is [`Self::AccountRefused`], which reports
    /// the code and keeps the password. The raw code travels with all three.
    ///
    /// `login_error.rs`'s fixture calls this rather than building variants by
    /// hand, so a fixture cannot record a (token, variant) pair the live
    /// pipeline will not produce. That was #457's defect and #488 found it
    /// reintroduced one level in.
    pub(crate) fn from_refusal_code(code: impl Into<String>) -> Self {
        let code = code.into();
        let upper = code.to_ascii_uppercase();
        if upper == WRONG_PASSWORD_TOKEN {
            Self::BadCredentials { code }
        } else if LOCKED_WORDS.iter().any(|w| upper.contains(w)) {
            Self::AccountLockedOrExpired { code }
        } else {
            Self::AccountRefused { code }
        }
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

/// Where `connect()` will go, after `credentials`' two debug-only overrides.
///
/// A thin wrapper rather than a second reader of the environment: the host and
/// the override rules both live in `credentials.rs`, and this only adapts the
/// error into this module's type so a caller has one thing to match on.
///
/// The error path used to re-read `DRC_EACCESS_HOST` and `DRC_EACCESS_PORT` to
/// name the place it had failed to resolve. That was the second reader this
/// doc comment says does not exist, and issue #464 made it load-bearing: the
/// overrides are gone in a release build, so a line reading them here would
/// have reported an endpoint the release binary would never use. `detail`
/// already names the offending value, which is the part a reader needs.
pub fn endpoint() -> Result<(String, u16), EAccessError> {
    crate::credentials::eaccess_endpoint().map_err(|detail| EAccessError::Network {
        endpoint: crate::credentials::EACCESS_ENDPOINT.0.to_string(),
        detail,
    })
}

/// The certificate `eaccess.play.net:7910` presents, and the only trust anchor
/// [`connect`] will accept.
///
/// Compiled in rather than read from disk: a pin a user can edit is not a pin,
/// and a file that has to be found at runtime is one more thing that can be
/// missing on the machine where signing in matters.
const PINNED_CERTIFICATE_PEM: &str = include_str!("../certs/eaccess-play-net.pem");

/// SHA-256 of the DER inside [`PINNED_CERTIFICATE_PEM`], lowercase hex.
///
/// Recorded here as well as in that file's own header so the two have to agree.
/// `the_pinned_certificate_is_the_one_whose_fingerprint_is_recorded` fails
/// naming both values if a certificate is swapped in without its fingerprint
/// being updated, which is how a pin gets quietly replaced.
const PINNED_CERTIFICATE_SHA256: &str =
    "10b737e661987d15bc5c8245e3f8b78291d41ed8abc76672ecb02fe78ed0218a";

/// The DER bytes of a PEM certificate, or a reason it could not be read.
///
/// Decoded by hand rather than through `base64`'s engine API for one call.
/// Anything that is not a certificate block is an error rather than empty
/// bytes, which would compare unequal to everything and read as a pin
/// mismatch - a wrong answer wearing the right shape.
fn der_from_pem(pem: &str) -> Result<Vec<u8>, String> {
    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    let start = pem.find(BEGIN).ok_or("no BEGIN CERTIFICATE line")?;
    let rest = &pem[start + BEGIN.len()..];
    let end = rest
        .find("-----END CERTIFICATE-----")
        .ok_or("no END CERTIFICATE line")?;
    let body: String = rest[..end].split_whitespace().collect();
    let mut out = Vec::new();
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    for c in body.bytes() {
        if c == b'=' {
            break;
        }
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err(format!("{:?} is not base64", c as char)),
        };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    if out.is_empty() {
        return Err("the certificate block was empty".to_string());
    }
    Ok(out)
}

/// Lowercase hex SHA-256, the form the pin constant and the error message both
/// use.
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    let mut h = sha2::Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// The pinned certificate as DER, checked against its recorded fingerprint.
///
/// The fingerprint check runs here rather than only in a test, so a build
/// carrying a swapped certificate refuses to connect instead of pinning
/// whatever it was handed.
fn pinned_certificate_der() -> Result<Vec<u8>, String> {
    let der = der_from_pem(PINNED_CERTIFICATE_PEM)
        .map_err(|e| format!("the pinned certificate could not be read: {e}"))?;
    let got = sha256_hex(&der);
    if got != PINNED_CERTIFICATE_SHA256 {
        return Err(format!(
            "the pinned certificate is {got} but this build records {PINNED_CERTIFICATE_SHA256}"
        ));
    }
    Ok(der)
}

/// Is this the certificate this app pins?
///
/// Split out of [`connect`] so the decision can be exercised without a socket,
/// in both directions - see `a_certificate_that_is_not_the_pinned_one_is_refused`.
fn check_pinned(
    presented_der: &[u8],
    pinned_der: &[u8],
    endpoint: &str,
) -> Result<(), EAccessError> {
    if presented_der == pinned_der {
        return Ok(());
    }
    Err(EAccessError::CertificateChanged {
        endpoint: endpoint.to_string(),
        presented: sha256_hex(presented_der),
    })
}

/// A TLS stream to the EAccess endpoint, ready to be handed to `login` or
/// `list_characters`.
pub struct TlsTransport {
    stream: native_tls::TlsStream<TcpStream>,
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
///
/// The handshake happens here, not lazily on the first write as the old rustls
/// stream did. That is the difference between "the login server's reply to K
/// was not what this version expects" and a sentence about the connection, and
/// it is why a TLS problem can no longer be reported as a protocol problem.
pub fn connect() -> Result<TlsTransport, EAccessError> {
    let (host, port) = endpoint()?;
    let where_ = format!("{host}:{port}");
    let net = |detail: String| EAccessError::Network {
        endpoint: where_.clone(),
        detail,
    };

    let pinned = pinned_certificate_der().map_err(net)?;

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

    // The trust decision, and the whole of it. "Certificate validation" at the
    // top of this file carries the measurement behind each of these three
    // lines. `danger_accept_invalid_certs` is deliberately absent.
    let anchor = native_tls::Certificate::from_der(&pinned)
        .map_err(|e| net(format!("the pinned certificate could not be loaded: {e}")))?;
    let connector = native_tls::TlsConnector::builder()
        .disable_built_in_roots(true)
        .add_root_certificate(anchor)
        // The certificate carries no CN and no subjectAltName, so there is no
        // name for this check to read. Nothing is given up that the line above
        // has not taken over: with one trust anchor and the byte comparison
        // below, "is this the right server" is answered by identity rather than
        // by a name a self-signed certificate could put in itself anyway.
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| net(format!("could not configure TLS: {e}")))?;

    let stream = connector.connect(&host, tcp).map_err(|e| match e {
        native_tls::HandshakeError::Failure(e) => net(format!("could not negotiate TLS: {e}")),
        native_tls::HandshakeError::WouldBlock(_) => {
            net("the TLS handshake did not finish in time".to_string())
        }
    })?;

    // The second check, and ours. The connector above should already have
    // refused anything but the pinned certificate; this says so in bytes rather
    // than trusting the platform backend to have honoured
    // `disable_built_in_roots`.
    let presented = stream
        .peer_certificate()
        .map_err(|e| net(format!("could not read the server's certificate: {e}")))?
        .ok_or_else(|| net("the server sent no certificate".to_string()))?
        .to_der()
        .map_err(|e| net(format!("could not read the server's certificate: {e}")))?;
    check_pinned(&presented, &pinned, &where_)?;

    Ok(TlsTransport { stream })
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

/// The scripted server the protocol cases are driven against.
///
/// A module of its own rather than an item inside `mod tests`, because
/// `lich.rs` needs the same instrument: N9 (issue #459) has to prove that the
/// password loaded from Windows Credential Manager is the one that reaches the
/// wire, and that is a claim about the bytes in frame 2. A second mock in that
/// file would be a fork of this one, and the two would drift.
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::collections::VecDeque;

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
    pub(crate) struct MockEAccess {
        pub(crate) replies: Vec<(u8, Vec<u8>)>,
        /// Every frame received, in order, without its trailing newline. This
        /// is the wire, and it is what the sequence and byte cases assert
        /// against - not what the client believes it sent.
        pub(crate) received: Vec<Vec<u8>>,
        pub(crate) inbox: VecDeque<u8>,
        pub(crate) pending: Vec<u8>,
    }

    impl MockEAccess {
        pub(crate) fn new(replies: Vec<(u8, &[u8])>) -> Self {
            Self {
                replies: replies.into_iter().map(|(v, r)| (v, r.to_vec())).collect(),
                received: Vec::new(),
                inbox: VecDeque::new(),
                pending: Vec::new(),
            }
        }

        /// The verbs received, as a string like `K A M F G P C L`.
        pub(crate) fn sequence(&self) -> String {
            self.received
                .iter()
                .map(|f| (f.first().copied().unwrap_or(b'?') as char).to_string())
                .collect::<Vec<_>>()
                .join(" ")
        }

        /// One received frame, rendered lossily for a message.
        pub(crate) fn frame_text(&self, i: usize) -> String {
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
    pub(crate) const HASHKEY: &[u8] = &[
        0x41, 0x1f, 0x7a, 0x05, 0x63, 0x2c, 0x50, 0x11, 0x08, 0x77, 0x39, 0x5e, 0x22, 0x6b, 0x14,
        0x4d,
    ];

    /// Assembled at run time rather than written as a literal: gitleaks blocks
    /// credential-shaped literals in this repository, fake ones included
    /// (`PLAN_TO_1_0.md` §1 trap 3). Both are obviously not credentials.
    pub(crate) fn account() -> String {
        String::from("acct-") + "example"
    }
    pub(crate) fn password() -> String {
        String::from("pw-") + "example"
    }

    /// The `A` reply for a password the account server will not accept.
    /// Shared with `lich.rs`, whose N9 cases turn on the difference between a
    /// refused *typed* password and a refused *stored* one.
    pub(crate) const REFUSED_A_REPLY: &[u8] = b"A\tacct-example\tPASSWORD\n";

    /// Every `A`-reply token issue #488 drives through the composed path, plus
    /// the three the classifier itself names.
    ///
    /// The first six are Lich's own `FATAL_ERROR_CODES`
    /// (`authenticator.rb:23`) — the only written-down vocabulary there is. The
    /// rest are the plausible-but-undocumented shapes #488's reviewer drove,
    /// kept verbatim so this list is a superset of the run in the issue, and
    /// `""` for a truncated third field.
    pub(crate) const REFUSAL_TOKENS: [&str; 22] = [
        "PASSWORD",
        "REJECT",
        "NORECORD",
        "INVALID",
        "CHARACTER_NOT_FOUND",
        "GENERATOR_NOT_AVAILABLE",
        "LOCKED",
        "SUSPENDED",
        "EXPIRED",
        "CLOSED",
        "BANNED",
        "NEW",
        "FROZEN",
        "INACTIVE",
        "NO_SUBSCRIPTION",
        "TOO_MANY_ATTEMPTS",
        "MAINTENANCE",
        "DISABLED",
        "TERMINATED",
        "HOLD",
        "password",
        "",
    ];

    /// The `A` reply for one refusal token, as the server would frame it.
    pub(crate) fn refused_a_reply(token: &str) -> Vec<u8> {
        format!("A\tacct-example\t{token}\n").into_bytes()
    }

    /// A server whose `A` step refuses with `token` and whose every other step
    /// is the happy one — so a case that reaches a later step is a case that
    /// did not refuse, rather than a case that ran out of script.
    pub(crate) fn server_refusing(token: &str) -> MockEAccess {
        let refusal = refused_a_reply(token);
        let mut replies: Vec<(u8, Vec<u8>)> = happy_replies()
            .into_iter()
            .map(|(v, r)| (v, r.to_vec()))
            .collect();
        for entry in replies.iter_mut() {
            if entry.0 == b'A' {
                entry.1 = refusal.clone();
            }
        }
        MockEAccess::new(replies.iter().map(|(v, r)| (*v, r.as_slice())).collect())
    }

    pub(crate) const C_REPLY: &[u8] = b"C\t2\t2\t0\t0\tW_ABC123\tPhemius\tW_DEF456\tAlisandra\n";
    pub(crate) const L_REPLY: &[u8] = b"L\tOK\tUPPORT=5535\tGAME=STORM\tGAMECODE=DR\tFULLGAMENAME=DragonRealms\tGAMEFILE=STORMFRONT.EXE\tGAMEHOST=dr.simutronics.net\tGAMEPORT=11024\tKEY=one-shot-launch-key\n";

    /// The exact reply set from `docs/LICH_NATIVE_LOGIN.md` §2.2, one per verb.
    pub(crate) fn happy_replies() -> Vec<(u8, &'static [u8])> {
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

    pub(crate) fn happy_server() -> MockEAccess {
        MockEAccess::new(happy_replies())
    }

    /// The same set with one verb's reply replaced.
    pub(crate) fn server_with(verb: u8, reply: &'static [u8]) -> MockEAccess {
        let mut r = happy_replies();
        for entry in r.iter_mut() {
            if entry.0 == verb {
                entry.1 = reply;
            }
        }
        MockEAccess::new(r)
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use std::sync::Mutex;

    /// `std::env` is process-global and cargo runs tests in threads, so the
    /// three cases that set `DRC_EACCESS_*` take this first. Without it they
    /// pass or fail depending on scheduling, which is a check that cannot be
    /// trusted in either direction.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

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
    #[cfg_attr(
        not(debug_assertions),
        ignore = "the endpoint overrides are debug-only from #464; credentials.rs asserts the release behaviour instead"
    )]
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
    #[cfg_attr(
        not(debug_assertions),
        ignore = "the endpoint overrides are debug-only from #464; credentials.rs asserts the release behaviour instead"
    )]
    fn a_port_that_is_not_a_number_fails_naming_the_value() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("DRC_EACCESS_PORT", "seventy-nine-ten");
        let err = endpoint().expect_err("not a port");
        assert!(err.to_string().contains("seventy-nine-ten"), "{err}");
        std::env::remove_var("DRC_EACCESS_PORT");
    }

    // -- the trust decision ------------------------------------------------

    /// A certificate that is emphatically not the pinned one. Public data, no
    /// private key, and its own header says what it is for.
    const NOT_THE_PINNED_CERTIFICATE: &str = include_str!("../certs/not-eaccess-play-net.test.pem");

    /// The pin and its recorded fingerprint have to be one fact, not two.
    ///
    /// Sabotage: change one hex digit of `PINNED_CERTIFICATE_SHA256`, or drop a
    /// different certificate into `certs/eaccess-play-net.pem`, and this goes
    /// red naming both values. Without it a certificate could be swapped for
    /// another and every other case here would still pass, because they all
    /// read the same swapped file.
    #[test]
    fn the_pinned_certificate_is_the_one_whose_fingerprint_is_recorded() {
        let der = der_from_pem(PINNED_CERTIFICATE_PEM).expect("the pinned PEM parses");
        // A floor on the denominator: an empty or truncated block would make
        // every comparison below meaningless, and this file's certificate is
        // an RSA 4096 one, so it is over a kilobyte.
        assert!(
            der.len() > 1000,
            "the pinned DER is only {} bytes",
            der.len()
        );
        assert_eq!(
            sha256_hex(&der),
            PINNED_CERTIFICATE_SHA256,
            "certs/eaccess-play-net.pem and PINNED_CERTIFICATE_SHA256 disagree"
        );
        // And the loader agrees, so `connect` is reading what this case read.
        assert_eq!(pinned_certificate_der().expect("the pin loads"), der);
    }

    /// The right answer is accepted.
    ///
    /// On its own this would pass against a `check_pinned` that returns `Ok`
    /// unconditionally, which is why the case below exists and why they belong
    /// together.
    #[test]
    fn the_pinned_certificate_is_accepted() {
        let der = pinned_certificate_der().expect("the pin loads");
        check_pinned(&der, &der, "eaccess.play.net:7910").expect("the pinned certificate passes");
    }

    /// The wrong answer is refused, and the refusal says which certificate
    /// arrived.
    ///
    /// This is the case run where the wrong answer is available: a real,
    /// well-formed, self-signed certificate that simply is not the pinned one -
    /// the shape a substituted certificate would have. Garbage bytes would test
    /// something easier.
    #[test]
    fn a_certificate_that_is_not_the_pinned_one_is_refused() {
        let pinned = pinned_certificate_der().expect("the pin loads");
        let other = der_from_pem(NOT_THE_PINNED_CERTIFICATE).expect("the fixture parses");
        assert_ne!(other, pinned, "the fixture must not be the pinned one");

        let err = check_pinned(&other, &pinned, "eaccess.play.net:7910")
            .expect_err("a different certificate must be refused");
        assert_eq!(err.code().as_str(), "certificate_changed");

        // The sentence a player gets. Asserted on properties rather than on the
        // whole string: that it names the fingerprint that actually arrived, so
        // a bug report can say which certificate it was, and that it does not
        // read as an outage - `certificate_changed` classifies to
        // `login_service_changed` in `lichLogin.ts`, not to `service_unreachable`.
        let rendered = err.to_string();
        assert!(rendered.contains(&sha256_hex(&other)), "{rendered}");
        assert!(!rendered.contains(PINNED_CERTIFICATE_SHA256), "{rendered}");
        assert!(rendered.contains("eaccess.play.net:7910"), "{rendered}");
        assert!(
            rendered.contains("certificate changed"),
            "the sentence must say what happened: {rendered}"
        );
        // No password can reach this variant, and no stack trace either.
        assert!(!rendered.contains("Error"), "{rendered}");
    }

    /// The PEM reader refuses rather than returning empty bytes.
    ///
    /// Empty bytes are the dangerous failure here, not an error: they would
    /// compare unequal to every certificate on earth and surface as a pin
    /// mismatch, which is a true-looking answer to a question that was never
    /// asked.
    #[test]
    fn a_pem_that_is_not_a_certificate_is_an_error_not_empty_bytes() {
        for bad in [
            "",
            "there is no certificate in this string",
            "-----BEGIN CERTIFICATE-----\nMIIB\n",
            "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n",
            "-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----\n",
        ] {
            assert!(
                der_from_pem(bad).is_err(),
                "should not have parsed: {bad:?}"
            );
        }
        // The control on the same reader: a real PEM still parses, so a
        // `der_from_pem` that had been broken into always failing would fail
        // this case rather than passing the five above.
        assert!(der_from_pem(PINNED_CERTIFICATE_PEM).is_ok());
    }

    /// A hash function that returned a constant would make every comparison
    /// above vacuous, so it is checked against a value with a published answer.
    #[test]
    fn the_fingerprint_helper_hashes_what_it_is_given() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_ne!(sha256_hex(b"abc"), sha256_hex(b"abd"));
    }

    // -- the live service --------------------------------------------------

    /// The one case that touches the network, and the only thing that can prove
    /// the trust decision works against the real server.
    ///
    /// `#[ignore]`, so `cargo test` reports it as ignored rather than skipping
    /// it silently, and `npm run gate` does not reach out to Simutronics from a
    /// developer's machine on every run. Run it deliberately:
    ///
    /// ```text
    /// cd src-tauri && cargo test --lib eaccess::tests::the_live_login_service -- --ignored --nocapture
    /// ```
    ///
    /// It sends **no account name and no password**. The only frame written is
    /// `K`, which asks the server for the per-connection hashkey and identifies
    /// nobody.
    ///
    /// What it establishes that the offline cases cannot: that this app and
    /// that server still share a cipher suite, and that the certificate on the
    /// wire is still the pinned one. Both are facts about a machine in
    /// Missouri, so neither can be asserted from here - and both are what broke.
    #[test]
    #[ignore = "contacts eaccess.play.net; run with --ignored (see docs/LICH_NATIVE_LOGIN.md 3.1)"]
    fn the_live_login_service_still_presents_the_pinned_certificate() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("DRC_EACCESS_HOST");
        std::env::remove_var("DRC_EACCESS_PORT");

        let mut t = match connect() {
            Ok(t) => t,
            Err(e) => panic!("could not open a pinned TLS session: {e}"),
        };
        // The handshake completing is most of the answer; that a frame goes
        // out and a reply comes back is the rest, and it is what the old
        // transport could not do. The hashkey is 32 bytes.
        send(&mut t, "K", b"K").expect("the K frame goes out");
        let key = recv(&mut t, "K").expect("the K reply comes back");
        assert_eq!(
            key.len(),
            32,
            "the hashkey should be 32 bytes, got {}",
            key.len()
        );
        println!(
            "live: handshake completed, K replied {} bytes, pin {PINNED_CERTIFICATE_SHA256}",
            key.len()
        );
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
